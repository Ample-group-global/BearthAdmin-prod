"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Other pages resolve "which collection" from a session cookie rather than
// a URL param -- keeps collection UUIDs out of the address bar. The Waves
// page reads its own short-lived hand-off cookie (nft_waves_collection_id);
// everywhere else reads the general, longer-lived one.
async function goToCollectionPage(
  router: ReturnType<typeof useRouter>,
  collectionId: string,
  collectionName: string,
  path: string,
  params: Record<string, string> = {},
) {
  const sessionEndpoint = path === "/nft/waves" ? "/api/session/waves-collection" : "/api/session/collection";
  await fetch(sessionEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collectionId, name: collectionName }),
  }).catch(() => {});
  const qs = new URLSearchParams(params).toString();
  router.push(qs ? `${path}?${qs}` : path);
}

interface WaveRow {
  waveNumber: number;
  name: string;
  status: string;
  priceEth: number;
  quantity: number;
  soldCount: number;
  treasuryQty: number;
  revenueEth: number;
}

interface WaveBreakdown { waveNumber: number; waveName: string; priceEth: number; qty: number; spentEth: number; }
interface WalletRow {
  customerName: string;
  address: string;
  userCode: string | null;
  referrerName: string | null;
  whitelisted: boolean;
  mintedCount: number;
  perWave: WaveBreakdown[];
}

interface WaveDiscrepancy { waveNumber: number; onChain: number; offChain: number; reason: string; }
interface SyncCheck {
  checked: boolean;
  inSync: boolean;
  totalOnChain: number | null;
  totalOffChain: number;
  waveDiscrepancies: WaveDiscrepancy[];
  error?: string;
}

interface ReportData {
  holders: number;
  totalRevenueEth: number;
  totalSold: number;
  waves: WaveRow[];
  wallets: WalletRow[];
  syncCheck: SyncCheck;
}

interface CollectionOption { id: string; name: string; }

interface MenuItem {
  label: string;
  href: string;
  icon: string | null;
  module: string | null;
  moduleLabel: string | null;
  sortOrder: number;
}

interface WaveSummary { collectionName: string; waveNumber: number; waveName: string; status: string; isRevealed: boolean; soldCount: number; quantity: number; }
interface CustomerSummary { userCode: string; name: string; referrerName: string | null; wallets: string[]; }
interface TeamMember { name: string; email: string; role: string; isActive: boolean; }
interface AdminOverview {
  nftStats: { premint: number; minted: number; treasury: number };
  waves: WaveSummary[];
  customers: CustomerSummary[];
  team: TeamMember[];
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

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadWalletsCsv(collectionName: string, wallets: WalletRow[]) {
  const headers = ["Collection", "Customer Code", "Customer Name", "Referrer", "Wallet Address", "Whitelisted", "Wave Number", "Wave Name", "Price (ETH)", "Quantity", "Spent (ETH)"];
  const rows: string[][] = [];
  for (const w of wallets) {
    const base = [collectionName, w.userCode ?? "", w.customerName, w.referrerName ?? "", w.address, w.whitelisted ? "Yes" : "No"];
    if (w.perWave.length === 0) {
      rows.push([...base, "", "", "", "0", "0"]);
    } else {
      for (const pw of w.perWave) {
        rows.push([
          ...base,
          String(pw.waveNumber), pw.waveName, pw.priceEth.toFixed(4), String(pw.qty), pw.spentEth.toFixed(4),
        ]);
      }
    }
  }
  const csv = [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bearth-customer-summary-${collectionName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function KpiCard({ label, value, sub, color = "#24315f", onClick }: {
  label: string; value: string | number; sub?: string; color?: string; onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#9bafc5" }}>{label}</p>
      <p className="font-extrabold leading-none text-2xl" style={{ color }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-xs mt-1.5" style={{ color: "#9bafc5" }}>{sub}</p>}
    </>
  );
  const cls = "bg-white rounded-xl shadow-sm block w-full text-left" + (onClick ? " transition-shadow hover:shadow-md cursor-pointer" : "");
  const style = { border: "1px solid #e5e7eb", borderLeft: `3px solid ${color}`, padding: "14px 16px" };
  return onClick
    ? <button onClick={onClick} className={cls} style={style}>{body}</button>
    : <div className={cls} style={style}>{body}</div>;
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: "#9bafc5" }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: "#e5e7eb" }} />
    </div>
  );
}

function WaveBarChart({ waves, collectionId, collectionName }: { waves: WaveRow[]; collectionId: string; collectionName: string }) {
  const router = useRouter();
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...waves.map(w => w.soldCount));
  const barW = 44, gap = 20, chartH = 160, leftPad = 8;
  const width = waves.length * (barW + gap) + leftPad;
  const active = hovered !== null ? waves.find(w => w.waveNumber === hovered) ?? null : null;
  const pctSold = (w: WaveRow) => w.quantity > 0 ? Math.round((w.soldCount / w.quantity) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 h-9">
        {active ? (
          <div className="flex items-center gap-3 text-xs">
            <span className="font-bold" style={{ color: "#24315f" }}>W{active.waveNumber} — {active.name}</span>
            <span className="px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(124,58,237,0.1)", color: "#7c3aed" }}>
              {active.soldCount.toLocaleString()} / {active.quantity.toLocaleString()} sold ({pctSold(active)}%)
            </span>
            <span style={{ color: "#9bafc5" }}>{active.priceEth ? `${active.priceEth} ETH each` : "Free mint"}</span>
            <span style={{ color: "#9bafc5" }}>· Revenue {active.revenueEth.toFixed(4)} ETH</span>
            <span className="font-semibold" style={{ color: "#41afeb" }}>Click to view these NFTs →</span>
          </div>
        ) : (
          <span className="text-xs" style={{ color: "#9bafc5" }}>Hover a bar for details · click to view that wave&apos;s NFTs</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <svg width={width} height={chartH + 40} role="img" aria-label="NFTs sold per wave">
          {waves.map((w, i) => {
            const h = Math.round((w.soldCount / max) * chartH);
            const x = leftPad + i * (barW + gap);
            const isHovered = hovered === w.waveNumber;
            return (
              <g key={w.waveNumber}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(w.waveNumber)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => goToCollectionPage(router, collectionId, collectionName, "/nft/nftlist", { wave: String(w.waveNumber) })}
              >
                <rect x={x - 4} y={0} width={barW + 8} height={chartH + 24} fill="transparent" />
                <rect x={x} y={chartH - h} width={barW} height={Math.max(h, w.soldCount > 0 ? 2 : 0)}
                  rx={4} fill="#7c3aed" opacity={w.soldCount > 0 ? (isHovered ? 1 : 0.85) : (isHovered ? 0.35 : 0.15)}
                  style={{ transition: "opacity 120ms ease" }} />
                {isHovered && (
                  <rect x={x} y={chartH - h} width={barW} height={Math.max(h, w.soldCount > 0 ? 2 : 0)}
                    rx={4} fill="none" stroke="#7c3aed" strokeWidth={2} />
                )}
                {!h && <rect x={x} y={chartH - 2} width={barW} height={2} rx={1} fill="#e5e7eb" />}
                <text x={x + barW / 2} y={chartH - h - 6} textAnchor="middle" fontSize="11" fontWeight="700"
                  fill={isHovered ? "#7c3aed" : "#24315f"}>
                  {w.soldCount}
                </text>
                <text x={x + barW / 2} y={chartH + 18} textAnchor="middle" fontSize="10" fontWeight="700"
                  fill={isHovered ? "#7c3aed" : "#9bafc5"}>
                  W{w.waveNumber}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function statusColor(status: string): string {
  const s = (status ?? "").toLowerCase();
  if (s === "active") return "#16a34a";
  if (s === "closed" || s === "revealed") return "#6b7280";
  return "#d97706";
}

export default function DashboardPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const copyAddr = (addr: string) => {
    navigator.clipboard?.writeText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr((id) => id === addr ? null : id), 2000);
  };
  const router = useRouter();
  const collectionName = collections.find(c => c.id === collectionId)?.name ?? "";

  const [cards, setCards] = useState<MenuItem[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);

  useEffect(() => {
    fetch("/api/master", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const cols: CollectionOption[] = d.collections ?? [];
        setCollections(cols);
        setCollectionId(prev => prev || (cols.length ? cols[0].id : ""));
      })
      .catch(() => {});

    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : { menus: [] })
      .then(d => {
        const menus: MenuItem[] = (d.menus ?? [])
          .filter((m: MenuItem) => m.href !== "/dashboard")
          .sort((a: MenuItem, b: MenuItem) => a.sortOrder - b.sortOrder);
        setCards(menus);
        setIsAdmin(d.role === "admin");
      })
      .catch(() => setCards([]));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/overview", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setOverview(d))
      .catch(() => setOverviewError(true));
  }, [isAdmin]);

  useEffect(() => {
    if (!collectionId) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/reports?collection_id=${collectionId}`, { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load report data."); setLoading(false); });
  }, [collectionId]);

  return (
    <div className="ba-page space-y-6 max-w-6xl">

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "#24315f" }}>Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>Quick wave &amp; selling summary for a collection</p>
        </div>
        {collections.length > 0 && (
          <div className="flex items-center gap-2">
            {loading && data && (
              <svg className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "#9bafc5" }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <select
              value={collectionId}
              onChange={e => setCollectionId(e.target.value)}
              className="py-1.5 px-3 rounded-lg text-sm font-semibold bg-white outline-none"
              style={{ border: "1px solid #e5e7eb", color: "#24315f" }}>
              {collections.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {collections.length === 0 ? (
        <div className="bg-white rounded-xl p-6 text-center" style={{ border: "1px solid #e5e7eb" }}>
          <p className="text-sm font-semibold" style={{ color: "#24315f" }}>No collections yet</p>
          <p className="text-sm mt-1" style={{ color: "#9bafc5" }}>
            Create one in <Link href="/dashboard/generator" style={{ color: "#41afeb" }}>NFT Studio</Link> to see selling and wave activity here.
          </p>
        </div>
      ) : loading && !data ? (
        <div className="p-6 flex items-center justify-center h-40">
          <div className="flex items-center gap-3" style={{ color: "#9bafc5" }}>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading…
          </div>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl text-sm" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>{error}</div>
      ) : !data ? null : (
        <>
          {data.syncCheck.checked && (
            <div className="p-4 rounded-xl text-sm flex items-start gap-3"
              style={{
                background: data.syncCheck.inSync ? "rgba(22,163,74,0.06)" : "rgba(217,119,6,0.06)",
                border: `1px solid ${data.syncCheck.inSync ? "rgba(22,163,74,0.25)" : "#fde68a"}`,
              }}>
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: data.syncCheck.inSync ? "#16a34a" : "#d97706" }}
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {data.syncCheck.inSync
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />}
              </svg>
              <div className="flex-1">
                {data.syncCheck.inSync ? (
                  <p className="font-semibold" style={{ color: "#16a34a" }}>
                    On-chain and off-chain are in sync — {data.syncCheck.totalOnChain} minted on-chain, {data.syncCheck.totalOffChain} in the database.
                  </p>
                ) : (
                  <>
                    <p className="font-semibold" style={{ color: "#d97706" }}>
                      Discrepancy detected — {data.syncCheck.totalOnChain} minted on-chain vs {data.syncCheck.totalOffChain} in the database.
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {data.syncCheck.waveDiscrepancies.map(d => (
                        <li key={d.waveNumber} className="text-xs" style={{ color: "#92400e" }}>
                          <strong>Wave {d.waveNumber}:</strong> on-chain {d.onChain} vs DB {d.offChain} — {d.reason}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
          {data.syncCheck.error && (
            <div className="p-3 rounded-xl text-xs" style={{ background: "#f9fafb", border: "1px solid #e5e7eb", color: "#9bafc5" }}>
              Could not check on-chain sync: {data.syncCheck.error}
            </div>
          )}

          <div>
            <SectionDivider label="Summary" />
            <div className="grid grid-cols-3 gap-4">
              <KpiCard label="Total Sold" value={data.totalSold} color="#7c3aed"
                onClick={data.totalSold > 0 ? () => goToCollectionPage(router, collectionId, collectionName, "/nft/nftlist") : undefined}
                sub={data.totalSold > 0 ? "view NFTs →" : undefined} />
              <KpiCard label="Revenue (ETH)" value={data.totalRevenueEth} color="#41afeb" />
              <KpiCard label="Holders" value={data.holders} color="#24315f"
                onClick={data.holders > 0 ? () => goToCollectionPage(router, collectionId, collectionName, "/nft/nftlist") : undefined}
                sub={data.holders > 0 ? "view holding wallets →" : "wallets holding an NFT here"} />
            </div>
          </div>

          <div>
            <SectionDivider label="Wave Selling Stats" />
            {data.waves.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-5 mb-4" style={{ border: "1px solid #e5e7eb" }}>
                <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "#9bafc5" }}>NFTs Sold per Wave</p>
                <WaveBarChart waves={data.waves} collectionId={collectionId} collectionName={collectionName} />
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid #e5e7eb" }}>
              {data.waves.length === 0 ? (
                <div className="py-10 text-center text-sm" style={{ color: "#9bafc5" }}>No waves configured for this collection</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                        {["Wave", "Status", "Price (ETH)", "Qty", "Sold", "Treasury Qty", "Revenue (ETH)"].map((h, i) => (
                          <th key={h} className={i === 0 ? "text-left" : "text-right"}
                            style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9bafc5" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.waves.map((w, i) => (
                        <tr key={w.waveNumber} style={{ borderTop: i === 0 ? "none" : "1px solid #f3f4f6" }} className="hover:bg-gray-50/50">
                          <td style={{ padding: "12px 16px" }}>
                            <button onClick={() => goToCollectionPage(router, collectionId, collectionName, "/nft/waves")}
                              className="font-semibold hover:underline" style={{ color: "#24315f" }}>
                              W{w.waveNumber} — {w.name}
                            </button>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ background: `${statusColor(w.status)}1a`, color: statusColor(w.status) }}>
                              {w.status}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#374151" }}>{w.priceEth || "Free"}</td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            <button onClick={() => goToCollectionPage(router, collectionId, collectionName, "/nft/nftlist", { wave: String(w.waveNumber) })}
                              className="hover:underline" style={{ color: "#41afeb" }}>
                              {w.quantity.toLocaleString()}
                            </button>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            {w.soldCount > 0 ? (
                              <button onClick={() => goToCollectionPage(router, collectionId, collectionName, "/nft/nftlist", { wave: String(w.waveNumber) })}
                                className="font-semibold hover:underline" style={{ color: "#41afeb" }}>
                                {w.soldCount.toLocaleString()}
                              </button>
                            ) : (
                              <span style={{ color: "#374151" }}>{w.soldCount.toLocaleString()}</span>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            {w.treasuryQty > 0 ? (
                              <button onClick={() => goToCollectionPage(router, collectionId, collectionName, "/nft/nftlist", { wave: String(w.waveNumber) })}
                                className="hover:underline" style={{ color: "#9bafc5" }}>
                                {w.treasuryQty.toLocaleString()}
                              </button>
                            ) : (
                              <span style={{ color: "#374151" }}>0</span>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#374151" }}>{w.revenueEth.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: "#9bafc5" }}>Customer Wallets</span>
              <button
                onClick={() => downloadWalletsCsv(collections.find(c => c.id === collectionId)?.name ?? "collection", data.wallets)}
                disabled={data.wallets.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white disabled:opacity-40"
                style={{ border: "1px solid #e5e7eb", color: "#6b7280" }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download CSV
              </button>
            </div>
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid #e5e7eb" }}>
              {data.wallets.length === 0 ? (
                <div className="py-10 text-center text-sm" style={{ color: "#9bafc5" }}>No customer wallets yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                        {["Code", "Customer", "Referrer", "Wallet", "Whitelisted", "Minted Here", "Wave Breakdown"].map((h, i) => (
                          <th key={h} className={i >= 4 && i <= 5 ? "text-right" : "text-left"}
                            style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9bafc5" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.wallets.map((w, i) => (
                        <tr key={w.address} style={{ borderTop: i === 0 ? "none" : "1px solid #f3f4f6" }} className="hover:bg-gray-50/50">
                          <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>{w.userCode ?? "—"}</td>
                          <td style={{ padding: "12px 16px", fontWeight: 600, color: "#24315f" }}>{w.customerName}</td>
                          <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>{w.referrerName ?? "—"}</td>
                          <td style={{ padding: "12px 16px" }}>
                            <div className="flex items-center gap-1.5">
                              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>
                                {w.address.slice(0, 8)}…{w.address.slice(-6)}
                              </span>
                              <button
                                onClick={() => copyAddr(w.address)}
                                style={{ color: copiedAddr === w.address ? "#16a34a" : "#9bafc5" }}
                                title={copiedAddr === w.address ? "Copied!" : "Copy address"}>
                                {copiedAddr === w.address ? (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                )}
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ background: w.whitelisted ? "rgba(22,163,74,0.1)" : "rgba(156,163,175,0.12)", color: w.whitelisted ? "#16a34a" : "#9ca3af" }}>
                              {w.whitelisted ? "Yes" : "No"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600 }}>
                            {w.mintedCount > 0 ? (
                              <button onClick={() => goToCollectionPage(router, collectionId, collectionName, "/nft/nftlist", { wallet: w.address })}
                                className="hover:underline" style={{ color: "#41afeb" }}>
                                {w.mintedCount}
                              </button>
                            ) : (
                              <span style={{ color: "#374151" }}>{w.mintedCount}</span>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", color: "#6b7280", fontSize: 12 }}>
                            {w.perWave.length === 0 ? "—" : w.perWave.map(pw =>
                              `W${pw.waveNumber} ×${pw.qty} @ ${pw.priceEth || "Free"}${pw.priceEth ? " ETH" : ""}`
                            ).join(" · ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {isAdmin && (
        <div className="space-y-4">
          <SectionDivider label="Overview (Read-Only)" />
          {overviewError ? (
            <p className="text-sm" style={{ color: "#9bafc5" }}>Couldn&apos;t load overview data — try refreshing.</p>
          ) : overview === null ? (
            <p className="text-sm" style={{ color: "#9bafc5" }}>Loading overview…</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <KpiCard label="Pre-mint" value={overview.nftStats.premint} color="#9bafc5" />
                <KpiCard label="Minted / Sold" value={overview.nftStats.minted} color="#16a34a" />
                <KpiCard label="Treasury-Held" value={overview.nftStats.treasury} color="#ea580c" />
              </div>

              <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e5e7eb" }}>
                <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "#9bafc5" }}>Wave Schedule &amp; Reveal Status (All Collections)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {overview.waves.map((w, i) => (
                    <div key={`${w.collectionName}-${w.waveNumber}-${i}`} className="text-xs p-2 rounded-lg" style={{ background: "#f8fafc" }}>
                      <div className="font-semibold" style={{ color: "#24315f" }}>{w.collectionName} · Wave {w.waveNumber} — {w.waveName}</div>
                      <div style={{ color: "#9bafc5" }}>{w.status} · {w.soldCount}/{w.quantity} sold · {w.isRevealed ? "revealed" : "not revealed"}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e5e7eb" }}>
                  <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "#9bafc5" }}>Customers ({overview.customers.length})</h3>
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {overview.customers.map(c => (
                      <div key={c.userCode} className="text-xs flex justify-between gap-2 py-1" style={{ borderBottom: "1px solid #f8fafc" }}>
                        <span style={{ color: "#24315f" }}>{c.name} <span style={{ color: "#9bafc5" }}>({c.userCode})</span></span>
                        <span style={{ color: "#9bafc5" }}>{c.wallets.length} wallet{c.wallets.length !== 1 ? "s" : ""}{c.referrerName ? ` · ref: ${c.referrerName}` : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e5e7eb" }}>
                  <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "#9bafc5" }}>Bearth Team ({overview.team.length})</h3>
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {overview.team.map(t => (
                      <div key={t.email} className="text-xs flex justify-between gap-2 py-1" style={{ borderBottom: "1px solid #f8fafc" }}>
                        <span style={{ color: "#24315f" }}>{t.name}</span>
                        <span style={{ color: "#9bafc5" }}>{t.role}{!t.isActive ? " · inactive" : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div>
        <SectionDivider label="Quick Links" />
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
