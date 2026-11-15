import {
  PanelError, getAccount, listServers, getServerResources, listDirectory, normalizePanelUrl,
  type PanelCredential, type PanelServer
} from './pterodactyl';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from './crypto';
import {
  getConnection, upsertConnection, updateConnectionState, deleteConnection, storageMode,
  type ConnectionStatus
} from './store';
import { legacyPanelConfig } from './env';

/** Single-administrator model: the session proves admin, so one row per install. */
export const ADMIN_ID = 'admin';

const BOT_HINTS = [/darknote/i, /whats\s*app/i, /wa[-_ ]?bot/i];

export type VerifyOutcome = {
  ok: boolean;
  status: ConnectionStatus;
  message: string;
  account?: { username: string; email: string; rootAdmin: boolean };
  servers?: PanelServer[];
  candidates?: PanelServer[];
  selectedServer?: { identifier: string; name: string } | null;
  permissionsVerified: boolean;
  verifiedAt: string | null;
  needsServerSelection?: boolean;
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

function failure(err: unknown, fallback: ConnectionStatus = 'panel_unavailable'): { status: ConnectionStatus; message: string } {
  if (err instanceof PanelError) return { status: FAIL_STATUS[err.code] ?? fallback, message: err.message };
  return { status: fallback, message: err instanceof Error ? err.message : 'Panel verification failed.' };
}

export function detectBotServers(servers: PanelServer[]): PanelServer[] {
  return servers.filter(s => BOT_HINTS.some(r => r.test(s.name) || r.test(s.description)));
}

/**
 * Full verification. Every gate below is a real request against the panel;
 * 'connected' is returned only after account identity, server access and file
 * read permission have all been proven.
 */
export async function verifyPanel(input: {
  panelUrl: string; username: string; apiKey: string; serverId?: string | null;
}): Promise<VerifyOutcome> {
  const empty = { permissionsVerified: false, verifiedAt: null as string | null };

  let base: string;
  try {
    base = normalizePanelUrl(input.panelUrl);
  } catch (e) {
    const f = failure(e, 'invalid_url');
    return { ok: false, status: 'invalid_url', message: f.message, ...empty };
  }

  const username = (input.username || '').trim();
  const apiKey = (input.apiKey || '').trim();
  if (!username) return { ok: false, status: 'authentication_failed', message: 'Panel username is required.', ...empty };
  if (!apiKey) return { ok: false, status: 'authentication_failed', message: 'A Pterodactyl Client API key is required.', ...empty };

  const cred: PanelCredential = { base, token: apiKey };

  // 1. Identify the account that owns the key.
  let account;
  try {
    account = await getAccount(cred);
  } catch (e) {
    const f = failure(e);
    return { ok: false, status: f.status, message: f.message, ...empty };
  }

  // 2. The key must belong to the username the operator typed.
  if (account.username.toLowerCase() !== username.toLowerCase()) {
    return {
      ok: false, status: 'authentication_failed', ...empty,
      message: `This API key belongs to "${account.username}", not "${username}". Use the key created by the matching panel account.`
    };
  }

  // 3. Discover the servers this account can reach.
  let servers: PanelServer[];
  try {
    servers = await listServers(cred);
  } catch (e) {
    const f = failure(e);
    return { ok: false, status: f.status, message: f.message, account: { username: account.username, email: account.email, rootAdmin: account.rootAdmin }, ...empty };
  }

  if (servers.length === 0) {
    return {
      ok: false, status: 'permission_insufficient', servers, ...empty,
      account: { username: account.username, email: account.email, rootAdmin: account.rootAdmin },
      message: 'Verified, but this account cannot see any Pterodactyl servers. Grant it access to the bot server first.'
    };
  }

  // 4. Choose the target server: explicit choice, else auto-detected bot, else sole server.
  let chosen: PanelServer | undefined;
  if (input.serverId) chosen = servers.find(s => s.identifier === input.serverId);
  if (!chosen) {
    const detected = detectBotServers(servers);
    if (detected.length === 1) chosen = detected[0];
    else if (!input.serverId && servers.length === 1) chosen = servers[0];
  }

  if (!chosen) {
    const detected = detectBotServers(servers);
    return {
      ok: false, status: 'permission_insufficient', servers, ...empty,
      account: { username: account.username, email: account.email, rootAdmin: account.rootAdmin },
      candidates: detected.length ? detected : servers,
      needsServerSelection: true,
      message: input.serverId
        ? `Server "${input.serverId}" is not accessible with this key.`
        : `Account verified, but no single Darknote/WhatsApp server could be identified among ${servers.length}. Select the correct server.`
    };
  }

  // 5. Prove read access to that server's live state.
  try {
    await getServerResources(cred, chosen.identifier);
  } catch (e) {
    const f = failure(e);
    return {
      ok: false, status: f.status, servers, account: { username: account.username, email: account.email, rootAdmin: account.rootAdmin }, ...empty,
      message: `Account verified, but server "${chosen.name}" is not readable: ${f.message}`
    };
  }

  // 6. Prove file read permission, which the file manager depends on.
  try {
    await listDirectory(cred, chosen.identifier, '/');
  } catch (e) {
    const f = failure(e);
    return {
      ok: false, status: e instanceof PanelError && (e.code === 'forbidden' || e.code === 'unauthorized') ? 'permission_insufficient' : f.status,
      servers, account: { username: account.username, email: account.email, rootAdmin: account.rootAdmin }, ...empty,
      message: `Server access works, but the key cannot read files: ${f.message} Add the file.read scope to the key.`
    };
  }

  return {
    ok: true,
    status: 'connected',
    message: 'Panel verified: account identity, server access and file permissions all confirmed.',
    account: { username: account.username, email: account.email, rootAdmin: account.rootAdmin },
    servers,
    selectedServer: { identifier: chosen.identifier, name: chosen.name },
    permissionsVerified: true,
    verifiedAt: new Date().toISOString()
  };
}

export class NotConnectedError extends Error {
  constructor(message = 'No Pterodactyl panel is connected to this control center.') { super(message); this.name = 'NotConnectedError'; }
}

/** Encrypts and persists a verified connection. Never called on a failed verify. */
export async function connectPanel(input: {
  panelUrl: string; username: string; apiKey: string; serverId?: string | null;
}): Promise<VerifyOutcome> {
  if (!isEncryptionConfigured()) {
    return {
      ok: false, status: 'disconnected', permissionsVerified: false, verifiedAt: null,
      message: 'Credential storage is not ready: set PANEL_ENCRYPTION_KEY (32+ random characters) in the server environment. Nothing was saved.'
    };
  }
  if (storageMode() === 'none') {
    return {
      ok: false, status: 'disconnected', permissionsVerified: false, verifiedAt: null,
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
    serverId: outcome.selectedServer!.identifier,
    serverName: outcome.selectedServer!.name,
    status: 'connected',
    permissionsVerified: outcome.permissionsVerified,
    lastVerifiedAt: new Date(outcome.verifiedAt!)
  });
  return outcome;
}

/**
 * Re-runs verification using the stored credential. A stored row is never
 * treated as proof of health: this always makes a live request.
 */
export async function testStoredConnection(): Promise<VerifyOutcome> {
  const row = await getConnection(ADMIN_ID);
  if (!row) throw new NotConnectedError();
  if (row.status === 'disconnected') {
    return { ok: false, status: 'disconnected', message: 'This connection was disconnected. Reconnect with current credentials.', permissionsVerified: false, verifiedAt: null };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.encryptedApiKey);
  } catch {
    return {
      ok: false, status: 'authentication_failed', permissionsVerified: false, verifiedAt: null,
      message: 'The stored credential could not be decrypted. PANEL_ENCRYPTION_KEY may have changed — reconnect the panel.'
    };
  }

  const outcome = await verifyPanel({ panelUrl: row.panelUrl, username: row.panelUsername, apiKey, serverId: row.serverId });

  if (outcome.ok) {
    await updateConnectionState(ADMIN_ID, {
      status: 'connected', permissionsVerified: true, lastVerifiedAt: new Date(outcome.verifiedAt!),
      serverId: outcome.selectedServer!.identifier, serverName: outcome.selectedServer!.name
    });
  } else if (outcome.status !== 'disconnected') {
    // Record the failure but keep the stored credential so the operator can retry.
    await updateConnectionState(ADMIN_ID, { status: outcome.status, permissionsVerified: false, lastVerifiedAt: row.lastVerifiedAt });
  }
  return outcome;
}

/** Credentials for the file/resource routes. Stored connection wins; env is the legacy fallback. */
export async function resolveCredentials(): Promise<{ panelUrl: string; apiKey: string; serverId: string }> {
  const row = await getConnection(ADMIN_ID);
  if (row && row.serverId) {
    let apiKey: string;
    try { apiKey = decryptSecret(row.encryptedApiKey); }
    catch { throw new NotConnectedError('Stored credential cannot be decrypted. Reconnect the panel.'); }
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
  const storage = storageMode();
  const base = {
    storage, encryptionReady: isEncryptionConfigured(),
    connected: false, status: 'disconnected' as ConnectionStatus
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
    permissionsVerified: row.permissionsVerified,
    lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString()
  };
}
