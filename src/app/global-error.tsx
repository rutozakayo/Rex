'use client';
// Inline styles only: if the root layout or CSS bundle fails, this must still render.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#070a12', color: '#e7ecf5', fontFamily: 'Arial,Helvetica,sans-serif', minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div style={{ maxWidth: 420, width: '100%', border: '1px solid rgba(255,255,255,.1)', background: '#101624', borderRadius: 16, padding: 28 }}>
          <p style={{ fontSize: 10, letterSpacing: '.2em', color: '#fda4af', margin: 0 }}>DARKNOTE / FATAL</p>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 8 }}>Control center unavailable</h1>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>The application root failed to render. Reload to retry.</p>
          <pre style={{ fontSize: 11, color: '#fecdd3', background: '#080d17', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 160 }}>{error.message}</pre>
          <button onClick={reset} style={{ marginTop: 16, width: '100%', background: '#2563eb', color: '#fff', border: 0, borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 600 }}>Reload</button>
        </div>
      </body>
    </html>
  );
}
