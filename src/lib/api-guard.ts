import { NextResponse, type NextRequest } from 'next/server';
import { isAuthenticated } from './session';
import { clientKey, isSameOrigin, rateLimit } from './security';

/**
 * Shared gate for state-changing panel endpoints: same-origin, authenticated,
 * and rate limited. Returns a response to short-circuit, or null to continue.
 */
export async function guard(
  req: NextRequest,
  scope: string,
  limit: number,
  windowMs = 60_000
): Promise<NextResponse | null> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-site request rejected.' }, { status: 403 });
  }
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = rateLimit(clientKey(req, scope), limit, windowMs);
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Retry shortly.' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } }
    );
  }
  return null;
}
