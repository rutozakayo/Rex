import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { authConfig } from './env';
const COOKIE = 'darknote_admin';
const secret = () => new TextEncoder().encode(authConfig().ADMIN_SESSION_SECRET);
export async function createSession() {
  const token = await new SignJWT({ role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('8h').sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'strict', path:'/', maxAge:8*60*60 });
}
export async function destroySession() {
  (await cookies()).set(COOKIE, '', { httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'strict', path:'/', maxAge:0 });
}
export async function isAuthenticated() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  try { const { payload } = await jwtVerify(token, secret()); return payload.role === 'admin'; }
  catch { return false; }
}
