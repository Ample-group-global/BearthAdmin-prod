// @ts-nocheck
'use client';
// Read-only "what's actually in Filebase" checker, opened by clicking a
// collection's Supply number on the sync-status page. Deliberately separate
// from the NFT List page (app/nft/nftlist) -- that page reads nft_records
// (the DB), this reads the bucket directly, for verifying a fresh
// generation run before anything gets synced to the DB at all. Infinite
// scroll (no page-number pagination), full supply reachable by scrolling.
import { useState, useEffect, useCallback, useRef } from 'react';

interface Props {
  collectionName: string;
  supply: number;
  onClose: () => void;
}

interface ImgEntry { n: number; key: string; }
interface ItemMeta {
  n: number;
  imageUrl?: string;
  metaUrl?: string;
  name?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
  metaLoading?: boolean;
  metaError?: boolean;
}

const BATCH = 48;
const URL_BATCH = 100; // keys per presigned-urls call while scrolling

export default function SupplyBrowseModal({ collectionName, supply, onClose }: Props) {
  const [bucketList, setBucketList] = useState<string[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(true);
  const [bucket, setBucket] = useState('');
  const [images, setImages] = useState<ImgEntry[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState<Record<number, ItemMeta>>({});
  const [visibleCount, setVisibleCount] = useState(BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/filebase/buckets')
      .then(r => (r.ok ? r.json() : { buckets: [] }))
      .then(d => setBucketList((d.buckets ?? []).map((b: any) => b.name).filter(Boolean)))
      .catch(() => {})
      .finally(() => setBucketsLoading(false));
  }, []);

  const loadImageList = useCallback(async (b: string) => {
    setLoadError('');
    setListLoading(true);
    setImages(null);
    setItems({});
    setVisibleCount(BATCH);
    try {
      const r = await fetch(`/api/filebase/objects?bucket=${encodeURIComponent(b)}&prefix=images/`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const entries: ImgEntry[] = (data.objects ?? [])
        .map((o: any) => {
          const m = /^images\/(\d+)\.\w+$/.exec(o.key ?? '');
          return m ? { n: parseInt(m[1], 10), key: o.key as string } : null;
        })
        .filter((e: ImgEntry | null): e is ImgEntry => e !== null)
        .sort((a: ImgEntry, b2: ImgEntry) => a.n - b2.n);
      setImages(entries);
    } catch (e: any) {
      setLoadError(e.message ?? 'Failed to list bucket contents');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { if (bucket) loadImageList(bucket); }, [bucket, loadImageList]);

  // Resolve presigned URLs + metadata for whatever numbers just became visible.
  useEffect(() => {
    if (!images || !bucket) return;
    const slice = images.slice(0, visibleCount).filter(e => !items[e.n]);
    if (!slice.length) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < slice.length; i += URL_BATCH) {
        if (cancelled) return;
        const chunk = slice.slice(i, i + URL_BATCH);
        const keys = chunk.flatMap(e => [e.key, `metadata/${e.n}.json`]);
        try {
          const r = await fetch('/api/filebase/presigned-urls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucket, keys }),
          });
          const { urls } = await r.json();
          if (cancelled) return;
          setItems(prev => {
            const next = { ...prev };
            for (const e of chunk) {
              next[e.n] = { n: e.n, imageUrl: urls[e.key], metaUrl: urls[`metadata/${e.n}.json`], metaLoading: true };
            }
            return next;
          });
          for (const e of chunk) {
            const metaUrl = urls[`metadata/${e.n}.json`];
            if (!metaUrl) continue;
            fetch(metaUrl)
              .then(mr => (mr.ok ? mr.json() : null))
              .then(json => {
                if (cancelled) return;
                setItems(prev => ({
                  ...prev,
                  [e.n]: { ...prev[e.n], name: json?.name, attributes: json?.attributes, metaLoading: false, metaError: !json },
                }));
              })
              .catch(() => {
                if (cancelled) return;
                setItems(prev => ({ ...prev, [e.n]: { ...prev[e.n], metaLoading: false, metaError: true } }));
              });
          }
        } catch {
          if (cancelled) return;
          setItems(prev => {
            const next = { ...prev };
            for (const e of chunk) next[e.n] = { n: e.n, metaError: true, metaLoading: false };
            return next;
          });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, visibleCount, bucket]);

  // Infinite scroll — grow visibleCount as the sentinel comes into view.
  useEffect(() => {
    if (!sentinelRef.current || !images) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setVisibleCount(v => (v >= images.length ? v : Math.min(v + BATCH, images.length)));
        }
      },
      { rootMargin: '600px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [images]);

  const total = images?.length ?? 0;

  return (
    <div style={ov.backdrop} onClick={onClose}>
      <div style={ov.panel} onClick={e => e.stopPropagation()}>
        <div style={ov.header}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{collectionName} — All NFTs</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Read-only check of what's actually in Filebase right now — separate from NFT Lists (which reads the database).
              {images && ` Showing ${Math.min(visibleCount, total).toLocaleString()} of ${total.toLocaleString()} found (supply: ${supply.toLocaleString()}).`}
            </div>
          </div>
          <button onClick={onClose} style={ov.closeBtn} aria-label="Close">✕</button>
        </div>

        <div style={ov.bucketRow}>
          <label style={ov.bucketLabel}>Filebase Bucket</label>
          {bucketsLoading ? (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading buckets…</span>
          ) : (
            <select value={bucket} onChange={e => setBucket(e.target.value)} style={ov.select}>
              <option value="">— select bucket —</option>
              {bucketList.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </div>

        <div style={ov.body}>
          {!bucket && <div style={ov.dim}>Pick a bucket above to browse its NFTs.</div>}
          {bucket && listLoading && <div style={ov.dim}>Listing bucket contents…</div>}
          {loadError && <div style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>{loadError}</div>}
          {images && images.length === 0 && !listLoading && <div style={ov.dim}>No images found under images/ in this bucket.</div>}

          {images && images.length > 0 && (
            <>
              <div style={ov.grid}>
                {images.slice(0, visibleCount).map(({ n }) => {
                  const it = items[n];
                  return (
                    <div key={n} style={ov.card}>
                      <div style={ov.thumbWrap}>
                        {it?.imageUrl ? (
                          <img src={it.imageUrl} alt={`#${n}`} style={ov.thumb} loading="lazy" />
                        ) : (
                          <div style={ov.thumbSkeleton} />
                        )}
                      </div>
                      <div style={ov.cardBody}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>#{n}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', minHeight: 16 }}>
                          {it?.metaLoading ? 'Loading metadata…' : it?.metaError ? 'Metadata not found' : (it?.name ?? '—')}
                        </div>
                        {it?.attributes && it.attributes.length > 0 && (
                          <div style={ov.attrWrap}>
                            {it.attributes.slice(0, 3).map((a, i) => (
                              <span key={i} style={ov.attrChip}>{a.trait_type}: {String(a.value)}</span>
                            ))}
                            {it.attributes.length > 3 && <span style={ov.attrChip}>+{it.attributes.length - 3}</span>}
                          </div>
                        )}
                        <div style={ov.linkRow}>
                          {it?.imageUrl && <a href={it.imageUrl} target="_blank" rel="noreferrer" style={ov.link}>Image</a>}
                          {it?.metaUrl && <a href={it.metaUrl} target="_blank" rel="noreferrer" style={ov.link}>Metadata</a>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {visibleCount < total ? (
                <div ref={sentinelRef} style={ov.sentinel}>Loading more…</div>
              ) : (
                <div style={ov.sentinel}>— end of {total.toLocaleString()} NFTs —</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const ov: Record<string, any> = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  panel: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 1120, height: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 22px', borderBottom: '1px solid var(--border)', gap: 16 },
  closeBtn: { background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1, padding: 4 },
  bucketRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 22px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' },
  bucketLabel: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' },
  select: { padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 13, minWidth: 220 },
  body: { flex: 1, overflowY: 'auto', padding: '18px 22px' },
  dim: { color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '40px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 },
  card: { border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--hover)' },
  thumbWrap: { aspectRatio: '1 / 1', background: 'var(--border)' },
  thumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  thumbSkeleton: { width: '100%', height: '100%', background: 'var(--border)' },
  cardBody: { padding: 10 },
  attrWrap: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  attrChip: { fontSize: 10, padding: '2px 6px', borderRadius: 5, background: 'rgba(96,165,250,0.14)', color: '#60a5fa', fontWeight: 600 },
  linkRow: { display: 'flex', gap: 10, marginTop: 8 },
  link: { fontSize: 11, color: '#60a5fa', textDecoration: 'none', fontWeight: 600 },
  sentinel: { textAlign: 'center', padding: '20px 0', fontSize: 13, color: 'var(--text-muted)' },
};
