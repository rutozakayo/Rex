import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center p-5">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101624] p-7">
        <p className="text-[10px] tracking-[.2em] text-blue-300">DARKNOTE / 404</p>
        <h1 className="mt-2 text-xl font-semibold">Route not found</h1>
        <p className="mt-2 text-xs text-slate-400">This address does not match any control center panel.</p>
        <Link href="/" className="mt-4 block rounded-xl bg-blue-600 p-3 text-center text-sm font-semibold hover:bg-blue-500">Return to dashboard</Link>
      </div>
    </main>
  );
}
