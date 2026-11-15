'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Cpu, HardDrive, KeyRound, Link2, Loader2, MemoryStick,
  Plug, RefreshCw, Save, Server, ShieldCheck, Timer, Trash2, User
} from 'lucide-react';

type ConnStatus = 'connected' | 'verifying' | 'authentication_failed' | 'invalid_url'
  | 'permission_insufficient' | 'panel_unavailable' | 'disconnected';

type StatusDto = {
  storage: 'neon' | 'memory' | 'none';
  encryptionReady: boolean;
  connected: boolean;
  status: ConnStatus;
  panelUrl?: string;
  panelUsername?: string;
  serverId?: string | null;
  serverName?: string | null;
  serverAddress?: string | null;
  permissionsVerified?: boolean;
  lastVerifiedAt?: string | null;
};

type ServerDto = {
  name: string; identifier: string; address: string | null; state: string; isSuspended: boolean;
  cpuAbsolute: number; cpuLimit: number; memoryBytes: number; memoryLimitBytes: number;
  diskBytes: number; diskLimitBytes: number; uptimeSeconds: number;
  allocationsReadable: boolean; fetchedAt: string;
};

type Outcome = {
  ok?: boolean; status?: ConnStatus; message?: string; error?: string; notes?: string[];
  issues?: { field: string; message: string }[];
  server?: { identifier: string; name: string; address: string | null };
  permissions?: { server: boolean; resources: boolean; files: boolean; allocations: boolean };
  verifiedAt?: string | null;
  notConnected?: boolean;
};

const EMPTY = { panelUrl: '', serverName: '', serverId: '', serverAddress: '', username: '', apiKey: '' };

async function readJson(r: Response): Promise<Outcome & Partial<StatusDto>> {
  const t = await r.text();
  try { return JSON.parse(t) as Outcome & Partial<StatusDto>; }
  catch { return { error: t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || `Request failed (${r.status})` }; }
}

function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`;
}

function uptime(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function when(iso?: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString();
}

export default function PanelConnection() {
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [info, setInfo] = useState<ServerDto | null>(null);
  const [mode, setMode] = useState<'loading' | 'setup' | 'view' | 'edit'>('loading');
  const [busy, setBusy] = useState<'' | 'saving' | 'testing' | 'disconnecting'>('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [infoError, setInfoError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/panel', { cache: 'no-store' });
      const j = await readJson(r);
      if (!r.ok) { setOutcome({ error: j.error || 'Could not read connection state.' }); setMode('setup'); return; }
      const next: StatusDto = {
        storage: j.storage ?? 'none',
        encryptionReady: Boolean(j.encryptionReady),
        connected: Boolean(j.connected),
        status: (j.status ?? 'disconnected') as ConnStatus,
        panelUrl: j.panelUrl, panelUsername: j.panelUsername,
        serverId: j.serverId ?? null, serverName: j.serverName ?? null, serverAddress: j.serverAddress ?? null,
        permissionsVerified: Boolean(j.permissionsVerified), lastVerifiedAt: j.lastVerifiedAt ?? null
      };
      setStatus(next);
      setForm(f => ({
        ...f,
        panelUrl: next.panelUrl || f.panelUrl,
        username: next.panelUsername || f.username,
        serverId: next.serverId || f.serverId,
        serverName: next.serverName || f.serverName,
        serverAddress: next.serverAddress || f.serverAddress
      }));
      setMode(m => (next.connected ? 'view' : m === 'edit' ? 'edit' : 'setup'));
    } catch {
      setOutcome({ error: 'Could not reach the control center API.' });
      setMode('setup');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (mode !== 'view') { setInfo(null); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/panel/server-info', { cache: 'no-store' });
        const j = await readJson(r);
        if (!alive) return;
        const withServer = j as Outcome & { server?: ServerDto };
        if (!r.ok || !withServer.server) { setInfoError(withServer.error || 'Server information unavailable.'); setInfo(null); return; }
        setInfo(withServer.server);
        setInfoError('');
      } catch { if (alive) setInfoError('Could not reach the panel.'); }
    })();
    return () => { alive = false; };
  }, [mode]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('saving'); setOutcome(null);
    try {
      const r = await fetch('/api/panel/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
      });
      const j = await readJson(r);
      setOutcome(j);
      if (r.ok && j.ok) { setForm(f => ({ ...f, apiKey: '' })); setMode('view'); await load(); }
    } catch { setOutcome({ error: 'Network error while contacting the panel.' }); }
    finally { setBusy(''); }
  }

  async function test() {
    setBusy('testing'); setOutcome(null);
    try {
      const r = await fetch('/api/panel/test', { method: 'POST' });
      const j = await readJson(r);
      setOutcome(j);
      await load();
    } catch { setOutcome({ error: 'Network error during test.' }); }
    finally { setBusy(''); }
  }

  async function disconnect() {
    setBusy('disconnecting'); setOutcome(null);
    try {
      const r = await fetch('/api/panel/disconnect', { method: 'POST' });
      const j = await readJson(r);
      if (!r.ok) { setOutcome({ error: j.error || 'Disconnect failed.' }); return; }
      setStatus(s => s ? { ...s, connected: false, status: 'disconnected', serverId: null, serverName: null, serverAddress: null } : s);
      setForm(EMPTY); setInfo(null); setMode('setup');
      setOutcome({ message: 'Disconnected. The stored credential was deleted.' });
    } catch { setOutcome({ error: 'Network error during disconnect.' }); }
    finally { setBusy(''); }
  }

  const connecting = busy === 'saving' || busy === 'testing';
  const hasConfig = Boolean(status?.serverId);
  const state = connecting ? 'connecting'
    : status?.connected ? 'connected'
    : (status && status.status !== 'disconnected' && hasConfig) ? 'error'
    : 'disconnected';

  const pill = {
    connected: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
    connecting: 'border-blue-400/40 bg-blue-500/10 text-blue-300',
    error: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
    disconnected: 'border-rose-400/30 bg-rose-500/10 text-rose-300'
  }[state];
  const dot = {
    connected: 'bg-emerald-400', connecting: 'bg-blue-400 animate-pulse',
    error: 'bg-amber-400', disconnected: 'bg-rose-400'
  }[state];
  const stateLabel = { connected: 'CONNECTED', connecting: 'CONNECTING', error: 'CONNECTION ERROR', disconnected: 'DISCONNECTED' }[state];

  const blocked = status && (!status.encryptionReady || status.storage === 'none');
  const showForm = mode === 'setup' || mode === 'edit';

  return (
    <section className="mt-5 rounded-2xl border border-white/[.07] bg-[#101624] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-blue-400/20 bg-blue-500/10 p-2 text-blue-300"><Plug size={15} /></span>
          <div>
            <h2 className="text-sm font-semibold">Pterodactyl server</h2>
            <p className="text-[10px] tracking-[.15em] text-slate-600">SINGLE SERVER CONNECTION</p>
          </div>
        </div>
        <span className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${pill}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{stateLabel}
        </span>
      </div>

      {mode === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Reading configuration…</p>
      )}

      {blocked && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-200">
          {status.storage === 'none'
            ? 'Storage is offline: DATABASE_URL is not set, so the configuration cannot be saved.'
            : 'Encryption is offline: set PANEL_ENCRYPTION_KEY (32+ random characters), then redeploy.'}
        </div>
      )}

      {showForm && (
        <form onSubmit={save} className="grid gap-3">
          <div className="rounded-xl border border-white/[.07] bg-[#080d17] p-3 text-[11px] leading-5 text-slate-400">
            <b className="text-slate-200">About the panel credential.</b> Pterodactyl has no username/password API — its
            Client API accepts only an API key, and the web login at <code className="text-slate-300">/auth/login</code> is
            throttled and reCAPTCHA-protected, so automating it is neither safe nor supported. Create a key in your panel
            under <span className="text-slate-200">Account → API Credentials</span> (scopes: <code>file.read</code>,
            <code> allocation.read</code>) and paste it below. The key&apos;s owning account is checked against the username
            you enter, so the connection is bound to that exact account.
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field icon={<Link2 size={14} />} label="Panel URL" value={form.panelUrl} required
              placeholder="https://panel.example.com" onChange={v => setForm(f => ({ ...f, panelUrl: v }))} />
            <Field icon={<User size={14} />} label="Panel username" value={form.username} required
              placeholder="paneladmin" onChange={v => setForm(f => ({ ...f, username: v }))} />
            <Field icon={<Server size={14} />} label="Server name" value={form.serverName}
              placeholder="Darknote WhatsApp Bot" onChange={v => setForm(f => ({ ...f, serverName: v }))} />
            <Field icon={<Server size={14} />} label="Server ID" value={form.serverId} required mono
              placeholder="a1b2c3d4" onChange={v => setForm(f => ({ ...f, serverId: v }))} />
            <Field icon={<Link2 size={14} />} label="Server address" value={form.serverAddress}
              placeholder="node.example.com:25565" onChange={v => setForm(f => ({ ...f, serverAddress: v }))} />
            <Field icon={<KeyRound size={14} />} label="Client API key" value={form.apiKey} required secret
              placeholder={mode === 'edit' ? 'Paste the key again to re-verify' : 'ptlc_…'}
              onChange={v => setForm(f => ({ ...f, apiKey: v }))} />
          </div>

          {outcome?.issues?.length ? (
            <ul className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-[11px] leading-5 text-rose-200">
              {outcome.issues.map(i => <li key={i.field}><b>{i.field}</b>: {i.message}</li>)}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy === 'saving'} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold hover:bg-blue-500 disabled:opacity-50">
              {busy === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {busy === 'saving' ? 'Verifying…' : 'Save configuration'}
            </button>
            {mode === 'edit' && (
              <button type="button" onClick={() => { setMode('view'); setOutcome(null); }} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-300">Cancel</button>
            )}
          </div>
        </form>
      )}

      {mode === 'view' && status?.connected && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat label="Server" value={info?.name || status.serverName || '—'} />
            <Stat label="Server ID" value={info?.identifier || status.serverId || '—'} mono />
            <Stat label="Address" value={info?.address || status.serverAddress || 'Not exposed by key'} mono />
            <Stat label="State" value={info ? (info.isSuspended ? 'suspended' : info.state) : '—'} />
            <Stat label="Uptime" value={info ? uptime(info.uptimeSeconds) : '—'} icon={<Timer size={12} />} />
            <Stat label="Last checked" value={when(status.lastVerifiedAt)} />
          </div>

          {infoError && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />{infoError}
            </p>
          )}

          {info && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Meter icon={<Cpu size={12} />} label="CPU" used={`${info.cpuAbsolute.toFixed(1)}%`}
                detail={info.cpuLimit > 0 ? `of ${info.cpuLimit}%` : 'unlimited'} percent={info.cpuLimit > 0 ? (info.cpuAbsolute / info.cpuLimit) * 100 : 0} />
              <Meter icon={<MemoryStick size={12} />} label="RAM" used={bytes(info.memoryBytes)}
                detail={info.memoryLimitBytes > 0 ? `of ${bytes(info.memoryLimitBytes)}` : 'unlimited'}
                percent={info.memoryLimitBytes > 0 ? (info.memoryBytes / info.memoryLimitBytes) * 100 : 0} />
              <Meter icon={<HardDrive size={12} />} label="Disk" used={bytes(info.diskBytes)}
                detail={info.diskLimitBytes > 0 ? `of ${bytes(info.diskLimitBytes)}` : 'unlimited'}
                percent={info.diskLimitBytes > 0 ? (info.diskBytes / info.diskLimitBytes) * 100 : 0} />
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={test} disabled={busy === 'testing'} className="flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-2.5 text-xs text-blue-200 disabled:opacity-50">
              {busy === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Test connection
            </button>
            <button onClick={() => { setMode('edit'); setOutcome(null); }} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-300">Edit details</button>
            <button onClick={disconnect} disabled={busy === 'disconnecting'} className="flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200 disabled:opacity-50">
              {busy === 'disconnecting' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Disconnect
            </button>
          </div>
        </>
      )}

      {outcome?.message && (
        <div className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-[11px] leading-5 ${outcome.ok ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>
          {outcome.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
          <span>{outcome.message}</span>
        </div>
      )}
      {outcome?.notes?.length ? (
        <ul className="mt-2 space-y-1 text-[10px] leading-4 text-slate-500">
          {outcome.notes.map(n => <li key={n}>• {n}</li>)}
        </ul>
      ) : null}
      {outcome?.error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-[11px] leading-5 text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{outcome.error}</span>
        </div>
      )}
      {outcome?.permissions && outcome.ok && (
        <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-600">
          <ShieldCheck size={11} /> Scopes: server {outcome.permissions.server ? '✓' : '✗'} · resources {outcome.permissions.resources ? '✓' : '✗'} · files {outcome.permissions.files ? '✓' : '✗'} · allocations {outcome.permissions.allocations ? '✓' : '✗'}
        </p>
      )}
      {status && (
        <p className="mt-3 text-[10px] text-slate-600">
          Storage: {status.storage === 'memory' ? 'in-memory (development only)' : status.storage === 'neon' ? 'Neon PostgreSQL' : 'not configured'}
          {' · '}Credential encrypted: {status.encryptionReady ? 'AES-256-GCM' : 'no'}
        </p>
      )}
    </section>
  );
}

function Field({ icon, label, value, onChange, placeholder, required, mono, secret }: {
  icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; mono?: boolean; secret?: boolean;
}) {
  return (
    <label className="text-[10px] uppercase tracking-wider text-slate-500">
      {label}
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-[#080d17] px-3 focus-within:border-blue-400/50">
        <span className="text-slate-600">{icon}</span>
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
          type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false}
          className={`w-full bg-transparent py-3 text-xs outline-none ${mono ? 'font-mono' : ''}`} />
      </div>
    </label>
  );
}

function Stat({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[.07] bg-[#080d17] p-3">
      <p className="flex items-center gap-1 text-[9px] uppercase tracking-[.18em] text-slate-600">{icon}{label}</p>
      <p className={`mt-1 truncate text-xs text-slate-200 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function Meter({ icon, label, used, detail, percent }: { icon: React.ReactNode; label: string; used: string; detail: string; percent: number }) {
  const width = Math.max(0, Math.min(100, percent));
  const tone = width > 90 ? 'bg-rose-400' : width > 70 ? 'bg-amber-400' : 'bg-blue-400';
  return (
    <div className="rounded-xl border border-white/[.07] bg-[#080d17] p-3">
      <p className="flex items-center gap-1 text-[9px] uppercase tracking-[.18em] text-slate-600">{icon}{label}</p>
      <p className="mt-1 text-xs text-slate-200">{used} <span className="text-slate-600">{detail}</span></p>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
