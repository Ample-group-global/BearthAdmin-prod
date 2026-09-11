import { NextRequest } from "next/server";
import { proxyToApi } from "../../../../../lib/api-proxy";

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  return proxyToApi(req, "/api/filebase/objects/batch", { method: "DELETE", body });
}
