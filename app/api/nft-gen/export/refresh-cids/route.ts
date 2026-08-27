import { NextRequest, NextResponse } from "next/server";
import { proxyToApi } from "../../../../../lib/api-proxy";

// This proxy route was missing entirely — every request to
// /api/nft-gen/export/refresh-cids fell through to the dynamic
// [exportId]/route.ts (which only defines GET), producing a 405 for the
// real POST call. The "Fix Pending CIDs" UI button has never actually
// worked through the deployed app because of this.
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
  }
  return proxyToApi(req, "/api/nft-gen/export/refresh-cids", { method: "POST", body });
}
