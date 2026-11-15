'use client';
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen grid place-items-center p-5">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101624] p-7">
        <p className="text-[10px] tracking-[.2em] text-rose-300">DARKNOTE / RUNTIME ERROR</p>
        <h1 className="mt-2 text-xl font-semibold">This panel could not finish loading</h1>
        <p className="mt-2 text-xs text-slate-400">The interface shell is still running. Retry, or review server configuration and upstream services.</p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-[#080d17] p-3 text-[11px] text-rose-200">{error.message}</pre>
        <button onClick={reset} className="mt-4 w-full rounded-xl bg-blue-600 p-3 text-sm font-semibold hover:bg-blue-500">Retry</button>
      </div>
    </main>
  );
}
