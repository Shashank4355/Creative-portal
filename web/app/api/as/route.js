import { NextResponse } from 'next/server';
export async function GET(req) {
  const u = new URL(req.url);
  const res = NextResponse.redirect(new URL(u.searchParams.get('back') || '/', u.origin));
  res.cookies.set('as', u.searchParams.get('uid') || 'u-mgr-ana', { httpOnly: true, sameSite: 'lax', path: '/' });
  return res;
}
