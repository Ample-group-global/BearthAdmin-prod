import { NextRequest, NextResponse } from 'next/server';
import { getSessionToken } from '../../../../lib/api-proxy';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.BEARTH_API_URL!;

// Cleans up a layer's stale leftovers once all of its chunked uploads have
// landed — see BearthApi's /api/nft-gen/layers/upload/finalize for why this
// is a separate call from the upload itself.
export async function POST(request: NextRequest) {
  const token = getSessionToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const resp = await fetch(`${API_BASE}/api/nft-gen/layers/upload/finalize`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: 'API unreachable' }, { status: 503 });
  }
}
