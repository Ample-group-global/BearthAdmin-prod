// @ts-nocheck
'use client';
import { useState, useMemo } from 'react';
import { TIERS, getTier, resolveTier } from '../../../../lib/studio/tiers';
import AssetCard              from './AssetCard';

export default function AssetGrid({ layer, layerWeights, supply, onWeightChange, onLayersChange, onOpenLayerModal }) {
  const [filterTier, setFilterTier] = useState('all');

  const ws: Record<string,number> = layerWeights ?? {};
  const totalW  = useMemo(() => Object.values(ws).reduce((a, b) => a + b, 0), [ws]);

  const sortedAssets = useMemo(() =>
    [...layer.assets].sort((a, b) =>
      a.stem.localeCompare(b.stem, undefined, { numeric: true, sensitivity: 'base' })
    ), [layer.assets]);

  // Same preference as the individual cards (AssetCard.tsx): the artist's
  // own explicit classification over a live weight computation. These
  // counts/filters used to always use the live tier only, so a trait could
  // show e.g. "Epic" on its own card but never appear when filtering by
  // Epic if its live-computed tier actually landed in a different band.
  function tierFor(a) {
    const prob = totalW > 0 ? (ws[a.stem] ?? 0) / totalW : 0;
    return resolveTier(a.rarityTier, getTier(prob));
  }

  const tierCounts = useMemo(() => {
    const counts = {};
    TIERS.forEach(t => { counts[t.label] = 0; });
    sortedAssets.forEach(a => { counts[tierFor(a).label]++; });
    return counts;
  }, [sortedAssets, ws, totalW]);

  const visible = filterTier === 'all'
    ? sortedAssets
    : sortedAssets.filter(a => tierFor(a).label.toLowerCase() === filterTier);

  async function handleDelete(asset) {
    if (!asset.id) return;
    await fetch(`/api/nft-gen/traits/${asset.id}`, { method: 'DELETE' });
    onLayersChange?.();
  }

  return (
    <main className="content">
      <div className="ch">
        <div className="ct">{layer.label}</div>
        <div className="cs">{layer.count} traits &nbsp;·&nbsp; <b>Total weight: {totalW.toFixed(1)}</b></div>
      </div>

      <div className="toolbar">
        <button
          className={`filter-btn${filterTier === 'all' ? ' active' : ''}`}
          onClick={() => setFilterTier('all')}
        >
          All ({layer.count})
        </button>
        {TIERS.filter(t => tierCounts[t.label] > 0).map(t => (
          <button
            key={t.label}
            className={`filter-btn${filterTier === t.label.toLowerCase() ? ' active' : ''}`}
            onClick={() => setFilterTier(t.label.toLowerCase())}
            style={filterTier === t.label.toLowerCase()
              ? { borderColor: t.color, color: t.color, background: t.bg }
              : {}}
          >
            {t.label} ({tierCounts[t.label]})
          </button>
        ))}
        <button className="filter-btn" style={{ marginLeft: 'auto' }} onClick={() => onOpenLayerModal?.(layer.folder)}>
          ⚙ Layer Rarity
        </button>
      </div>

      <div className="asset-grid">
        {visible.map(asset => (
          <AssetCard
            key={asset.stem}
            asset={asset}
            weight={ws[asset.stem] ?? asset.defaultWeight ?? 1}
            totalWeight={totalW}
            supply={supply}
            onDelete={handleDelete}
            onOpen={() => onOpenLayerModal?.(layer.folder, asset.stem)}
          />
        ))}
      </div>

      {visible.length === 0 && <div className="empty">No traits match this filter.</div>}
    </main>
  );
}
