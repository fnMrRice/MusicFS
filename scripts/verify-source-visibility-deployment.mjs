import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 使用临时登录会话，只读检查正式部署；凭据和 Cookie 仅保留在内存。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployment = resolve(process.argv[2] ?? join(root, 'deploy/musicfs-windows-amd64'));
const origin = new URL(process.argv[3] ?? 'http://127.0.0.1:8080').origin;
const output = join(root, 'web/test-results/deployed-source-visibility');
const { request, chromium } = createRequire(join(root, 'web/package.json'))('@playwright/test');
const result = { passed: false, ready: false, sourceOnlyAPI: false, sourceOnlyUI: false,
  albumAPI: false, albumUI: 'skipped', detailsUI: false, editorUI: false, sourceLinkEditorUI: false,
  sourcedSampleCount: 0, savedAlbumFieldCount: 0 };
let api, browser, context, csrfToken, failure;

class VerificationError extends Error {}
function check(value, message) {
  if (!value) throw new VerificationError(message);
}
async function get(path) {
  const response = await api.get(`/api/v1${path}`);
  check(response.status() === 200, 'A deployment API check failed');
  return response.json();
}

try {
  const release = JSON.parse(readFileSync(join(deployment, 'release.json'), 'utf8'));
  const web = JSON.parse(readFileSync(join(deployment, 'web-source.json'), 'utf8'));
  result.serverRevision = release.revision;
  result.webRevision = web.webRevision;
  api = await request.newContext({ baseURL: origin, timeout: 30_000,
    extraHTTPHeaders: { Origin: origin, Accept: 'application/json' } });
  const ready = await get('/health/ready');
  check(ready.product === 'MusicFS' && ready.ready === true, 'Deployment is not ready');
  result.ready = true;
  const token = readFileSync(join(deployment, 'configs/admin-token.txt'), 'utf8').trim();
  check(token.length > 0, 'Administrator credential is unavailable');
  const login = await api.post('/api/v1/auth/session', { headers: { Authorization: `Bearer ${token}` } });
  check(login.status() === 200, 'Verification login failed');
  const session = await login.json();
  check(typeof session.csrfToken === 'string' && session.csrfToken.length > 0, 'Verification session is invalid');
  csrfToken = session.csrfToken;
  const tracks = await get('/library/tracks?sourceOnly=true&limit=100');
  check(Array.isArray(tracks.items), 'Source-only response is invalid');
  check(tracks.items.every((item) => Array.isArray(item.sources) && item.sources.length > 0),
    'Source-only response contains a track without sources');
  result.sourcedSampleCount = tracks.items.length;
  result.sourceOnlyAPI = true;
  const albums = await get('/library/albums?limit=100');
  check(Array.isArray(albums.items), 'Album response is invalid');
  const album = albums.items.find((item) => typeof item.albumId === 'string' && item.albumId.length > 0);
  if (album) {
    check(typeof album.originalName === 'string' && album.originalName.length > 0,
      'Album original name is missing');
    const fields = await get(`/library/albums/${encodeURIComponent(album.albumId)}/scraped-fields`);
    check(Array.isArray(fields.items), 'Album metadata response is invalid');
    result.savedAlbumFieldCount = fields.items.length;
    result.albumAPI = true;
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 960 },
    storageState: await api.storageState() });
  // 防止页面的意外 HTTP 写操作修改部署资料，验证只执行导航与读取。
  let blockedWrites = 0;
  await context.route('**/api/v1/**', (route) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
    blockedWrites++;
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const loaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === '/api/v1/library/tracks'
      && url.searchParams.get('sourceOnly') === 'true' && response.request().method() === 'GET';
  });
  await page.goto(`${origin}/#/library`);
  check((await loaded).status() === 200, 'Web did not load the source-only catalog');
  await page.getByRole('button', { name: '账号菜单', exact: true }).waitFor();
  if (tracks.items.length) await page.locator('.tracks tbody tr').first().waitFor();
  result.sourceOnlyUI = true;
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, 'all-tracks.png') });
  if (album) {
    const params = new URLSearchParams({ category: '专辑', categoryId: album.albumId });
    const albumLoaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === '/api/v1/library/tracks'
        && url.searchParams.get('albumId') === album.albumId;
    });
    await page.goto(`${origin}/#/library?${params}`);
    check((await albumLoaded).status() === 200, 'Web did not load the album track list');
    await page.getByRole('button', { name: '搜索在线资料', exact: true }).waitFor();
    if (album.trackCount > 0) await page.locator('.tracks tbody tr').first().waitFor();
    const toggle = page.getByRole('button', { name: '专辑详情', exact: true });
    check(await toggle.getAttribute('aria-expanded') === 'false', 'Album details are not collapsed initially');
    const scrape = await page.getByRole('button', { name: '搜索在线资料', exact: true }).boundingBox();
    const sort = await page.getByRole('combobox', { name: '曲目排序', exact: true }).boundingBox();
    check(scrape && sort && scrape.x + scrape.width <= sort.x, 'Scraping is not placed before sorting');
    await page.screenshot({ path: join(output, 'album-scraping-entry.png') });
    await toggle.click();
    const details = page.getByRole('region', { name: '专辑详情', exact: true });
    await details.getByText('原名', { exact: true }).waitFor();
    check(await toggle.getAttribute('aria-expanded') === 'true', 'Album details did not expand');
    check(!(await details.innerText()).includes('musicfs.scraper.'), 'Album details expose plugin identifiers');
    await page.screenshot({ path: join(output, 'album-details.png') });
    result.detailsUI = true;
    await details.getByRole('button', { name: '编辑资料', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑专辑资料', exact: true });
    await editor.waitFor();
    check(await editor.getByLabel('原名', { exact: true }).getAttribute('readonly') !== null,
      'Album original name is editable');
    check(await editor.getByLabel('显示名', { exact: true }).inputValue() === album.name,
      'Album display name is not available for editing');
    check(await editor.getByLabel('平台专辑页面', { exact: true }).inputValue() === (album.sourceUrl ?? ''),
      'The saved album platform page is not available for editing');
    await editor.getByRole('combobox', { name: '资料平台', exact: true }).waitFor();
    result.sourceLinkEditorUI = true;
    await page.keyboard.press('Escape');
    result.editorUI = true;
    result.albumUI = 'passed';
  }
  check(blockedWrites === 0, 'Web attempted a write during read-only verification');
  result.passed = true;
} catch (error) {
  failure = error instanceof VerificationError ? error.message :
    ['TimeoutError', 'AbortError'].includes(error?.name) ? 'Deployment verification timed out' : 'Deployment verification failed';
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (csrfToken && api) {
    try {
      const logout = await api.delete('/api/v1/auth/session', { headers: { 'X-CSRF-Token': csrfToken }, timeout: 10_000 });
      if (logout.status() !== 204) failure ??= 'Verification session cleanup failed';
    } catch { failure ??= 'Verification session cleanup failed'; }
  }
  await api?.dispose().catch(() => {});
}

console.log(JSON.stringify(failure ? { ...result, passed: false, message: failure } : result));
if (failure) process.exitCode = 1;
