// End-to-end verification of the panel connection flow against a real HTTP
// server and the mock Pterodactyl panel. Test-only.
const BASE = process.env.BASE || 'http://localhost:3110';
const PANEL = process.env.PANEL || 'https://127.0.0.1:4020';

let cookie = '';
let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) pass++; else fail++;
}

async function call(path, { method = 'GET', body, ip = '10.0.0.1', origin } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip };
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const auth = setCookie.find(c => c.startsWith('darknote_admin='));
  if (auth) cookie = auth.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

const connect = (payload, opts = {}) => call('/api/panel/connect', { method: 'POST', body: payload, ...opts });
const good = { panelUrl: PANEL, username: 'zakayo', apiKey: 'valid-key-123456' };

// 0. authentication
let r = await call('/api/panel');
check('unauthenticated status request -> 401', r.status === 401, `status=${r.status}`);

r = await call('/api/auth/login', { method: 'POST', body: { password: 'zakayo' }, ip: '10.0.0.99' });
check('admin login with website password', r.status === 200 && r.json?.ok === true, `status=${r.status}`);

r = await call('/api/panel');
check('initial state is disconnected', r.json?.status === 'disconnected' && r.json?.connected === false,
  `status=${r.json?.status} storage=${r.json?.storage}`);
check('storage backend reported', r.json?.storage === 'memory', `storage=${r.json?.storage}`);
check('encryption key detected', r.json?.encryptionReady === true, `ready=${r.json?.encryptionReady}`);

// 1. invalid URL (http, not https)
r = await connect({ ...good, panelUrl: 'http://insecure.example.com' }, { ip: '10.0.0.2' });
check('1. non-HTTPS URL rejected as invalid_url', r.json?.status === 'invalid_url', `${r.status} ${r.json?.status}: ${r.json?.message}`);

// 2. unreachable panel
r = await connect({ ...good, panelUrl: 'https://127.0.0.1:9' }, { ip: '10.0.0.3' });
check('2. unreachable panel -> panel_unavailable', r.json?.status === 'panel_unavailable', `${r.status} ${r.json?.status}: ${r.json?.message}`);

// 3. wrong username
r = await connect({ ...good, username: 'notzakayo' }, { ip: '10.0.0.4' });
check('3a. wrong username -> authentication_failed', r.json?.status === 'authentication_failed', `${r.status} ${r.json?.status}`);
check('3b. mismatch names the real key owner', /belongs to "zakayo"/.test(r.json?.message || ''), r.json?.message);

// 4. revoked / invalid key
r = await connect({ ...good, apiKey: 'revoked-key-000000' }, { ip: '10.0.0.5' });
check('4. revoked key -> authentication_failed (401 mapped)', r.json?.status === 'authentication_failed' && /401/.test(r.json?.message || ''),
  `${r.status} ${r.json?.status}: ${r.json?.message}`);

// 5. insufficient permission (cannot list servers)
r = await connect({ ...good, apiKey: 'noperm-key-12345' }, { ip: '10.0.0.6' });
check('5. no server permission -> permission_insufficient', r.json?.status === 'permission_insufficient', `${r.status} ${r.json?.status}: ${r.json?.message}`);

// 6. cannot read files
r = await connect({ ...good, apiKey: 'nofile-key-12345' }, { ip: '10.0.0.7' });
check('6. missing file.read -> permission_insufficient', r.json?.status === 'permission_insufficient' && /file\.read/.test(r.json?.message || ''),
  `${r.status} ${r.json?.status}: ${r.json?.message}`);

// 7. ambiguous server list -> requires selection, never reports connected
r = await connect({ ...good, apiKey: 'multi-key-123456' }, { ip: '10.0.0.8' });
check('7a. ambiguous servers -> needsServerSelection', r.json?.needsServerSelection === true, `${r.status} ${r.json?.status}`);
check('7b. candidates returned for selection', (r.json?.candidates?.length || 0) === 2, `count=${r.json?.candidates?.length}`);

// 8. successful connect
r = await connect(good, { ip: '10.0.0.9' });
check('8a. valid credentials -> ok', r.status === 200 && r.json?.ok === true, `${r.status} ${r.json?.status}: ${r.json?.message}`);
check('8b. identity verified against username', r.json?.account?.username === 'zakayo', r.json?.account?.username);
check('8c. bot server auto-identified', r.json?.selectedServer?.name === 'Darknote WhatsApp Bot', r.json?.selectedServer?.name);
check('9. permissions verified flag set', r.json?.permissionsVerified === true, `perms=${r.json?.permissionsVerified}`);

// perspective: persisted state
r = await call('/api/panel', { ip: '10.0.0.9' });
check('10a. status now connected', r.json?.connected === true && r.json?.status === 'connected', `${r.json?.status}`);
check('10b. panel url stored', r.json?.panelUrl === PANEL, r.json?.panelUrl);
check('10c. username stored', r.json?.panelUsername === 'zakayo', r.json?.panelUsername);
check('10d. server identifier stored', r.json?.serverId === 'a1b2c3d4', r.json?.serverId);
check('10e. last verified timestamp present', Boolean(r.json?.lastVerifiedAt), r.json?.lastVerifiedAt);
check('10f. no secret leaked in status payload', !/valid-key-123456|encrypted|cipher/i.test(JSON.stringify(r.json)), 'payload clean');

// 11. Test Connection performs a live check
r = await call('/api/panel/test', { method: 'POST', ip: '10.0.0.9' });
check('11. Test connection re-verifies live', r.status === 200 && r.json?.ok === true, `${r.status} ${r.json?.message}`);

// 12. dashboard data paths now use the stored credential
r = await call('/api/pterodactyl/resources', { ip: '10.0.0.9' });
check('12a. resources readable via stored connection', r.status === 200 && typeof r.json?.resources?.cpuAbsolute === 'number',
  `${r.status} cpu=${r.json?.resources?.cpuAbsolute}`);
r = await call('/api/pterodactyl/files?directory=/', { ip: '10.0.0.9' });
check('12b. file listing readable via stored connection', r.status === 200 && (r.json?.files?.length || 0) === 2,
  `${r.status} files=${r.json?.files?.length}`);

// 13. CSRF
r = await call('/api/panel/test', { method: 'POST', ip: '10.0.0.9', origin: 'https://evil.example.com' });
check('13. cross-origin POST rejected', r.status === 403, `status=${r.status}`);

// 14. rate limiting
let last;
for (let i = 0; i < 7; i++) last = await connect({ ...good, panelUrl: 'https://127.0.0.1:9' }, { ip: '10.9.9.9' });
check('14. connect endpoint rate limited', last.status === 429, `status=${last.status}`);

// 15. disconnect
r = await call('/api/panel/disconnect', { method: 'POST', ip: '10.0.0.9' });
check('15a. disconnect succeeds', r.status === 200 && r.json?.ok === true, `${r.status}`);
r = await call('/api/panel', { ip: '10.0.0.9' });
check('15b. state is disconnected after disconnect', r.json?.connected === false && r.json?.status === 'disconnected', `${r.json?.status}`);
check('15c. credential removed from storage', !r.json?.panelUrl, `panelUrl=${r.json?.panelUrl}`);

// 16. dashboard paths refuse while disconnected
r = await call('/api/pterodactyl/resources', { ip: '10.0.0.9' });
check('16. resources blocked when not connected', r.status === 503 && r.json?.notConnected === true, `${r.status} ${r.json?.error}`);

// 17. reconnect
r = await connect(good, { ip: '10.0.0.10' });
check('17a. reconnect after disconnect works', r.status === 200 && r.json?.ok === true, `${r.status}`);
r = await call('/api/panel', { ip: '10.0.0.10' });
check('17b. state restored to connected', r.json?.connected === true, `${r.json?.status}`);

// 18. server list endpoint
r = await call('/api/panel/servers', { ip: '10.0.0.10' });
check('18. server discovery endpoint returns servers', r.status === 200 && (r.json?.servers?.length || 0) >= 2, `${r.status} count=${r.json?.servers?.length}`);

console.log('\n=== PANEL CONNECTION FLOW ===');
for (const t of results) console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name}${t.ok ? '' : '  <<< ' + t.detail}`);
console.log(`\n${pass} passed, ${fail} failed, ${results.length} total`);
process.exit(fail === 0 ? 0 : 1);
