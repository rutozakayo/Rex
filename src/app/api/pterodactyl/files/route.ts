import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/session';
import { listFiles, safeRemotePath } from '@/lib/pterodactyl';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({error:'Unauthorized'},{status:401});
  try {
    const directory = safeRemotePath(req.nextUrl.searchParams.get('directory') || '/');
    const result = await listFiles(directory);
    return NextResponse.json({directory, files:result.data.map(x=>x.attributes)});
  } catch (e) { return NextResponse.json({error:e instanceof Error?e.message:'Remote listing failed.'},{status:502}); }
}
