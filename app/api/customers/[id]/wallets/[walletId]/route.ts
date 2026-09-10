import { NextRequest } from "next/server";
import { proxyToApi } from "../../../../../../lib/api-proxy";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; walletId: string }> }) {
  const { id, walletId } = await params;
  return proxyToApi(req, `/api/customers/${id}/wallets/${walletId}`, { method: "DELETE" });
}
