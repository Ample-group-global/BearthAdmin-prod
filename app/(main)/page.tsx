"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface WaveRow {
  waveNumber: number;
  name: string;
  status: string;
  priceEth: number;
  quantity: number;
  soldCount: number;
  revenueEth: number;
}

interface WaveBreakdown { waveNumber: number; waveName: string; priceEth: number; qty: number; spentEth: number; }
interface WalletRow {
  customerName: string;
  address: string;
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

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadWalletsCsv(collectionName: string, wallets: WalletRow[]) {
  const headers = ["Collection", "Customer Name", "Wallet Address", "Whitelisted", "Wave Number", "Wave Name", "Price (ETH)", "Quantity", "Spent (ETH)"];
  const rows: string[][] = [];
  for (const w of wallets) {
    if (w.perWave.length === 0) {
      rows.push([collectionName, w.customerName, w.address, w.whitelisted ? "Yes" : "No", "", "", "", "0", "0"]);
    } else {
      for (const pw of w.perWave) {
        rows.push([
          collectionName, w.customerName, w.address, w.whitelisted ? "Yes" : "No",
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

function KpiCard({ label, value, sub, color = "#24315f" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm" style={{ border: "1px solid #e5e7eb", borderLeft: `3px solid ${color}`, padding: "14px 16px" }}>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#9bafc5" }}>{label}</p>
      <p className="font-extrabold leading-none text-2xl" style={{ color }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-xs mt-1.5" style={{ color: "#9bafc5" }}>{sub}</p>}
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: "#9bafc5" }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: "#e5e7eb" }} />
    </div>
  );
}

function WaveBarChart({ waves }: { waves: WaveRow[] }) {
  const max = Math.max(1, ...waves.map(w => w.soldCount));
  const barW = 44, gap = 20, chartH = 160, leftPad = 8;
  const width = waves.length * (barW + gap) + leftPad;
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={chartH + 40} role="img" aria-label="NFTs sold per wave">
        {waves.map((w, i) => {
          const h = Math.round((w.soldCount / max) * chartH);
          const x = leftPad + i * (barW + gap);
          return (
            <g key={w.waveNumber}>
              <rect x={x} y={chartH - h} width={barW} height={Math.max(h, w.soldCount > 0 ? 2 : 0)}
                rx={4} fill="#7c3aed" opacity={w.soldCount > 0 ? 0.85 : 0.15} />
              {!h && <rect x={x} y={chartH - 2} width={barW} height={2} rx={1} fill="#e5e7eb" />}
              <text x={x + barW / 2} y={chartH - h - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#24315f">
                {w.soldCount}
              </text>
              <text x={x + barW / 2} y={chartH + 18} textAnchor="middle" fontSize="10" fontWeight="700" fill="#9bafc5">
                W{w.waveNumber}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function statusColor(status: string): string {
  const s = (status ?? "").toLowerCase();
  if (s === "active") return "#16a34a";
  if (s === "closed" || s === "revealed") return "#6b7280";
  return "#d97706";
}

export default function OverviewPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collectionId, setCollectionId] = useState("");

  useEffect(() => {
    fetch("/api/master", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const cols: CollectionOption[] = d.collections ?? [];
        setCollections(cols);
        if (!collectionId && cols.length) setCollectionId(cols[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <div>
        <h1 className="text-xl font-extrabold" style={{ color: "#24315f" }}>Bearth Overview</h1>
        <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>Quick wave & selling summary for a collection</p>
      </div>

      {collections.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl flex-wrap"
          style={{ background: "#f8fafc", border: "1px solid #e5e7eb" }}>
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#64748b" }}>Collection</span>
          <select
            value={collectionId}
            onChange={e => setCollectionId(e.target.value)}
            className="py-1.5 px-3 rounded-lg text-sm font-semibold bg-white outline-none"
            style={{ border: "1px solid #cbd5e1", color: "#24315f" }}>
            {collections.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
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
              <KpiCard label="Total Sold" value={data.totalSold} color="#7c3aed" />
              <KpiCard label="Revenue (ETH)" value={data.totalRevenueEth} color="#41afeb" />
              <KpiCard label="Holders" value={data.holders} color="#24315f" sub="wallets holding an NFT here" />
            </div>
          </div>

          <div>
            <SectionDivider label="Wave Selling Stats" />
            {data.waves.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-5 mb-4" style={{ border: "1px solid #e5e7eb" }}>
                <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "#9bafc5" }}>NFTs Sold per Wave</p>
                <WaveBarChart waves={data.waves} />
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
                        {["Wave", "Status", "Price (ETH)", "Qty", "Sold", "Revenue (ETH)"].map((h, i) => (
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
                            <Link href={`/nft/waves?collection_id=${collectionId}`} className="font-semibold" style={{ color: "#24315f" }}>
                              W{w.waveNumber} — {w.name}
                            </Link>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ background: `${statusColor(w.status)}1a`, color: statusColor(w.status) }}>
                              {w.status}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#374151" }}>{w.priceEth || "Free"}</td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#374151" }}>{w.quantity.toLocaleString()}</td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#374151" }}>{w.soldCount.toLocaleString()}</td>
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
                        {["Customer", "Wallet", "Whitelisted", "Minted Here", "Wave Breakdown"].map((h, i) => (
                          <th key={h} className={i >= 2 && i <= 3 ? "text-right" : "text-left"}
                            style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9bafc5" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.wallets.map((w, i) => (
                        <tr key={w.address} style={{ borderTop: i === 0 ? "none" : "1px solid #f3f4f6" }} className="hover:bg-gray-50/50">
                          <td style={{ padding: "12px 16px", fontWeight: 600, color: "#24315f" }}>{w.customerName}</td>
                          <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>
                            {w.address.slice(0, 8)}…{w.address.slice(-6)}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ background: w.whitelisted ? "rgba(22,163,74,0.1)" : "rgba(156,163,175,0.12)", color: w.whitelisted ? "#16a34a" : "#9ca3af" }}>
                              {w.whitelisted ? "Yes" : "No"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#374151", fontWeight: 600 }}>{w.mintedCount}</td>
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

      <div>
        <SectionDivider label="Detailed Reports" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: "/nft/nftlist",             label: "NFT Records",     icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
            { href: "/nft/waves",                label: "NFT Waves",       icon: "M4 6h16M4 12h16M4 18h16" },
            { href: "/customers",               label: "Customer Report", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
          ].map(r => (
            <Link key={r.href} href={r.href}
              className="bg-white rounded-xl p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow group"
              style={{ border: "1px solid #e5e7eb" }}>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(65,175,235,0.08)" }}>
                <svg className="w-4 h-4" style={{ color: "#41afeb" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={r.icon} />
                </svg>
              </span>
              <span className="text-xs font-semibold flex-1" style={{ color: "#24315f" }}>{r.label}</span>
              <svg className="w-3.5 h-3.5 flex-shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: "#d1d5db" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
