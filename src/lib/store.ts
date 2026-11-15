import { neon } from '@neondatabase/serverless';

export type ConnectionStatus =
  | 'connected' | 'verifying' | 'authentication_failed'
  | 'invalid_url' | 'permission_insufficient' | 'panel_unavailable' | 'disconnected';

export type ConnectionRow = {
  adminUserId: string;
  panelUrl: string;
  panelUsername: string;
  encryptedApiKey: string;
  serverId: string | null;
  serverName: string | null;
  serverAddress: string | null;
  status: ConnectionStatus;
  permissionsVerified: boolean;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StorageMode = 'neon' | 'memory' | 'none';

/**
 * Neon in every deployed environment. The in-memory store exists only so the
 * flow can be exercised locally without a database; it is never selected when
 * NODE_ENV=production, so a misconfigured deployment fails loudly instead of
 * silently forgetting credentials.
 */
export function storageMode(): StorageMode {
  // PANEL_STORE=memory is an explicit development/testing override: it does not
  // persist across restarts and must never be used to serve real credentials.
  const forced = process.env.PANEL_STORE;
  if (forced === 'memory') return 'memory';
  if (process.env.DATABASE_URL) return 'neon';
  if (forced === 'neon') return 'none';
  if (process.env.NODE_ENV !== 'production') return 'memory';
  return 'none';
}

const memory = new Map<string, ConnectionRow>();

let migrated: Promise<void> | null = null;

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured.');
  return neon(url);
}

async function ensureSchema(): Promise<void> {
  if (!migrated) {
    migrated = (async () => {
      const sql = client();
      await sql`
        create table if not exists panel_connections (
          id uuid primary key default gen_random_uuid(),
          admin_user_id text not null unique,
          panel_url text not null,
          panel_username text not null,
          encrypted_api_key text not null,
          server_id text,
          server_name text,
          server_address text,
          status text not null default 'disconnected',
          permissions_verified boolean not null default false,
          last_verified_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )`;
      // Additive migration for databases created before server_address existed.
      await sql`alter table panel_connections add column if not exists server_address text`;
    })().catch(err => { migrated = null; throw err; });
  }
  return migrated;
}

type DbRow = Record<string, unknown>;

function toRow(r: DbRow): ConnectionRow {
  return {
    adminUserId: String(r.admin_user_id),
    panelUrl: String(r.panel_url),
    panelUsername: String(r.panel_username),
    encryptedApiKey: String(r.encrypted_api_key),
    serverId: r.server_id ? String(r.server_id) : null,
    serverName: r.server_name ? String(r.server_name) : null,
    serverAddress: r.server_address ? String(r.server_address) : null,
    status: String(r.status) as ConnectionStatus,
    permissionsVerified: Boolean(r.permissions_verified),
    lastVerifiedAt: r.last_verified_at ? new Date(String(r.last_verified_at)) : null,
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at))
  };
}

export async function getConnection(adminUserId: string): Promise<ConnectionRow | null> {
  const mode = storageMode();
  if (mode === 'none') return null;
  if (mode === 'memory') return memory.get(adminUserId) ?? null;
  await ensureSchema();
  const sql = client();
  const rows = await sql`select * from panel_connections where admin_user_id = ${adminUserId} limit 1`;
  return rows.length ? toRow(rows[0] as DbRow) : null;
}

export async function upsertConnection(input: {
  adminUserId: string; panelUrl: string; panelUsername: string; encryptedApiKey: string;
  serverId: string | null; serverName: string | null; serverAddress?: string | null;
  status: ConnectionStatus; permissionsVerified: boolean; lastVerifiedAt: Date | null;
}): Promise<void> {
  const mode = storageMode();
  if (mode === 'none') throw new Error('Credential storage is not configured. DATABASE_URL is required in production.');
  if (mode === 'memory') {
    const now = new Date();
    const prev = memory.get(input.adminUserId);
    memory.set(input.adminUserId, { ...input, serverAddress: input.serverAddress ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now });
    return;
  }
  await ensureSchema();
  const sql = client();
  await sql`
    insert into panel_connections
      (admin_user_id, panel_url, panel_username, encrypted_api_key, server_id, server_name, server_address, status, permissions_verified, last_verified_at, updated_at)
    values
      (${input.adminUserId}, ${input.panelUrl}, ${input.panelUsername}, ${input.encryptedApiKey}, ${input.serverId}, ${input.serverName}, ${input.serverAddress ?? null}, ${input.status}, ${input.permissionsVerified}, ${input.lastVerifiedAt}, now())
    on conflict (admin_user_id) do update set
      panel_url = excluded.panel_url,
      panel_username = excluded.panel_username,
      encrypted_api_key = excluded.encrypted_api_key,
      server_id = excluded.server_id,
      server_name = excluded.server_name,
      server_address = excluded.server_address,
      status = excluded.status,
      permissions_verified = excluded.permissions_verified,
      last_verified_at = excluded.last_verified_at,
      updated_at = now()`;
}

export async function updateConnectionState(adminUserId: string, patch: {
  status: ConnectionStatus; permissionsVerified: boolean; lastVerifiedAt: Date | null;
  serverId?: string | null; serverName?: string | null; serverAddress?: string | null;
}): Promise<void> {
  const mode = storageMode();
  if (mode === 'none') return;
  if (mode === 'memory') {
    const prev = memory.get(adminUserId);
    if (!prev) return;
    memory.set(adminUserId, {
      ...prev, status: patch.status,
      permissionsVerified: patch.permissionsVerified,
      lastVerifiedAt: patch.lastVerifiedAt,
      serverId: patch.serverId !== undefined ? patch.serverId : prev.serverId,
      serverName: patch.serverName !== undefined ? patch.serverName : prev.serverName,
      serverAddress: patch.serverAddress !== undefined ? patch.serverAddress : prev.serverAddress,
      updatedAt: new Date()
    });
    return;
  }
  await ensureSchema();
  const sql = client();
  await sql`
    update panel_connections set
      status = ${patch.status},
      permissions_verified = ${patch.permissionsVerified},
      last_verified_at = ${patch.lastVerifiedAt},
      server_id = coalesce(${patch.serverId ?? null}, server_id),
      server_name = coalesce(${patch.serverName ?? null}, server_name),
      server_address = coalesce(${patch.serverAddress ?? null}, server_address),
      updated_at = now()
    where admin_user_id = ${adminUserId}`;
}

export async function deleteConnection(adminUserId: string): Promise<void> {
  const mode = storageMode();
  if (mode === 'none') return;
  if (mode === 'memory') { memory.delete(adminUserId); return; }
  await ensureSchema();
  const sql = client();
  await sql`delete from panel_connections where admin_user_id = ${adminUserId}`;
}
