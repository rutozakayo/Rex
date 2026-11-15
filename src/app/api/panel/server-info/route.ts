import { NextResponse } from 'next/server';
import { guard } from '@/lib/api-guard';
import { serverInfo, NotConnectedError } from '@/lib/connection';
import { PanelError } from '@/lib/pterodactyl';

export const dynamic = 'force-dynamic';

/** Live read of the one configured server. Nothing is cached or invented. */
export async function GET(req: Request) {
  const blocked = await guard(req as never, 'panel-server-info', 30);
  if (blocked) return blocked;
  try {
    return NextResponse.json({ ok: true, server: await serverInfo() });
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ ok: false, notConnected: true, error: e.message }, { status: 404 });
    if (e instanceof PanelError) return NextResponse.json({ ok: false, error: e.message, panelCode: e.code }, { status: 502 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not read server information.' }, { status: 500 });
  }
}
