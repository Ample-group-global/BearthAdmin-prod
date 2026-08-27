import { NextRequest } from "next/server";
import { proxyToApi } from "../../../../../../lib/api-proxy";

export async function GET(req: NextRequest, { params }: { params: Promise<{ refreshId: string }> }) {
  const { refreshId } = await params;
  return proxyToApi(req, `/api/nft-gen/export/refresh-cids/${refreshId}`);
}
