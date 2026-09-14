import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WAVE_COOKIE   = 'nft_list_wave';
const STATUS_COOKIE = 'nft_list_status';
const MAX_AGE = 5 * 60;

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge:   MAX_AGE,
  path:     '/',
};

export async function GET(req: NextRequest) {
  const wave   = req.cookies.get(WAVE_COOKIE)?.value   ?? null;
  const status = req.cookies.get(STATUS_COOKIE)?.value ?? null;
  return NextResponse.json({ wave, status });
}

export async function POST(req: NextRequest) {
  const { wave, status } = await req.json();
  const res = NextResponse.json({ ok: true });
  if (wave)   res.cookies.set(WAVE_COOKIE,   String(wave), COOKIE_OPTS);
  else        res.cookies.delete(WAVE_COOKIE);
  if (status) res.cookies.set(STATUS_COOKIE, String(status), COOKIE_OPTS);
  else        res.cookies.delete(STATUS_COOKIE);
  return res;
}

export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(WAVE_COOKIE);
  res.cookies.delete(STATUS_COOKIE);
  return res;
}
