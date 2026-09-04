"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface MenuItem {
  label: string;
  href: string;
  icon: string | null;
  module: string | null;
  moduleLabel: string | null;
  sortOrder: number;
}

interface ActiveWave { waveNumber: number; name: string; }
interface CollectionStat {
  id: string;
  name: string;
  symbol: string | null;
  supply: number;
  createdAt: string;
  mintedCount: number;
  totalSold: number;
  ethRaised: number;
  activeWave: ActiveWave | null;
}
interface DashboardStats {
  totals: { collections: number; supply: number; minted: number; sold: number; ethRaised: number; activeWaves: number };
  collections: CollectionStat[];
}

const CARD_COLORS = [
  { bg: "rgba(65,175,235,0.1)", stroke: "#41afeb" },
  { bg: "rgba(124,58,237,0.08)", stroke: "#7c3aed" },
  { bg: "rgba(22,163,74,0.08)", stroke: "#16a34a" },
  { bg: "rgba(234,88,12,0.08)", stroke: "#ea580c" },
  { bg: "rgba(220,38,38,0.08)", stroke: "#dc2626" },
  { bg: "rgba(16,185,129,0.08)", stroke: "#10b981" },
];

const ICON_PATHS: Record<string, string> = {
  image: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  shield: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  key: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z",
  menu: "M4 6h16M4 12h16M4 18h7",
  "user-check": "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  users: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  grid: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  cpu: "M9 3H7a2 2 0 00-2 2v2M9 3h6M9 3V1m6 2h2a2 2 0 012 2v2m0 0V3m0 4v10m0 0v2a2 2 0 01-2 2h-2m0 0H9m6 0v2M9 21H7a2 2 0 01-2-2v-2m0 0V9M5 9H3m2 0v6m16-6h2m-2 0v6m-6-6v6",
  "bar-chart": "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  default: "M13 10V3L4 14h7v7l9-11h-7z",
};

function StatTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e5e7eb" }}>
      <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "#9bafc5" }}>{label}</div>
      <div className="text-xl font-extrabold mt-1" style={{ color: accent }}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [cards, setCards] = useState<MenuItem[] | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : { menus: [] })
      .then(data => {
        const menus: MenuItem[] = (data.menus ?? [])
          .filter((m: MenuItem) => m.href !== "/dashboard") // exclude the dashboard menu itself
          .sort((a: MenuItem, b: MenuItem) => a.sortOrder - b.sortOrder);
        setCards(menus);
      })
      .catch(() => setCards([]));

    fetch("/api/nft-gen/collections/dashboard-stats", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setStats(d))
      .catch(() => setStatsError(true));
  }, []);

  const fmtEth = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`;

  return (
    <div className="ba-page space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "#24315f" }}>Dashboard</h1>
        <p className="text-sm mt-0.5" style={{ color: "#9bafc5" }}>Bearth Admin — NFT Studio</p>
      </div>

      {/* ── Overview stats — selling/wave activity across every collection ── */}
      {stats && stats.totals.collections > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile label="Collections"   value={String(stats.totals.collections)} accent="#24315f" />
          <StatTile label="Total Supply"  value={stats.totals.supply.toLocaleString()} accent="#7c3aed" />
          <StatTile label="Minted"        value={stats.totals.minted.toLocaleString()} accent="#41afeb" />
          <StatTile label="Sold"          value={stats.totals.sold.toLocaleString()} accent="#16a34a" />
          <StatTile label="ETH Raised"    value={fmtEth(stats.totals.ethRaised)} accent="#ea580c" />
          <StatTile label="Active Waves"  value={String(stats.totals.activeWaves)} accent="#dc2626" />
        </div>
      )}

      {/* ── Per-collection breakdown ────────────────────────────────────── */}
      {statsError ? (
        <p className="text-sm" style={{ color: "#9bafc5" }}>Couldn&apos;t load collection statistics — try refreshing.</p>
      ) : stats === null ? (
        <p className="text-sm" style={{ color: "#9bafc5" }}>Loading collection statistics…</p>
      ) : stats.collections.length === 0 ? (
        <div className="bg-white rounded-xl p-6 text-center" style={{ border: "1px solid #e5e7eb" }}>
          <p className="text-sm font-semibold" style={{ color: "#24315f" }}>No collections yet</p>
          <p className="text-sm mt-1" style={{ color: "#9bafc5" }}>
            Create one in <Link href="/dashboard/generator" style={{ color: "#41afeb" }}>NFT Studio</Link> to see selling and wave activity here.
          </p>
        </div>
      ) : (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: "#9bafc5" }}>Collections</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {stats.collections.map(c => (
              <div key={c.id} className="bg-white rounded-xl p-5" style={{ border: "1px solid #e5e7eb" }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold" style={{ color: "#24315f" }}>{c.name}</div>
                    {c.symbol && <div className="text-xs" style={{ color: "#9bafc5" }}>{c.symbol}</div>}
                  </div>
                  {c.activeWave ? (
                    <span className="text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                      style={{ background: "rgba(22,163,74,0.1)", color: "#16a34a" }}>
                      ● Wave {c.activeWave.waveNumber} live
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                      style={{ background: "#f1f5f9", color: "#94a3b8" }}>
                      No active wave
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#9bafc5" }}>Minted</div>
                    <div className="text-sm font-bold" style={{ color: "#24315f" }}>{c.mintedCount.toLocaleString()} / {c.supply.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#9bafc5" }}>Sold</div>
                    <div className="text-sm font-bold" style={{ color: "#24315f" }}>{c.totalSold.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#9bafc5" }}>Raised</div>
                    <div className="text-sm font-bold" style={{ color: "#24315f" }}>{fmtEth(c.ethRaised)}</div>
                  </div>
                </div>

                <div className="flex gap-4 mt-4 pt-3" style={{ borderTop: "1px solid #f1f5f9" }}>
                  <Link href={`/nft/waves?collectionId=${c.id}`} className="text-xs font-semibold" style={{ color: "#41afeb" }}>Manage Waves →</Link>
                  <Link href="/nft/nftlist" className="text-xs font-semibold" style={{ color: "#41afeb" }}>View NFTs →</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick links — unchanged navigation shortcuts ────────────────── */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: "#9bafc5" }}>Quick Links</h2>
        {cards === null ? (
          <p className="text-sm" style={{ color: "#9bafc5" }}>Loading…</p>
        ) : cards.length === 0 ? (
          <p className="text-sm" style={{ color: "#9bafc5" }}>No shortcuts available for your role.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((item, i) => {
              const { bg, stroke } = CARD_COLORS[i % CARD_COLORS.length];
              const iconPath = ICON_PATHS[item.icon ?? ""] ?? ICON_PATHS.default;
              return (
                <Link key={item.href} href={item.href}
                  className="block bg-white rounded-xl shadow-sm p-6 transition-shadow hover:shadow-md"
                  style={{ border: "1px solid #e5e7eb" }}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: bg }}>
                      <svg className="w-5 h-5" fill="none" stroke={stroke} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
                      </svg>
                    </div>
                    <span className="font-semibold" style={{ color: "#24315f" }}>{item.label}</span>
                  </div>
                  {item.moduleLabel && (
                    <p className="text-sm" style={{ color: "#9bafc5" }}>{item.moduleLabel}</p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
