import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/session';
import { getResources } from '@/lib/pterodactyl';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({error:'Unauthorized'},{status:401});
  try { const r=await getResources(); return NextResponse.json(r.attributes); }
  catch(e) { return NextResponse.json({error:e instanceof Error?e.message:'Resource query failed.'},{status:502}); }
}
