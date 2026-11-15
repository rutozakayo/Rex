import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/session';
import { sql } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (!process.env.DATABASE_URL) return NextResponse.json({connected:false,error:'DATABASE_URL is not configured.'},{status:503});
  try { await sql()`select 1 as ok`; return NextResponse.json({connected:true}); }
  catch { return NextResponse.json({connected:false,error:'Database is not configured or unreachable.'},{status:503}); }
}
