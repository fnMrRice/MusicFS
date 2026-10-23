import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 两个独立登录窗口验证自动发现；观察窗口始终只读，脚本不管理服务进程。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployment = resolve(process.argv[2] ?? join(root, 'deploy/musicfs-windows-amd64'));
const origin = new URL(process.argv[3] ?? 'http://127.0.0.1:8080').origin;
const output = join(root, 'deploy/.validation/scan-status');
const { chromium } = createRequire(join(root, 'web/package.json'))('@playwright/test');
const token = readFileSync(join(deployment, 'configs/admin-token.txt'), 'utf8').trim();
const sessions = [];
const result = { passed: false, observerSubmissions: 0, samples: [], reloadVerified: false, navigationVerified: false };
const active = ['queued', 'running', 'retry_wait'];
let browser, observer, latest, targetJob, error;
let reading = Promise.resolve();
const statusPath = /^\/api\/v1\/provider-instances\/([^/]+)\/scan-status$/;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function save() {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
}
async function session() {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 960 } });
  const response = await context.request.post(`${origin}/api/v1/auth/session`, {
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
  });
  assert.equal(response.status(), 200, 'Verification login failed');
  const login = await response.json();
  sessions.push({ context, csrf: login.csrfToken });
  return context;
}
async function settings(page) {
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '账号菜单', exact: true }).waitFor();
  await page.getByRole('tab', { name: '音乐源', exact: true }).click();
  await page.locator('.local-music-source').waitFor();
}
async function waitFor(check, label) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (error) throw error;
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(label);
}
async function visibleProgress() {
  const content = await observer.locator('.local-music-source .local-scan-status').innerText();
  return Number(content.match(/正在扫描音乐，已发现\s+(\d+)\s+首曲目/)?.[1] ?? 0);
}
async function screenshot(name) {
  mkdirSync(output, { recursive: true });
  await observer.locator('.local-music-source .local-scan-status').screenshot({ path: join(output, name) });
}

mkdirSync(output, { recursive: true });
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const observerContext = await session();
  observer = await observerContext.newPage();
  observer.on('request', (request) => {
    if (request.method() === 'POST' && /\/scan-jobs$/.test(new URL(request.url()).pathname)) result.observerSubmissions++;
  });
  observer.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin || response.request().method() !== 'GET'
      || !(statusPath.test(url.pathname) || /^\/api\/v1\/scan-jobs\/[^/]+$/.test(url.pathname))) return;
    reading = reading.then(async () => {
      assert.equal(response.status(), 200, 'Automatic scan status request failed');
      const value = await response.json();
      const job = statusPath.test(url.pathname) ? value.job : value;
      if (!job || job.jobId !== targetJob) return;
      const sample = { status: job.status, observed: job.progress.observed, complete: job.complete };
      if (!latest || latest.status !== sample.status || latest.observed !== sample.observed) {
        result.samples.push(sample);
        console.log(`Observer automatically detected ${sample.status}: ${sample.observed} tracks`);
      }
      latest = sample;
      save();
    }).catch((caught) => { error ??= caught; });
  });
  const discovery = observer.waitForResponse((response) => response.request().method() === 'GET'
    && statusPath.test(new URL(response.url()).pathname));
  await settings(observer);
  const firstStatus = await discovery;
  assert.equal(firstStatus.status(), 200, 'Initial scan discovery failed');
  const instance = statusPath.exec(new URL(firstStatus.url()).pathname)[1];
  const configurationResponse = await observerContext.request.get(`${origin}/api/v1/admin/plugin-instances/${instance}/configuration`);
  assert.equal(configurationResponse.status(), 200, 'Directory configuration read failed');
  const configuration = await configurationResponse.json();
  const statisticsResponse = await observerContext.request.get(`${origin}/api/v1/provider-instances/${instance}/root-statistics`);
  assert.equal(statisticsResponse.status(), 200, 'Directory statistics read failed');
  const statistics = await statisticsResponse.json();
  result.directoryStatistics = [];
  for (const directory of configuration.roots) {
    const expected = statistics.roots.find((item) => item.rootId === directory.id) ?? { trackCount: 0, sizeBytes: 0 };
    const row = observer.locator('.directory-saved-list li').filter({
      has: observer.getByText(directory.name, { exact: true }),
    });
    await waitFor(async () => new RegExp(`^${expected.trackCount} 首 · `).test(await row.locator('.directory-saved-stats').innerText()),
      'Directory track count did not match the published library');
    const text = await row.locator('.directory-saved-stats').innerText();
    assert.match(text, / · \d+(?:\.\d+)? (?:B|KiB|MiB|GiB|TiB)$/, 'Directory size is not displayed');
    result.directoryStatistics.push({ trackCount: expected.trackCount, sizeBytes: expected.sizeBytes, display: text });
  }
  await observer.locator('.local-music-source').screenshot({ path: join(output, 'directory-statistics.png') });
  const initial = (await firstStatus.json()).job;
  if (initial && active.includes(initial.status)) {
    targetJob = initial.jobId;
    result.reusedExistingScan = true;
  } else {
    const actor = await (await session()).newPage();
    await settings(actor);
    const submitted = actor.waitForResponse((response) => response.request().method() === 'POST'
      && /\/api\/v1\/provider-instances\/[^/]+\/scan-jobs$/.test(new URL(response.url()).pathname));
    await actor.getByRole('button', { name: '扫描音乐', exact: true }).click();
    const response = await submitted;
    assert.ok(response.ok(), 'Actor scan submission failed');
    targetJob = (await response.json()).jobId;
    result.reusedExistingScan = false;
  }
  await waitFor(async () => latest?.status === 'running' && latest.observed > 0 && await visibleProgress() > 0,
    'Observer did not automatically display running progress');
  result.firstObserved = latest.observed;
  await screenshot('automatic-discovery.png');
  await observer.reload();
  await waitFor(async () => await visibleProgress() >= result.firstObserved, 'Refresh did not recover running progress');
  result.reloadVerified = true;
  await screenshot('after-refresh.png');
  await observer.goto(`${origin}/#/library`);
  await observer.locator('.local-music-source').waitFor({ state: 'detached' });
  await settings(observer);
  await waitFor(async () => await visibleProgress() >= result.firstObserved, 'Returning to settings lost running progress');
  result.navigationVerified = true;
  await waitFor(async () => latest?.status === 'running' && latest.observed > result.firstObserved
    && await visibleProgress() > result.firstObserved, 'Automatically discovered progress did not increase');
  result.increasedObserved = latest.observed;
  await screenshot('automatic-increase.png');
  await observer.setViewportSize({ width: 390, height: 844 });
  await observer.locator('.local-music-source').screenshot({ path: join(output, 'mobile-statistics.png') });
  result.mobileNoOverflow = await observer.locator('.directory-saved-list').evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  assert.ok(result.mobileNoOverflow, 'Directory statistics overflow on a narrow viewport');
  assert.equal(result.observerSubmissions, 0, 'Observer unexpectedly submitted a scan');
  result.passed = true;
  console.log('Automatic discovery, refresh, navigation, and increasing progress verified');
} catch (caught) {
  // 只记录去除会话凭据后的错误首行，避免输出浏览器请求头。
  let message = String(caught?.message ?? caught).split('\n')[0].replaceAll(token, '[redacted]');
  for (const entry of sessions) if (entry.csrf) message = message.replaceAll(entry.csrf, '[redacted]');
  result.failure = message;
  console.error(message);
  process.exitCode = 1;
} finally {
  await reading;
  result.logoutSucceeded = true;
  for (const entry of sessions) {
    const response = await entry.context.request.delete(`${origin}/api/v1/auth/session`, {
      headers: { Origin: origin, 'X-CSRF-Token': entry.csrf }, timeout: 10_000,
    }).catch(() => null);
    result.logoutSucceeded &&= response?.ok() ?? false;
  }
  await browser?.close();
  if (!result.logoutSucceeded) { result.passed = false; process.exitCode = 1; }
  save();
}
