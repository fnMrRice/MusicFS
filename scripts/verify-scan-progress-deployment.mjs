import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 仅显式运行本脚本时提交扫描；使用独立浏览器会话，不启动或停止服务。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployment = resolve(process.argv[2] ?? join(root, 'deploy/musicfs-windows-amd64'));
const origin = new URL(process.argv[3] ?? 'http://127.0.0.1:8080').origin;
const output = join(root, 'deploy/.validation/scan-progress');
const { chromium } = createRequire(join(root, 'web/package.json'))('@playwright/test');
const started = Date.now();
const deadline = started + 15 * 60_000;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const result = { passed: false, startedAt: new Date(started).toISOString(),
  submissions: 0, polls: 0, failedRequests: 0, firstRunningCount: null,
  increasedRunningCount: null, samples: [], screenshots: [], logoutSucceeded: false };
let browser, context, page, session, jobId, latest, observerError;
let responses = Promise.resolve();

class VerificationError extends Error {}
function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}
function timeout() {
  check(Date.now() < deadline, 'Scan verification exceeded the 15-minute deadline');
  return Math.min(30_000, deadline - Date.now());
}
function save() {
  result.elapsedMs = Date.now() - started;
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
}
function scanRequest(request) {
  const url = new URL(request.url());
  if (url.origin !== origin) return null;
  if (request.method() === 'POST' && /^\/api\/v1\/provider-instances\/[^/]+\/scan-jobs$/.test(url.pathname)) return 'submit';
  if (request.method() === 'GET' && /^\/api\/v1\/scan-jobs\/[^/]+$/.test(url.pathname)) return 'poll';
  return null;
}

async function observe(response) {
  const kind = scanRequest(response.request());
  if (!kind) return;
  check(response.ok(), `Scan ${kind} returned HTTP ${response.status()}`);
  const value = await response.json();
  if (kind === 'submit') {
    check(typeof value.jobId === 'string' && value.jobId.length > 0, 'Scan submission did not return a job');
    check(!jobId || jobId === value.jobId, 'The browser submitted more than one scan job');
    jobId = value.jobId;
    result.merged = value.merged === true;
    console.log('Scan submission accepted');
    save();
    return;
  }
  if (!jobId || value.jobId !== jobId) return;
  const observed = value.progress?.observed;
  const statuses = ['queued', 'running', 'retry_wait', 'succeeded', 'failed', 'cancelled', 'paused'];
  check(statuses.includes(value.status) && Number.isInteger(observed) && observed >= 0,
    'Scan polling returned an invalid status or observed count');
  const sample = { elapsedMs: Date.now() - started, status: value.status, observed,
    complete: value.complete === true,
    attemptCount: Number.isInteger(value.attemptCount) ? value.attemptCount : null,
    errorCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(value.error?.code ?? '') ? value.error.code : null };
  const previous = latest;
  latest = sample;
  if (!previous || previous.status !== sample.status || previous.observed !== observed
    || previous.attemptCount !== sample.attemptCount || previous.errorCode !== sample.errorCode) {
    result.samples.push(sample);
    console.log(`Scan ${sample.status}: ${observed} tracks found`);
    save();
  }
}

async function screenshot(name) {
  // 只截取进度区域，避免把目录名称、路径或账号资料写入验收附件。
  await page.locator('.local-music-source .local-scan-status').first().screenshot({
    path: join(output, name), timeout: timeout(),
  });
  result.screenshots.push(name);
  save();
}

mkdirSync(output, { recursive: true });
try {
  const token = readFileSync(join(deployment, 'configs/admin-token.txt'), 'utf8').trim();
  check(token.length > 0, 'The deployment administrator token file is empty');
  browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: timeout() });
  context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 960 } });
  context.setDefaultTimeout(30_000);
  page = await context.newPage();
  const ready = await context.request.get(`${origin}/api/v1/health/ready`, { timeout: timeout() });
  check(ready.ok(), 'The deployment is not ready; start it before verification');
  const login = await context.request.post(`${origin}/api/v1/auth/session`, {
    headers: { Authorization: `Bearer ${token}`, Origin: origin }, timeout: timeout(),
  });
  check(login.status() === 200, 'Verification login failed');
  session = await login.json();
  check(typeof session.csrfToken === 'string', 'Verification login returned an invalid session');
  page.on('request', (request) => {
    const kind = scanRequest(request);
    if (kind === 'submit') result.submissions++;
    if (kind === 'poll') result.polls++;
  });
  page.on('requestfailed', (request) => {
    if (scanRequest(request)) result.failedRequests++;
  });
  page.on('response', (response) => {
    // 串行读取响应，确保提交记录先于该任务的首次轮询处理。
    responses = responses.then(() => observe(response)).catch((error) => { observerError ??= error; });
  });
  await page.goto(`${origin}/#/settings`, { timeout: timeout() });
  await page.getByRole('button', { name: '账号菜单', exact: true }).waitFor({ timeout: timeout() });
  await page.getByRole('tab', { name: '音乐源', exact: true }).click({ timeout: timeout() });
  const source = page.locator('.local-music-source');
  await source.first().waitFor({ timeout: timeout() });
  check(await source.count() === 1, 'Expected one local music source in settings');
  await source.getByRole('button', { name: '扫描音乐', exact: true }).click({ timeout: timeout() });
  while (true) {
    timeout();
    if (observerError) throw observerError;
    check(result.submissions <= 1, 'The browser submitted more than one scan request');
    const sample = latest;
    if (sample?.status === 'running' && sample.observed > 0) {
      // 页面显示也必须出现正数，避免仅验证服务端而遗漏前端更新链路。
      const statusText = await source.locator('.local-scan-status').innerText({ timeout: timeout() });
      const visibleCount = Number(statusText.match(/正在扫描音乐，已发现\s+(\d+)\s+首曲目/)?.[1] ?? 0);
      if (visibleCount > 0 && result.firstRunningCount === null) {
        result.firstRunningCount = sample.observed;
        await screenshot('running-first.png');
      } else if (visibleCount > result.firstRunningCount && result.firstRunningCount !== null
        && sample.observed > result.firstRunningCount && result.increasedRunningCount === null) {
        result.increasedRunningCount = sample.observed;
        await screenshot('running-increased.png');
      }
    }
    if (sample && ['succeeded', 'failed', 'cancelled', 'paused'].includes(sample.status)) {
      check(result.submissions === 1, 'Expected exactly one browser scan submission');
      check(sample.status === 'succeeded' && sample.complete, 'The scan ended without complete success');
      check(result.firstRunningCount !== null, 'No positive running progress was observed');
      check(result.increasedRunningCount !== null, 'Running progress did not increase a second time');
      await source.getByText(`扫描完成，共发现 ${sample.observed} 首曲目。`, { exact: true }).waitFor({ timeout: timeout() });
      await screenshot('succeeded.png');
      result.passed = true;
      break;
    }
    await delay(Math.min(250, deadline - Date.now()));
  }
} catch (error) {
  // 不打印浏览器原始异常、响应正文或请求头，以免意外输出令牌。
  result.failure = error instanceof VerificationError ? error.message : 'Verification failed during browser or deployment access';
  console.error(result.failure);
  if (page && session) await screenshot('failed.png').catch(() => {});
  process.exitCode = 1;
} finally {
  await responses;
  if (session && context) {
    const logout = await context.request.delete(`${origin}/api/v1/auth/session`, {
      headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, timeout: 10_000,
    }).catch(() => null);
    result.logoutSucceeded = logout?.ok() ?? false;
    if (!result.logoutSucceeded) {
      result.passed = false;
      result.failure ??= 'Verification session logout failed';
      console.error('Verification session logout failed');
      process.exitCode = 1;
    }
  }
  await browser?.close().catch(() => {
    result.passed = false;
    result.failure ??= 'Verification browser cleanup failed';
    console.error('Verification browser cleanup failed');
    process.exitCode = 1;
  });
  save();
  if (result.passed) console.log('Scan progress verification passed');
}
