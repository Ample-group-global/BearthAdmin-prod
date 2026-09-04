"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useInterval } from "@/lib/useInterval";
import { ErrBanner } from "@/components/nft/Banner";
import CollaborationsTab from "@/components/nft/tabs/CollaborationsTab";
import RevealModal from "./components/WaveRevealModal";
import TreasuryMoveModal from "./components/TreasuryMoveModal";
import RevealScheduleEditModal from "./components/RevealScheduleEditModal";
import WavesTable from "./components/WavesTable";
import WaveManageModal from "./components/WaveManageModal";
import WaveProgressStepper from "./components/WaveProgressStepper";
import TxSuccessModal from "@/components/nft/shared/TxSuccessModal";
import { Wave, WaveSchedule, SaleMethod, OnChainWaveInfo, WaveManageForm } from "./wave-types";
import { STATE_META, toLocalDateTimeInput, fmtDatetime as fmtFull } from "@/lib/nft-utils";

function waveState(w: WaveSchedule): "revealed" | "ready_reveal" | "reveal_scheduled" | "active" | "ended" | "ended_zero" | "upcoming" | "not_scheduled" {
  const now = Date.now();
  if (w.is_revealed) return "revealed";
  if (w.wave_start_triggered && !w.wave_end_triggered) return "active";
  if (w.wave_end_triggered) {
    if (w.reveal_scheduled_at && new Date(w.reveal_scheduled_at).getTime() <= now) return "ready_reveal";
    if (w.reveal_scheduled_at && new Date(w.reveal_scheduled_at).getTime() > now) return "reveal_scheduled";
    if ((w.sold_count ?? 0) === 0) return "ended_zero";
    return "ended";
  }
  // Time-window fallback: scheduler may not have fired yet (up to 30s lag)
  if (w.scheduled_start && new Date(w.scheduled_start).getTime() <= now) {
    if (!w.scheduled_end || new Date(w.scheduled_end).getTime() > now) return "active";
    return "ended"; // both start and end passed but DB flags not yet updated
  }
  if (w.scheduled_start) return "upcoming";
  return "not_scheduled";
}

function deriveWaveDisplayStatus(w: Wave): string {
  const now = Date.now();
  if (w.waveRevealed) return "revealed";
  if (w.waveClosed) {
    if (w.revealScheduledAt && new Date(w.revealScheduledAt).getTime() <= now) return "ready_reveal";
    if (w.revealScheduledAt && new Date(w.revealScheduledAt).getTime() > now) return "reveal_scheduled";
    return "closed";
  }
  if (w.status === "active" && w.scheduledEnd && new Date(w.scheduledEnd).getTime() < now) return "ended";
  // Time-based fallback: scheduled_start passed but DB not yet updated (auto-trigger lag)
  if (w.scheduledStart && new Date(w.scheduledStart).getTime() <= now) {
    if (!w.scheduledEnd || new Date(w.scheduledEnd).getTime() > now) return "active";
    return "ended";
  }
  return w.status;
}

export default function WavesPage() {
  const searchParams = useSearchParams();
  const strategyHighlight = searchParams.get("saleMethod");
  const strategyName = searchParams.get("strategy");
  const highlightRef = useRef<HTMLDivElement>(null);


  const [activeTab, setActiveTab] = useState<"waves" | "collaborations">("waves");

  // Waves are now per-collection (mirrors NFT List's collection_id split) --
  // unlike NFT List there's no meaningful "all collections combined" view
  // here (21 waves from 3 collections can't be shown as one merged table),
  // so exactly one collection must always be selected.
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [collectionId, setCollectionId] = useState("");

  const [waves, setWaves] = useState<Wave[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saleMethods, setSaleMethods] = useState<SaleMethod[]>([]);
  const [wavePage, setWavePage] = useState(1);
  const WAVES_PER_PAGE = 10;

  // DB edit modal
  const [editWave, setEditWave] = useState<Wave | null>(null);
  const [manageMaximized, setManageMaximized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<WaveManageForm>({
    defaultPriceEth: "", saleMethod: "", scheduledStart: "",
    scheduledEnd: "", status: "", unsoldStrategy: "auto_treasury",
    revealStrategy: "auto", whitelistRequired: true, revealUri: "",
  });

  // On-chain action modal
  const [chainWave, setChainWave] = useState<Wave | null>(null);
  const [chainOnChain, setChainOnChain] = useState<OnChainWaveInfo | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainSaving, setChainSaving] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [chainTx, setChainTx] = useState<string | null>(null);

  // Chain form fields
  const [chainPrice, setChainPrice] = useState("");
  const [purchaseLimitInput, setPurchaseLimitInput] = useState("");
  const [treasuryMoveWave, setTreasuryMoveWave] = useState<Wave | null>(null);
  const [treasurySuccessData, setTreasurySuccessData] = useState<{ txHash: string; waveNum: number } | null>(null);

  const [revealWaves, setRevealWaves] = useState<WaveSchedule[]>([]);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);
  const [revealWave, setRevealWave] = useState<WaveSchedule | null>(null);
  const [revealSuccessData, setRevealSuccessData] = useState<{ txHash: string; waveNum: number } | null>(null);
  const [scheduleEditWave, setScheduleEditWave] = useState<WaveSchedule | null>(null);
  const [scheduleEditDate, setScheduleEditDate] = useState("");
  const [scheduleEditSaving, setScheduleEditSaving] = useState(false);
  const [scheduleEditErr, setScheduleEditErr] = useState<string | null>(null);
  const [blindBoxUrl, setBlindBoxUrl] = useState<string | null>(null);

  const loadWaves = () => {
    if (!collectionId) return;
    console.group("[WavesPage] loadWaves");
    console.log("fetching /api/nft-sell/waves");
    setLoading(true); setError(null);
    fetch(`/api/nft-sell/waves?collection_id=${collectionId}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        console.log("waves loaded:", d.waves?.length ?? 0);
        console.groupEnd();
        setWaves(d.waves ?? []); setLoading(false);
      })
      .catch(e => {
        console.error("loadWaves failed:", e);
        console.groupEnd();
        setError("Failed to load waves."); setLoading(false);
      });
  };

  const [waveWatchAlert, setWaveWatchAlert] = useState<string | null>(null);
  const [revealReadyCount, setRevealReadyCount] = useState(0);
  const [watchUpdated, setWatchUpdated] = useState<Date | null>(null);

  const silentWavePoll = useCallback(async () => {
    if (!collectionId) return;
    try {
      const [res, sr] = await Promise.all([
        fetch(`/api/nft-sell/waves?collection_id=${collectionId}`, { credentials: "include" }),
        fetch(`/api/nft-sell/waves/schedule-status?collection_id=${collectionId}`, { credentials: "include" }),
      ]);
      if (!res.ok) return;
      const d = await res.json();
      const updated: Wave[] = d.waves ?? [];
      setWatchUpdated(new Date());

      // detect waves whose reveal date has passed but are not yet revealed
      const now = Date.now();
      const readyToReveal = updated.filter(w =>
        w.revealScheduledAt && new Date(w.revealScheduledAt).getTime() <= now && !w.waveRevealed
      );
      setRevealReadyCount(readyToReveal.length);
      if (readyToReveal.length > 0) {
        setWaveWatchAlert(`${readyToReveal.length} wave${readyToReveal.length > 1 ? "s" : ""} ready to reveal: ${readyToReveal.map(w => `Wave ${w.waveNumber}`).join(", ")}`);
      }

      // silently refresh wave list and progress stepper together
      setWaves(updated);
      if (sr.ok) {
        const sd = await sr.json();
        setRevealWaves(sd.waves ?? []);
      }
    } catch { /* silent */ }
  }, [collectionId]);

  useInterval(silentWavePoll, 30_000);

  // Precision event timer: fire silentWavePoll at the exact millisecond each
  // scheduled event (start / end / reveal) arrives so the UI transitions
  // immediately without waiting for the next 30-second poll tick.
  useEffect(() => {
    const now = Date.now();
    const times: number[] = [];
    for (const w of revealWaves) {
      if (w.scheduled_start) times.push(new Date(w.scheduled_start).getTime());
      if (w.scheduled_end) times.push(new Date(w.scheduled_end).getTime());
      if (w.reveal_scheduled_at) times.push(new Date(w.reveal_scheduled_at).getTime());
    }
    for (const w of waves) {
      if (w.scheduledStart) times.push(new Date(w.scheduledStart).getTime());
      if (w.scheduledEnd) times.push(new Date(w.scheduledEnd).getTime());
      if (w.revealScheduledAt) times.push(new Date(w.revealScheduledAt).getTime());
    }
    const upcoming = times.filter(t => t > now);
    if (upcoming.length === 0) return;
    const next = Math.min(...upcoming);
    const id = setTimeout(() => silentWavePoll(), next - now + 200);
    return () => clearTimeout(id);
  }, [revealWaves, waves, silentWavePoll]);

  const loadRevealData = useCallback(async () => {
    if (!collectionId) return;
    setRevealLoading(true); setRevealErr(null);
    try {
      const wr = await fetch(`/api/nft-sell/waves/schedule-status?collection_id=${collectionId}`, { credentials: "include" });
      const wd = await wr.json();
      setRevealWaves(wd.waves ?? []);
    } catch {
      setRevealErr("Failed to load wave data");
    } finally {
      setRevealLoading(false);
    }
  }, [collectionId]);

  // Collection dropdown: /api/master's list is deliberately scoped to
  // collections that already have synced nft_records -- correct here too,
  // not just for NFT List: a collection with nothing generated/synced yet
  // has no real NFTs to schedule a sale for, so it should NOT show up in
  // Waves either. The actual bug was that this fetch resolving to zero
  // collections left collectionsLoading/loading stuck true forever with no
  // empty-state message -- see the render below, which now shows one.
  useEffect(() => {
    fetch("/api/master", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setCollections(d.collections ?? []);
        if (d.blindBoxImageUrl) setBlindBoxUrl(d.blindBoxImageUrl);
        if (!collectionId && d.collections?.length) setCollectionId(d.collections[0].id);
        if (!d.collections?.length) setLoading(false);
      })
      .catch(() => setLoading(false));
    fetch("/api/nft-sell/lookups/wave-sale-methods", { credentials: "include" })
      .then(r => r.json())
      .then(d => setSaleMethods(d.saleMethods ?? []))
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once a collection is selected (default or user-picked), (re)load everything for it.
  useEffect(() => {
    if (!collectionId) return;
    loadWaves();
    loadRevealData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId]);

  useEffect(() => {
    if (strategyHighlight && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [strategyHighlight, waves]);

  const saveRevealDate = async () => {
    if (!scheduleEditWave) return;
    const matched = waves.find(w => w.waveNumber === scheduleEditWave.wave_number);
    if (!matched) { setScheduleEditErr("Wave not found."); return; }
    setScheduleEditSaving(true); setScheduleEditErr(null);
    try {
      const res = await fetch(`/api/waves/${matched.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revealScheduledAt: scheduleEditDate ? new Date(scheduleEditDate).toISOString() : null }),
      });
      if (!res.ok) { const d = await res.json(); setScheduleEditErr(d.error ?? "Save failed"); return; }
      setScheduleEditWave(null);
      loadRevealData();
      loadWaves();
    } catch { setScheduleEditErr("Network error."); }
    finally { setScheduleEditSaving(false); }
  };

  const openEdit = (w: Wave) => {
    setEditWave(w);
    setForm({
      defaultPriceEth: w.defaultPriceEth != null ? String(w.defaultPriceEth) : "",
      saleMethod: w.saleMethod ?? "fixed_price",
      scheduledStart: w.scheduledStart ? toLocalDateTimeInput(new Date(w.scheduledStart)) : "",
      scheduledEnd: w.scheduledEnd ? toLocalDateTimeInput(new Date(w.scheduledEnd)) : "",
      status: w.status ?? "upcoming",
      unsoldStrategy: (w.unsoldStrategy ?? "auto_treasury") as 'auto_treasury' | 'manual',
      revealStrategy: (w.revealStrategy ?? "auto") as 'auto' | 'manual',
      whitelistRequired: w.whitelistRequired ?? true,
      revealUri: w.waveRevealUri ?? "",
    });
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!editWave) return;
    setSaving(true); setSaveError(null);
    try {
      const schedLocked = editWave.waveClosed ||
        editWave.status === "active" ||
        !!(editWave.scheduledStart && new Date(editWave.scheduledStart) <= new Date());
      const body: Record<string, unknown> = {
        defaultPriceEth: form.defaultPriceEth !== "" ? Number(form.defaultPriceEth) : null,
        saleMethod: form.saleMethod || null,
        ...(schedLocked ? {} : {
          scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : null,
          scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : null,
        }),
        status: form.status || null,
        unsoldStrategy: form.unsoldStrategy,
        revealStrategy: form.revealStrategy,
        whitelistRequired: form.whitelistRequired,
        waveRevealUri: form.revealUri || null,
      };
      const res = await fetch(`/api/waves/${editWave.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); setSaveError(d.error ?? "Save failed."); return; }
      setEditWave(null); loadWaves(); loadRevealData();
    } catch { setSaveError("Network error."); }
    finally { setSaving(false); }
  };

  const openManage = (w: Wave) => {
    console.group("[WavesPage] openManage");
    console.log("wave:", w.waveNumber, w.name, "status:", w.status);
    openEdit(w);
    setChainWave(w); setChainError(null); setChainTx(null); setChainOnChain(null);
    setChainPrice(w.defaultPriceEth != null ? String(w.defaultPriceEth) : "");
    setPurchaseLimitInput(w.maxPerWallet != null ? String(w.maxPerWallet) : "0");
    setChainLoading(true);
    fetch(`/api/nft-sell/waves/${w.waveNumber}?collection_id=${collectionId}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { console.log("on-chain state:", d.onChain); console.groupEnd(); setChainOnChain(d.onChain ?? null); })
      .catch(() => { console.groupEnd(); })
      .finally(() => setChainLoading(false));
  };

  const closeManage = () => {
    setEditWave(null); setChainWave(null);
    setChainTx(null); setChainError(null);
    setManageMaximized(false);
  };

  const chainOp = async (opName: string, fn: () => Promise<Response>) => {
    console.group(`[WavesPage] chainOp: ${opName}`);
    console.log("wave:", chainWave?.waveNumber);
    setChainSaving(opName); setChainError(null); setChainTx(null);
    try {
      const res = await fn();
      const d = await res.json();
      if (!res.ok) { setChainError(d.error ?? `${opName} failed.`); return; }
      console.log("chainOp success, txHash:", d.txHash ?? null);
      setChainTx(d.txHash ?? null);
      const fresh = await fetch(`/api/nft-sell/waves/${chainWave!.waveNumber}?collection_id=${collectionId}`, { credentials: "include" }).then(r => r.json());
      setChainOnChain(fresh.onChain ?? null);
      loadWaves();
    } catch (e) {
      console.error("chainOp network error:", e);
      setChainError("Network error.");
    }
    finally { console.groupEnd(); setChainSaving(null); }
  };

  const handleSetScheduleOnChain = () => {
    if (!editWave?.scheduledStart || !editWave?.scheduledEnd) {
      setChainError("No schedule in DB — set start/end dates in the Settings tab first.");
      return;
    }
    chainOp("schedule", () => fetch(`/api/nft-sell/waves/${chainWave!.waveNumber}/schedule`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUnix: Math.floor(new Date(editWave.scheduledStart!).getTime() / 1000),
        endUnix: Math.floor(new Date(editWave.scheduledEnd!).getTime() / 1000),
        collectionId,
      }),
    }));
  };

  const handleSetPriceOnChain = () => {
    if (!chainPrice || isNaN(parseFloat(chainPrice))) { setChainError("Enter a valid price."); return; }
    chainOp("price", () => fetch(`/api/nft-sell/waves/${chainWave!.waveNumber}/price`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceEth: chainPrice, collectionId }),
    }));
  };

  const handleSetPurchaseLimitOnChain = () => {
    const limit = parseInt(purchaseLimitInput, 10);
    if (isNaN(limit) || limit < 0) { setChainError("Enter a valid limit (0 = use global limit)."); return; }
    chainOp("purchase-limit", () => fetch(`/api/nft-sell/waves/${chainWave!.waveNumber}/purchase-limit`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPerWallet: limit, collectionId }),
    }));
  };

  function handleRevealSuccess(txHash: string, waveNum: number) {
    console.group("[WavesPage] handleRevealSuccess");
    console.log("txHash:", txHash, "waveNum:", waveNum);
    console.groupEnd();
    setRevealWave(null);
    setRevealSuccessData({ txHash, waveNum });
    loadRevealData();
    loadWaves();
  }

  const totalNfts = waves.reduce((s, w) => s + (w.quantity ?? 0), 0);
  const activeWave = waves.find(w => deriveWaveDisplayStatus(w) === "active");
  // Waves whose minting period is over: closed, reveal-scheduled, ready-to-reveal, revealed, or transitional ended
  const completedCount = waves.filter(w =>
    ["revealed", "closed", "reveal_scheduled", "ready_reveal", "ended"].includes(deriveWaveDisplayStatus(w))
  ).length;
  const totalSold = waves.reduce((s, w) => s + (w.soldCount ?? w.onChain?.soldCount ?? 0), 0);

  const revealNow = Date.now();
  const readyCount = Math.max(
    revealWaves.filter(w => waveState(w) === "ready_reveal").length,
    revealReadyCount
  );
  const nextAction = revealWaves
    .flatMap(w => [
      w.scheduled_start && !w.wave_start_triggered ? { label: `W${w.wave_number} starts`, dt: new Date(w.scheduled_start).getTime() } : null,
      w.reveal_scheduled_at && !w.wave_reveal_triggered && !w.is_revealed ? { label: `W${w.wave_number} reveal due`, dt: new Date(w.reveal_scheduled_at).getTime() } : null,
    ])
    .filter((x): x is { label: string; dt: number } => x !== null && x.dt > revealNow)
    .sort((a, b) => a.dt - b.dt)[0] ?? null;

  const TAB_STYLE_ACTIVE = {
    color: "#24315f",
    borderBottom: "2px solid #41afeb",
    fontWeight: 700,
    background: "transparent",
  };
  const TAB_STYLE_INACTIVE = {
    color: "#9bafc5",
    borderBottom: "2px solid transparent",
    fontWeight: 600,
    background: "transparent",
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold" style={{ color: "#24315f" }}>NFT Waves</h1>
          <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
            Manage wave pricing, schedules, reveal dates and on-chain wave actions
          </p>
        </div>
        <button
          onClick={() => { loadWaves(); loadRevealData(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ border: "1px solid #e5e7eb", color: "#6b7280", background: "white" }}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Collections only qualify here once they have synced nft_records
          (same rule /api/master already applies for NFT List, correct here
          too — a collection with nothing generated/synced yet has no real
          NFTs to schedule a sale for). Previously this state was a
          perpetual "Loading..." spinner with no explanation once the
          collections fetch resolved to zero results — !loading here means
          the fetch actually completed, it just found nothing yet. */}
      {!loading && collections.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-6 py-14 rounded-xl text-center"
          style={{ background: "#f8fafc", border: "1px solid #e5e7eb" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.35 }}>
            <path d="M3 7l2-3h14l2 3M3 7v12a1 1 0 001 1h16a1 1 0 001-1V7M3 7h18M9 11h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-sm font-bold" style={{ color: "#24315f" }}>No collections with generated NFTs yet</p>
          <p className="text-xs max-w-md" style={{ color: "#94a3b8" }}>
            Waves only appear here once a collection&apos;s NFTs have been generated and synced to records in{" "}
            <a href="/dashboard/generator" style={{ color: "#41afeb", fontWeight: 600 }}>NFT Studio</a> —
            there&apos;s nothing to schedule a sale for until then.
          </p>
        </div>
      )}

      {/* Collection selector — waves are per-collection (each with its own
          independent 7-wave schedule), unlike NFT List there's no "all
          combined" view here, so exactly one must always be selected. */}
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
          <span className="text-xs" style={{ color: "#94a3b8" }}>
            Each collection has its own independent wave schedule.
          </span>
        </div>
      )}

      <div className="ba-tabs" style={{ borderBottom: "1px solid #e5e7eb" }}>
        <div className="flex gap-0">
          {/* Hidden: "packs" (Mystery Packs — no on-chain mint in reveal flow, design gap pending) */}
          {([
            { key: "waves", label: "Waves" },
            /* Hidden for now (work in progress): { key: "collaborations", label: "Collaborations" } */
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors"
              style={activeTab === tab.key ? TAB_STYLE_ACTIVE : TAB_STYLE_INACTIVE}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>


      {waveWatchAlert && (
        <div className="flex items-center justify-between px-4 py-2 rounded-xl text-sm"
          style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.25)", color: "#d97706" }}>
          <span>{waveWatchAlert}</span>
          <button onClick={() => setWaveWatchAlert(null)} className="ml-4 text-xs opacity-60 hover:opacity-100">X</button>
        </div>
      )}
      {watchUpdated && (
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "#9bafc5" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          Live · last checked {watchUpdated.toLocaleTimeString()}
        </div>
      )}

      {activeTab === "waves" && collections.length > 0 && (
        <>
          {/* Strategy banner */}
          {strategyHighlight && (
            <div ref={highlightRef} className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm"
              style={{ background: "rgba(65,175,235,0.08)", border: "1px solid rgba(65,175,235,0.3)" }}>
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="#41afeb" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <span className="font-bold" style={{ color: "#41afeb" }}>
                  {strategyName ? `Strategy: ${strategyName}` : "Strategy selected"}
                </span>
                <span className="ml-2" style={{ color: "#6b7280" }}>
                  — Configure waves with{" "}
                  <strong>{saleMethods.find(s => s.code === strategyHighlight)?.label ?? strategyHighlight}</strong>{" "}
                  as the sale method. Edit each wave below and set Sale Method accordingly.
                </span>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Waves", value: String(waves.length), color: "#41afeb" },
              { label: "Complete", value: String(completedCount), color: "#16a34a" },
              { label: "Active Wave", value: activeWave?.name ?? "—", color: "#7c3aed", small: true },
              { label: "Total Minted", value: `${totalSold.toLocaleString()} / ${totalNfts.toLocaleString()}`, color: "#24315f", small: true },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm" style={{ border: "1px solid #e5e7eb" }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#9bafc5" }}>{s.label}</p>
                <p className={`font-bold ${s.small ? "text-sm" : "text-2xl"}`} style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {error && <ErrBanner msg={error} onDismiss={() => setError(null)} />}
          {revealErr && <ErrBanner msg={revealErr} onDismiss={() => setRevealErr(null)} />}

          {/* Collection Reveal Progress */}
          {revealWaves.length > 0 && (
            <WaveProgressStepper revealWaves={revealWaves} stateMeta={STATE_META} />
          )}

          {/* Ready-to-reveal alert */}
          {readyCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.3)" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(217,119,6,0.15)" }}>
                <svg className="w-4 h-4" style={{ color: "#d97706" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#d97706" }}>
                  {readyCount} wave{readyCount > 1 ? "s" : ""} ready to reveal
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#92400e" }}>
                  Reveal date has passed. Find the wave below and click &quot;Reveal Now&quot;.
                </p>
              </div>
            </div>
          )}

          {/* Next upcoming action */}
          {!readyCount && nextAction && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: "rgba(65,175,235,0.06)", border: "1px solid rgba(65,175,235,0.2)" }}>
              <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#41afeb" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm" style={{ color: "#374151" }}>
                <strong style={{ color: "#41afeb" }}>Next: </strong>
                {nextAction.label} on {fmtFull(new Date(nextAction.dt).toISOString())}
              </span>
            </div>
          )}

          {/* Waves Table */}
          <WavesTable
            waves={waves}
            loading={loading}
            wavePage={wavePage}
            setWavePage={setWavePage}
            saleMethods={saleMethods}
            onManage={openManage}
            onReveal={setRevealWave}
            onTreasuryMove={setTreasuryMoveWave}
            onSetRevealDate={(w, ws) => {
              setScheduleEditWave(ws);
              setScheduleEditDate(w.revealScheduledAt ? toLocalDateTimeInput(new Date(w.revealScheduledAt)) : "");
              setScheduleEditErr(null);
            }}
            highlightRef={highlightRef}
            strategyHighlight={strategyHighlight}
            WAVES_PER_PAGE={WAVES_PER_PAGE}
          />
        </>
      )}

      {activeTab === "collaborations" && <CollaborationsTab />}

      {/* Reveal Date Editor Modal */}
      {scheduleEditWave && (
        <RevealScheduleEditModal
          wave={scheduleEditWave}
          date={scheduleEditDate}
          onDateChange={setScheduleEditDate}
          onSave={saveRevealDate}
          onClose={() => setScheduleEditWave(null)}
          saving={scheduleEditSaving}
          error={scheduleEditErr}
        />
      )}

      {revealWave && (
        <RevealModal
          wave={revealWave}
          collectionId={collectionId}
          onClose={() => setRevealWave(null)}
          onSuccess={(txHash) => handleRevealSuccess(txHash, revealWave.wave_number)}
        />
      )}
      {revealSuccessData && (
        <TxSuccessModal
          title={`Wave ${revealSuccessData.waveNum} Revealed!`}
          message="The reveal transaction was submitted on-chain. Buyers can now see their NFT artwork."
          txHash={revealSuccessData.txHash}
          onClose={() => setRevealSuccessData(null)}
        />
      )}


      {/* Treasury Move Modal */}
      {treasuryMoveWave && (
        <TreasuryMoveModal
          wave={treasuryMoveWave}
          collectionId={collectionId}
          onClose={() => setTreasuryMoveWave(null)}
          onSuccess={(txHash) => {
            setTreasuryMoveWave(null);
            setTreasurySuccessData({ txHash, waveNum: treasuryMoveWave.waveNumber });
            loadWaves();
          }}
        />
      )}
      {treasurySuccessData && (
        <TxSuccessModal
          title={`Wave ${treasurySuccessData.waveNum} Transferred!`}
          message={`Unsold NFTs from Wave ${treasurySuccessData.waveNum} have been minted to the treasury wallet.`}
          txHash={treasurySuccessData.txHash}
          onClose={() => setTreasurySuccessData(null)}
        />
      )}

      {/* Manage Modal */}
      {editWave && (
        <WaveManageModal
          wave={editWave}
          onClose={closeManage}
          maximized={manageMaximized}
          onMaximize={() => setManageMaximized(m => !m)}
          form={form}
          setForm={setForm}
          saving={saving}
          saveError={saveError}
          onSave={handleSave}
          chainOnChain={chainOnChain}
          chainLoading={chainLoading}
          chainSaving={chainSaving}
          chainError={chainError}
          setChainError={setChainError}
          chainTx={chainTx}
          chainPrice={chainPrice}
          setChainPrice={setChainPrice}
          onSetScheduleOnChain={handleSetScheduleOnChain}
          onSetPriceOnChain={handleSetPriceOnChain}
          purchaseLimitInput={purchaseLimitInput}
          setPurchaseLimitInput={setPurchaseLimitInput}
          onSetPurchaseLimitOnChain={handleSetPurchaseLimitOnChain}
        />
      )}

    </div>
  );
}


