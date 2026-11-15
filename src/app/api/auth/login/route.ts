import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, scryptSync } from 'node:crypto';
import { createSession } from '@/lib/session';
import { env, missingEnv } from '@/lib/env';
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';
  let encoded: string;
  try {
    encoded = env().ADMIN_PASSWORD_HASH;
  } catch {
    // Configuration problems are reported as data, never as an uncaught throw.
    return NextResponse.json({ error:'Server configuration is incomplete.', configMissing:true, missing:missingEnv() }, { status:503 });
  }
  // Format: scrypt$<salt-hex>$<derived-key-hex>
  const [scheme, salt, expectedHex] = encoded.split('$');
  if (scheme !== 'scrypt' || !salt || !expectedHex || !/^[a-f0-9]+$/i.test(salt) || !/^[a-f0-9]+$/i.test(expectedHex)) {
    return NextResponse.json({error:'Admin password hash is not configured correctly.'},{status:500});
  }
  const actual = scryptSync(password, Buffer.from(salt,'hex'), expectedHex.length/2);
  const expected = Buffer.from(expectedHex,'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return NextResponse.json({error:'Invalid credentials.'},{status:401});
  await createSession();
  return NextResponse.json({ok:true});
}
