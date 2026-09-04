"use client";

import { useEffect, useState } from "react";

// New collections only -- existing collections (Bearth V1, etc.) keep using
// the shared global contract and never show this card as "not deployed."
// Signer private keys never pass through this component or any request it
// sends -- they live only in BearthApi-V1's server-side env vars
// (DEPLOY_SEPOLIA_*/DEPLOY_MAINNET_*). This form only ever sends network +
// blind box URI, neither of which is a secret.

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

export default function DeployContractPanel({ collectionId }: { collectionId: string | null }) {
  const [info, setInfo] = useState<ContractInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [network, setNetwork] = useState<"sepolia" | "mainnet">("sepolia");
  const [blindBoxUri, setBlindBoxUri] = useState("");
  const [confirmMainnet, setConfirmMainnet] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <div className="exp-banner exp-banner-saved" style={{ marginTop: 12, flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <span>
            Deployed on <strong>{info?.contractNetwork}</strong>
          </span>
          <a
            href={`${EXPLORER[info!.contractNetwork!]}${deployedAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: "monospace", fontSize: 12.5 }}
          >
            {deployedAddress}
          </a>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select
              className="exp-fb-input"
              style={{ minWidth: 160 }}
              value={network}
              onChange={e => { setNetwork(e.target.value as "sepolia" | "mainnet"); setConfirmMainnet(false); }}
              disabled={deploying}
            >
              <option value="sepolia">Sepolia (testnet)</option>
              <option value="mainnet">Ethereum Mainnet</option>
            </select>
            <input
              className="exp-fb-input"
              style={{ flex: 1, minWidth: 260 }}
              placeholder="Blind box metadata URI (e.g. ipfs://...)"
              value={blindBoxUri}
              onChange={e => setBlindBoxUri(e.target.value)}
              disabled={deploying}
            />
          </div>

          {network === "mainnet" && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--text-muted)" }}>
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

          <div>
            <button
              className="btn btn-primary"
              onClick={deploy}
              disabled={deploying || !blindBoxUri.trim() || (network === "mainnet" && !confirmMainnet)}
            >
              {deploying ? "Deploying… this can take a minute" : `Deploy to ${network === "mainnet" ? "Mainnet" : "Sepolia"}`}
            </button>
          </div>

          {error && (
            <div className="exp-banner exp-banner-error">
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
