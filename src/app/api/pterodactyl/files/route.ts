import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/session';
import { listFiles, safeRemotePath } from '@/lib/pterodactyl';
import { isEnvConfigured, missingEnv } from '@/lib/env';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (!isEnvConfigured()) return NextResponse.json({error:'Server configuration is incomplete.',configMissing:true,missing:missingEnv()},{status:503});
  if (!(await isAuthenticated())) return NextResponse.json({error:'Unauthorized'},{status:401});
  try {
    const directory = safeRemotePath(req.nextUrl.searchParams.get('directory') || '/');
    const result = await listFiles(directory);
    return NextResponse.json({directory, files:result.data.map(x=>x.attributes)});
  } catch (e) { return NextResponse.json({error:e instanceof Error?e.message:'Remote listing failed.'},{status:502}); }
}
