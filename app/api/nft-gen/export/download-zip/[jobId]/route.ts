import { NextRequest, NextResponse } from "next/server";
import { Agent } from "undici";
import { getSessionToken } from "../../../../../../lib/api-proxy";

const API_BASE = process.env.BEARTH_API_URL!;

export const maxDuration = 300;

const noTimeoutDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const token = getSessionToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const upstreamUrl = new URL(`/api/nft-gen/export/download-zip/${jobId}`, API_BASE);
  req.nextUrl.searchParams.forEach((v, k) => upstreamUrl.searchParams.set(k, v));

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      // @ts-expect-error - Node's fetch accepts an undici dispatcher; not in the lib.dom fetch types
      dispatcher: noTimeoutDispatcher,
    });
  } catch {
    return NextResponse.json({ error: "API unreachable" }, { status: 503 });
  }

  if (!upstream.ok) {
    try {
      return NextResponse.json(await upstream.json(), { status: upstream.status });
    } catch {
      return NextResponse.json({ error: "Download failed" }, { status: upstream.status });
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("content-type") ?? "application/zip",
    "Content-Disposition":
      upstream.headers.get("content-disposition") ?? 'attachment; filename="bearth-nft-collection.zip"',
  };
  const estimatedBytes = upstream.headers.get("x-estimated-zip-bytes");
  if (estimatedBytes) headers["X-Estimated-Zip-Bytes"] = estimatedBytes;

  return new NextResponse(upstream.body, { status: 200, headers });
}
