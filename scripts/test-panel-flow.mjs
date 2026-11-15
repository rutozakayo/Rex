// End-to-end verification of the single-server connection flow.
// The administrator password is read from the environment so it is never
// committed to the repository.
const BASE = process.env.BASE || 'http://localhost:3110';
const PANEL = process.env.PANEL || 'https://127.0.0.1:4020';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!PASSWORD) {
  console.error('TEST_ADMIN_PASSWORD is required. Run: TEST_ADMIN_PASSWORD=<admin password> node scripts/test-panel-flow.mjs');
  process.exit(2);
}

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
  return { status: res.status, json, text };
}

const save = (payload, opts = {}) => call('/api/panel/connect', { method: 'POST', body: payload, ...opts });
const base = {
  panelUrl: PANEL, username: 'paneladmin', apiKey: 'valid-key-123456',
  serverId: 'a1b2c3d4', serverName: 'Darknote WhatsApp Bot', serverAddress: 'node.example.com:25565'
};

// 0. authentication gate
let r = await call('/api/panel');
check('unauthenticated status -> 401', r.status === 401, `status=${r.status}`);
r = await call('/api/panel/server-info');
check('unauthenticated server-info -> 401', r.status === 401, `status=${r.status}`);
r = await call('/api/auth/login', { method: 'POST', body: { password: PASSWORD }, ip: '10.0.0.99' });
check('administrator login', r.status === 200 && r.json?.ok === true, `status=${r.status}`);
r = await call('/api/auth/login', { method: 'POST', body: { password: PASSWORD + 'x' }, ip: '10.0.0.98' });
check('wrong administrator password rejected', r.status === 401, `status=${r.status}`);

r = await call('/api/panel');
check('initial state disconnected', r.json?.status === 'disconnected' && r.json?.connected === false, `${r.json?.status}`);
check('storage backend reported', r.json?.storage === 'memory', `${r.json?.storage}`);

// 1-2. URL validation and reachability
r = await save({ ...base, panelUrl: 'http://insecure.example.com' }, { ip: '10.0.0.2' });
check('1. non-HTTPS URL -> invalid_url', r.json?.status === 'invalid_url', `${r.status} ${r.json?.status}`);
r = await save({ ...base, panelUrl: 'https://127.0.0.1:9' }, { ip: '10.0.0.3' });
check('2. unreachable panel -> panel_unavailable', r.json?.status === 'panel_unavailable', `${r.json?.status}: ${r.json?.message}`);

// 3-4. identity
r = await save({ ...base, username: 'notpaneladmin' }, { ip: '10.0.0.4' });
check('3a. wrong username -> authentication_failed', r.json?.status === 'authentication_failed', `${r.json?.status}`);
check('3b. mismatch names key owner', /belongs to "paneladmin"/.test(r.json?.message || ''), r.json?.message);
r = await save({ ...base, apiKey: 'revoked-key-000000' }, { ip: '10.0.0.5' });
check('4. revoked key -> authentication_failed', r.json?.status === 'authentication_failed' && /401/.test(r.json?.message || ''), r.json?.message);

// 5. input validation (server id required, pattern enforced)
r = await save({ ...base, serverId: '' }, { ip: '10.0.0.6' });
check('5a. missing server ID -> 400 + field issue', r.status === 400 && r.json?.issues?.some(i => i.field === 'serverId'), `${r.status}`);
r = await save({ ...base, serverId: '../../etc/passwd' }, { ip: '10.0.0.61' });
check('5b. malformed server ID rejected', r.status === 400, `${r.status}`);

// 6. server not accessible
r = await save({ ...base, serverId: 'zzzz9999' }, { ip: '10.0.0.7' });
check('6. unknown server ID -> permission_insufficient', r.json?.status === 'permission_insufficient' && /not found or is not accessible/i.test(r.json?.message || ''), `${r.json?.status}: ${r.json?.message}`);

// 7-8. permission scope failures
r = await save({ ...base, apiKey: 'noperm-key-12345' }, { ip: '10.0.0.8' });
check('7. no server read permission -> permission_insufficient', r.json?.status === 'permission_insufficient', `${r.json?.status}: ${r.json?.message}`);
r = await save({ ...base, apiKey: 'nofile-key-12345' }, { ip: '10.0.0.9' });
check('8. missing file.read -> permission_insufficient', r.json?.status === 'permission_insufficient' && /file\.read/.test(r.json?.message || ''), `${r.json?.message}`);

// 9. successful save
r = await save(base, { ip: '10.0.0.10' });
check('9a. valid configuration -> connected', r.status === 200 && r.json?.ok === true, `${r.status} ${r.json?.message}`);
check('9b. panel-authoritative server name', r.json?.server?.name === 'Darknote WhatsApp Bot', r.json?.server?.name);
check('9c. address from primary allocation', r.json?.server?.address === '203.0.113.10:25565', String(r.json?.server?.address));
check('9d. permissions reported', r.json?.permissions?.files === true && r.json?.permissions?.allocations === true, JSON.stringify(r.json?.permissions));
check('9e. no secrets in response', !/valid-key-123456|encrypted|ptlc_/i.test(r.text), 'clean');

// 10. name mismatch surfaces a note but the panel name wins
r = await save({ ...base, serverName: 'Wrong Name', apiKey: 'valid-key-123456' }, { ip: '10.0.0.11' });
check('10. typed name mismatch -> note, panel name kept', r.json?.ok === true && r.json?.notes?.length > 0 && r.json?.server?.name === 'Darknote WhatsApp Bot', `${r.json?.server?.name} notes=${r.json?.notes?.length}`);

// 11. persisted single configuration
r = await call('/api/panel', { ip: '10.0.0.10' });
check('11a. stored as connected', r.json?.connected === true, `${r.json?.status}`);
check('11b. single server id stored', r.json?.serverId === 'a1b2c3d4', r.json?.serverId);
check('11c. no multi-server list exposed', !('servers' in r.json) && r.json?.multiServer === undefined, 'single-server shape');

// 12. live server information
r = await call('/api/panel/server-info', { ip: '10.0.0.10' });
const s = r.json?.server;
check('12a. server info returns name/id', s?.name === 'Darknote WhatsApp Bot' && s?.identifier === 'a1b2c3d4', `${s?.name}/${s?.identifier}`);
check('12b. real CPU value', s?.cpuAbsolute === 12.4, `cpu=${s?.cpuAbsolute}`);
check('12c. real memory with limit', s?.memoryBytes === 734003200 && s?.memoryLimitBytes === 2048 * 1024 * 1024, `mem=${s?.memoryBytes}/${s?.memoryLimitBytes}`);
check('12d. real disk with limit', s?.diskBytes === 2147483648 && s?.diskLimitBytes === 10240 * 1024 * 1024, `disk=${s?.diskBytes}`);
check('12e. uptime and state', s?.uptimeSeconds === 86400000 && s?.state === 'running', `${s?.state}/${s?.uptimeSeconds}`);
check('12f. address resolved', s?.address === '203.0.113.10:25565', s?.address);

// 13. test connection
r = await call('/api/panel/test', { method: 'POST', ip: '10.0.0.10' });
check('13. Test connection re-verifies live', r.status === 200 && r.json?.ok === true, `${r.status}`);

// 14-15. security
r = await call('/api/panel/test', { method: 'POST', ip: '10.0.0.10', origin: 'https://evil.example.com' });
check('14. cross-origin POST rejected', r.status === 403, `${r.status}`);
let last;
for (let i = 0; i < 7; i++) last = await save({ ...base, panelUrl: 'https://127.0.0.1:9' }, { ip: '10.9.9.9' });
check('15. save endpoint rate limited', last.status === 429, `${last.status}`);

// 16-17. disconnect and reconnect
r = await call('/api/panel/disconnect', { method: 'POST', ip: '10.0.0.10' });
check('16a. disconnect succeeds', r.status === 200 && r.json?.ok === true, `${r.status}`);
r = await call('/api/panel', { ip: '10.0.0.10' });
check('16b. state disconnected', r.json?.connected === false && r.json?.status === 'disconnected', `${r.json?.status}`);
r = await call('/api/panel/server-info', { ip: '10.0.0.10' });
check('16c. server-info blocked when disconnected', r.status === 404 && r.json?.notConnected === true, `${r.status}`);
r = await call('/api/pterodactyl/resources', { ip: '10.0.0.10' });
check('16d. dashboard data blocked when disconnected', r.status === 503, `${r.status}`);
r = await save(base, { ip: '10.0.0.12' });
check('17. reconnect after disconnect works', r.status === 200 && r.json?.ok === true, `${r.status}`);

// 18. removed multi-server endpoint
r = await call('/api/panel/servers', { ip: '10.0.0.12' });
check('18. multi-server endpoint no longer exists', r.status === 404, `${r.status}`);

console.log('\n=== SINGLE-SERVER CONNECTION FLOW ===');
for (const t of results) console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name}${t.ok ? '' : '  <<< ' + t.detail}`);
console.log(`\n${pass} passed, ${fail} failed, ${results.length} total`);
process.exit(fail === 0 ? 0 : 1);
