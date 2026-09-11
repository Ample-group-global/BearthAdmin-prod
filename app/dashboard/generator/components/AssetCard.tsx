// @ts-nocheck
'use client';
import { calcRarity } from '../../../../lib/studio/probability';
import { resolveTier } from '../../../../lib/studio/tiers';
import { useLayerFiles } from '../LayerFilesContext';

export default function AssetCard({ asset, weight, totalWeight, supply, onDelete, onOpen }) {
  const { tier: liveTier, pct } = calcRarity(weight, totalWeight, supply);
  const tier = resolveTier(asset.rarityTier, liveTier);
  const { getBlobUrl } = useLayerFiles();

  function handleDelete(e) {
    e.stopPropagation();
    if (!confirm(`Delete "${asset.name}"? This cannot be undone.`)) return;
    onDelete?.(asset);
  }

  return (
    <div
      className={`asset-card${weight === 0 ? ' disabled' : ''}`}
      onClick={() => onOpen?.()}
      style={{ cursor: 'pointer' }}
    >
      <div className="thumb">
        {asset.rel ? (
          <img
            src={getBlobUrl(asset.rel) ?? `/api/layer-img/${asset.rel}?w=200&h=200`}
            alt={asset.stem}
            loading="lazy"
            onError={e => {
              const img = e.currentTarget as HTMLImageElement;
              const ph = document.createElement('span');
              ph.className = 'no-img';
              ph.textContent = '🖼';
              img.replaceWith(ph);
            }}
          />
        ) : (
          <span className="no-img" style={{ fontSize: 13, color: '#888' }}>NONE</span>
        )}
        <div className="tier-ribbon" style={{ background: tier.bg, color: tier.color }}>
          {tier.label}
        </div>
        {asset.rel && (
          <button className="card-delete-btn" onClick={handleDelete} title="Delete trait">🗑</button>
        )}
      </div>

      <div className="card-bottom">
        <span className="card-stem" title={asset.name}>{asset.name}</span>
        <span className="card-pct" style={{ color: tier.color }}>{pct}%</span>
      </div>
    </div>
  );
}
