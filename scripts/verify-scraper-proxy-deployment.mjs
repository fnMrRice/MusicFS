import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 使用临时会话只读核验实际部署，代理设置及凭据不写入输出。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployment = resolve(process.argv[2] ?? join(root, 'deploy/musicfs-windows-amd64'));
const origin = new URL(process.argv[3] ?? 'http://127.0.0.1:8080').origin;
const output = join(root, 'web/test-results/deployed-scraper-proxy');
const { request, chromium } = createRequire(join(root, 'web/package.json'))('@playwright/test');
const result = { passed: false, ready: false, configuredPluginCount: 0, configurationUI: false,
  redundantDescriptionRemoved: false };
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
  result.serverRevision = JSON.parse(readFileSync(join(deployment, 'release.json'), 'utf8')).revision;
  result.webRevision = JSON.parse(readFileSync(join(deployment, 'web-source.json'), 'utf8')).webRevision;
  api = await request.newContext({ baseURL: origin, timeout: 30_000,
    extraHTTPHeaders: { Origin: origin, Accept: 'application/json' } });
  const ready = await get('/health/ready');
  check(ready.product === 'MusicFS' && ready.ready === true, 'Deployment is not ready');
  result.ready = true;
  const token = readFileSync(join(deployment, 'configs/admin-token.txt'), 'utf8').trim();
  check(token.length > 0, 'Administrator credential is unavailable');
  const login = await api.post('/api/v1/auth/session', { headers: { Authorization: `Bearer ${token}` } });
  check(login.status() === 200, 'Verification login failed');
  csrfToken = (await login.json()).csrfToken;
  check(typeof csrfToken === 'string' && csrfToken.length > 0, 'Verification session is invalid');
  const [catalog, snapshot] = await Promise.all([get('/scrapers'), get('/admin/plugins')]);
  check(Array.isArray(catalog.items) && catalog.items.length > 0 && Array.isArray(snapshot.items),
    'Scraper catalog is invalid');
  const settings = new Map();
  for (const scraper of catalog.items) {
    const plugin = snapshot.items.find(item => item.pluginId === scraper.pluginId);
    check(plugin?.settingsAvailable === true, 'A scraper has no declared settings entry');
    const config = await get(`/plugin-settings/${encodeURIComponent(scraper.pluginId)}`);
    const mode = config.schema?.fields.find(field => field.key === 'proxyMode');
    const address = config.schema?.fields.find(field => field.key === 'proxyUrl');
    check(config.pluginId === scraper.pluginId && Number.isSafeInteger(config.revision)
      && mode?.type === 'select' && address?.type === 'text', 'A scraper proxy schema is invalid');
    check(['environment', 'direct', 'custom'].every(value => mode.options.some(option => option.value === value)),
      'A scraper proxy mode is missing');
    settings.set(scraper.pluginId, config);
  }
  result.configuredPluginCount = settings.size;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 960 },
    storageState: await api.storageState() });
  // 页面只允许读取，防止核验过程意外修改用户配置。
  let blockedWrites = 0;
  await context.route('**/api/v1/**', route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
    blockedWrites++;
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const filter = page.getByRole('searchbox', { name: '按 ID 或名称筛选插件', exact: true });
  await filter.waitFor();
  mkdirSync(output, { recursive: true });
  for (const [index, scraper] of catalog.items.slice(0, 2).entries()) {
    const config = settings.get(scraper.pluginId);
    await filter.fill(scraper.pluginId);
    const row = page.locator('.plugin-entry-row').filter({ has: page.getByText(scraper.pluginId, { exact: true }) });
    const entry = row.locator('details.plugin-entry');
    await row.waitFor();
    check(await entry.getAttribute('open') === null, 'Configuration requires expanding the plugin');
    check(await entry.locator('summary button').count() === 0, 'Configuration is nested inside the summary');
    await row.getByRole('button', { name: /^配置 / }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: config.schema.title, exact: true }).waitFor();
    for (const field of config.schema.fields) {
      const control = dialog.getByLabel(field.label, { exact: true });
      check(await control.inputValue() === (config.values[field.key] ?? field.defaultValue),
        'Configuration does not show saved plugin values');
    }
    check(await dialog.getByRole('button', { name: '保存设置', exact: true }).isDisabled(),
      'Unchanged settings can be saved');
    if (index === 0) await page.screenshot({ path: join(output, 'configuration-dark.png'), animations: 'disabled', mask: [dialog.locator('input')] });
    if (index === 1) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'light' });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows');
      await page.screenshot({ path: join(output, 'configuration-mobile.png'), animations: 'disabled', mask: [dialog.locator('input')] });
    }
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    check(await entry.getAttribute('open') === null, 'Configuration changed the plugin expansion');
    await entry.locator('summary').click();
    check(!(await entry.innerText()).includes('内置能力已装配到服务端主进程'), 'Redundant description remains');
  }
  result.configurationUI = true;
  result.redundantDescriptionRemoved = true;
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
