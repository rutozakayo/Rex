import { NextResponse } from 'next/server';
import { guard } from '@/lib/api-guard';
import { resolveCredentials, detectBotServers, NotConnectedError } from '@/lib/connection';
import { listServers } from '@/lib/pterodactyl';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const blocked = await guard(req as never, 'panel-servers', 20);
  if (blocked) return blocked;
  try {
    const cred = await resolveCredentials();
    const servers = await listServers({ base: cred.panelUrl.replace(/\/$/, ''), token: cred.apiKey });
    const detected = detectBotServers(servers);
    return NextResponse.json({
      servers,
      detectedIds: (detected.length ? detected : []).map(s => s.identifier),
      currentServerId: cred.serverId
    });
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not list servers.' }, { status: 502 });
  }
}
