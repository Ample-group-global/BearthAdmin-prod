"use client";

import { useState, useEffect, useCallback } from "react";
import { SectionCard } from "@/components/nft/SectionCard";
import { TxBanner, ErrBanner } from "@/components/nft/Banner";
import { inputStyle, thStyle, tdStyle } from "@/components/nft/styles";
import { ETH_ADDRESS_RE } from "@/lib/nft-constants";
import type { OnChainInfo, CollectionConfig } from "./MintOperationsTab";

interface TimelockStatus {
  operationId: string;
  purpose: string;
  newValue: string | null;
  eta: string;
  ready: boolean;
  done: boolean;
  scheduledTxHash: string;
  executedTxHash: string | null;
  executedAt: string | null;
}

export interface ContractEvent {
  id: string;
  event_name: string;
  tx_hash: string;
  block_number: number;
  processed_at: string;
}

interface Props {
  collectionId: string;
  onChain: OnChainInfo | null;
  config:  CollectionConfig | null;
  events:  ContractEvent[];
  onRefresh: () => Promise<void>;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest mb-3"
      style={{ color: "#9bafc5" }}>{children}</p>
  );
}

export default function CollectionControlsTab({ collectionId, onChain, config, events, onRefresh }: Props) {
  const [saving,      setSaving]      = useState<string | null>(null);
  const [tx,          setTx]          = useState<string | null>(null);
  const [opError,     setOpError]     = useState<string | null>(null);
  const [blindBoxUri, setBlindBoxUri] = useState(config?.blind_box_uri ?? "");
  const [treasury,    setTreasury]    = useState(config?.treasury_wallet ?? "");
  const [blockWallet, setBlockWallet] = useState("");
  const [timelock,    setTimelock]    = useState<TimelockStatus | null>(null);
  const [timelockLoading, setTimelockLoading] = useState(true);

  const loadTimelockStatus = useCallback(() => {
    if (!collectionId) return;
    setTimelockLoading(true);
    fetch(`/api/nft-sell/collection/treasury/timelock-status?collection_id=${collectionId}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => setTimelock(d.status && !d.status.done ? d.status : null))
      .catch(() => {})
      .finally(() => setTimelockLoading(false));
  }, [collectionId]);

  useEffect(() => { loadTimelockStatus(); }, [loadTimelockStatus]);

  const doOp = async (opName: string, fn: () => Promise<Response>) => {
    setSaving(opName); setOpError(null); setTx(null);
    try {
      const res = await fn();
      const d   = await res.json();
      if (!res.ok) { setOpError(d.error ?? `${opName} failed.`); return; }
      if (d.txHash) setTx(d.txHash);
      await onRefresh();
    } catch { setOpError("Network error."); }
    finally { setSaving(null); }
  };

  const handleSetBlindBoxUri = () => {
    if (!blindBoxUri.startsWith("ipfs://")) { setOpError("Blind box URI must start with ipfs://"); return; }
    doOp("blind-box", () => fetch("/api/nft-sell/collection/blind-box-uri", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri: blindBoxUri, collectionId }),
    }));
  };

  const handleScheduleTreasury = () => {
    if (!ETH_ADDRESS_RE.test(treasury)) { setOpError("Treasury must be a valid Ethereum address (0x + 40 hex)."); return; }
    setSaving("treasury"); setOpError(null); setTx(null);
    fetch("/api/nft-sell/collection/treasury", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: treasury, collectionId }),
    }).then(async res => {
      const d = await res.json();
      if (!res.ok) { setOpError(d.error ?? "Schedule failed."); return; }
      setTx(d.scheduledTxHash);
      loadTimelockStatus();
    }).catch(() => setOpError("Network error."))
      .finally(() => setSaving(null));
  };

  const handleExecuteTreasury = () => {
    if (!timelock) return;
    setSaving("treasury-execute"); setOpError(null); setTx(null);
    fetch("/api/nft-sell/collection/treasury/execute", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationId: timelock.operationId, collectionId }),
    }).then(async res => {
      const d = await res.json();
      if (!res.ok) { setOpError(d.error ?? "Execute failed."); return; }
      setTx(d.txHash);
      loadTimelockStatus();
      await onRefresh();
    }).catch(() => setOpError("Network error."))
      .finally(() => setSaving(null));
  };

  const handleWithdraw = () => {
    if (!window.confirm("Withdraw all ETH balance to the treasury wallet? This is immediate and irreversible.")) return;
    doOp("withdraw", () => fetch(`/api/nft-sell/collection/withdraw?collection_id=${collectionId}`, { method: "POST", credentials: "include" }));
  };

  const handlePause = (pause: boolean) => {
    const msg = pause
      ? "Pause the contract? All minting and transfers will stop immediately."
      : "Unpause the contract? Minting and transfers will resume.";
    if (!window.confirm(msg)) return;
    doOp(pause ? "pause" : "unpause", () => fetch(
      `/api/nft-sell/collection/${pause ? "pause" : "unpause"}?collection_id=${collectionId}`,
      { method: "POST", credentials: "include" }
    ));
  };

  const handleBlockWallet = (blocked: boolean) => {
    if (!ETH_ADDRESS_RE.test(blockWallet)) { setOpError("Enter a valid Ethereum address (0x + 40 hex)."); return; }
    const msg = blocked
      ? `Block ${blockWallet} from minting and transfers?`
      : `Unblock ${blockWallet}, restoring normal mint/transfer access?`;
    if (!window.confirm(msg)) return;
    doOp(blocked ? "block" : "unblock", () => fetch("/api/nft-sell/collection/block-account", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: blockWallet, blocked, collectionId }),
    }));
  };

  return (
    <div className="space-y-7">
      {tx      && <TxBanner  txHash={tx}   onDismiss={() => setTx(null)} />}
      {opError && <ErrBanner msg={opError}  onDismiss={() => setOpError(null)} />}

      {/* ─── CONTENT ────────────────────────────────────── */}
      <section>
        <GroupLabel>Content</GroupLabel>
        <div className="space-y-4">

          {/* Blind Box URI */}
          <SectionCard
            title="Blind Box URI"
            subtitle="Placeholder metadata shown to holders before the collection is revealed. All tokens show this URI while blind.">
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#9bafc5" }}>
                  Blind Box Base URI (IPFS)
                </label>
                <input type="text" value={blindBoxUri} onChange={e => setBlindBoxUri(e.target.value)}
                  style={inputStyle} placeholder="ipfs://Qm…" />
                <p className="text-xs mt-1" style={{ color: "#9bafc5" }}>
                  Current: {config?.blind_box_uri
                    ? <span className="font-mono">{config.blind_box_uri}</span>
                    : "Not set"}
                </p>
              </div>
              <div className="flex justify-end">
                <button onClick={handleSetBlindBoxUri}
                  disabled={saving === "blind-box" || !blindBoxUri}
                  className="px-5 py-2.5 text-xs font-bold text-white rounded-xl"
                  style={{ background: saving === "blind-box" || !blindBoxUri ? "#9bafc5" : "#41afeb" }}>
                  {saving === "blind-box" ? "Submitting tx…" : "⛓ Set Blind Box URI On-Chain"}
                </button>
              </div>
            </div>
          </SectionCard>

          {/* Treasury Wallet — gated behind a 48h Timelock, two-step flow */}
          <SectionCard title="Treasury Wallet" subtitle="ETH from mint sales is withdrawable to this address. Changing it goes through BearthTimelock's 48-hour governance delay — schedule now, execute once the delay passes.">
            <div className="space-y-3">
              <p className="text-xs" style={{ color: "#9bafc5" }}>
                Current:{" "}
                {config?.treasury_wallet
                  ? <span className="font-mono">{config.treasury_wallet}</span>
                  : "Not set"}
              </p>

              {!timelockLoading && timelock && (
                <div className="p-3 rounded-xl text-xs space-y-2"
                  style={{ background: timelock.ready ? "rgba(22,163,74,0.06)" : "rgba(217,119,6,0.06)", border: `1px solid ${timelock.ready ? "rgba(22,163,74,0.25)" : "#fde68a"}` }}>
                  <p className="font-semibold" style={{ color: timelock.ready ? "#16a34a" : "#d97706" }}>
                    {timelock.ready ? "Ready to execute" : "Pending — Timelock delay in progress"}
                  </p>
                  <p style={{ color: "#6b7280" }}>
                    New wallet: <span className="font-mono">{timelock.newValue}</span>
                  </p>
                  <p style={{ color: "#6b7280" }}>
                    {timelock.ready ? "Executable now" : `Executable at ${new Date(timelock.eta).toLocaleString()}`}
                  </p>
                  <button onClick={handleExecuteTreasury} disabled={!timelock.ready || saving === "treasury-execute"}
                    className="px-4 py-2 text-xs font-bold text-white rounded-xl"
                    style={{ background: !timelock.ready || saving === "treasury-execute" ? "#9bafc5" : "#16a34a" }}>
                    {saving === "treasury-execute" ? "Executing…" : "⛓ Execute Now"}
                  </button>
                </div>
              )}

              {!timelockLoading && !timelock && (
                <div className="flex gap-2">
                  <input type="text" value={treasury} onChange={e => setTreasury(e.target.value)}
                    style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }} placeholder="0x…" />
                  <button onClick={handleScheduleTreasury} disabled={saving === "treasury" || !treasury}
                    className="px-4 py-2 text-xs font-bold text-white rounded-xl flex-shrink-0"
                    style={{ background: saving === "treasury" || !treasury ? "#9bafc5" : "#41afeb" }}>
                    {saving === "treasury" ? "Scheduling…" : "⛓ Schedule Change (48h)"}
                  </button>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </section>

      {/* ─── EMERGENCY CONTROLS ─────────────────────────── */}
      <section>
        <GroupLabel>Emergency Controls</GroupLabel>
        <div className="bg-white rounded-2xl shadow-sm p-5" style={{ border: "1px solid #fecaca" }}>
          <div className="mb-4">
            <p className="text-sm font-bold" style={{ color: "#dc2626" }}>Contract Safety Controls</p>
            <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
              Pause stops all mints and transfers. Withdraw pulls the ETH balance to the treasury wallet. A confirmation prompt will appear before each action.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => handlePause(true)} disabled={saving === "pause"}
              className="px-4 py-2 text-xs font-bold rounded-xl"
              style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid #fecaca" }}>
              {saving === "pause" ? "Pausing…" : "⛓ Pause Contract"}
            </button>
            <button onClick={() => handlePause(false)} disabled={saving === "unpause"}
              className="px-4 py-2 text-xs font-bold rounded-xl"
              style={{ background: "rgba(22,163,74,0.08)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.3)" }}>
              {saving === "unpause" ? "Unpausing…" : "⛓ Unpause Contract"}
            </button>
            <button onClick={handleWithdraw} disabled={saving === "withdraw"}
              className="px-4 py-2 text-xs font-bold rounded-xl"
              style={{ background: "rgba(65,175,235,0.08)", color: "#41afeb", border: "1px solid rgba(65,175,235,0.3)" }}>
              {saving === "withdraw" ? "Withdrawing…" : "⛓ Withdraw ETH to Treasury"}
            </button>
          </div>

          {/* Block / Unblock Wallet — pre-mainnet checklist item, contractBlockAccount()
              already existed in the service layer with no route/UI anywhere until now. */}
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid #fecaca" }}>
            <p className="text-xs font-semibold mb-2" style={{ color: "#dc2626" }}>Block / Unblock Wallet</p>
            <div className="flex flex-wrap gap-2">
              <input type="text" value={blockWallet} onChange={e => setBlockWallet(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 260, fontFamily: "monospace" }} placeholder="0x…" />
              <button onClick={() => handleBlockWallet(true)} disabled={saving === "block" || !blockWallet}
                className="px-4 py-2 text-xs font-bold rounded-xl"
                style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid #fecaca" }}>
                {saving === "block" ? "Blocking…" : "⛓ Block"}
              </button>
              <button onClick={() => handleBlockWallet(false)} disabled={saving === "unblock" || !blockWallet}
                className="px-4 py-2 text-xs font-bold rounded-xl"
                style={{ background: "rgba(22,163,74,0.08)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.3)" }}>
                {saving === "unblock" ? "Unblocking…" : "⛓ Unblock"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ─── AUDIT LOG ──────────────────────────────────── */}
      <section>
        <GroupLabel>Audit Log</GroupLabel>
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid #e5e7eb" }}>
          <div className="px-5 py-4" style={{ borderBottom: "1px solid #e5e7eb" }}>
            <h2 className="text-sm font-bold" style={{ color: "#24315f" }}>Contract Events</h2>
            <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
              Immutable on-chain event history — synced from blockchain
            </p>
          </div>
          {events.length === 0 ? (
            <div className="py-12 text-center text-sm" style={{ color: "#9bafc5" }}>No events recorded yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-max">
                <thead>
                  <tr>
                    {["Event", "Tx Hash", "Block", "Time"].map(h => (
                      <th key={h} style={{ ...thStyle, textAlign: "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev, i) => (
                    <tr key={ev.id} style={{ borderTop: i === 0 ? "none" : "1px solid #f3f4f6" }}>
                      <td style={tdStyle}>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ background: "rgba(65,175,235,0.1)", color: "#41afeb" }}>
                          {ev.event_name}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span className="font-mono" style={{ color: "#6b7280" }}>
                          {ev.tx_hash.slice(0, 10)}…{ev.tx_hash.slice(-6)}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: "#374151" }}>{ev.block_number.toLocaleString()}</td>
                      <td style={{ ...tdStyle, color: "#9bafc5" }}>
                        {new Date(ev.processed_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
