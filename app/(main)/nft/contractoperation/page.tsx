"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useInterval } from "@/lib/useInterval";
import { ErrBanner, TxBanner } from "@/components/nft/Banner";
import MintOperationsTab, { type OnChainInfo, type CollectionConfig } from "@/components/nft/tabs/MintOperationsTab";
import CollectionControlsTab, { type ContractEvent }                   from "@/components/nft/tabs/CollectionControlsTab";
import RoyaltyTab    from "@/components/nft/tabs/RoyaltyTab";
import MembershipTab from "@/components/nft/tabs/MembershipTab";
import AdvancedTab   from "@/components/nft/tabs/AdvancedTab";
import WhitelistTab  from "@/components/nft/tabs/WhitelistTab";

const TABS: { key: string; label: string }[] = [
  { key: "Mint Operations",       label: "Mint Operations" },
  { key: "Collection & Controls", label: "Collection & Controls" },
  { key: "Whitelist",             label: "Whitelist" },
  { key: "Royalty",               label: "Royalty" },
  { key: "Membership",            label: "Membership" },
  { key: "Advanced",              label: "Advanced" },
];
type Tab = "Mint Operations" | "Collection & Controls" | "Whitelist" | "Royalty" | "Membership" | "Advanced";

interface CollectionOption { id: string; name: string; }

export default function ContractOperationPage() {
  const [tab, setTab] = useState<Tab>("Mint Operations");

  const [collections,  setCollections]  = useState<CollectionOption[]>([]);
  const [collectionId, setCollectionId] = useState<string>("");

  const [config,      setConfig]      = useState<CollectionConfig | null>(null);
  const [onChain,     setOnChain]     = useState<OnChainInfo | null>(null);
  const [events,      setEvents]      = useState<ContractEvent[]>([]);

  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  const [watchAlert,    setWatchAlert]    = useState<string | null>(null);
  const [watchUpdated,  setWatchUpdated]  = useState<Date | null>(null);
  const prevPhaseRef   = useRef<number | null>(null);
  const prevMintedRef  = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/master", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setCollections(d.collections ?? []);
        if (!collectionId && d.collections?.length) setCollectionId(d.collections[0].id);
        if (!d.collections?.length) setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!collectionId) return;
    setLoading(true); setError(null);
    try {
      const [colData, evData] = await Promise.all([
        fetch(`/api/nft-sell/collection?collection_id=${collectionId}`,               { credentials: "include" }).then(r => r.json()),
        fetch(`/api/nft-sell/collection/events?limit=20&collection_id=${collectionId}`, { credentials: "include" }).then(r => r.json()),
      ]);
      setConfig(colData.config ?? null);
      setOnChain(colData.onChain ?? null);
      setEvents(evData.events ?? []);
    } catch {
      setError("Failed to load collection data.");
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => { load(); }, [load]);

  const silentPoll = useCallback(async () => {
    if (!collectionId) return;
    try {
      const res = await fetch(`/api/nft-sell/collection?collection_id=${collectionId}`, { credentials: "include" });
      if (!res.ok) return;
      const d = await res.json();
      setWatchUpdated(new Date());
      const oc: OnChainInfo | null = d.onChain ?? null;
      if (!oc) return;
      if (prevPhaseRef.current !== null && oc.currentPhase !== prevPhaseRef.current) {
        const phaseLabel = (p: number) => ["Free Mint", "Paid Mint"][p] ?? `Phase ${p}`;
        setWatchAlert(`Contract state changed: ${phaseLabel(prevPhaseRef.current)} → ${phaseLabel(oc.currentPhase)}`);
        setOnChain(oc);
      }
      if (prevMintedRef.current !== null && oc.totalMinted !== prevMintedRef.current) {
        setWatchAlert(`New mints detected: ${prevMintedRef.current} → ${oc.totalMinted}`);
        setOnChain(oc);
      }
      prevPhaseRef.current  = oc.currentPhase;
      prevMintedRef.current = oc.totalMinted;
    } catch { }
  }, [collectionId]);

  useInterval(silentPoll, 60_000);

  if (loading) return (
    <div className="flex items-center justify-center h-64" style={{ color: "#9bafc5" }}>
      <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Loading…
    </div>
  );

  return (
    <div className="flex flex-col h-full">

      <div className="flex-shrink-0 px-5 pt-5 pb-0 space-y-4" style={{ background: "#f0f2f7" }}>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold" style={{ color: "#24315f" }}>Contract Operations</h1>
            <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
              BearthNFT · Phase control · access control · reveal · emergency
            </p>
          </div>
          <button onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ border: "1px solid #e5e7eb", color: "#6b7280", background: "white" }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {watchAlert && (
          <div className="flex items-center justify-between px-4 py-2 rounded-xl text-sm"
            style={{ background: "rgba(65,175,235,0.08)", border: "1px solid rgba(65,175,235,0.25)", color: "#2e9fd8" }}>
            <span>⟳ {watchAlert}</span>
            <button onClick={() => setWatchAlert(null)} className="ml-4 text-xs opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {watchUpdated && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "#9bafc5" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            Live · last checked {watchUpdated.toLocaleTimeString()}
          </div>
        )}

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
              Every action on this page acts only on the selected collection&apos;s own contract.
            </span>
          </div>
        )}

        {error && <ErrBanner msg={error} />}

        <div className="flex gap-1 border-b flex-wrap" style={{ borderColor: "#e5e7eb" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key as Tab)}
              className="px-4 py-2 text-xs font-semibold rounded-t-lg -mb-px transition-colors"
              style={tab === t.key
                ? { background: "white", color: "#41afeb", border: "1px solid #e5e7eb", borderBottom: "1px solid white" }
                : { color: "#9bafc5", border: "1px solid transparent" }}>
              <span className="flex items-center gap-1.5">
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {tab === "Mint Operations"      && <MintOperationsTab    collectionId={collectionId} onChain={onChain} config={config} onRefresh={load} />}
        {tab === "Collection & Controls" && <CollectionControlsTab collectionId={collectionId} onChain={onChain} config={config} events={events} onRefresh={load} />}
        {tab === "Whitelist"            && <WhitelistTab collectionId={collectionId} />}
        {tab === "Royalty"              && <RoyaltyTab collectionId={collectionId} />}
        {tab === "Membership"           && <MembershipTab collectionId={collectionId} />}
        {tab === "Advanced"             && <AdvancedTab collectionId={collectionId} />}
      </div>
    </div>
  );
}
