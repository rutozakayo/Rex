'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Link2, Loader2, Plug, Server, ShieldCheck, Trash2, User } from 'lucide-react';

type Status =
  | 'connected' | 'verifying' | 'authentication_failed'
  | 'invalid_url' | 'permission_insufficient' | 'panel_unavailable' | 'disconnected';

type StatusDto = {
  storage: 'neon' | 'memory' | 'none';
  encryptionReady: boolean;
  connected: boolean;
  status: Status;
  panelUrl?: string;
  panelUsername?: string;
  serverId?: string | null;
  serverName?: string | null;
  permissionsVerified?: boolean;
  lastVerifiedAt?: string | null;
  updatedAt?: string;
};

type ServerDto = { identifier: string; name: string; description: string; isSuspended: boolean };

type Outcome = {
  ok?: boolean;
  status?: Status;
  message?: string;
  error?: string;
  account?: { username: string; email: string; rootAdmin: boolean };
  selectedServer?: { identifier: string; name: string } | null;
  candidates?: ServerDto[];
  needsServerSelection?: boolean;
  permissionsVerified?: boolean;
  verifiedAt?: string | null;
};

const LABEL: Record<Status, { text: string; tone: string }> = {
  connected: { text: 'Connected', tone: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' },
  verifying: { text: 'Verifying', tone: 'border-blue-400/30 bg-blue-500/10 text-blue-300' },
  authentication_failed: { text: 'Authentication failed', tone: 'border-rose-400/30 bg-rose-500/10 text-rose-300' },
  invalid_url: { text: 'Invalid panel URL', tone: 'border-rose-400/30 bg-rose-500/10 text-rose-300' },
  permission_insufficient: { text: 'Permission insufficient', tone: 'border-amber-400/30 bg-amber-500/10 text-amber-300' },
  panel_unavailable: { text: 'Panel unavailable', tone: 'border-amber-400/30 bg-amber-500/10 text-amber-300' },
  disconnected: { text: 'Disconnected', tone: 'border-slate-500/30 bg-slate-500/10 text-slate-300' }
};

async function readJson(r: Response): Promise<Outcome & Partial<StatusDto>> {
  const t = await r.text();
  try { return JSON.parse(t) as Outcome & StatusDto; }
  catch { return { error: t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || `Request failed (${r.status})` }; }
}

function when(iso?: string | null) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString();
}

export default function PanelConnection() {
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [mode, setMode] = useState<'loading' | 'setup' | 'view' | 'edit'>('loading');
  const [busy, setBusy] = useState<'' | 'saving' | 'testing' | 'disconnecting'>('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [form, setForm] = useState({ panelUrl: '', username: '', apiKey: '', serverId: '' });
  const [candidates, setCandidates] = useState<ServerDto[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/panel', { cache: 'no-store' });
      const j = await readJson(r);
      if (!r.ok) { setOutcome({ error: j.error || 'Could not read connection state.' }); setMode('setup'); return; }
      const next: StatusDto = {
        storage: j.storage ?? 'none',
        encryptionReady: Boolean(j.encryptionReady),
        connected: Boolean(j.connected),
        status: (j.status ?? 'disconnected') as Status,
        panelUrl: j.panelUrl,
        panelUsername: j.panelUsername,
        serverId: j.serverId ?? null,
        serverName: j.serverName ?? null,
        permissionsVerified: Boolean(j.permissionsVerified),
        lastVerifiedAt: j.lastVerifiedAt ?? null,
        updatedAt: j.updatedAt
      };
      setStatus(next);
      if (next.connected) {
        setMode('view');
        setForm(f => ({ ...f, panelUrl: next.panelUrl || '', username: next.panelUsername || '', serverId: next.serverId || '' }));
      } else {
        setMode(m => (m === 'edit' ? 'edit' : 'setup'));
        setForm(f => ({ ...f, panelUrl: next.panelUrl || f.panelUrl, username: next.panelUsername || f.username, serverId: next.serverId || f.serverId }));
      }
    } catch {
      setOutcome({ error: 'Could not reach the control center API.' });
      setMode('setup');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy('saving'); setOutcome(null); setCandidates([]);
    try {
      const r = await fetch('/api/panel/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          panelUrl: form.panelUrl, username: form.username, apiKey: form.apiKey,
          serverId: form.serverId || null
        })
      });
      const j = await readJson(r);
      setOutcome(j);
      if (r.ok && j.ok) {
        setForm(f => ({ ...f, apiKey: '' }));
        await load();
      } else if (j.needsServerSelection && j.candidates?.length) {
        setCandidates(j.candidates);
      }
    } catch {
      setOutcome({ error: 'Network error while contacting the panel.' });
    } finally { setBusy(''); }
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
      setStatus(s => ({ ...(s as StatusDto), connected: false, status: 'disconnected', serverId: null, serverName: null }));
      setForm({ panelUrl: '', username: '', apiKey: '', serverId: '' });
      setMode('setup');
      setOutcome({ message: 'Panel disconnected and the stored credential was deleted.' });
    } catch { setOutcome({ error: 'Network error during disconnect.' }); }
    finally { setBusy(''); }
  }

  const current = status?.status ?? 'disconnected';
  const badge = LABEL[current] ?? LABEL.disconnected;
  const blocked = status && (!status.encryptionReady || status.storage === 'none');
  const showForm = mode === 'setup' || mode === 'edit';

  return (
    <section className="mt-5 rounded-2xl border border-white/[.07] bg-[#101624] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-blue-400/20 bg-blue-500/10 p-2 text-blue-300"><Plug size={15} /></span>
          <div>
            <h2 className="text-sm font-semibold">Pterodactyl connection</h2>
            <p className="text-[10px] tracking-[.15em] text-slate-600">PANEL AUTHENTICATION &amp; PERMISSIONS</p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${badge.tone}`}>{badge.text}</span>
      </div>

      {mode === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Reading connection state…</p>
      )}

      {blocked && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-200">
          {status.storage === 'none'
            ? 'Credential storage is offline: DATABASE_URL is not configured, so a panel connection cannot be saved.'
            : 'Credential encryption is offline: set PANEL_ENCRYPTION_KEY (32+ random characters), then redeploy.'}
          {' '}Verification still runs, but nothing will be stored until this is fixed.
        </div>
      )}

      {mode === 'view' && status?.connected && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Panel" value={status.panelUrl || '—'} mono />
          <Field label="Username" value={status.panelUsername || '—'} mono />
          <Field label="Server" value={status.serverName || '—'} />
          <Field label="Server identifier" value={status.serverId || '—'} mono />
          <Field label="Authentication" value={current === 'connected' ? 'Verified' : 'Not verified'} ok={current === 'connected'} />
          <Field label="API permissions" value={status.permissionsVerified ? 'Verified (files + resources)' : 'Not verified'} ok={Boolean(status.permissionsVerified)} />
          <Field label="Connection" value={badge.text} />
          <Field label="Last checked" value={when(status.lastVerifiedAt)} />
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="mt-2 grid gap-3">
          <div className="rounded-xl border border-white/[.07] bg-[#080d17] p-3 text-[11px] leading-5 text-slate-400">
            <b className="text-slate-200">Why an API key instead of your panel password?</b> Pterodactyl has no API that
            accepts a username and password — its Client API only accepts an API key. Sending a panel password here would
            require scripting the panel&apos;s web login, which is unsafe and unsupported. Create a key in your panel under
            <span className="text-slate-200"> Account → API Credentials</span> and paste it below. The key&apos;s owner is
            checked against the username you enter, so the connection is tied to that exact account.
          </div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Panel URL
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-[#080d17] px-3">
              <Link2 size={14} className="text-slate-600" />
              <input required value={form.panelUrl} onChange={e => setForm(f => ({ ...f, panelUrl: e.target.value }))}
                placeholder="https://panel.example.com" className="w-full bg-transparent py-3 text-xs outline-none" />
            </div>
          </label>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Panel username
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-[#080d17] px-3">
              <User size={14} className="text-slate-600" />
              <input required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="admin_username" autoComplete="off" className="w-full bg-transparent py-3 text-xs outline-none" />
            </div>
          </label>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Client API key
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-[#080d17] px-3">
              <KeyRound size={14} className="text-slate-600" />
              <input required value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                type="password" autoComplete="off" spellCheck={false}
                placeholder={mode === 'edit' ? 'Paste the key again to re-verify' : 'ptlc_…'}
                className="w-full bg-transparent py-3 text-xs outline-none" />
            </div>
          </label>

          {candidates.length > 0 && (
            <label className="text-[10px] uppercase tracking-wider text-slate-500">Select the Darknote server
              <select value={form.serverId} onChange={e => setForm(f => ({ ...f, serverId: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#080d17] p-3 text-xs outline-none">
                <option value="">Choose a server…</option>
                {candidates.map(s => <option key={s.identifier} value={s.identifier}>{s.name} · {s.identifier}</option>)}
              </select>
            </label>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button disabled={busy === 'saving'} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold hover:bg-blue-500 disabled:opacity-50">
              {busy === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              {busy === 'saving' ? 'Verifying…' : 'Verify & connect'}
            </button>
            {mode === 'edit' && (
              <button type="button" onClick={() => setMode('view')} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-300">Cancel</button>
            )}
          </div>
        </form>
      )}

      {mode === 'view' && status?.connected && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={test} disabled={busy === 'testing'} className="flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-2.5 text-xs text-blue-200 disabled:opacity-50">
            {busy === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />} Test connection
          </button>
          <button onClick={() => { setMode('edit'); setOutcome(null); }} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-300">Change panel details</button>
          <button onClick={() => setMode('setup')} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-300">Reconnect</button>
          <button onClick={disconnect} disabled={busy === 'disconnecting'} className="flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200 disabled:opacity-50">
            {busy === 'disconnecting' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Disconnect
          </button>
        </div>
      )}

      {outcome?.message && (
        <div className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-[11px] leading-5 ${outcome.ok ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>
          {outcome.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
          <span>{outcome.message}</span>
        </div>
      )}
      {outcome?.error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-[11px] leading-5 text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{outcome.error}</span>
        </div>
      )}
      {outcome?.verifiedAt && outcome.ok && (
        <p className="mt-2 text-[10px] text-slate-600">Verified at {when(outcome.verifiedAt)}</p>
      )}
      {status && (
        <p className="mt-3 text-[10px] text-slate-600">
          Storage: {status.storage === 'memory' ? 'in-memory (development only — not persisted)' : status.storage === 'neon' ? 'Neon PostgreSQL' : 'not configured'}
          {' · '}Credentials encrypted: {status.encryptionReady ? 'yes (AES-256-GCM)' : 'no'}
        </p>
      )}
    </section>
  );
}

function Field({ label, value, mono, ok }: { label: string; value: string; mono?: boolean; ok?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[.07] bg-[#080d17] p-3">
      <p className="text-[9px] uppercase tracking-[.18em] text-slate-600">{label}</p>
      <p className={`mt-1 truncate text-xs ${mono ? 'font-mono' : ''} ${ok === true ? 'text-emerald-300' : ok === false ? 'text-amber-300' : 'text-slate-200'}`}>{value}</p>
    </div>
  );
}
