import { NextRequest } from "next/server";
import { proxyToApi }  from "../../../../../../lib/api-proxy";

// This route was missing entirely — downloadOfflineZip() in ExportPanel.tsx
// has always called it, got a 404, and silently fallen through to the slow
// streaming download-zip path every time, even when a pre-built ZIP already
// existed. Confirmed live 2026-08-25.
export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return proxyToApi(req, `/api/nft-gen/export/presigned-zip/${jobId}`, {
    searchParams: req.nextUrl.searchParams,
  });
}
