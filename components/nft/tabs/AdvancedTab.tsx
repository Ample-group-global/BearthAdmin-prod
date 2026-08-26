"use client";

import { useState } from "react";
import { ETH_ADDRESS_RE } from "@/lib/nft-constants";

interface TxState { pending: boolean; hash: string; error: string; success: string; }
const TX0: TxState = { pending: false, hash: "", error: "", success: "" };

interface TokenMetadata {
  name?: string;
  description?: string;
  image?: string;
  attributes?: { trait_type: string; value: string | number }[];
}

function TxStatus({ tx, onClear }: { tx: TxState; onClear: () => void }) {
  if (!tx.pending && !tx.hash && !tx.error && !tx.success) return null;
  return (
    <div className={`mt-3 p-3 rounded-lg text-sm flex items-start gap-2.5 ${tx.error ? "bg-red-50 border border-red-200 text-red-700" : tx.success ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-blue-50 border border-blue-200 text-blue-700"}`}>
      {tx.pending && <span className="w-4 h-4 mt-0.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        {tx.pending && <p className="font-medium">Transaction pending…</p>}
        {tx.hash && <p className="font-mono text-xs break-all">TX: {tx.hash}</p>}
        {tx.error && <p>{tx.error}</p>}
        {tx.success && <p className="font-medium">{tx.success}</p>}
      </div>
      {(tx.error || tx.success) && (
        <button onClick={onClear} className="flex-shrink-0 text-xs opacity-60 hover:opacity-100">✕</button>
      )}
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border p-4 space-y-3" style={{ borderColor: "#e5e7eb" }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "#24315f" }}>{title}</p>
        {note && <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>{note}</p>}
      </div>
      {children}
    </div>
  );
}

function Inp({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: "#6b7280" }}>{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400";
const btnCls = (danger?: boolean, disabled?: boolean) =>
  `px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${danger ? "bg-red-600 hover:bg-red-700 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`;

export default function AdvancedTab() {
  const [emergencyTokenId, setEmergencyTokenId] = useState("");
  const [emergencyFrom, setEmergencyFrom]       = useState("");
  const [emergencyTo, setEmergencyTo]           = useState("");
  const [emergencyReason, setEmergencyReason]   = useState("");
  const [checkTokenId, setCheckTokenId]         = useState("");
  const [checkMeta, setCheckMeta]               = useState<TokenMetadata | null>(null);
  const [checkUri, setCheckUri]                 = useState<string | null>(null);
  const [checkLoading, setCheckLoading]         = useState(false);
  const [checkError, setCheckError]             = useState("");

  const [txEmergency, setTxEmergency] = useState(TX0);

  const handleEmergencyTransfer = async () => {
    const tid = Number(emergencyTokenId);
    if (!tid || tid < 1) { setTxEmergency({ ...TX0, error: "Valid token ID required." }); return; }
    if (!ETH_ADDRESS_RE.test(emergencyFrom.trim())) { setTxEmergency({ ...TX0, error: "Valid 'from' address required." }); return; }
    if (!ETH_ADDRESS_RE.test(emergencyTo.trim())) { setTxEmergency({ ...TX0, error: "Valid 'to' address required." }); return; }
    if (!emergencyReason.trim()) { setTxEmergency({ ...TX0, error: "Reason is required." }); return; }

    setTxEmergency({ pending: true, hash: "", error: "", success: "" });
    try {
      const res = await fetch("/api/nft-chain/emergency-transfer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: tid,
          from: emergencyFrom.trim().toLowerCase(),
          to: emergencyTo.trim().toLowerCase(),
          reason: emergencyReason.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setTxEmergency({ ...TX0, error: d.error ?? "Emergency transfer failed" }); return; }
      setTxEmergency({ pending: false, hash: d.txHash ?? "", error: "", success: "Emergency transfer executed" });
    } catch (e: unknown) {
      setTxEmergency({ ...TX0, error: e instanceof Error ? e.message : "Network error" });
    }
  };

  const handleCheckMetadata = async () => {
    if (!checkTokenId) return;
    setCheckLoading(true); setCheckError(""); setCheckMeta(null); setCheckUri(null);
    try {
      const res = await fetch(`/api/nft-chain/metadata/${checkTokenId}`, { credentials: "include" });
      const d = await res.json();
      if (!res.ok) { setCheckError(d.error ?? `HTTP ${res.status}`); return; }
      setCheckUri(d.uri ?? null);
      if (d.metadata) {
        setCheckMeta(d.metadata as TokenMetadata);
      } else {
        setCheckError("tokenURI resolved but IPFS metadata could not be fetched (check IPFS availability).");
      }
    } catch (e: unknown) { setCheckError(e instanceof Error ? e.message : "Network error"); }
    finally { setCheckLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl text-xs flex items-center gap-2" style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}>
        These operations are potentially irreversible. Use only when necessary.
      </div>

      <Card title="Emergency Transfer" note="Force-transfer a specific NFT. Requires EMERGENCY_ROLE on the contract. Signed server-side.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Inp label="Token ID">
            <input type="number" value={emergencyTokenId} onChange={e => setEmergencyTokenId(e.target.value)}
              placeholder="e.g. 42" className={inputCls} style={{ borderColor: "#e5e7eb" }} />
          </Inp>
          <div />
          <Inp label="From Address">
            <input value={emergencyFrom} onChange={e => setEmergencyFrom(e.target.value)}
              placeholder="0x..." className={inputCls} style={{ borderColor: "#e5e7eb" }} />
          </Inp>
          <Inp label="To Address">
            <input value={emergencyTo} onChange={e => setEmergencyTo(e.target.value)}
              placeholder="0x..." className={inputCls} style={{ borderColor: "#e5e7eb" }} />
          </Inp>
          <div className="sm:col-span-2">
            <Inp label="Reason (logged on-chain)">
              <input value={emergencyReason} onChange={e => setEmergencyReason(e.target.value)}
                placeholder="e.g. Lost wallet recovery — user verified via KYC"
                className={inputCls} style={{ borderColor: "#e5e7eb", fontFamily: "inherit" }} />
            </Inp>
          </div>
        </div>
        <button
          onClick={handleEmergencyTransfer}
          disabled={txEmergency.pending || !emergencyTokenId || !emergencyFrom.trim() || !emergencyTo.trim()}
          className={btnCls(true, txEmergency.pending)}>
          {txEmergency.pending ? "Sending…" : "Execute Emergency Transfer"}
        </button>
        <TxStatus tx={txEmergency} onClear={() => setTxEmergency(TX0)} />
      </Card>

      <Card
        title="On-Chain Metadata Verifier"
        note="Reads tokenURI directly from the live contract and fetches the IPFS JSON — use this to detect DB ↔ chain desync.">
        <div className="px-3 py-2.5 rounded-lg text-xs flex items-start gap-2"
          style={{ background: "#f0f9ff", border: "1px solid #bae6fd", color: "#0369a1" }}>
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            This reads from the <strong>contract</strong>, not the database. NFT Lists reads from the DB — they can diverge
            if a reveal was not pushed on-chain, if the IPFS file is missing, or if a token was minted via adminMint() (tokenWave=0 bug).
          </span>
        </div>
        <Inp label="Token ID">
          <div className="flex gap-2">
            <input value={checkTokenId} onChange={e => { setCheckTokenId(e.target.value); setCheckMeta(null); setCheckError(""); setCheckUri(null); }}
              type="number" min="1" placeholder="e.g. 42"
              className="w-40 px-3 py-1.5 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
              style={{ borderColor: "#e5e7eb" }} />
            <button
              onClick={handleCheckMetadata}
              disabled={checkLoading || !checkTokenId}
              className={btnCls(false, checkLoading || !checkTokenId) + " whitespace-nowrap"}>
              {checkLoading ? "Fetching…" : "Verify On-Chain"}
            </button>
          </div>
        </Inp>
        {checkUri && <p className="text-xs font-mono break-all" style={{ color: "#6b7280" }}>URI: {checkUri}</p>}
        {checkError && <p className="text-xs text-red-600">{checkError}</p>}
        {checkMeta && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#9bafc5" }}>Raw IPFS Metadata</p>
            <pre className="text-xs rounded-lg p-3 overflow-auto max-h-64" style={{ background: "#f8fafc", border: "1px solid #e5e7eb", color: "#374151" }}>
              {JSON.stringify(checkMeta, null, 2)}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}
