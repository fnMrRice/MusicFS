import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 使用独立会话验证部署实例，不合并用户的歌曲。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployment = resolve(process.argv[2] ?? join(root, 'deploy/musicfs-windows-amd64'));
const origin = process.argv[3] ?? 'http://127.0.0.1:8080';
const output = join(root, 'web/test-results/deployed-library');
const { chromium } = createRequire(join(root, 'web/package.json'))('@playwright/test');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plugin = 'musicfs.plugin.matching.standard';
const token = process.env.MUSICFS_ADMIN_TOKEN || readFileSync(join(deployment, 'configs/admin-token.txt'), 'utf8').trim();
let child, browser, context, session;
mkdirSync(output, { recursive: true });

async function ready() {
  try { return (await fetch(`${origin}/api/v1/health/ready`, { signal: AbortSignal.timeout(1000) })).ok; }
  catch { return false; }
}

async function get(path) {
  const response = await context.request.get(`${origin}/api/v1${path}`);
  assert.equal(response.status(), 200, `GET ${path} failed`);
  return response.json();
}

async function allTracks(grouped) {
  let cursor = null;
  const items = [];
  do {
    const query = new URLSearchParams({ limit: '200' });
    if (grouped) query.set('groupBy', 'recording');
    if (cursor) query.set('cursor', cursor);
    const page = await get(`/source-tracks?${query}`);
    items.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  return items;
}

try {
  if (!await ready()) {
    child = spawn(join(deployment, 'bin/musicfs.exe'), ['serve', '--config', join(deployment, 'configs/server.yaml')], {
      cwd: deployment, env: { ...process.env, MUSICFS_ADMIN_TOKEN: token }, windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('error', () => {});
    let available = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (child.exitCode !== null) throw new Error('Verification server exited before readiness');
      if (await ready()) { available = true; break; }
      await delay(500);
    }
    assert.ok(available, 'Verification server did not become ready');
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();
  const login = await context.request.post(`${origin}/api/v1/auth/session`, {
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
  });
  assert.equal(login.status(), 200, 'Verification login failed');
  session = await login.json();
  const before = await get('/matching/revision');
  const tracks = await allTracks(false);
  assert.ok(tracks.length, 'The deployed library is empty');
  let settings = await get(`/plugin-settings/${plugin}`);
  if (settings.values.automatic) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (settings.job.status === 'succeeded' && settings.job.processed === tracks.filter((t) => t.availability === 'available').length) break;
      await delay(1000);
      settings = await get(`/plugin-settings/${plugin}`);
    }
    assert.equal(settings.job.status, 'succeeded', 'Automatic detection did not finish');
  }
  const after = await get('/matching/revision');
  assert.equal(after.revision, before.revision, 'Detection unexpectedly changed manual associations');
  const grouped = await allTracks(true);
  assert.equal(grouped.reduce((count, track) => count + track.versions.length, 0), tracks.length);
  let candidates = 0, next = null;
  do {
    const query = new URLSearchParams({ limit: '20' });
    if (next) query.set('after', next);
    const result = await get(`/matching/candidates?${query}`);
    assert.ok(result.items.every((item) => item.requiresConfirmation), 'A candidate lacks manual confirmation');
    candidates += result.items.length; next = result.nextAfter;
  } while (next);
  await page.goto(`${origin}/#/library`);
  await page.getByRole('button', { name: '账号菜单', exact: true }).waitFor();
  const track = grouped.slice(0, 100).find((item) => item.availability === 'available' && (item.container === 'mp3' || item.codec === 'mp3'));
  assert.ok(track, 'No MP3 is available on the first page');
  await page.getByRole('button', { name: `播放 ${track.displayName}`, exact: true }).first().click();
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > .2; });
  await page.screenshot({ path: join(output, 'library.png') });
  await page.getByRole('button', { name: '重复识别', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重复识别', exact: true });
  await dialog.getByRole('button', { name: '刷新候选', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'candidates.png') });
  await dialog.getByRole('link', { name: '打开插件设置', exact: true }).click();
  const entry = page.locator('details.plugin-entry').filter({ hasText: plugin });
  await entry.locator('summary').click();
  await entry.getByRole('button', { name: '立即识别', exact: true }).waitFor();
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'plugin-settings.png') });
  const result = { sourceTracks: tracks.length, visibleSongs: grouped.length, manualRevision: after.revision,
    automatic: settings.values.automatic, job: settings.job, pendingCandidates: candidates, playbackVerified: true };
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (session && context) await context.request.delete(`${origin}/api/v1/auth/session`, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
  }).catch(() => {});
  await browser?.close();
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
  }
}
