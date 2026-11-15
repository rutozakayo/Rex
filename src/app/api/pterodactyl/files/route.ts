import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/session';
import { listDirectory, safeRemotePath, PanelError } from '@/lib/pterodactyl';
import { resolveCredentials, NotConnectedError } from '@/lib/connection';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const cred = await resolveCredentials();
    const directory = safeRemotePath(req.nextUrl.searchParams.get('directory') || '/');
    const result = await listDirectory({ base: cred.panelUrl.replace(/\/$/, ''), token: cred.apiKey }, cred.serverId, directory);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ error: e.message, notConnected: true }, { status: 503 });
    if (e instanceof PanelError) return NextResponse.json({ error: e.message, panelCode: e.code }, { status: e.code === 'forbidden' ? 403 : 502 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Remote listing failed.' }, { status: 502 });
  }
}
