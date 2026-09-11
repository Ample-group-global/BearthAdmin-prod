import { NextRequest } from "next/server";
import { proxyToApi }  from "../../../../../../lib/api-proxy";

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return proxyToApi(req, `/api/nft-gen/export/presigned-zip/${jobId}`, {
    searchParams: req.nextUrl.searchParams,
  });
}
