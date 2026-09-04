import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Separate from /api/session/collection (which drives NFT Studio's generator
// flow) so that deep-linking into Waves for one collection never silently
// reassigns the collection someone is mid-generation on in the Studio tab.
const COLLECTION_COOKIE = 'nft_waves_collection_id';
const MAX_AGE = 5 * 60; // short-lived: one-shot deep-link handoff, not a durable preference

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge:   MAX_AGE,
  path:     '/',
};

export async function GET(req: NextRequest) {
  const collectionId = req.cookies.get(COLLECTION_COOKIE)?.value ?? null;
  return NextResponse.json({ collectionId });
}

export async function POST(req: NextRequest) {
  const { collectionId } = await req.json();
  const res = NextResponse.json({ ok: true });
  if (collectionId) res.cookies.set(COLLECTION_COOKIE, collectionId, COOKIE_OPTS);
  return res;
}

export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COLLECTION_COOKIE);
  return res;
}
