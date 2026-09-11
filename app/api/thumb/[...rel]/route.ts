import { NextRequest } from 'next/server';
import { getSessionToken } from '../../../../lib/api-proxy';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.BEARTH_API_URL ?? 'http://localhost:4000';

export async function GET(req: NextRequest, { params }: { params: Promise<{ rel: string[] }> }) {
  const token = getSessionToken(req);
  if (!token) return new Response(null, { status: 401 });

  const rel = (await params).rel.join('/');

  try {
    const upstream = await fetch(
      `${API_BASE}/api/nft-gen/layers/image?rel=${encodeURIComponent(rel)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!upstream.ok) return new Response(null, { status: 404 });

    const buf = Buffer.from(await upstream.arrayBuffer());
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type':  'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
