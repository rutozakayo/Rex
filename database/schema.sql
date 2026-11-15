-- Neon PostgreSQL metadata schema. Production files remain on Pterodactyl.
create extension if not exists pgcrypto;
create table if not exists connected_servers (
 id uuid primary key default gen_random_uuid(), name text not null,
 panel_url text not null, pterodactyl_server_id text not null unique,
 created_at timestamptz not null default now(), last_seen_at timestamptz
);
create table if not exists file_indexes (
 id uuid primary key default gen_random_uuid(), server_id uuid not null references connected_servers(id) on delete cascade,
 path text not null, file_name text not null, file_size bigint, mime_type text,
 sha256 text, remote_modified_at timestamptz, indexed_at timestamptz not null default now(),
 unique(server_id,path)
);
create index if not exists file_indexes_name_idx on file_indexes using gin(to_tsvector('simple',file_name));
create table if not exists editor_drafts (
 id uuid primary key default gen_random_uuid(), server_id uuid not null references connected_servers(id),
 path text not null, content text not null, base_sha256 text, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists file_versions (
 id uuid primary key default gen_random_uuid(), server_id uuid not null references connected_servers(id),
 path text not null, version_number integer not null, sha256 text not null, storage_key text not null,
 created_by text not null, deployment_id uuid, created_at timestamptz not null default now(),
 unique(server_id,path,version_number)
);
create table if not exists deployments (
 id uuid primary key default gen_random_uuid(), server_id uuid not null references connected_servers(id),
 status text not null check(status in ('pending','validating','approved','deploying','succeeded','failed','rolled_back')),
 requested_by text not null, approved_by text, change_summary text, created_at timestamptz not null default now(),
 finished_at timestamptz
);
create table if not exists activity_logs (
 id bigserial primary key, actor text not null, action text not null, target text,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists sync_conflicts (
 id uuid primary key default gen_random_uuid(), server_id uuid not null references connected_servers(id),
 path text not null, base_sha256 text, remote_sha256 text, draft_sha256 text,
 status text not null default 'open', created_at timestamptz not null default now()
);

-- Per-administrator Pterodactyl connection metadata.
-- The API key is stored as AES-256-GCM ciphertext (PANEL_ENCRYPTION_KEY);
-- no plaintext credential, password or token is ever written to these columns.
create table if not exists panel_connections (
 id uuid primary key default gen_random_uuid(),
 admin_user_id text not null unique,
 panel_url text not null,
 panel_username text not null,
 encrypted_api_key text not null,
 server_id text,
 server_name text,
 server_address text,
 status text not null default 'disconnected'
   check (status in ('connected','verifying','authentication_failed','invalid_url','permission_insufficient','panel_unavailable','disconnected')),
 permissions_verified boolean not null default false,
 last_verified_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists panel_connections_status_idx on panel_connections(status);
-- Additive migration for databases created before server_address existed.
alter table panel_connections add column if not exists server_address text;
