import { NextRequest } from "next/server";
import { proxyToApi } from "../../../../../lib/api-proxy";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(req, `/api/customers/${id}/status`, {
    method: "PATCH",
    body: await req.json(),
  });
}
