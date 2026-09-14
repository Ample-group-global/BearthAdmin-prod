"use client";

import { useEffect, useState } from "react";
import { TxBanner, ErrBanner } from "@/components/nft/Banner";
import { Toggle } from "@/components/nft/Toggle";
import { labelStyle, inputStyle } from "@/components/nft/styles";
import { ETH_ADDRESS_RE } from "@/lib/nft-constants";

interface RoyaltyConfig {
  royalty_pct_bps: number;
  receiver_address: string;
  enforce_royalty: boolean;
  last_tx_hash: string | null;
  synced_at: string | null;
}

export default function RoyaltyTab({ collectionId }: { collectionId: string }) {
  const [royalty, setRoyalty]     = useState<RoyaltyConfig | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error,   setError]       = useState<string | null>(null);

  const [feePct,        setFeePct]        = useState("");
  const [receiver,      setReceiver]      = useState("");
  const [enforced,      setEnforced]      = useState(true);
  const [savingRoyalty, setSavingRoyalty] = useState(false);
  const [royaltyError,  setRoyaltyError]  = useState<string | null>(null);
  const [royaltyTx,     setRoyaltyTx]     = useState<string | null>(null);

  const [validatorAddr,    setValidatorAddr]    = useState("");
  const [savingValidator,  setSavingValidator]  = useState(false);
  const [validatorError,   setValidatorError]   = useState<string | null>(null);
  const [validatorTx,      setValidatorTx]      = useState<string | null>(null);

  const load = () => {
    if (!collectionId) return;
    setLoading(true); setError(null);
    fetch(`/api/nft-sell/royalty?collection_id=${collectionId}`, { credentials: "include" }).then(r => r.json())
      .then((rData) => {
        const r: RoyaltyConfig = rData.royalty ?? null;
        setRoyalty(r);
        if (r) {
          setFeePct(String((r.royalty_pct_bps / 100).toFixed(2)));
          setReceiver(r.receiver_address ?? "");
          setEnforced(r.enforce_royalty ?? true);
        }
        setLoading(false);
      }).catch(() => { setError("Failed to load royalty settings."); setLoading(false); });
  };

  useEffect(() => { load(); }, [collectionId]);

  const handleSaveRoyalty = async () => {
    setSavingRoyalty(true); setRoyaltyError(null); setRoyaltyTx(null);
    const pctNum = parseFloat(feePct);
    if (isNaN(pctNum) || pctNum < 0 || pctNum > 10) {
      setRoyaltyError("Royalty must be 0–10%."); setSavingRoyalty(false); return;
    }
    if (!ETH_ADDRESS_RE.test(receiver)) {
      setRoyaltyError("Enter a valid Ethereum address (0x + 40 hex)."); setSavingRoyalty(false); return;
    }
    try {
      const res = await fetch("/api/nft-sell/royalty", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverAddress: receiver, feeBps: Math.round(pctNum * 100), collectionId }),
      });
      const d = await res.json();
      if (!res.ok) { setRoyaltyError(d.error ?? "Save failed."); return; }
      setRoyaltyTx(d.txHash);
      load();
    } catch { setRoyaltyError("Network error."); }
    finally { setSavingRoyalty(false); }
  };

  const handleToggleEnforcement = async (val: boolean) => {
    setEnforced(val);
    try {
      const res = await fetch("/api/nft-sell/royalty/enforcement", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforced: val, collectionId }),
      });
      const d = await res.json();
      if (!res.ok) { setRoyaltyError(d.error ?? "Failed to toggle."); setEnforced(!val); return; }
    } catch { setRoyaltyError("Network error."); setEnforced(!val); }
  };

  const handleSetTransferValidator = async () => {
    setSavingValidator(true); setValidatorError(null); setValidatorTx(null);
    if (!ETH_ADDRESS_RE.test(validatorAddr)) {
      setValidatorError("Enter a valid Ethereum address (0x + 40 hex)."); setSavingValidator(false); return;
    }
    try {
      const res = await fetch("/api/nft-sell/royalty/transfer-validator", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validatorAddress: validatorAddr, collectionId }),
      });
      const d = await res.json();
      if (!res.ok) { setValidatorError(d.error ?? "Failed to set validator."); return; }
      setValidatorTx(d.txHash);
    } catch { setValidatorError("Network error."); }
    finally { setSavingValidator(false); }
  };

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
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold" style={{ color: "#24315f" }}>Royalty & Marketplace Settings</h2>
        <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
          ERC2981 on-chain royalty + ERC721C transfer validator for enforcement
        </p>
      </div>

      {error && <ErrBanner msg={error} />}

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5" style={{ border: "1px solid #e5e7eb" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold" style={{ color: "#24315f" }}>ERC2981 Royalty</h2>
            <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
              OpenSea reads this automatically. Max 10%. Requires OPERATOR_ROLE.
            </p>
          </div>
          {royalty?.last_tx_hash && (
            <span className="text-xs font-mono px-2 py-1 rounded-lg" style={{ background: "#f0fdf4", color: "#16a34a" }}>
              Synced on-chain
            </span>
          )}
        </div>

        {royaltyTx    && <TxBanner  txHash={royaltyTx}  onDismiss={() => setRoyaltyTx(null)} />}
        {royaltyError && <ErrBanner msg={royaltyError}   onDismiss={() => setRoyaltyError(null)} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label style={labelStyle}>Royalty % (0–10%)</label>
            <div className="relative">
              <input type="number" step="0.01" min="0" max="10"
                value={feePct}
                onChange={e => setFeePct(e.target.value)}
                style={{ ...inputStyle, paddingRight: "36px" }}
                placeholder="5.00" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold"
                style={{ color: "#9bafc5" }}>%</span>
            </div>
            <p className="text-xs mt-1" style={{ color: "#9bafc5" }}>
              {feePct && !isNaN(parseFloat(feePct))
                ? `= ${Math.round(parseFloat(feePct) * 100)} basis points`
                : "Stored as basis points (500 = 5%)"}
            </p>
          </div>
          <div>
            <label style={labelStyle}>Receiver Wallet Address</label>
            <input type="text"
              value={receiver}
              onChange={e => setReceiver(e.target.value)}
              style={inputStyle}
              placeholder="0x..." />
            <p className="text-xs mt-1" style={{ color: "#9bafc5" }}>
              ETH sent here from secondary sales
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={handleSaveRoyalty} disabled={savingRoyalty}
            className="px-5 py-2.5 text-sm font-bold text-white rounded-xl transition-opacity"
            style={{ background: savingRoyalty ? "#9bafc5" : "#41afeb" }}>
            {savingRoyalty ? "Submitting tx…" : "⛓ Save Royalty On-Chain"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4" style={{ border: "1px solid #e5e7eb" }}>
        <div>
          <h2 className="text-sm font-bold" style={{ color: "#24315f" }}>Enforcement Status</h2>
          <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
            This flag is recorded in the database for reference. Actual on-chain enforcement is controlled by the Transfer Validator below.
          </p>
        </div>

        <div className="px-4 py-3 rounded-xl text-xs"
          style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#d97706" }}>
          <strong>DB only</strong> — toggling this does NOT submit a blockchain transaction. To enforce royalties on-chain, set the Transfer Validator address in the section below.
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl"
          style={{ background: enforced ? "rgba(65,175,235,0.06)" : "#f9fafb", border: "1px solid #e5e7eb" }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#24315f" }}>Royalty Enforcement (DB flag)</p>
            <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
              {enforced
                ? "Marked ON — remember to set the Transfer Validator for real on-chain enforcement"
                : "Marked OFF — transfers are not restricted by royalty rules"}
            </p>
          </div>
          <Toggle value={enforced} onChange={handleToggleEnforcement} />
        </div>

        {!enforced && (
          <div className="px-4 py-3 rounded-xl text-xs" style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#d97706" }}>
            Warning: When enforcement is OFF, buyers can bypass royalties by trading on unapproved platforms.
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4" style={{ border: "1px solid #e5e7eb" }}>
        <div>
          <h2 className="text-sm font-bold" style={{ color: "#24315f" }}>Transfer Validator (On-Chain Enforcement)</h2>
          <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
            ERC721C — sets the contract that validates every transfer. This is the actual on-chain royalty enforcement mechanism. Requires DEFAULT_ADMIN_ROLE.
          </p>
        </div>

        <div className="px-4 py-3 rounded-xl text-xs"
          style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.2)", color: "#7c3aed" }}>
          The validator contract allowlists which marketplace operator contracts may call transfers. Zero address disables enforcement and allows all transfers.
        </div>

        {validatorTx    && <TxBanner  txHash={validatorTx}  onDismiss={() => setValidatorTx(null)} />}
        {validatorError && <ErrBanner msg={validatorError}   onDismiss={() => setValidatorError(null)} />}

        <div className="flex gap-2">
          <input type="text" value={validatorAddr} onChange={e => setValidatorAddr(e.target.value)}
            style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }}
            placeholder="0x… (validator contract address, or 0x000…000 to disable)" />
          <button onClick={handleSetTransferValidator} disabled={savingValidator || !validatorAddr}
            className="px-4 py-2 text-xs font-bold text-white rounded-xl flex-shrink-0"
            style={{ background: savingValidator || !validatorAddr ? "#9bafc5" : "#7c3aed" }}>
            {savingValidator ? "Submitting tx…" : "⛓ Set On-Chain"}
          </button>
        </div>
      </div>

    </div>
  );
}
