// @ts-nocheck
'use client';
import { useMemo } from 'react';
import { TIERS as CANONICAL_TIERS, getTier } from '../../../../lib/studio/tiers';

// ── Tier helpers ──────────────────────────────────────────────────────────────
// Thresholds/colors come from lib/studio/tiers.ts (the same source
// RarityModal.tsx uses) so a future threshold change can't drift out of
// sync here — this file previously reimplemented its own 1/5/15% cutoffs,
// which is exactly the duplication that caused a real mismatch bug before
// (see RarityModal.tsx's own comment on this).
function rarityTier(pct: number) {
  const t = getTier(pct / 100);
  return { label: t.label, color: t.color };
}

// Display-only metadata (icon/description/range copy) layered onto the
// canonical thresholds — never a second copy of the threshold values
// themselves.
const TIER_DISPLAY: Record<string, { icon: string; preRange: string; postRange: string; desc: string }> = {
  Legendary: { icon: '👑', preRange: '≤ 1%',  postRange: 'Top 1%',  desc: 'Ultra-rare. Highest collector value.' },
  Epic:      { icon: '🔮', preRange: '≤ 5%',  postRange: 'Top 5%',  desc: 'Very rare. Strong collector demand.' },
  Rare:      { icon: '🔷', preRange: '≤ 15%', postRange: 'Top 15%', desc: 'Clearly limited. Noticeably scarce.' },
  Common:    { icon: '🩶', preRange: '> 15%', postRange: 'Rest',     desc: 'Most frequent. Baseline traits.' },
};
const TIERS = CANONICAL_TIERS.map(t => ({ label: t.label, color: t.color, ...TIER_DISPLAY[t.label] }));

// ── Tier overview cards ───────────────────────────────────────────────────────
function TierOverview() {
  return (
    <div className="rt-section">
      <div className="rt-section-header">
        <span className="rt-section-icon">✨</span>
        <span className="rt-section-title">Rarity Tiers</span>
      </div>
      <div className="rt-tiers-grid">
        {TIERS.map(t => (
          <div key={t.label} className="rt-tier-card" style={{
            borderColor: t.color,
            background: `linear-gradient(145deg, ${t.color}22 0%, ${t.color}0a 100%)`,
            ['--tc' as string]: t.color,
          }}>
            <div className="rt-tier-icon">{t.icon}</div>
            <div className="rt-tier-label" style={{ color: t.color }}>{t.label}</div>
            <div className="rt-tier-ranges" style={{ borderColor: t.color + '55', background: 'rgba(255,255,255,0.55)' }}>
              <div className="rt-tier-range-row">
                <span className="rt-tier-range-tag">Pre-gen</span>
                <span className="rt-tier-range-val" style={{ color: t.color }}>{t.preRange}</span>
              </div>
              <div className="rt-tier-range-row">
                <span className="rt-tier-range-tag">Post-gen</span>
                <span className="rt-tier-range-val" style={{ color: t.color }}>{t.postRange}</span>
              </div>
            </div>
            <div className="rt-tier-desc">{t.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Formula section ───────────────────────────────────────────────────────────
function FormulaSection({ supply }) {
  const ex = Math.min(supply, 100);
  const EX = [
    { name: 'Trait A', w: 5  },
    { name: 'Trait B', w: 10 },
    { name: 'Trait C', w: 3  },
    { name: 'Trait D', w: 2  },
  ];
  const totalW = EX.reduce((s, t) => s + t.w, 0);

  return (
    <div className="rt-section">
      <div className="rt-section-header">
        <span className="rt-section-icon">📐</span>
        <span className="rt-section-title">How Rarity Is Calculated</span>
      </div>
      <div className="rt-formula-grid">

        {/* Pre-gen */}
        <div className="rt-formula-card">
          <div className="rt-formula-phase-badge" style={{ background:'#34D39920', color:'#059669', border:'1px solid #34D39950' }}>
            Pre-Generation
          </div>
          <div className="rt-formula-name">Weight-Based Probability</div>
          <div className="rt-formula-eq">
            <span className="rt-eq-result">Probability</span> = trait_weight ÷ layer_total_weight × 100%
          </div>
          <div className="rt-formula-note">
            Lower weight = rarer trait. Weight 0 disables completely. Set in Organize tab.
          </div>
          <div className="rt-formula-example">
            <div className="rt-ex-header">Example — {EX.length} traits, total weight {totalW}</div>
            {EX.map(t => {
              const pct  = (t.w / totalW) * 100;
              const tier = rarityTier(pct);
              return (
                <div key={t.name} className="rt-ex-row">
                  <span className="rt-ex-name">{t.name} (w={t.w})</span>
                  <span className="rt-ex-calc">{t.w}÷{totalW}</span>
                  <span className="rt-ex-pct" style={{ color: tier.color }}>{pct.toFixed(0)}%</span>
                  <span className="rt-ex-tier" style={{ color: tier.color, background: tier.color + '20', border:`1px solid ${tier.color}44` }}>{tier.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Post-gen */}
        <div className="rt-formula-card">
          <div className="rt-formula-phase-badge" style={{ background:'#6366F120', color:'#4f46e5', border:'1px solid #6366F150' }}>
            Post-Generation
          </div>
          <div className="rt-formula-name">Rarity Score (Industry Standard)</div>
          <div className="rt-formula-eq">
            <span className="rt-eq-result">NFT Score</span> = Σ ( supply ÷ trait_occurrence ) per trait
          </div>
          <div className="rt-formula-note">
            After generation, each NFT is scored across all traits. Rarer traits = higher score. Tied scores share the same rank.
          </div>
          <div className="rt-formula-example">
            <div className="rt-ex-header">Example — supply {ex}</div>
            {[
              { name: 'Red Hoodie', count: 10 },
              { name: 'Gold Hat',   count: 50 },
              { name: 'Blue Eyes',  count: 25 },
            ].map(t => (
              <div key={t.name} className="rt-ex-row">
                <span className="rt-ex-name">{t.name} ({t.count} NFTs)</span>
                <span className="rt-ex-calc">{ex}÷{t.count}</span>
                <span className="rt-ex-pct" style={{ color:'var(--accent2)' }}>{(ex/t.count).toFixed(1)}</span>
                <span className="rt-ex-tier" style={{ color:'var(--dim)', background:'var(--bg2)', border:'1px solid var(--border)' }}>pts</span>
              </div>
            ))}
            <div className="rt-ex-row rt-ex-total">
              <span className="rt-ex-name" style={{ fontWeight:700, color:'var(--text)' }}>Total Score</span>
              <span />
              <span className="rt-ex-pct" style={{ color:'#F59E0B', fontSize:14 }}>{(ex/10 + ex/50 + ex/25).toFixed(1)}</span>
              <span className="rt-ex-tier" style={{ color:'#F59E0B', background:'#F59E0B20', border:'1px solid #F59E0B44' }}>Rare</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RarityTab({ layers, weights, collection }) {
  const supply = collection?.supply ?? 100;

  const analysis = useMemo(() => layers.map(layer => {
    const ws     = weights[layer.folder] ?? {};
    const totalW = layer.assets.reduce((s, a) => s + (ws[a.stem] ?? a.defaultWeight ?? 1), 0);
    const traits = layer.assets.map(a => {
      const w   = ws[a.stem] ?? a.defaultWeight ?? 1;
      const pct = totalW > 0 ? (w / totalW) * 100 : 0;
      const tier = a.rel === null ? { label: 'None', color: '#9ca3af' } : rarityTier(pct);
      return { stem: a.stem, name: a.name, weight: w, pct, tier, isNone: a.rel === null };
    });
    return { layer, traits, totalW };
  }), [layers, weights, supply]);

  return (
    <div className="rt-page">

      {/* ── Tier overview ── */}
      <TierOverview />

      {/* ── Formulas ── */}
      <FormulaSection supply={supply} />

    </div>
  );
}
