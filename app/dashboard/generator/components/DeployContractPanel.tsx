"use client";

import { useEffect, useState } from "react";

type ContractInfo = {
  contractAddress: string | null;
  contractNetwork: "sepolia" | "mainnet" | null;
  contractDeployTxHash: string | null;
  contractDeployedAt: string | null;
};

const EXPLORER: Record<string, string> = {
  sepolia: "https://sepolia.etherscan.io/address/",
  mainnet: "https://etherscan.io/address/",
};

const DEFAULT_BLIND_BOX_URI = "ipfs://QmeSsy5oz4HvjGEDH71Rrv2axqf7ZgUKHJncHPQWwQnvKp";
const IPFS_GATEWAY = "https://amgbearth.myfilebase.com/ipfs/";

function toGatewayUrl(uri: string): string | null {
  if (!uri.startsWith("ipfs://")) return null;
  return IPFS_GATEWAY + uri.slice("ipfs://".length);
}

const fieldStyle = {
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 13,
  color: "#111827",
};

const buttonStyle = (disabled: boolean) => ({
  padding: "10px 20px",
  borderRadius: 8,
  border: "none",
  fontWeight: 700,
  fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer",
  background: disabled ? "#9ca3af" : "#6366f1",
  color: "#fff",
});

export default function DeployContractPanel({ collectionId }: { collectionId: string | null }) {
  const [info, setInfo] = useState<ContractInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [network, setNetwork] = useState<"sepolia" | "mainnet">("sepolia");
  const [blindBoxUri, setBlindBoxUri] = useState(DEFAULT_BLIND_BOX_URI);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [confirmMainnet, setConfirmMainnet] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uri = blindBoxUri.trim();
    const metaUrl = toGatewayUrl(uri);
    if (!metaUrl) { setPreviewImage(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(metaUrl)
        .then(r => r.ok ? r.json() : null)
        .then(meta => {
          if (cancelled) return;
          const imgUri = meta?.image as string | undefined;
          setPreviewImage(imgUri ? toGatewayUrl(imgUri) : null);
        })
        .catch(() => { if (!cancelled) setPreviewImage(null); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [blindBoxUri]);

  useEffect(() => {
    if (!collectionId) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/nft-gen/collections/${collectionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const c = data?.collection ?? data;
        if (c) {
          setInfo({
            contractAddress: c.contractAddress ?? null,
            contractNetwork: c.contractNetwork ?? null,
            contractDeployTxHash: c.contractDeployTxHash ?? null,
            contractDeployedAt: c.contractDeployedAt ?? null,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collectionId]);

  async function deploy() {
    if (!collectionId || !blindBoxUri.trim()) return;
    if (network === "mainnet" && !confirmMainnet) return;
    setDeploying(true);
    setError(null);
    try {
      const r = await fetch(`/api/nft-gen/collections/${collectionId}/deploy-contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, blindBoxUri: blindBoxUri.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data?.error || "Deployment failed."); return; }
      const deployed: ContractInfo = {
        contractAddress: data.contractAddress,
        contractNetwork: data.network,
        contractDeployTxHash: data.txHash,
        contractDeployedAt: new Date().toISOString(),
      };
      setInfo(deployed);
    } catch {
      setError("Could not reach the server. The deploy may still be running — check back before retrying.");
    } finally {
      setDeploying(false);
    }
  }

  if (loading || !collectionId) return null;

  const deployedAddress = info?.contractAddress;

  return (
    <div className="exp-fb-card exp-svr-card" data-testid="deploy-contract-section">
      <div className="exp-fb-header">
        <div className="exp-fb-title">Deploy Smart Contract</div>
        <div className="exp-fb-sub">
          {deployedAddress
            ? "This collection has its own deployed contract."
            : "Give this collection its own dedicated contract, separate from the shared Bearth contract."}
        </div>
      </div>

      {deployedAddress ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px" }}>
          <span style={{ color: "#166534" }}>
            Deployed on <strong>{info?.contractNetwork}</strong>
          </span>
          <a
            href={`${EXPLORER[info!.contractNetwork!]}${deployedAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: "monospace", fontSize: 12.5, color: "#166534" }}
          >
            {deployedAddress}
          </a>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <select
            style={fieldStyle}
            value={network}
            onChange={e => { setNetwork(e.target.value as "sepolia" | "mainnet"); setConfirmMainnet(false); }}
            disabled={deploying}
          >
            <option value="sepolia">Sepolia (testnet)</option>
            <option value="mainnet">Ethereum Mainnet</option>
          </select>
          <input
            style={{ ...fieldStyle, width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 12.5, background: "#f9fafb", color: "#374151" }}
            placeholder="Blind box metadata URI (e.g. ipfs://...)"
            value={blindBoxUri}
            readOnly
            title="Read-only — this is the confirmed shared blind-box placeholder"
          />

          {previewImage && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img
                src={previewImage}
                alt="Blind box preview (read-only)"
                style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border)" }}
              />
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                Placeholder art every token shows before reveal
              </span>
            </div>
          )}

          {network === "mainnet" && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#6b7280" }}>
              <input
                type="checkbox"
                checked={confirmMainnet}
                onChange={e => setConfirmMainnet(e.target.checked)}
                disabled={deploying}
                style={{ marginTop: 2 }}
              />
              <span>
                I understand this deploys to <strong>Ethereum Mainnet</strong> using real ETH and cannot be undone.
                Double-check the collection name, symbol, and blind box URI above before continuing.
              </span>
            </label>
          )}

          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              style={buttonStyle(deploying || !blindBoxUri.trim() || (network === "mainnet" && !confirmMainnet))}
              onClick={deploy}
              disabled={deploying || !blindBoxUri.trim() || (network === "mainnet" && !confirmMainnet)}
            >
              {deploying ? "Deploying… this can take a minute" : `Deploy to ${network === "mainnet" ? "Mainnet" : "Sepolia"}`}
            </button>
          </div>

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "8px 12px", fontSize: 12.5 }}>
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
