// Test-only mock of the Pterodactyl Client API. Never imported by the app.
// Serves HTTPS because the app refuses non-HTTPS panel URLs.
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';

const PORT = Number(process.argv[2] || 4020);

const ACCOUNTS = {
  'valid-key-123456': { id: 1, username: 'zakayo', email: 'zakayo@example.com', admin: true },
  'multi-key-123456': { id: 2, username: 'zakayo', email: 'zakayo@example.com', admin: false },
  'noperm-key-12345': { id: 3, username: 'zakayo', email: 'zakayo@example.com', admin: false },
  'nofile-key-12345': { id: 4, username: 'zakayo', email: 'zakayo@example.com', admin: false }
};

const BOT = { identifier: 'a1b2c3d4', uuid: 'uuid-bot', name: 'Darknote WhatsApp Bot', description: 'Production bot', limits: { memory: 2048, disk: 10240, cpu: 100 }, is_suspended: false, is_installing: false };
const OTHER = { identifier: 'z9y8x7w6', uuid: 'uuid-web', name: 'Static Website', description: 'Unrelated', limits: { memory: 512, disk: 2048, cpu: 50 }, is_suspended: false, is_installing: false };
const SECOND = { identifier: 'q1w2e3r4', uuid: 'uuid-db', name: 'Postgres Node', description: 'Unrelated', limits: { memory: 1024, disk: 4096, cpu: 60 }, is_suspended: false, is_installing: false };

const STATS = { object: 'stats', attributes: { current_state: 'running', is_suspended: false, resources: { memory_bytes: 734003200, cpu_absolute: 12.4, disk_bytes: 2147483648, network_rx_bytes: 1024, network_tx_bytes: 2048, uptime: 86400000 } } };

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

const server = createServer({ key: readFileSync('.test-tls/key.pem'), cert: readFileSync('.test-tls/cert.pem') }, (req, res) => {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const account = ACCOUNTS[auth];
  const url = new URL(req.url, 'https://localhost');

  if (url.pathname === '/healthz') return send(res, 200, { ok: true });
  if (!account) return send(res, 401, { errors: [{ detail: 'Unauthenticated.' }] });

  if (url.pathname === '/api/client') {
    return send(res, 200, { object: 'user', attributes: { id: account.id, admin: account.admin, username: account.username, email: account.email, first_name: 'Za', last_name: 'Kayo', language: 'en' } });
  }

  if (url.pathname === '/api/client/servers') {
    if (auth === 'noperm-key-12345') return send(res, 403, { errors: [{ detail: 'Forbidden.' }] });
    const list = auth === 'multi-key-123456' ? [OTHER, SECOND] : [BOT, OTHER];
    const data = list.map(s => ({ object: 'server', attributes: s }));
    return send(res, 200, { object: 'list', data });
  }

  const m = url.pathname.match(/^\/api\/client\/servers\/([^/]+)\/(resources|files\/list)$/);
  if (m) {
    const identifier = decodeURIComponent(m[1]);
    if (m[2] === 'resources') return send(res, 200, STATS);
    if (m[2] === 'files/list') {
      if (auth === 'nofile-key-12345') return send(res, 403, { errors: [{ detail: 'Forbidden.' }] });
      return send(res, 200, { object: 'list', data: [
        { object: 'file_object', attributes: { name: 'index.js', mode: 'rw-r--r--', size: 2048, is_file: true, is_symlink: false, mimetype: 'text/plain', created_at: '2026-01-01T00:00:00Z', modified_at: '2026-01-02T00:00:00Z' } },
        { object: 'file_object', attributes: { name: 'auth', mode: 'rwxr-xr-x', size: 0, is_file: false, is_symlink: false, mimetype: 'inode/directory', created_at: '2026-01-01T00:00:00Z', modified_at: '2026-01-02T00:00:00Z' } }
      ] });
    }
    return send(res, 404, { errors: [{ detail: 'Not found: ' + identifier }] });
  }

  return send(res, 404, { errors: [{ detail: 'Unknown endpoint ' + url.pathname }] });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock-panel listening https://127.0.0.1:${PORT}`));
