import { env } from './env';
import path from 'node:path';

function config() {
  const e = env();
  return { base: e.PTERODACTYL_BASE_URL.replace(/\/$/, ''), token: e.PTERODACTYL_CLIENT_API_TOKEN, server: e.PTERODACTYL_SERVER_ID };
}
async function request<T>(endpoint: string): Promise<T> {
  const c = config();
  const response = await fetch(`${c.base}/api/client/servers/${encodeURIComponent(c.server)}${endpoint}`, {
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'Application/vnd.pterodactyl.v1+json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Pterodactyl request failed (${response.status}). Check server ID and Client API permissions.`);
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
  const response = await fetch(`${c.base}/api/client/servers/${encodeURIComponent(c.server)}/files/contents?file=${encodeURIComponent(safe)}`, {
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'text/plain' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Pterodactyl file read failed (${response.status}).`);
  return response.text();
}
export async function getResources() {
  return request<{ attributes: { current_state:string; resources:{ cpu_absolute:number; memory_bytes:number; disk_bytes:number; uptime:number; network_rx_bytes:number; network_tx_bytes:number } } }>('/resources');
}
