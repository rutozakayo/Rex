import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/session';
import { getServerResources, PanelError } from '@/lib/pterodactyl';
import { resolveCredentials, NotConnectedError } from '@/lib/connection';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const cred = await resolveCredentials();
    const resources = await getServerResources({ base: cred.panelUrl.replace(/\/$/, ''), token: cred.apiKey }, cred.serverId);
    return NextResponse.json(resources);
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ error: e.message, notConnected: true }, { status: 503 });
    if (e instanceof PanelError) return NextResponse.json({ error: e.message, panelCode: e.code }, { status: e.code === 'forbidden' ? 403 : 502 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Resource query failed.' }, { status: 502 });
  }
}
