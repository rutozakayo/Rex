import { NextResponse } from 'next/server';
import { guard } from '@/lib/api-guard';
import { publicStatus } from '@/lib/connection';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const blocked = await guard(req as never, 'panel-status', 60);
  if (blocked) return blocked;
  try { return NextResponse.json(await publicStatus()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read connection state.' }, { status: 503 }); }
}
