import { NextRequest, NextResponse } from 'next/server';
import { guard } from '@/lib/api-guard';
import { connectPanel } from '@/lib/connection';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const blocked = await guard(req, 'panel-connect', 5);
  if (blocked) return blocked;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  const panelUrl = typeof body.panelUrl === 'string' ? body.panelUrl : '';
  const username = typeof body.username === 'string' ? body.username : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
  const serverId = typeof body.serverId === 'string' && body.serverId ? body.serverId : null;
  try {
    const outcome = await connectPanel({ panelUrl, username, apiKey, serverId });
    // 200 only when a real verification succeeded; failures keep their own status.
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Connection failed.' }, { status: 500 });
  }
}
