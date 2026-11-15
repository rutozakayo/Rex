import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/session';
import { readFile, safeRemotePath } from '@/lib/pterodactyl';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({error:'Unauthorized'},{status:401});
  try {
    const file = safeRemotePath(req.nextUrl.searchParams.get('file') || '');
    const contents = await readFile(file);
    return new NextResponse(contents, {headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:'Remote read failed.'},{status:502}); }
}
