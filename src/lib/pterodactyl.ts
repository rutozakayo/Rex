import { env } from './env';
import path from 'node:path';

const TIMEOUT_MS = 10_000;

function config() {
  const e = env();
  return { base: e.PTERODACTYL_BASE_URL.replace(/\/$/, ''), token: e.PTERODACTYL_CLIENT_API_TOKEN, server: e.PTERODACTYL_SERVER_ID };
}

function panelHost(base: string) {
  try { return new URL(base).host; } catch { return 'the configured panel'; }
}

/** Turns transport failures into messages an operator can act on. */
function explainNetworkError(e: unknown, base: string): Error {
  const host = panelHost(base);
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    return new Error(`Pterodactyl panel at ${host} did not respond within ${TIMEOUT_MS / 1000}s. The panel may be offline or unreachable from this host.`);
  }
  return new Error(`Cannot reach the Pterodactyl panel at ${host}. Check PTERODACTYL_BASE_URL and that the panel is online.`);
}

function explainStatus(status: number): Error {
  if (status === 401 || status === 403) return new Error('Pterodactyl rejected the request (401/403). Check PTERODACTYL_CLIENT_API_TOKEN and its Client API permissions.');
  if (status === 404) return new Error('Pterodactyl returned 404. Check PTERODACTYL_SERVER_ID and the requested path.');
  if (status === 429) return new Error('Pterodactyl rate limited the request (429). Retry shortly.');
  if (status >= 500) return new Error(`Pterodactyl panel error (${status}). The panel may be restarting — retry shortly.`);
  return new Error(`Pterodactyl request failed (${status}).`);
}

async function send(url: string, accept: string) {
  const c = config();
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${c.token}`, Accept: accept },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    throw explainNetworkError(e, c.base);
  }
}

async function request<T>(endpoint: string): Promise<T> {
  const c = config();
  const response = await send(
    `${c.base}/api/client/servers/${encodeURIComponent(c.server)}${endpoint}`,
    'Application/vnd.pterodactyl.v1+json'
  );
  if (!response.ok) throw explainStatus(response.status);
  return response.json() as Promise<T>;
}

export function safeRemotePath(input: string) {
  const normalized = path.posix.normalize('/' + input.replaceAll('\\', '/')).replace(/^\/+/, '/');
  if (normalized.split('/').some(part => part === '..')) throw new Error('Path is outside the permitted server root.');
  return normalized === '.' ? '/' : normalized;
}

export async function listFiles(directory = '/') {
  const safe = safeRemotePath(directory);
  return request<{ data: Array<{ attributes: { name:string; mode:string; size:number; is_file:boolean; is_symlink:boolean; mimetype:string; created_at:string; modified_at:string } }> }>(
    `/files/list?directory=${encodeURIComponent(safe)}`
  );
}

export async function readFile(file: string) {
  const safe = safeRemotePath(file);
  const c = config();
  const response = await send(
    `${c.base}/api/client/servers/${encodeURIComponent(c.server)}/files/contents?file=${encodeURIComponent(safe)}`,
    'text/plain'
  );
  if (!response.ok) throw explainStatus(response.status);
  return response.text();
}

export async function getResources() {
  return request<{ attributes: { current_state:string; resources:{ cpu_absolute:number; memory_bytes:number; disk_bytes:number; uptime:number; network_rx_bytes:number; network_tx_bytes:number } } }>('/resources');
}
