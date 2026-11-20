import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 使用临时登录会话，只读检查正式部署；凭据和 Cookie 仅保留在内存。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployment = resolve(process.argv[2] ?? join(root, 'deploy/musicfs-windows-amd64'));
const origin = new URL(process.argv[3] ?? 'http://127.0.0.1:8080').origin;
const requestedAlbum = process.argv[4];
const output = join(root, 'web/test-results/deployed-source-visibility');
const { request, chromium } = createRequire(join(root, 'web/package.json'))('@playwright/test');
const result = { passed: false, ready: false, sourceOnlyAPI: false, sourceOnlyUI: false,
  albumAPI: false, albumUI: 'skipped', detailsUI: false, albumSearchUI: false, editorUI: false, sourceLinkEditorUI: false,
  savedTrackListUI: 'skipped', sourcedSampleCount: 0, savedAlbumFieldCount: 0 };
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
  const album = requestedAlbum ? await get(`/library/albums/${encodeURIComponent(requestedAlbum)}`)
    : albums.items.find((item) => typeof item.albumId === 'string' && item.albumId.length > 0);
  let savedTrackCount = 0;
  if (album) {
    check(typeof album.originalName === 'string' && album.originalName.length > 0,
      'Album original name is missing');
    const fields = await get(`/library/albums/${encodeURIComponent(album.albumId)}/scraped-fields`);
    check(Array.isArray(fields.items), 'Album metadata response is invalid');
    result.savedAlbumFieldCount = fields.items.length;
    const savedTracks = fields.items.find(entry => entry.field === 'albumTracks')?.item?.tracks;
    if (Array.isArray(savedTracks)) savedTrackCount = savedTracks.length;
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
    const response = await albumLoaded;
    check(response.status() === 200, 'Web did not load the album track list');
    const albumTracks = await response.json();
    check(Array.isArray(albumTracks.items), 'Album track response is invalid');
    const rows = page.locator('table.tracks tbody tr');
    if (albumTracks.items.length) await rows.first().waitFor();
    const toggle = page.getByRole('button', { name: '专辑详情', exact: true });
    await toggle.waitFor();
    check(await toggle.getAttribute('aria-expanded') === 'false', 'Album details are not collapsed initially');
    await toggle.click();
    const details = page.getByRole('region', { name: '专辑详情', exact: true });
    await details.getByText('原名', { exact: true }).waitFor();
    check(await toggle.getAttribute('aria-expanded') === 'true', 'Album details did not expand');
    check(!(await details.innerText()).includes('musicfs.scraper.'), 'Album details expose plugin identifiers');
    check(await details.getByText('平台专辑名', { exact: true }).count() === 0, 'Album details contain a platform title');
    if (savedTrackCount) {
      const trackToggle = details.getByRole('button', { name: '曲目表', exact: true });
      const savedTable = details.getByRole('table', { name: '专辑曲目', exact: true });
      await trackToggle.waitFor();
      check(await trackToggle.getAttribute('aria-expanded') === 'false' && !await savedTable.isVisible(),
        'Saved album tracks are not collapsed initially');
      check(await details.locator('table.tracks').count() === 0, 'Main track list is inside album details');
      const mainListVisible = async () => !albumTracks.items.length || await rows.first().isVisible();
      check(await mainListVisible(), 'Main track list is hidden while saved tracks are collapsed');
      await trackToggle.click();
      await savedTable.waitFor();
      check(await trackToggle.getAttribute('aria-expanded') === 'true' &&
        await savedTable.locator('tbody tr').count() === savedTrackCount, 'Saved album tracks did not expand completely');
      check(await mainListVisible(), 'Opening saved tracks hid the main track list');
      await trackToggle.click();
      await savedTable.waitFor({ state: 'hidden' });
      check(await trackToggle.getAttribute('aria-expanded') === 'false', 'Saved album tracks did not collapse again');
      check(await mainListVisible(), 'Closing saved tracks hid the main track list');
      result.savedTrackListUI = 'passed';
    }
    check(Array.isArray(album.sourceLinks), 'Album platform links are missing');
    for (const link of album.sourceLinks) {
      const linked = await details.getByRole('link').evaluateAll((nodes, url) => nodes.some(node => node.href === new URL(url).href), link.url);
      check(linked, 'A saved platform page is missing from album details');
    }
    await page.screenshot({ path: join(output, 'album-details.png') });
    result.detailsUI = true;
    const search = details.getByRole('button', { name: '搜索', exact: true });
    const refreshButton = details.getByRole('button', { name: '刷新资料', exact: true });
    const [searchBox, refreshBox] = await Promise.all([search.boundingBox(), refreshButton.boundingBox()]);
    check(searchBox && refreshBox && searchBox.x + searchBox.width <= refreshBox.x &&
      searchBox.y < refreshBox.y + refreshBox.height && refreshBox.y < searchBox.y + searchBox.height,
      'Album search is not to the left of refresh in album details');
    await search.click();
    const searchDialog = page.getByRole('dialog', { name: '搜索在线资料', exact: true });
    await searchDialog.waitFor();
    await page.screenshot({ path: join(output, 'album-scraping-entry.png') });
    await searchDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await searchDialog.waitFor({ state: 'hidden' });
    result.albumSearchUI = true;
    await details.getByRole('button', { name: '编辑资料', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑专辑资料', exact: true });
    await editor.waitFor();
    check(await editor.getByLabel('原名', { exact: true }).getAttribute('readonly') !== null,
      'Album original name is editable');
    check(await editor.getByLabel('显示名', { exact: true }).inputValue() === album.name,
      'Album display name is not available for editing');
    const urls = editor.getByLabel('平台专辑页面', { exact: true });
    const platforms = editor.getByRole('combobox', { name: '资料平台', exact: true });
    check(await urls.count() === album.sourceLinks.length, 'Platform page editor count is incorrect');
    for (const [i, link] of album.sourceLinks.entries()) {
      check(await urls.nth(i).inputValue() === link.url && await platforms.nth(i).inputValue() === link.pluginId,
        'A saved platform association is unavailable for editing');
    }
    await editor.getByRole('button', { name: '添加平台链接', exact: true }).waitFor();
    result.sourceLinkEditorUI = true;
    await page.keyboard.press('Escape');
    result.editorUI = true;
    if (album.sourceLinks.length) {
      await refreshButton.click();
      const refresh = page.getByRole('dialog', { name: '对比专辑资料', exact: true });
      const select = refresh.getByLabel('资料平台', { exact: true });
      check(await select.inputValue() === (album.sourceLinks.length === 1 ? album.sourceLinks[0].pluginId : ''),
        'Refresh did not present the expected platform selection');
      const read = refresh.getByRole('button', { name: '读取平台资料', exact: true });
      await read.waitFor();
      check(await read.isDisabled() === (album.sourceLinks.length > 1), 'Refresh platform confirmation is incorrect');
      await page.keyboard.press('Escape');
    }
    await toggle.click();
    if (await rows.count()) {
      const first = rows.first();
      await first.getByRole('button', { name: /的更多操作$/ }).click();
      await page.getByRole('menuitem', { name: '搜索在线资料', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      const expand = first.getByRole('button', { name: /^展开 .* 的来源版本$/ });
      if (await expand.count()) {
        await expand.click();
        const versions = page.locator('.track-versions');
        await versions.waitFor();
        check(await versions.getByRole('button', { name: '搜索在线资料', exact: true }).count() === 0, 'Online search still appears on a source version');
        await expand.click();
      }
    }
    if (await rows.count() >= 2) {
      await rows.nth(0).getByRole('checkbox').check();
      await rows.nth(1).getByRole('checkbox').check();
      await page.getByRole('button', { name: '合并歌曲', exact: true }).click();
      const merge = page.getByRole('dialog', { name: '合并歌曲', exact: true });
      check(await merge.getByRole('radio').count() === 2, 'Album merge did not show both selected tracks');
      await page.keyboard.press('Escape');
      result.albumMergeUI = true;
    }
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
