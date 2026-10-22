import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// 使用独立登录与播放会话验证部署服务，不修改用户设置或曲库。
// 本脚本验证 HTTP 流与恢复接口；Web 的位置取整由前端回归测试覆盖。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployment = resolve(process.argv[2] ?? join(root, 'deploy/musicfs-windows-amd64'));
const origin = new URL(process.argv[3] ?? 'http://127.0.0.1:8080').origin;
const requestIds = {};
let cookie = '', csrfToken = '', playbackSessionId = '';
let result, failure;

class VerificationError extends Error {}
function requireValue(condition, message) {
  if (!condition) throw new VerificationError(message);
}
function rememberRequest(label, response) {
  const id = response.headers.get('x-request-id');
  if (id && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) requestIds[label] = id;
}
function target(path) {
  const url = new URL(path, origin);
  requireValue(url.origin === origin && url.pathname.startsWith('/api/v1/'), 'Unexpected API URL');
  return url;
}
async function request(path, { label, method = 'GET', body, bearer, expected = 200, timeoutMs = 30000 } = {}) {
  const headers = { Accept: 'application/json', Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (body !== undefined && method === 'POST') headers['Idempotency-Key'] = randomUUID();
  const response = await fetch(target(path), { method, headers, redirect: 'error',
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  rememberRequest(label, response);
  if (label === 'login') cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (response.status !== expected) {
    const data = await response.json().catch(() => null);
    const code = data?.error?.code;
    throw new VerificationError(`${label} failed with HTTP ${response.status}${
      typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? ` (${code})` : ''}`);
  }
  return expected === 204 ? undefined : response.json();
}

async function selectTrack() {
  const providers = await request('/api/v1/provider-instances', { label: 'providers' });
  requireValue(Array.isArray(providers.items), 'Invalid provider list');
  const local = new Set(providers.items.filter(item => item.plugin?.id === 'musicfs.plugin.source.localfiles').map(item => item.id));
  requireValue(local.size > 0, 'No local music provider is available');
  let cursor = null, fallback;
  const cursors = new Set();
  const deadline = Date.now() + 120000;
  for (let pageNumber = 0; pageNumber < 500; pageNumber++) {
    requireValue(Date.now() < deadline, 'Track selection timed out');
    const query = new URLSearchParams({ limit: '200' });
    if (cursor) query.set('cursor', cursor);
    const page = await request(`/api/v1/source-tracks?${query}`, { label: 'tracks' });
    requireValue(Array.isArray(page.items), 'Invalid source-track page');
    const candidates = page.items.filter(item => local.has(item.providerInstanceId) && item.availability === 'available'
      && Number.isFinite(item.durationMs) && item.durationMs >= 180000);
    const preferred = candidates.find(item => /月|guiano/i.test([item.title, item.displayName, ...(item.artists ?? [])].join(' ')));
    if (preferred) return preferred;
    for (const item of candidates) if (!fallback || item.durationMs < fallback.durationMs) fallback = item;
    cursor = page.nextCursor;
    if (!cursor) break;
    requireValue(typeof cursor === 'string' && !cursors.has(cursor), 'Track pagination did not advance');
    cursors.add(cursor);
  }
  requireValue(fallback, 'No available local track of at least 180 seconds was found');
  return fallback;
}

async function readStream(descriptor, label, pauseMs) {
  const started = Date.now();
  const response = await fetch(target(descriptor.streamUrl), {
    headers: { Cookie: cookie, Origin: origin }, redirect: 'error', signal: AbortSignal.timeout(180000),
  });
  rememberRequest(label, response);
  requireValue(response.status === 200, `${label} failed with HTTP ${response.status}`);
  requireValue(response.headers.get('content-type')?.startsWith('audio/mpeg'), `${label} is not MPEG audio`);
  requireValue(response.body, `${label} has no response body`);
  const reader = response.body.getReader();
  let bytes = 0, chunks = 0, completed = false;
  try {
    const first = await reader.read();
    requireValue(!first.done && first.value.byteLength > 0, `${label} returned no audio`);
    bytes += first.value.byteLength;
    chunks++;
    if (pauseMs) {
      console.log(`${label}: first chunk received; pausing consumption for ${pauseMs / 1000} seconds.`);
      await delay(pauseMs);
    }
    while (true) {
      const next = await reader.read();
      if (next.done) { completed = true; break; }
      bytes += next.value.byteLength;
      chunks++;
    }
    const declared = response.headers.get('content-length');
    if (declared !== null) requireValue(bytes === Number(declared), `${label} ended before the declared content length`);
    return { bytes, chunks, pauseMs, elapsedMs: Date.now() - started, requestId: requestIds[label] };
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

try {
  const token = (process.env.MUSICFS_ADMIN_TOKEN || readFileSync(join(deployment, 'configs/admin-token.txt'), 'utf8')).trim();
  requireValue(token.length > 0, 'Administrator credential is unavailable');
  const auth = await request('/api/v1/auth/session', { label: 'login', method: 'POST', bearer: token });
  csrfToken = auth.csrfToken;
  requireValue(cookie && typeof csrfToken === 'string' && csrfToken, 'Login did not provide session credentials');
  const track = await selectTrack();
  console.log(`Selected local track ${track.sourceTrackId}; duration ${track.durationMs} ms.`);
  const initial = await request('/api/v1/playback/sessions', { label: 'create', method: 'POST', expected: 201, body: {
    sourceTrackId: track.sourceTrackId,
    capabilities: { htmlAudio: true, formats: [{ mime: 'audio/mpeg', canPlay: 'probably' }] },
    preferences: { forceProcessing: true, gainDb: 0, dspExecution: 'server' },
  } });
  playbackSessionId = initial.sessionId;
  requireValue(typeof playbackSessionId === 'string' && playbackSessionId && typeof initial.attemptId === 'string', 'Invalid playback session');
  requireValue(initial.deliveryMode === 'processed' && initial.dspExecution === 'server'
    && initial.outputProfile?.mime === 'audio/mpeg', 'Server did not select processed MPEG audio');
  const initialStream = await readStream(initial, 'initialStream', 20000);
  const positionMs = Math.round(151.438867 * 1000);
  const recovered = await request(`/api/v1/playback/sessions/${encodeURIComponent(playbackSessionId)}/recover`, {
    label: 'recover', method: 'POST', body: { attemptId: initial.attemptId, positionMs,
      observedError: { code: 'BUFFERING_TIMEOUT', message: 'Deployment verification recovery probe', outputProfile: initial.outputProfile } },
  });
  requireValue(recovered.sessionId === playbackSessionId && recovered.attemptId !== initial.attemptId
    && typeof recovered.attemptId === 'string' && recovered.positionOriginMs === positionMs
    && recovered.resumeDecision === 'continue', 'Recovery did not preserve the session and requested position');
  const recoveredStream = await readStream(recovered, 'recoveredStream', 0);
  result = { status: 'passed', trackId: track.sourceTrackId, durationMs: track.durationMs,
    initialStream, recoveryPositionMs: positionMs, recoveredStream };
} catch (error) {
  failure = error instanceof VerificationError ? error.message :
    ['TimeoutError', 'AbortError'].includes(error?.name) ? 'A verification request timed out' : 'Verification could not complete';
} finally {
  if (playbackSessionId && cookie && csrfToken) {
    try { await request(`/api/v1/playback/sessions/${encodeURIComponent(playbackSessionId)}`, {
      label: 'deletePlayback', method: 'DELETE', expected: 204, timeoutMs: 10000 }); }
    catch { failure ??= 'Playback session cleanup failed'; }
  }
  if (cookie && csrfToken) {
    try { await request('/api/v1/auth/session', { label: 'logout', method: 'DELETE', expected: 204, timeoutMs: 10000 }); }
    catch { failure ??= 'Authentication session cleanup failed'; }
  }
}

console.log(JSON.stringify(failure ? { status: 'failed', message: failure, requestIds } : { ...result, requestIds }));
if (failure) process.exitCode = 1;
