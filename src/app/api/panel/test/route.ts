import { NextRequest, NextResponse } from 'next/server';
import { guard } from '@/lib/api-guard';
import { testStoredConnection, NotConnectedError } from '@/lib/connection';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const blocked = await guard(req, 'panel-test', 10);
  if (blocked) return blocked;
  try {
    const outcome = await testStoredConnection();
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Test failed.' }, { status: 500 });
  }
}
