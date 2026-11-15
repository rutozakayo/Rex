import {
  PanelError, getAccount, getServer, getServerResources, listAllocations, listDirectory,
  normalizePanelUrl, type PanelCredential, type PanelServerDetail, type PanelResources
} from './pterodactyl';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from './crypto';
import {
  getConnection, upsertConnection, updateConnectionState, deleteConnection, storageMode,
  type ConnectionStatus
} from './store';
import { legacyPanelConfig } from './env';

/** Single-administrator, single-server model. */
export const ADMIN_ID = 'admin';

export type Permissions = { server: boolean; resources: boolean; files: boolean; allocations: boolean };

export type VerifyOutcome = {
  ok: boolean;
  status: ConnectionStatus;
  message: string;
  notes: string[];
  account?: { username: string; email: string; rootAdmin: boolean };
  server?: { identifier: string; name: string; address: string | null };
  permissions: Permissions;
  verifiedAt: string | null;
};

export type ServerInfo = {
  name: string;
  identifier: string;
  address: string | null;
  state: string;
  isSuspended: boolean;
  cpuAbsolute: number;
  cpuLimit: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  diskLimitBytes: number;
  uptimeSeconds: number;
  allocationsReadable: boolean;
  fetchedAt: string;
};

const FAIL_STATUS: Record<string, ConnectionStatus> = {
  unauthorized: 'authentication_failed',
  forbidden: 'permission_insufficient',
  not_found: 'permission_insufficient',
  invalid_url: 'invalid_url',
  unreachable: 'panel_unavailable',
  timeout: 'panel_unavailable',
  rate_limited: 'panel_unavailable',
  panel_error: 'panel_unavailable',
  invalid_response: 'panel_unavailable'
};

const NO_PERMS: Permissions = { server: false, resources: false, files: false, allocations: false };

function failure(err: unknown, fallback: ConnectionStatus = 'panel_unavailable'): { status: ConnectionStatus; message: string } {
  if (err instanceof PanelError) return { status: FAIL_STATUS[err.code] ?? fallback, message: err.message };
  return { status: fallback, message: err instanceof Error ? err.message : 'Panel verification failed.' };
}

function addressOf(allocations: { ip: string; port: number; alias: string | null; primary: boolean }[]): string | null {
  const chosen = allocations.find(a => a.primary) ?? allocations[0];
  if (!chosen) return null;
  return `${chosen.ip}:${chosen.port}`;
}

/**
 * Verifies one panel and one server. Every gate is a live request; the caller
 * only reports CONNECTED after all of them pass.
 */
export async function verifyPanel(input: {
  panelUrl: string; username: string; apiKey: string; serverId: string;
  serverName?: string; serverAddress?: string;
}): Promise<VerifyOutcome> {
  const base: Omit<VerifyOutcome, 'ok' | 'status' | 'message'> = {
    notes: [], permissions: { ...NO_PERMS }, verifiedAt: null
  };

  let url: string;
  try {
    url = normalizePanelUrl(input.panelUrl);
  } catch (e) {
    return { ...base, ok: false, status: 'invalid_url', message: failure(e, 'invalid_url').message };
  }

  const username = (input.username || '').trim();
  const apiKey = (input.apiKey || '').trim();
  const serverId = (input.serverId || '').trim();
  if (!username) return { ...base, ok: false, status: 'authentication_failed', message: 'Panel username is required.' };
  if (!apiKey) return { ...base, ok: false, status: 'authentication_failed', message: 'A Pterodactyl Client API key is required.' };
  if (!serverId) return { ...base, ok: false, status: 'permission_insufficient', message: 'Server ID is required.' };

  const cred: PanelCredential = { base: url, token: apiKey };

  let account;
  try { account = await getAccount(cred); }
  catch (e) { const f = failure(e); return { ...base, ok: false, status: f.status, message: f.message }; }

  const accountView = { username: account.username, email: account.email, rootAdmin: account.rootAdmin };

  if (account.username.toLowerCase() !== username.toLowerCase()) {
    return {
      ...base, ok: false, status: 'authentication_failed', account: accountView,
      message: `This API key belongs to "${account.username}", not "${username}". Use the key created by the matching panel account.`
    };
  }

  // The single configured server must be reachable with this key.
  let server: PanelServerDetail;
  try { server = await getServer(cred, serverId); }
  catch (e) {
    const f = failure(e, 'permission_insufficient');
    return {
      ...base, ok: false, status: f.status, account: accountView,
      message: e instanceof PanelError && e.code === 'not_found'
        ? `Server "${serverId}" was not found or is not accessible with this API key.`
        : `Could not read server "${serverId}": ${f.message}`
    };
  }

  let resources: PanelResources;
  try { resources = await getServerResources(cred, serverId); }
  catch (e) {
    const f = failure(e);
    return {
      ...base, ok: false, status: f.status, account: accountView,
      permissions: { ...NO_PERMS, server: true },
      message: `Server "${server.name}" could not be queried: ${f.message}`
    };
  }

  try { await listDirectory(cred, serverId, '/'); }
  catch (e) {
    const f = failure(e);
    return {
      ...base, ok: false, status: e instanceof PanelError && (e.code === 'forbidden' || e.code === 'unauthorized') ? 'permission_insufficient' : f.status,
      account: accountView, permissions: { ...NO_PERMS, server: true, resources: true },
      message: `Server state is readable, but files are not: ${f.message} Add the file.read scope to the API key.`
    };
  }

  // Allocations are optional: without allocation.read the address is unavailable.
  let address: string | null = null;
  let allocationsReadable = true;
  try { address = addressOf(await listAllocations(cred, serverId)); }
  catch { allocationsReadable = false; }

  const notes: string[] = [];
  const typedName = (input.serverName || '').trim();
  if (typedName && typedName.toLowerCase() !== server.name.toLowerCase()) {
    notes.push(`Panel reports this server as "${server.name}", not "${typedName}". The panel name is authoritative.`);
  }
  const typedAddress = (input.serverAddress || '').trim();
  if (!allocationsReadable) {
    notes.push('Server address is unavailable: the API key lacks the allocation.read scope.');
  } else if (typedAddress && address && typedAddress !== address) {
    notes.push(`Panel reports the primary allocation as ${address}, not ${typedAddress}.`);
  }

  return {
    ok: true,
    status: 'connected',
    message: `Verified "${server.name}" (${resources.currentState}) — account identity, server access and file permissions confirmed.`,
    notes,
    account: accountView,
    server: { identifier: server.identifier, name: server.name, address: address ?? (typedAddress || null) },
    permissions: { server: true, resources: true, files: true, allocations: allocationsReadable },
    verifiedAt: new Date().toISOString()
  };
}

export class NotConnectedError extends Error {
  constructor(message = 'No Pterodactyl server is configured yet.') { super(message); this.name = 'NotConnectedError'; }
}

export async function connectPanel(input: {
  panelUrl: string; username: string; apiKey: string; serverId: string;
  serverName?: string; serverAddress?: string;
}): Promise<VerifyOutcome> {
  if (!isEncryptionConfigured()) {
    return {
      ok: false, status: 'disconnected', notes: [], permissions: { ...NO_PERMS }, verifiedAt: null,
      message: 'Credential storage is not ready: set PANEL_ENCRYPTION_KEY (32+ random characters). Nothing was saved.'
    };
  }
  if (storageMode() === 'none') {
    return {
      ok: false, status: 'disconnected', notes: [], permissions: { ...NO_PERMS }, verifiedAt: null,
      message: 'Credential storage is not ready: DATABASE_URL is not configured. Nothing was saved.'
    };
  }

  const outcome = await verifyPanel(input);
  if (!outcome.ok) return outcome;

  await upsertConnection({
    adminUserId: ADMIN_ID,
    panelUrl: normalizePanelUrl(input.panelUrl),
    panelUsername: outcome.account!.username,
    encryptedApiKey: encryptSecret(input.apiKey.trim()),
    serverId: outcome.server!.identifier,
    serverName: outcome.server!.name,
    serverAddress: outcome.server!.address,
    status: 'connected',
    permissionsVerified: outcome.permissions.resources && outcome.permissions.files,
    lastVerifiedAt: new Date(outcome.verifiedAt!)
  });
  return outcome;
}

export async function testStoredConnection(): Promise<VerifyOutcome> {
  const row = await getConnection(ADMIN_ID);
  if (!row || !row.serverId) throw new NotConnectedError();

  let apiKey: string;
  try { apiKey = decryptSecret(row.encryptedApiKey); }
  catch {
    return {
      ok: false, status: 'authentication_failed', notes: [], permissions: { ...NO_PERMS }, verifiedAt: null,
      message: 'The stored credential could not be decrypted. PANEL_ENCRYPTION_KEY may have changed — save the configuration again.'
    };
  }

  const outcome = await verifyPanel({
    panelUrl: row.panelUrl, username: row.panelUsername, apiKey,
    serverId: row.serverId, serverName: row.serverName ?? undefined
  });

  if (outcome.ok) {
    await updateConnectionState(ADMIN_ID, {
      status: 'connected',
      permissionsVerified: outcome.permissions.resources && outcome.permissions.files,
      lastVerifiedAt: new Date(outcome.verifiedAt!),
      serverId: outcome.server!.identifier,
      serverName: outcome.server!.name,
      serverAddress: outcome.server!.address
    });
  } else {
    await updateConnectionState(ADMIN_ID, { status: outcome.status, permissionsVerified: false, lastVerifiedAt: row.lastVerifiedAt });
  }
  return outcome;
}

/** Live statistics for the single configured server. Values come from the panel. */
export async function serverInfo(): Promise<ServerInfo> {
  const row = await getConnection(ADMIN_ID);
  if (!row || !row.serverId) throw new NotConnectedError();

  let apiKey: string;
  try { apiKey = decryptSecret(row.encryptedApiKey); }
  catch { throw new NotConnectedError('Stored credential cannot be decrypted. Save the configuration again.'); }

  const cred: PanelCredential = { base: row.panelUrl.replace(/\/$/, ''), token: apiKey };
  const detail = await getServer(cred, row.serverId);
  const stats = await getServerResources(cred, row.serverId);

  let address: string | null = null;
  let allocationsReadable = true;
  try { address = addressOf(await listAllocations(cred, row.serverId)); }
  catch { allocationsReadable = false; }

  return {
    name: detail.name,
    identifier: detail.identifier,
    address,
    state: stats.currentState,
    isSuspended: stats.isSuspended,
    cpuAbsolute: stats.resources.cpuAbsolute,
    cpuLimit: detail.limits.cpu,
    memoryBytes: stats.resources.memoryBytes,
    memoryLimitBytes: detail.limits.memory * 1024 * 1024,
    diskBytes: stats.resources.diskBytes,
    diskLimitBytes: detail.limits.disk * 1024 * 1024,
    uptimeSeconds: stats.resources.uptime,
    allocationsReadable,
    fetchedAt: new Date().toISOString()
  };
}

export async function resolveCredentials(): Promise<{ panelUrl: string; apiKey: string; serverId: string }> {
  const row = await getConnection(ADMIN_ID);
  if (row && row.serverId) {
    let apiKey: string;
    try { apiKey = decryptSecret(row.encryptedApiKey); }
    catch { throw new NotConnectedError('Stored credential cannot be decrypted. Save the configuration again.'); }
    return { panelUrl: row.panelUrl, apiKey, serverId: row.serverId };
  }

  const legacy = legacyPanelConfig();
  if (legacy) {
    return { panelUrl: legacy.PTERODACTYL_BASE_URL, apiKey: legacy.PTERODACTYL_CLIENT_API_TOKEN, serverId: legacy.PTERODACTYL_SERVER_ID };
  }
  throw new NotConnectedError();
}

export async function disconnectPanel(): Promise<void> {
  await deleteConnection(ADMIN_ID);
}

/** Response-safe projection: no API key, no ciphertext, no encryption metadata. */
export async function publicStatus() {
  const row = await getConnection(ADMIN_ID);
  const base = {
    storage: storageMode(),
    encryptionReady: isEncryptionConfigured(),
    connected: false,
    status: 'disconnected' as ConnectionStatus
  };
  if (!row) return { ...base };
  return {
    ...base,
    connected: row.status === 'connected',
    status: row.status,
    panelUrl: row.panelUrl,
    panelUsername: row.panelUsername,
    serverId: row.serverId,
    serverName: row.serverName,
    serverAddress: row.serverAddress,
    permissionsVerified: row.permissionsVerified,
    lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString()
  };
}
