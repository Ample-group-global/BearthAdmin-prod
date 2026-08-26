import { NextRequest } from "next/server";
import { proxyToApi } from "../../../../../../../lib/api-proxy";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(req, `/api/nft-gen/layers/${id}/traits/apply-names`, {
    method: "POST",
    body: await req.json(),
  });
}
