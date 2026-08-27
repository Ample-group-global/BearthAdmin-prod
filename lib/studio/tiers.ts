export const TIERS = [
  { max: 0.01, label: 'Legendary', color: '#F59E0B', bg: 'rgba(245,158,11,.15)' },
  { max: 0.05, label: 'Epic',      color: '#A855F7', bg: 'rgba(168,85,247,.15)' },
  { max: 0.15, label: 'Rare',      color: '#3B82F6', bg: 'rgba(59,130,246,.15)'  },
  { max: 1.00, label: 'Common',    color: '#6B7280', bg: 'rgba(107,114,128,.15)' },
];

// Preset weights for quick tier assignment (used in RarityModal quick-assign)
export const TIER_PRESET_WEIGHTS: Record<string, number> = {
  Legendary: 1,
  Epic:      3,
  Rare:      10,
  Common:    30,
};

export const DISABLED_TIER = { max: 0, label: 'Disabled', color: '#9CA3AF', bg: 'rgba(156,163,175,.15)' };

export function getTier(prob: any) {
  if (prob <= 0) return DISABLED_TIER;
  return TIERS.find(t => prob <= t.max) ?? TIERS[TIERS.length - 1];
}

// A trait's badge prefers, in order: the artist's own explicit classification
// (manually picked, or Excel-supplied via asset.rarityTier) over a fresh
// weight computation that can land in a different band. Single source of
// truth for this preference -- RarityModal.tsx used to define its own local
// copy while AssetCard.tsx/AssetGrid.tsx never applied the preference at all
// and always showed the live-computed tier regardless of what the artist
// actually set, which meant the SAME trait could show two different tiers
// depending on which screen you were looking at.
export function resolveTier(explicitTierLabel: string | null | undefined, liveTier: any) {
  if (!explicitTierLabel) return liveTier;
  const match = TIERS.find(t => t.label.toLowerCase() === explicitTierLabel.toLowerCase());
  return match ?? liveTier;
}
