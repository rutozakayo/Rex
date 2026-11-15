import { NextRequest, NextResponse } from 'next/server';
import { guard } from '@/lib/api-guard';
import { disconnectPanel } from '@/lib/connection';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const blocked = await guard(req, 'panel-disconnect', 10);
  if (blocked) return blocked;
  try {
    await disconnectPanel();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Disconnect failed.' }, { status: 500 });
  }
}
