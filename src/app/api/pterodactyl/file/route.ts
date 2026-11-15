import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/session';
import { readFileContents, safeRemotePath, PanelError } from '@/lib/pterodactyl';
import { resolveCredentials, NotConnectedError } from '@/lib/connection';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const cred = await resolveCredentials();
    const file = safeRemotePath(req.nextUrl.searchParams.get('file') || '');
    const contents = await readFileContents({ base: cred.panelUrl.replace(/\/$/, ''), token: cred.apiKey }, cred.serverId, file);
    return new NextResponse(contents, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ error: e.message, notConnected: true }, { status: 503 });
    if (e instanceof PanelError) return NextResponse.json({ error: e.message, panelCode: e.code }, { status: e.code === 'forbidden' ? 403 : 502 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Remote read failed.' }, { status: 502 });
  }
}
