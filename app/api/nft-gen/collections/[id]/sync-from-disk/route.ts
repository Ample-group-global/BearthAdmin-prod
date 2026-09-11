import { NextRequest, NextResponse } from "next/server";
import { getSessionToken } from "../../../../../../lib/api-proxy";

export const dynamic = "force-dynamic";

const API_BASE = process.env.BEARTH_API_URL!;

async function apiPost(token: string, path: string, body: unknown) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await r.json().catch(() => ({}));
    throw new Error(errBody.error ?? `${path} failed (HTTP ${r.status})`);
  }
  return await r.json();
}

async function apiGet(token: string, path: string) {
  const r = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}

function inferTier(stem: string): string | null {
  const s = stem.toLowerCase();
  if (s.includes("legendary")) return "legendary";
  if (s.includes("epic"))      return "epic";
  if (s.includes("rare"))      return "rare";
  if (s.includes("common"))    return "common";
  return null;
}

interface ManifestAsset { stem: string; name?: string; rel?: string | null; defaultWeight?: number; rarityTier?: string; }
interface ManifestLayer { folder: string; label?: string; count?: number; optional?: boolean; assets: ManifestAsset[]; }

async function syncOneLayer(token: string, collectionId: string, ml: ManifestLayer, layerIdx: number) {
  const realAssets = ml.assets.filter((a) => !!a.rel);
  if (!realAssets.length) return { layerName: ml.folder, layerId: null, traitsUpserted: 0, traitsDeleted: 0 };

  const layerData = await apiPost(token, `/api/nft-gen/collections/${collectionId}/layers`, {
    name:           ml.folder,
    displayName:    ml.label ?? ml.folder,
    layerRarityPct: ml.optional ? 80 : 100,
    sortOrder:      layerIdx,
  });
  const layerId: string | null = layerData?.layer?.id ?? layerData?.id ?? null;
  if (!layerId) return { layerName: ml.folder, layerId: null, traitsUpserted: 0, traitsDeleted: 0 };

  const activeFilePaths = realAssets.map((a) => a.rel as string);
  const bulkResp = await apiPost(token, `/api/nft-gen/layers/${layerId}/traits/bulk`, {
    traits: realAssets.map((asset) => ({
      name:            asset.name ?? asset.stem,
      filePath:        asset.rel,
      rarityTier:      asset.rarityTier ?? inferTier(asset.stem),
      storageProvider: "filebase",
      rarityWeight:    asset.defaultWeight ?? undefined,
    })),
  });
  const traitsUpserted = bulkResp?.count ?? 0;

  const reconcileTraits = await apiPost(token, `/api/nft-gen/layers/${layerId}/traits/reconcile`, { activeFilePaths });
  return { layerName: ml.folder, layerId, traitsUpserted, traitsDeleted: reconcileTraits?.deactivated ?? 0 };
}

async function syncLayerManifest(
  token: string,
  collectionId: string,
  manifest: ManifestLayer[]
) {
  const CONCURRENCY = 4;
  const results: Array<{ layerName: string; layerId: string | null; traitsUpserted: number; traitsDeleted: number }> = new Array(manifest.length);
  for (let i = 0; i < manifest.length; i += CONCURRENCY) {
    const batch = manifest.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((ml, j) => syncOneLayer(token, collectionId, ml, i + j)));
    batchResults.forEach((r, j) => { results[i + j] = r; });
  }

  const reconcileLayers = await apiPost(token, `/api/nft-gen/collections/${collectionId}/layers/reconcile`, {
    activeNames: manifest.map((l) => l.folder),
  });

  return {
    collectionId,
    layersSynced:  results.filter((r) => r.layerId).length,
    layersDeleted: reconcileLayers?.deactivated ?? 0,
    results,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: collectionId } = await params;
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: { layers?: ManifestLayer[] } = {};
    try { body = await req.json(); } catch { }

    if (!body.layers?.length) {
      return NextResponse.json({
        error: "No layer manifest provided — drag and drop your assets folder in the Settings tab before syncing.",
      }, { status: 422 });
    }

    const before = await apiGet(token, `/api/nft-gen/layers/collections/${collectionId}/prefixes`);
    const oldPrefixes: string[] = before?.prefixes ?? [];

    const data = await syncLayerManifest(token, collectionId, body.layers);

    const newPrefixes = new Set(
      body.layers.flatMap(l => l.assets.map(a => a.rel?.split("/")[0]).filter(Boolean)),
    );
    const superseded = oldPrefixes.filter(p => !newPrefixes.has(p));
    await Promise.all(superseded.map(prefix =>
      apiPost(token, `/api/nft-gen/layers/cleanup-orphaned-prefix`, { prefix }).catch(() => {}),
    ));

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-from-disk] unhandled:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
