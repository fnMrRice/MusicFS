import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 使用独立登录会话检查部署分类、插件设置和真实播放，不修改用户偏好。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployment = resolve(process.argv[2] ?? join(root, 'deploy/musicfs-windows-amd64'));
const origin = process.argv[3] ?? 'http://127.0.0.1:8080';
const output = join(root, 'web/test-results/deployed-codecs');
const { chromium } = createRequire(join(root, 'web/package.json'))('@playwright/test');
const token = process.env.MUSICFS_ADMIN_TOKEN || readFileSync(join(deployment, 'configs/admin-token.txt'), 'utf8').trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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

try {
  if (!await ready()) {
    child = spawn(join(deployment, 'bin/musicfs.exe'), ['serve', '--config', join(deployment, 'configs/server.yaml')], {
      cwd: deployment, env: { ...process.env, MUSICFS_ADMIN_TOKEN: token }, windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('error', () => {});
    for (let attempt = 0; attempt < 90 && !await ready(); attempt++) {
      assert.equal(child.exitCode, null, 'Verification server exited before readiness');
      await delay(500);
    }
    assert.ok(await ready(), 'Verification server did not become ready');
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 960 } });
  const response = await context.request.post(`${origin}/api/v1/auth/session`, {
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
  });
  assert.equal(response.status(), 200, 'Verification login failed');
  session = await response.json();
  const snapshot = await get('/admin/plugins');
  const ffmpeg = snapshot.items.find(plugin => plugin.pluginId === 'musicfs.plugin.decoder.ffmpeg');
  const ncm = snapshot.items.find(plugin => plugin.pluginId === 'musicfs.plugin.decoder.ncm');
  const channelmix = snapshot.items.find(plugin => plugin.pluginId === 'musicfs.plugin.decoder.channelmix');
  for (const plugin of [ffmpeg, ncm]) {
    assert.ok(plugin?.plugin.features.includes('audio-codec'), 'Codec category is missing');
    assert.equal(plugin.settingsAvailable, true);
  }
  assert.ok(channelmix?.plugin.features.includes('audio-dsp'), 'Channel conversion is not categorized as DSP');
  assert.equal(ffmpeg.version, '0.4.0');
  const preferences = await get(`/plugin-settings/${ffmpeg.pluginId}`);
  assert.deepEqual(preferences.schema.fields.find(field => field.key === 'decodeOutput').options.map(option => option.value), ['native', 'pcm_f32le', 'pcm_s16le']);
  const page = await context.newPage();
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const entry = page.locator('details.plugin-entry').filter({ has: page.getByText(ffmpeg.pluginId, { exact: true }) });
  await entry.locator('summary').click();
  await entry.getByRole('combobox', { name: '解码输出格式' }).waitFor();
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'codec-settings.png') });
  const tracks = await get('/source-tracks?groupBy=recording&limit=100');
  const playable = tracks.items.find(track => track.availability === 'available' && (track.container === 'mp3' || track.codec === 'mp3'));
  assert.ok(playable, 'No playable MP3 is available on the first page');
  await page.goto(`${origin}/#/library`);
  await page.getByRole('button', { name: `播放 ${playable.displayName}`, exact: true }).first().click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return audio && !audio.paused && audio.currentTime > .2;
  });
  await page.screenshot({ path: join(output, 'playback.png') });
  const result = { codecVersion: ffmpeg.version, categoriesVerified: true, outputOptionsVerified: true, selectedOutput: preferences.values.decodeOutput, playbackVerified: true };
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (session && context) await context.request.delete(`${origin}/api/v1/auth/session`, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
  }).catch(() => {});
  await browser?.close();
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
  }
}
