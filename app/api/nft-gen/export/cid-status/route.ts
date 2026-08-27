import { NextRequest } from "next/server";
import { proxyToApi } from "../../../../../lib/api-proxy";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  const sp = new URLSearchParams();
  if (jobId) sp.set("jobId", jobId);
  return proxyToApi(req, "/api/nft-gen/export/cid-status", { searchParams: sp });
}
