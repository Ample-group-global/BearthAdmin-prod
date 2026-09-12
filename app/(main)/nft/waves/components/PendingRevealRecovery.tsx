"use client";

import { useEffect, useState } from "react";

interface RevealStatus {
  isPending: boolean;
  requestedAt: string | null;
  readyAt: string | null;
  isStale: boolean;
  staleRequestTimeoutSeconds: number | null;
}

function formatCountdown(readyAt: string): string {
  const ms = new Date(readyAt).getTime() - Date.now();
  if (ms <= 0) return "now";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// A reveal's VRF request can be accepted on-chain but never fulfilled
// (Chainlink subscription issue, etc.) -- the contract then blocks every
// further "Reveal Now" attempt with the same failure until the request is
// formally cancelled, which requires a mandatory 24h safety wait. Without
// this, the team just sees the same confusing error on every retry with no
// indication of what's actually wrong or what to do about it.
export default function PendingRevealRecovery({
  waveNumber,
  collectionId,
  onRecovered,
}: {
  waveNumber: number;
  collectionId: string;
  onRecovered: () => void;
}) {
  const [status, setStatus] = useState<RevealStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/nft-sell/waves/${waveNumber}/reveal-status?collection_id=${collectionId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setStatus(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [waveNumber, collectionId]);

  // Re-render every 30s so the countdown stays live without a page refresh.
  useEffect(() => {
    if (!status?.isPending || status.isStale) return;
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [status]);

  if (!status?.isPending) return null;

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/nft-sell/waves/${waveNumber}/cancel-stale-reveal?collection_id=${collectionId}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel");
      setStatus(null);
      onRecovered();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 mt-1 px-2 py-1.5 rounded-lg text-[10px]"
      style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)", maxWidth: 220 }}>
      <span className="font-bold" style={{ color: "#dc2626" }}>⚠ Reveal request stuck</span>
      <span style={{ color: "#7f1d1d" }}>
        Sent to Chainlink VRF but no response yet. Retrying "Reveal Now" will keep failing until this is cancelled.
      </span>
      {status.isStale ? (
        <>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="mt-0.5 inline-flex items-center justify-center px-2 py-1 rounded-md font-bold text-white disabled:opacity-50"
            style={{ background: "#dc2626" }}>
            {cancelling ? "Cancelling…" : "Cancel & Retry"}
          </button>
          {error && <span style={{ color: "#dc2626" }}>{error}</span>}
        </>
      ) : (
        <span style={{ color: "#7f1d1d" }}>
          Cancellable in {status.readyAt ? formatCountdown(status.readyAt) : "…"} (24h safety window, protects against
          cancelling a request that might still complete).
        </span>
      )}
    </div>
  );
}
