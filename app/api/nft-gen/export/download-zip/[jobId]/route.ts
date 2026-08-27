import { NextRequest, NextResponse } from "next/server";
import { Agent } from "undici";
import { getSessionToken } from "../../../../../../lib/api-proxy";

const API_BASE = process.env.BEARTH_API_URL!;

// The blanket app/api/nft-gen/** maxDuration (60s, vercel.json) is fine for
// normal API calls but kills this route specifically — it's a long-lived
// stream, not a quick request/response, and a real 9999-item collection
// takes several minutes to stream through. Vercel was truncating the
// response mid-archive at the 60s mark, producing a ZIP with no End Of
// Central Directory record (confirmed: a real download landed at ~27MB,
// far short of the expected size, and every unzip tool rejected it).
// Reverted from 800 back to 300 — setting it to 800 here silently broke
// every Vercel deployment from that point on (confirmed via GitHub's
// commit-status API: every commit after that change shows "Deployment
// has failed", while BearthApi-V1's own vercel.json also setting 800
// deploys fine — this project's plan/config apparently doesn't accept
// 800 via a Next.js route's own `maxDuration` export the same way).
// 300 is the universally-safe ceiling on every Vercel plan tier. This
// route is also no longer the primary download path — the direct-to-
// folder downloader (ExportPanel.tsx) bypasses it entirely for exported
// collections; this only still matters for the pre-export fallback.
export const maxDuration = 300;

// Node's fetch() (undici under the hood) applies a default headersTimeout/
// bodyTimeout to every request unless told otherwise. BearthApi-V1 already
// disables its own socket idle timeout for this route (req.socket.setTimeout(0)
// in export.ts) so it can stream a large archive for minutes — but that only
// covers the Express side. This hop is a second, independent client with its
// own default timeout, so a large ZIP was getting cut off here regardless of
// the backend being fine. One shared no-timeout agent for this route only —
// never applied globally, since every other proxy route should keep normal
// timeout protection.
const noTimeoutDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

// Streams a ZIP64 archive from BearthApi directly to the browser.
// Cannot use proxyToApi() here — that buffers response.json() which would
// OOM on a 15–20 GB ZIP. This route pipes the ReadableStream through.
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
