import type { NextRequest } from 'next/server';

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

/**
 * Fixed-window counter held per process. On serverless hosting each instance
 * keeps its own window, so this throttles bursts rather than guaranteeing a
 * global quota. It is a speed bump, not the only control: endpoints also
 * require a valid admin session.
 */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter(t => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0];
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) if (v.hits.length === 0 || now - v.hits[v.hits.length - 1] > windowMs) buckets.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

export function clientKey(req: NextRequest, scope: string): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || req.headers.get('x-real-ip') || 'unknown';
  return `${scope}:${ip}`;
}

/** Cross-site POST defence in addition to the SameSite=strict session cookie. */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('host');
  try { return new URL(origin).host === host; } catch { return false; }
}
