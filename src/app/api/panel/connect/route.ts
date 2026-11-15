import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guard } from '@/lib/api-guard';
import { connectPanel } from '@/lib/connection';

export const dynamic = 'force-dynamic';

const schema = z.object({
  panelUrl: z.string().trim().min(1, 'Panel URL is required.').max(2048),
  username: z.string().trim().min(1, 'Panel username is required.').max(191),
  apiKey: z.string().trim().min(8, 'Client API key looks too short.').max(4096),
  serverId: z.string().trim().min(1, 'Server ID is required.').max(64).regex(/^[A-Za-z0-9_-]+$/, 'Server ID may only contain letters, numbers, hyphen and underscore.'),
  serverName: z.string().trim().max(191).optional(),
  serverAddress: z.string().trim().max(255).optional()
});

export async function POST(req: NextRequest) {
  const blocked = await guard(req, 'panel-connect', 5);
  if (blocked) return blocked;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      ok: false,
      error: 'Check the highlighted fields.',
      issues: parsed.error.issues.map(i => ({ field: String(i.path[0]), message: i.message }))
    }, { status: 400 });
  }

  try {
    const outcome = await connectPanel(parsed.data);
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Connection failed.' }, { status: 500 });
  }
}
