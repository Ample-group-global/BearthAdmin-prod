"use client";

import { useState, useEffect } from "react";
import { useWhitelist } from "@/app/dashboard/whitelist/useWhitelist";
import { ToastContainer } from "@/app/dashboard/whitelist/Toast";
import { useToast } from "@/app/dashboard/whitelist/useToast";
import { ETH_ADDRESS_RE } from "@/lib/nft-constants";

const inputStyle: React.CSSProperties = { border: "1px solid #e5e7eb" };
const btnPrimaryStyle: React.CSSProperties = { background: "#24315f" };

export default function WhitelistTab({ collectionId, initialCheckAddress }: { collectionId: string; initialCheckAddress?: string }) {
  const { toasts, showToast, removeToast } = useToast();
  const {
    addresses, customers, stats, isLoading, error,
    addAddress, removeAddress, testAddress,
    clearMerkleRootOverride, exportWhitelist,
    removeAddressLoading, testAddressLoading, clearMerkleRootOverrideLoading,
  } = useWhitelist(collectionId);

  const [search, setSearch] = useState("");
  const [newRoleCode, setNewRoleCode] = useState("customer");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [testAddr, setTestAddr] = useState(initialCheckAddress ?? "");
  const [pushChainLoading, setPushChainLoading] = useState(false);
  const [pushChainTxHash, setPushChainTxHash] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    isWhitelisted: boolean; proof?: string[]; syncedOnChain: boolean;
    onChainRoot: string | null; onChainCheckError?: string;
    customer: { userCode: string | null; name: string | null } | null;
  } | null>(null);
  const [quickAdding, setQuickAdding] = useState(false);
  const [copiedRoot, setCopiedRoot] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;

  const filtered = addresses.filter((a) => a.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); showToast(ok, "success"); }
    catch (e: unknown) { showToast(e instanceof Error ? e.message : "Error", "error"); }
  };

  const handleRegister = async (addr: string) => {
    addr = addr.trim();
    if (!ETH_ADDRESS_RE.test(addr)) { showToast("Invalid Ethereum address — must be 0x + 40 hex", "error"); return; }
    if (!newFirstName.trim()) { showToast("First name is required", "error"); return; }
    setRegisterLoading(true);
    try {
      const res = await fetch("/api/whitelist/register", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: addr, role_code: newRoleCode,
          first_name: newFirstName.trim(), last_name: newLastName.trim() || undefined,
          email: newEmail.trim() || undefined,
          collectionId,
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; isNewUser?: boolean; roleCode?: string };
      if (!res.ok) throw new Error(data.error ?? "Registration failed");
      setNewFirstName(""); setNewLastName(""); setNewEmail(""); setNewRoleCode("customer"); setShowMoreFields(false);
      showToast(`Wallet registered as ${data.roleCode ?? newRoleCode}${data.isNewUser ? " (new user created)" : " (linked to existing user)"}`, "success");
      const r = await testAddress(addr);
      setTestResult(r);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleRemove = (addr: string) =>
    wrap(() => removeAddress(addr), "Address removed");

  const handlePushToChain = async () => {
    setPushChainLoading(true);
    setPushChainTxHash(null);
    try {
      const res = await fetch("/api/whitelist/push-chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ collectionId }),
      });
      const data = await res.json() as { success?: boolean; txHash?: string; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Push failed");
      setPushChainTxHash(data.txHash ?? null);
      showToast("Allowlist root pushed to contract ✓", "success");
      if (testResult) {
        const r = await testAddress(testAddr.trim());
        setTestResult(r);
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Push failed", "error");
    } finally {
      setPushChainLoading(false);
    }
  };

  const handleClearRoot = () =>
    wrap(clearMerkleRootOverride, "Override cleared, root recomputed");

  const handleTest = async () => {
    try {
      const r = await testAddress(testAddr.trim());
      setTestResult(r);
      showToast(r.isWhitelisted ? "Address is whitelisted ✓" : "Address is NOT whitelisted", r.isWhitelisted ? "success" : "warning");
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Error", "error"); }
  };

  // Only offered when the address already resolves to a known, named
  // customer -- otherwise falls through to the named registration form
  // below, same rule enforced everywhere else: no wallet gets whitelisted
  // without a real customer attached to it.
  const handleQuickAdd = async () => {
    setQuickAdding(true);
    try {
      await addAddress(testAddr.trim());
      showToast("Added to whitelist", "success");
      const r = await testAddress(testAddr.trim());
      setTestResult(r);
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Error", "error"); }
    finally { setQuickAdding(false); }
  };

  const handleExport = async (fmt: "csv" | "json" | "txt") => {
    try {
      const blob = await exportWhitelist(fmt);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `whitelist-${new Date().toISOString().split("T")[0]}.${fmt}`;
      document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); document.body.removeChild(a);
      showToast("Downloaded", "success");
    } catch { showToast("Export failed", "error"); }
  };

  useEffect(() => {
    if (error) showToast(error, "error");
  }, [error, showToast]);

  // Deep-linked here (e.g. from a customer's wallet list) with an address
  // already known -- run the check immediately instead of making the admin
  // re-type it. Only fires once collectionId has resolved to something real.
  useEffect(() => {
    if (initialCheckAddress && collectionId) handleTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCheckAddress, collectionId]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold" style={{ color: "#24315f" }}>Whitelist Management</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1.5">
            <span className="text-sm" style={{ color: "#6b7280" }}>
              {addresses.length.toLocaleString()} address{addresses.length !== 1 ? "es" : ""}
            </span>
            {stats?.merkleRoot ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                style={{ background: "#f3f4f6", border: "1px solid #e5e7eb" }}>
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#9bafc5" }}>Root</span>
                <span className="font-mono text-xs" style={{ color: "#24315f" }} title={stats.merkleRoot}>
                  {stats.merkleRoot.slice(0, 10)}…{stats.merkleRoot.slice(-6)}
                </span>
                <button
                  onClick={() => { navigator.clipboard?.writeText(stats.merkleRoot); setCopiedRoot(true); setTimeout(() => setCopiedRoot(false), 2000); }}
                  style={{ color: copiedRoot ? "#16a34a" : "#9bafc5" }}
                  title={copiedRoot ? "Copied!" : "Copy full root"}>
                  {copiedRoot ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  )}
                </button>
              </span>
            ) : (
              <span className="text-sm" style={{ color: "#9bafc5" }}>No root set</span>
            )}
            {stats?.lastUpdated && (
              <span className="text-xs" style={{ color: "#9bafc5" }}>Updated {new Date(stats.lastUpdated).toLocaleDateString()}</span>
            )}
            {stats?.manualOverride && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: "rgba(217,119,6,0.1)", color: "#d97706" }}>
                Manual Override
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stats?.manualOverride && (
            <button onClick={handleClearRoot} disabled={clearMerkleRootOverrideLoading}
              className="px-3 py-2 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40"
              style={{ background: "rgba(217,119,6,0.08)", color: "#d97706", border: "1px solid rgba(217,119,6,0.25)" }}
              title="This root was set outside the normal address-derived flow and won't update as addresses change">
              {clearMerkleRootOverrideLoading ? "Clearing..." : "Clear Override & Recompute"}
            </button>
          )}
          <button onClick={handlePushToChain} disabled={pushChainLoading}
            data-testid="push-allowlist-chain"
            className="px-4 py-2 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40"
            style={{ background: "#16a34a" }}
            title="Submit the current root to the smart contract on-chain">
            {pushChainLoading ? "Pushing..." : "⛓ Push to Contract"}
          </button>
        </div>
      </div>
      {pushChainTxHash && (
        <p className="text-xs font-mono break-all" style={{ color: "#16a34a" }}>Tx: {pushChainTxHash}</p>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4" style={{ border: "1px solid #e5e7eb" }}>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#9bafc5" }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search addresses..."
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#41afeb]"
              style={{ border: "1px solid #e5e7eb" }}
            />
          </div>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{ background: "#f3f4f6", color: "#6b7280" }}>
            {filtered.length} results
          </span>
          <div className="flex-1" />
          <button onClick={() => handleExport("csv")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: "white", border: "1px solid #e5e7eb", color: "#374151" }}>
            <svg className="w-3.5 h-3.5" style={{ color: "#41afeb" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>

        <div className="p-3 rounded-xl" style={{ background: "#f9fafb", border: "1px solid #e5e7eb" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "#6b7280" }}>Check or add any address</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={testAddr} onChange={(e) => { setTestAddr(e.target.value); setTestResult(null); }}
              placeholder="0x..."
              className="px-3 py-1.5 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-[#41afeb]"
              style={{ ...inputStyle, minWidth: 320, flex: 1 }} />
            <button onClick={handleTest} disabled={testAddressLoading || !testAddr.trim()}
              className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-40"
              style={btnPrimaryStyle}>
              {testAddressLoading ? "Checking..." : "Check"}
            </button>
          </div>

          {testResult && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold px-2 py-1 rounded-full"
                  style={{
                    background: testResult.isWhitelisted ? "rgba(22,163,74,0.1)" : "rgba(239,68,68,0.1)",
                    color: testResult.isWhitelisted ? "#16a34a" : "#dc2626",
                  }}>
                  {testResult.isWhitelisted ? "✓ In database" : "✗ Not in database"}
                </span>
                {testResult.isWhitelisted && (
                  <span className="text-xs font-semibold px-2 py-1 rounded-full"
                    style={{
                      background: testResult.syncedOnChain ? "rgba(22,163,74,0.1)" : "rgba(217,119,6,0.1)",
                      color: testResult.syncedOnChain ? "#16a34a" : "#d97706",
                    }}>
                    {testResult.syncedOnChain ? "✓ Synced on-chain" : "⚠ Not yet pushed on-chain"}
                  </span>
                )}
                {testResult.customer && (
                  <span className="text-xs" style={{ color: "#6b7280" }}>
                    Customer: <span className="font-semibold" style={{ color: "#24315f" }}>{testResult.customer.name || "(no name)"}</span>
                    {testResult.customer.userCode && <span className="font-mono"> ({testResult.customer.userCode})</span>}
                  </span>
                )}
              </div>

              {testResult.onChainCheckError && (
                <p className="text-xs" style={{ color: "#d97706" }}>Could not verify on-chain: {testResult.onChainCheckError}</p>
              )}

              {testResult.isWhitelisted && !testResult.syncedOnChain && (
                <div className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}>
                  <span>In the database, but the last on-chain push predates this address.</span>
                  <button onClick={handlePushToChain} disabled={pushChainLoading}
                    className="px-2.5 py-1 text-xs font-semibold text-white rounded-lg disabled:opacity-40 flex-shrink-0"
                    style={{ background: "#16a34a" }}>
                    {pushChainLoading ? "Pushing..." : "Push Now"}
                  </button>
                </div>
              )}

              {!testResult.isWhitelisted && (
                testResult.customer ? (
                  <div className="flex items-center gap-2">
                    <p className="text-xs" style={{ color: "#6b7280" }}>
                      Already a registered customer — add directly, no new name needed.
                    </p>
                    <button onClick={handleQuickAdd} disabled={quickAdding}
                      className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-40"
                      style={{ background: "#16a34a" }}>
                      {quickAdding ? "Adding..." : "Add to Whitelist"}
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg space-y-2" style={{ background: "white", border: "1px solid #e5e7eb" }}>
                    <p className="text-xs" style={{ color: "#6b7280" }}>
                      No customer record for this address yet — register one to add it (every whitelisted wallet must belong to a named customer).
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)}
                        placeholder="First name *" className="px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#41afeb]" style={inputStyle} />
                      <input value={newLastName} onChange={(e) => setNewLastName(e.target.value)}
                        placeholder="Last name" className="px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#41afeb]" style={inputStyle} />
                    </div>
                    {showMoreFields ? (
                      <div className="grid grid-cols-2 gap-2">
                        <select value={newRoleCode} onChange={(e) => setNewRoleCode(e.target.value)}
                          className="px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#41afeb] bg-white" style={{ ...inputStyle, color: "#24315f" }}>
                          <option value="customer">Customer — can mint NFTs</option>
                          <option value="technical_team">Team Member — internal / testing</option>
                          <option value="ext_referrer">Partner — referral / collaboration</option>
                        </select>
                        <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="Email (optional)" type="email"
                          className="px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#41afeb]" style={inputStyle} />
                      </div>
                    ) : (
                      <button onClick={() => setShowMoreFields(true)} className="text-xs font-semibold" style={{ color: "#41afeb" }}>
                        + Set user type / email (defaults to Customer)
                      </button>
                    )}
                    <button
                      onClick={() => handleRegister(testAddr)}
                      disabled={registerLoading || !newFirstName.trim()}
                      className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-40"
                      style={btnPrimaryStyle}>
                      {registerLoading ? "Registering..." : "Register & Add to Whitelist"}
                    </button>
                  </div>
                )
              )}

            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: "#f3f4f6" }} />
          ))}</div>
        ) : paginated.length === 0 ? (
          <div className="text-center py-10 text-sm" style={{ color: "#9bafc5" }}>No addresses found</div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid #e5e7eb" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9bafc5" }}>#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9bafc5" }}>Customer</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9bafc5" }}>Address</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9bafc5" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((addr, i) => (
                    <tr key={addr}
                      style={{ borderTop: i === 0 ? "none" : "1px solid #f3f4f6" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#fafbff")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: "#9bafc5" }}>{(page - 1) * PER_PAGE + i + 1}</td>
                      <td className="px-4 py-3 text-xs">
                        {customers[addr.toLowerCase()] ? (
                          <div>
                            <div className="font-semibold" style={{ color: "#24315f" }}>{customers[addr.toLowerCase()].name || "(no name)"}</div>
                            <div className="font-mono" style={{ color: "#9bafc5" }}>{customers[addr.toLowerCase()].userCode || "—"}</div>
                          </div>
                        ) : (
                          <span style={{ color: "#9bafc5" }}>Not registered</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs break-all" style={{ color: "#24315f" }}>{addr}</td>
                      <td className="px-4 py-3 text-right">
                        {confirmRemove === addr ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs" style={{ color: "#dc2626" }}>Confirm?</span>
                            <button onClick={() => { handleRemove(addr); setConfirmRemove(null); }}
                              className="text-xs px-2 py-1 rounded text-white" style={{ background: "#dc2626" }}>
                              Yes
                            </button>
                            <button onClick={() => setConfirmRemove(null)}
                              className="text-xs px-2 py-1 rounded" style={{ background: "#f3f4f6", color: "#6b7280" }}>
                              No
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmRemove(addr)}
                            disabled={removeAddressLoading}
                            className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                            style={{ color: "#dc2626", background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.15)" }}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm" style={{ color: "#9bafc5" }}>
                <span>Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                    style={{ border: "1px solid #e5e7eb", color: "#374151", background: "white" }}>
                    ← Prev
                  </button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                    style={{ border: "1px solid #e5e7eb", color: "#374151", background: "white" }}>
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
