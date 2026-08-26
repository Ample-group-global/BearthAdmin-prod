import sharp from 'sharp';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.BEARTH_API_URL ?? 'http://localhost:4000';

async function toThumbnail(input: string | Buffer, w: number, h: number): Promise<Buffer> {
  const src = sharp(input, { failOn: 'none' });
  const meta = await src.metadata();
  const origW = meta.width ?? 0, origH = meta.height ?? 0;

  // trim() removes uniform "background" margins around real artwork, but a
  // trait that's itself a flat solid-color fill (e.g. a plain background
  // swatch with no edges anywhere) has nothing for it to distinguish from
  // padding — it collapses the whole image down to a sliver, which then
  // renders as an almost-empty thumbnail. Traits are user-supplied art of any
  // kind, so trimming can never assume every image has real transparent
  // margins to remove; only keep the trim if it left a substantial image.
  let pipeline = sharp(input, { failOn: 'none' }).trim({ threshold: 10 });
  const trimmedMeta = await pipeline.clone().metadata();
  const trimW = trimmedMeta.width ?? 0, trimH = trimmedMeta.height ?? 0;
  const keptEnough = origW > 0 && origH > 0 && (trimW * trimH) >= (origW * origH) * 0.05;
  if (!keptEnough) pipeline = sharp(input, { failOn: 'none' });

  return pipeline
    .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

export async function GET(req: Request, { params }: { params: Promise<{ rel: string[] }> }) {
  const rel = (await params).rel.join('/');

  const url = new URL(req.url);
  const w   = parseInt(url.searchParams.get('w') ?? '512') || 512;
  const h   = parseInt(url.searchParams.get('h') ?? '512') || 512;

  try {
    const upstream = await fetch(`${API_BASE}/api/nft-gen/layers/image?rel=${encodeURIComponent(rel)}`);
    if (!upstream.ok) return new Response(null, { status: 404 });
    const raw = Buffer.from(await upstream.arrayBuffer());
    const buf = await toThumbnail(raw, w, h).catch(() => raw);
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
