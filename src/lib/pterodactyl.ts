import path from 'node:path';

const TIMEOUT_MS = 10_000;
const ACCEPT = 'Application/vnd.pterodactyl.v1+json';

export type PanelErrorCode =
  | 'invalid_url' | 'unreachable' | 'timeout' | 'unauthorized' | 'forbidden'
  | 'not_found' | 'rate_limited' | 'panel_error' | 'invalid_response';

export class PanelError extends Error {
  constructor(public readonly code: PanelErrorCode, message: string) {
    super(message);
    this.name = 'PanelError';
  }
}

export type PanelCredential = { base: string; token: string };

export type PanelAccount = { id: number; username: string; email: string; rootAdmin: boolean };

export type PanelServer = {
  identifier: string; uuid: string; name: string; description: string;
  isSuspended: boolean; isInstalling: boolean;
  limits: { memory: number; disk: number; cpu: number };
};

export type PanelResources = {
  currentState: string; isSuspended: boolean;
  resources: { memoryBytes: number; cpuAbsolute: number; diskBytes: number; uptime: number; networkRxBytes: number; networkTxBytes: number };
};

/**
 * Enforces an HTTPS panel URL and strips decorative parts. Rejects embedded
 * credentials, query strings and fragments so the URL cannot smuggle a secret.
 */
export function normalizePanelUrl(raw: string): string {
  const value = (raw || '').trim();
  if (!value) throw new PanelError('invalid_url', 'Panel URL is required.');
  let url: URL;
  try { url = new URL(value); } catch { throw new PanelError('invalid_url', 'Panel URL is not a valid absolute URL.'); }
  if (url.protocol !== 'https:') throw new PanelError('invalid_url', 'Panel URL must use HTTPS.');
  if (!url.hostname) throw new PanelError('invalid_url', 'Panel URL is missing a hostname.');
  if (url.username || url.password) throw new PanelError('invalid_url', 'Panel URL must not contain credentials.');
  if (url.search || url.hash) throw new PanelError('invalid_url', 'Panel URL must not contain a query string or fragment.');
  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${pathname}`;
}

function hostOf(base: string) {
  try { return new URL(base).host; } catch { return 'the configured panel'; }
}

function mapStatus(status: number): PanelError {
  if (status === 401) return new PanelError('unauthorized', 'Pterodactyl rejected the API key (401). It may be revoked, expired, or wrong.');
  if (status === 403) return new PanelError('forbidden', 'The API key lacks the permission required for this request (403).');
  if (status === 404) return new PanelError('not_found', 'Pterodactyl returned 404. The resource, server identifier, or panel path was not found.');
  if (status === 429) return new PanelError('rate_limited', 'Pterodactyl rate limited this request (429). Retry shortly.');
  if (status === 422) return new PanelError('panel_error', 'Pterodactyl rejected the request payload (422).');
  if (status >= 500) return new PanelError('panel_error', `Pterodactyl panel error (${status}). The panel may be restarting.`);
  return new PanelError('panel_error', `Pterodactyl request failed (${status}).`);
}

async function call(cred: PanelCredential, endpoint: string, accept = ACCEPT): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${cred.base}${endpoint}`, {
      headers: { Authorization: `Bearer ${cred.token}`, Accept: accept },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new PanelError('timeout', `Panel at ${hostOf(cred.base)} did not respond within ${TIMEOUT_MS / 1000}s.`);
    }
    throw new PanelError('unreachable', `Cannot reach the Pterodactyl panel at ${hostOf(cred.base)}. Check the URL and that the panel is online.`);
  }
  if (!response.ok) throw mapStatus(response.status);
  return response;
}

async function json<T>(cred: PanelCredential, endpoint: string): Promise<T> {
  const response = await call(cred, endpoint);
  try { return (await response.json()) as T; } catch { throw new PanelError('invalid_response', 'Pterodactyl returned a response that is not valid JSON. Is this really a Pterodactyl panel?'); }
}

/** GET /api/client — identifies the account that owns the API key. */
export async function getAccount(cred: PanelCredential): Promise<PanelAccount> {
  const body = await json<{ attributes?: { id?: number; username?: string; email?: string; admin?: boolean; root_admin?: boolean } }>(cred, '/api/client');
  const a = body?.attributes;
  if (!a || typeof a.username !== 'string') {
    throw new PanelError('invalid_response', 'Pterodactyl did not return an account object. Confirm the URL points at a Pterodactyl panel.');
  }
  return { id: Number(a.id ?? 0), username: a.username, email: a.email ?? '', rootAdmin: Boolean(a.root_admin ?? a.admin) };
}

export async function listServers(cred: PanelCredential): Promise<PanelServer[]> {
  const body = await json<{ data?: Array<{ attributes?: Record<string, unknown> }> }>(cred, '/api/client/servers');
  if (!Array.isArray(body?.data)) throw new PanelError('invalid_response', 'Pterodactyl did not return a server list.');
  return body.data.map(entry => {
    const a = (entry.attributes ?? {}) as Record<string, unknown>;
    const limits = (a.limits ?? {}) as Record<string, number>;
    return {
      identifier: String(a.identifier ?? ''),
      uuid: String(a.uuid ?? ''),
      name: String(a.name ?? 'Unnamed server'),
      description: String(a.description ?? ''),
      isSuspended: Boolean(a.is_suspended),
      isInstalling: Boolean(a.is_installing),
      limits: { memory: Number(limits.memory ?? 0), disk: Number(limits.disk ?? 0), cpu: Number(limits.cpu ?? 0) }
    };
  }).filter(s => s.identifier);
}

/** Proves read access to a specific server, which is what the dashboard needs. */
export async function getServerResources(cred: PanelCredential, serverId: string): Promise<PanelResources> {
  const body = await json<{ attributes?: Record<string, unknown> }>(cred, `/api/client/servers/${encodeURIComponent(serverId)}/resources`);
  const a = (body?.attributes ?? {}) as Record<string, unknown>;
  const r = (a.resources ?? {}) as Record<string, number>;
  if (!a.current_state) throw new PanelError('invalid_response', 'Pterodactyl returned no state for this server.');
  return {
    currentState: String(a.current_state),
    isSuspended: Boolean(a.is_suspended),
    resources: {
      memoryBytes: Number(r.memory_bytes ?? 0), cpuAbsolute: Number(r.cpu_absolute ?? 0),
      diskBytes: Number(r.disk_bytes ?? 0), uptime: Number(r.uptime ?? 0),
      networkRxBytes: Number(r.network_rx_bytes ?? 0), networkTxBytes: Number(r.network_tx_bytes ?? 0)
    }
  };
}

export function safeRemotePath(input: string) {
  const normalized = path.posix.normalize('/' + input.replaceAll('\\', '/')).replace(/^\/+/, '/');
  if (normalized.split('/').some(part => part === '..')) throw new PanelError('invalid_response', 'Path is outside the permitted server root.');
  return normalized === '.' ? '/' : normalized;
}

export async function listDirectory(cred: PanelCredential, serverId: string, directory = '/') {
  const safe = safeRemotePath(directory);
  const body = await json<{ data?: Array<{ attributes?: Record<string, unknown> }> }>(
    cred, `/api/client/servers/${encodeURIComponent(serverId)}/files/list?directory=${encodeURIComponent(safe)}`
  );
  if (!Array.isArray(body?.data)) throw new PanelError('invalid_response', 'Pterodactyl returned no file listing.');
  return {
    directory: safe,
    files: body.data.map(entry => entry.attributes ?? {}).map(a => ({
      name: String(a.name ?? ''), mode: String(a.mode ?? ''), size: Number(a.size ?? 0),
      is_file: Boolean(a.is_file), is_symlink: Boolean(a.is_symlink),
      mimetype: String(a.mimetype ?? ''), modified_at: String(a.modified_at ?? '')
    }))
  };
}

export async function readFileContents(cred: PanelCredential, serverId: string, file: string): Promise<string> {
  const safe = safeRemotePath(file);
  const response = await call(
    cred, `/api/client/servers/${encodeURIComponent(serverId)}/files/contents?file=${encodeURIComponent(safe)}`, 'text/plain'
  );
  return response.text();
}

export type PanelServerDetail = {
  identifier: string; uuid: string; name: string; description: string;
  isSuspended: boolean; isInstalling: boolean;
  limits: { memory: number; disk: number; cpu: number; swap: number; io: number };
};

export type PanelAllocation = { ip: string; port: number; alias: string | null; primary: boolean };

/** GET /api/client/servers/{id} — authoritative name, description and limits. */
export async function getServer(cred: PanelCredential, serverId: string): Promise<PanelServerDetail> {
  const body = await json<{ attributes?: Record<string, unknown> }>(cred, `/api/client/servers/${encodeURIComponent(serverId)}`);
  const a = (body?.attributes ?? {}) as Record<string, unknown>;
  if (!a.identifier) throw new PanelError('not_found', 'Pterodactyl did not return that server. Check the server identifier.');
  const limits = (a.limits ?? {}) as Record<string, number>;
  return {
    identifier: String(a.identifier), uuid: String(a.uuid ?? ''), name: String(a.name ?? ''),
    description: String(a.description ?? ''),
    isSuspended: Boolean(a.is_suspended), isInstalling: Boolean(a.is_installing),
    limits: {
      memory: Number(limits.memory ?? 0), disk: Number(limits.disk ?? 0),
      cpu: Number(limits.cpu ?? 0), swap: Number(limits.swap ?? 0), io: Number(limits.io ?? 0)
    }
  };
}

/**
 * GET /api/client/servers/{id}/network/allocations — real network address.
 * Requires the allocation.read scope; callers treat 403 as "unavailable".
 */
export async function listAllocations(cred: PanelCredential, serverId: string): Promise<PanelAllocation[]> {
  const body = await json<{ data?: Array<{ attributes?: Record<string, unknown> }> }>(
    cred, `/api/client/servers/${encodeURIComponent(serverId)}/network/allocations`
  );
  if (!Array.isArray(body?.data)) throw new PanelError('invalid_response', 'Pterodactyl returned no allocations.');
  return body.data.map(entry => {
    const a = (entry.attributes ?? {}) as Record<string, unknown>;
    return {
      ip: String(a.ip ?? ''), port: Number(a.port ?? 0),
      alias: a.ip_alias ? String(a.ip_alias) : null,
      primary: Boolean(a.is_default ?? a.is_primary)
    };
  }).filter(a => a.ip);
}
