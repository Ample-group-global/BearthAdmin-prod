"use client";

import { useEffect, useState, useRef } from "react";
import DataTable, { type ColumnDef } from "@/components/DataTable";

interface Customer {
  id: string;
  userCode: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string | null;
  email: string | null;
  lineId: string | null;
  notes: string | null;
  walletCount: number;
  walletAddresses: string[];
  isActive: boolean;
  createdAt: string;
  referrerId: string | null;
  referrerName: string | null;
}

interface Wallet {
  id: string;
  address: string;
  isWhitelisted: boolean;
  addedAt: string;
}

interface Referrer {
  id: string;
  referrerCode: string;
  name: string;
  roleCode: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin", operation: "Operation", technical_team: "Technical Team",
  sales_team: "Sales Team", ext_referrer: "External Referrer", customer: "Customer",
};

const PAGE_SIZE = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d\s\-().]{6,20}$/;

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showInactive, setShowInactive] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", lineId: "", notes: "" });
  const [referrerId, setReferrerId] = useState<string | null>(null);
  const [referrerLabel, setReferrerLabel] = useState("");
  const [referrerQuery, setReferrerQuery] = useState("");
  const [referrerOptions, setReferrerOptions] = useState<Referrer[]>([]);
  const [referrerDropdownOpen, setReferrerDropdownOpen] = useState(false);
  const [referrerLoading, setReferrerLoading] = useState(false);
  const referrerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [walletCustomer, setWalletCustomer] = useState<Customer | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [walletsError, setWalletsError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newWalletAddr, setNewWalletAddr] = useState("");
  const [addingWallet, setAddingWallet] = useState(false);
  const [removingWalletId, setRemovingWalletId] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCustomers = (q: string, off: number, sb = sortKey, sd = sortDir, inactive = showInactive) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ search: q, limit: String(PAGE_SIZE), offset: String(off), sort_by: sb, sort_dir: sd });
    if (inactive) params.set("active", "false");
    fetch(`/api/customers?${params}`, { credentials: "include" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
        setCustomers(data.customers ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((e: Error) => setError(e.message || "Failed to load customers."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadCustomers(search, offset, sortKey, sortDir, showInactive); }, [offset, sortKey, sortDir, showInactive]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (key: string, dir: "asc" | "desc") => {
    setSortKey(key);
    setSortDir(dir);
    setOffset(0);
    loadCustomers(search, 0, key, dir, showInactive);
  };

  const handleSearch = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setOffset(0); loadCustomers(v, 0); }, 300);
  };

  const loadReferrers = (q: string) => {
    setReferrerLoading(true);
    fetch(`/api/referrers?search=${encodeURIComponent(q)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setReferrerOptions(d.referrers ?? []))
      .catch(() => setReferrerOptions([]))
      .finally(() => setReferrerLoading(false));
  };

  const handleReferrerSearch = (v: string) => {
    setReferrerQuery(v);
    setReferrerDropdownOpen(true);
    if (referrerSearchTimer.current) clearTimeout(referrerSearchTimer.current);
    referrerSearchTimer.current = setTimeout(() => loadReferrers(v), 250);
  };

  const selectReferrer = (r: Referrer | null) => {
    setReferrerId(r?.id ?? null);
    setReferrerLabel(r ? `${r.name} (${ROLE_LABELS[r.roleCode] ?? r.roleCode})` : "");
    setReferrerQuery("");
    setReferrerDropdownOpen(false);
  };

  const hasContact = () => !!(form.phone.trim() || form.email.trim() || form.lineId.trim());

  const validateForm = (): string | null => {
    if (!form.firstName.trim()) return "First name is required.";
    if (!form.lastName.trim()) return "Last name is required.";
    if (!hasContact()) return "At least one contact method is required: Phone, Email, or LINE ID.";
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) return "Phone number is not valid.";
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) return "Email address is not valid.";
    return null;
  };

  const openCreate = () => {
    setEditCustomer(null);
    setForm({ firstName: "", lastName: "", phone: "", email: "", lineId: "", notes: "" });
    selectReferrer(null);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (c: Customer) => {
    setEditCustomer(c);
    setForm({ firstName: c.firstName ?? "", lastName: c.lastName ?? "", phone: c.phone ?? "", email: c.email ?? "", lineId: c.lineId ?? "", notes: c.notes ?? "" });
    setReferrerId(c.referrerId ?? null);
    setReferrerLabel(c.referrerId && c.referrerName ? c.referrerName : "");
    setReferrerQuery("");
    setReferrerDropdownOpen(false);
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    setFormError(null);
    const clientError = validateForm();
    if (clientError) { setFormError(clientError); return; }
    setSaving(true);
    try {
      const body = {
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        phone:     form.phone.trim() || undefined,
        email:     form.email.trim() || undefined,
        lineId:    form.lineId.trim() || undefined,
        notes:     form.notes.trim() || undefined,
        referrerId: referrerId ?? undefined,
      };
      const url = editCustomer ? `/api/customers/${editCustomer.id}` : "/api/customers";
      const method = editCustomer ? "PUT" : "POST";
      const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); setFormError(d.error ?? "Save failed."); return; }
      setShowModal(false);
      loadCustomers(search, offset);
    } catch { setFormError("Network error."); }
    finally { setSaving(false); }
  };

  const handleToggleActive = async (c: Customer) => {
    setTogglingId(c.id);
    try {
      const res = await fetch(`/api/customers/${c.id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !c.isActive }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Status update failed."); return; }
      setCustomers((prev) => prev.map((x) => x.id === c.id ? { ...x, isActive: !c.isActive } : x));
    } catch { setError("Network error."); }
    finally { setTogglingId(null); }
  };

  const openWallets = async (c: Customer) => {
    setWalletCustomer(c);
    setWallets([]);
    setWalletsError(null);
    setNewWalletAddr("");
    setWalletsLoading(true);
    try {
      const res = await fetch(`/api/customers/${c.id}/wallets`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) setWalletsError(data.error ?? "Failed to load wallets.");
      else setWallets(data.wallets ?? []);
    } catch { setWalletsError("Network error."); }
    finally { setWalletsLoading(false); }
  };

  const handleAddWallet = async () => {
    if (!walletCustomer || !newWalletAddr.trim()) return;
    setAddingWallet(true);
    setWalletsError(null);
    try {
      const res = await fetch(`/api/customers/${walletCustomer.id}/wallets`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: newWalletAddr.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setWalletsError(data.error ?? "Failed to add wallet."); return; }
      setWallets((prev) => [...prev, data.wallet]);
      setNewWalletAddr("");
      setCustomers((prev) => prev.map((x) => x.id === walletCustomer.id ? { ...x, walletCount: x.walletCount + 1 } : x));
    } catch { setWalletsError("Network error."); }
    finally { setAddingWallet(false); }
  };

  const handleRemoveWallet = async (walletId: string) => {
    if (!walletCustomer) return;
    setRemovingWalletId(walletId);
    try {
      const res = await fetch(`/api/customers/${walletCustomer.id}/wallets/${walletId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const d = await res.json(); setWalletsError(d.error ?? "Failed to remove wallet."); return; }
      setWallets((prev) => prev.filter((w) => w.id !== walletId));
      setCustomers((prev) => prev.map((x) => x.id === walletCustomer.id ? { ...x, walletCount: Math.max(0, x.walletCount - 1) } : x));
    } catch { setWalletsError("Network error."); }
    finally { setRemovingWalletId(null); }
  };

  const columns: ColumnDef<Customer>[] = [
    { key: "user_code", header: "Customer Code", sortKey: "user_code", render: (c) => <span className="font-mono text-xs font-semibold" style={{ color: "#41afeb" }}>{c.userCode ?? "N/A"}</span> },
    { key: "full_name", header: "Name", sortKey: "full_name", render: (c) => <span className="font-medium" style={{ color: "#111827" }}>{`${c.firstName} ${c.lastName}`.trim() || "N/A"}</span> },
    { key: "phone", header: "Phone", render: (c) => <span style={{ color: "#6b7280" }}>{c.phone || "N/A"}</span> },
    { key: "email", header: "Email", sortKey: "email", render: (c) => <span style={{ color: "#6b7280" }}>{c.email || "N/A"}</span> },
    { key: "line_id", header: "LINE ID", sortKey: "line_id", render: (c) => <span style={{ color: "#6b7280" }}>{c.lineId || "N/A"}</span> },
    { key: "referrer_name", header: "Referred By", sortKey: "referrer_name", render: (c) => <span style={{ color: "#6b7280" }}>{c.referrerName || "—"}</span> },
    {
      key: "wallets", header: "Wallets", sortKey: "wallet_count",
      render: (c) => {
        const addrs = c.walletAddresses ?? [];
        if (addrs.length === 0) {
          return (
            <button
              onClick={() => openWallets(c)}
              className="text-xs font-semibold"
              style={{ color: "#41afeb" }}
              title="Add a wallet"
            >
              + Add wallet
            </button>
          );
        }
        const VISIBLE = 2;
        const shown = addrs.slice(0, VISIBLE);
        const extra = addrs.length - shown.length;
        return (
          <button
            onClick={() => openWallets(c)}
            className="flex flex-col items-start gap-0.5 text-left"
            title="Click to manage wallets"
          >
            {shown.map((addr) => (
              <span key={addr} className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(65,175,235,0.1)", color: "#41afeb" }}>
                {addr.slice(0, 6)}…{addr.slice(-4)}
              </span>
            ))}
            {extra > 0 && (
              <span className="text-xs font-semibold" style={{ color: "#9bafc5" }}>+{extra} more</span>
            )}
          </button>
        );
      },
    },
    {
      key: "created_at", header: "Joined", sortKey: "created_at", align: "center",
      render: (c) => <span className="text-xs" style={{ color: "#6b7280" }}>{c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "N/A"}</span>,
    },
    {
      key: "is_active", header: "Active", sortKey: "is_active", align: "center",
      render: (c) => (
        <button
          onClick={() => handleToggleActive(c)}
          disabled={togglingId === c.id}
          title={c.isActive ? "Click to deactivate" : "Click to activate"}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold transition-opacity"
          style={{
            opacity: togglingId === c.id ? 0.5 : 1,
            cursor: togglingId === c.id ? "wait" : "pointer",
            ...(c.isActive ? { background: "rgba(22,163,74,0.1)", color: "#16a34a" } : { background: "rgba(156,163,175,0.1)", color: "#9ca3af" }),
          }}
        >
          {togglingId === c.id ? "…" : c.isActive ? "Active" : "Inactive"}
        </button>
      ),
    },
    {
      key: "actions", header: "Actions", align: "center",
      render: (c) => (
        <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg" style={{ color: "#41afeb" }} title="Edit">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      ),
    },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "#24315f" }}>Bearth Customers</h1>
          <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>NFT customers and their linked wallets</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
          style={{ background: "#41afeb" }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Customer
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#9bafc5" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, email, phone..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none bg-white"
            style={{ border: "1px solid #e5e7eb", color: "#111827" }}
          />
        </div>
        <button
          onClick={() => { setShowInactive((v) => !v); setOffset(0); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
          style={showInactive
            ? { background: "rgba(156,163,175,0.15)", color: "#6b7280", border: "1px solid #d1d5db" }
            : { background: "transparent", color: "#9bafc5", border: "1px solid #e5e7eb" }}
        >
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: showInactive ? "#9ca3af" : "#16a34a" }} />
          {showInactive ? "All customers" : "Active only"}
        </button>
        <span className="text-sm" style={{ color: "#9bafc5" }}>
          {total > 0 ? `${total} customer${total !== 1 ? "s" : ""}` : "0 results"}
        </span>
      </div>

      <DataTable
        columns={columns}
        data={customers}
        total={total}
        offset={offset}
        pageSize={PAGE_SIZE}
        onPageChange={(off) => { setOffset(off); loadCustomers(search, off); }}
        loading={loading}
        error={error}
        emptyText="No customers found"
        keyExtractor={(c) => c.id}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
      />

      {walletCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #e5e7eb" }}>
              <div>
                <h2 className="text-base font-bold" style={{ color: "#24315f" }}>Wallets</h2>
                <p className="text-xs mt-0.5" style={{ color: "#9bafc5" }}>
                  {`${walletCustomer.firstName} ${walletCustomer.lastName}`.trim()} · {walletCustomer.userCode}
                </p>
              </div>
              <button onClick={() => setWalletCustomer(null)} style={{ color: "#9bafc5" }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="0x… wallet address"
                  value={newWalletAddr}
                  onChange={(e) => setNewWalletAddr(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg text-sm outline-none font-mono"
                  style={{ border: "1px solid #e5e7eb", color: "#111827" }}
                />
                <button
                  onClick={handleAddWallet}
                  disabled={addingWallet || !newWalletAddr.trim()}
                  className="px-3 py-2 rounded-lg text-xs font-bold text-white"
                  style={{ background: "#41afeb", opacity: addingWallet || !newWalletAddr.trim() ? 0.6 : 1 }}
                >
                  {addingWallet ? "Adding…" : "Add"}
                </button>
              </div>

              {walletsError && (
                <div className="p-3 rounded-lg text-sm" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>{walletsError}</div>
              )}

              <div className="max-h-80 overflow-y-auto">
                {walletsLoading ? (
                  <div className="flex items-center justify-center h-20" style={{ color: "#9bafc5" }}>Loading…</div>
                ) : wallets.length === 0 ? (
                  <p className="text-sm text-center py-6" style={{ color: "#9bafc5" }}>No wallets linked yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <th className="pb-2 text-left text-xs font-semibold" style={{ color: "#9bafc5" }}>Wallet Address</th>
                        <th className="pb-2 text-center text-xs font-semibold" style={{ color: "#9bafc5" }}>Whitelist</th>
                        <th className="pb-2 text-right text-xs font-semibold" style={{ color: "#9bafc5" }}>Added</th>
                        <th className="pb-2 text-right text-xs font-semibold" style={{ color: "#9bafc5" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {wallets.map((w) => (
                        <tr key={w.id} style={{ borderBottom: "1px solid #f9fafb" }}>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs" style={{ color: "#24315f" }}>{w.address}</span>
                              <button
                                onClick={() => { navigator.clipboard?.writeText(w.address); setCopiedId(w.id); setTimeout(() => setCopiedId(null), 2000); }}
                                className="flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium transition-colors"
                                style={copiedId === w.id ? { background: "rgba(22,163,74,0.1)", color: "#16a34a" } : { background: "rgba(65,175,235,0.08)", color: "#41afeb" }}
                                title="Copy address"
                              >
                                {copiedId === w.id ? "Copied" : "Copy"}
                              </button>
                            </div>
                          </td>
                          <td className="py-2 text-center">
                            {w.isWhitelisted ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "rgba(22,163,74,0.1)", color: "#16a34a" }}>Listed</span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "rgba(156,163,175,0.1)", color: "#9ca3af" }}>Not Listed</span>
                            )}
                          </td>
                          <td className="py-2 text-right text-xs" style={{ color: "#9bafc5" }}>
                            {w.addedAt ? new Date(w.addedAt).toLocaleDateString() : "N/A"}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              onClick={() => handleRemoveWallet(w.id)}
                              disabled={removingWalletId === w.id}
                              className="px-2 py-0.5 rounded text-xs font-semibold"
                              style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", opacity: removingWalletId === w.id ? 0.5 : 1 }}
                            >
                              {removingWalletId === w.id ? "…" : "Remove"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col" style={{ maxHeight: "90vh" }}>
            <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid #e5e7eb" }}>
              <h2 className="text-base font-bold" style={{ color: "#24315f" }}>{editCustomer ? "Edit Customer" : "New Customer"}</h2>
              <button onClick={() => setShowModal(false)} style={{ color: "#9bafc5" }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-3 overflow-y-auto">
              {formError && (
                <div className="p-3 rounded-lg text-sm" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>{formError}</div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "#24315f" }}>First Name *</label>
                  <input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ border: "1px solid #e5e7eb", color: "#111827" }} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "#24315f" }}>Last Name *</label>
                  <input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ border: "1px solid #e5e7eb", color: "#111827" }} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#24315f" }}>Phone</label>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ border: "1px solid #e5e7eb", color: "#111827" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#24315f" }}>Email</label>
                <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ border: "1px solid #e5e7eb", color: "#111827" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#24315f" }}>LINE ID</label>
                <input value={form.lineId} onChange={(e) => setForm((f) => ({ ...f, lineId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ border: "1px solid #e5e7eb", color: "#111827" }} />
              </div>
              <p className="text-xs" style={{ color: "#9bafc5" }}>At least one of Phone, Email, or LINE ID is required.</p>

              <div className="relative">
                <label className="block text-xs font-semibold mb-1" style={{ color: "#24315f" }}>Referred By</label>
                {referrerId ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ border: "1px solid #e5e7eb", color: "#111827" }}>
                    <span>{referrerLabel}</span>
                    <button type="button" onClick={() => selectReferrer(null)} className="text-xs font-semibold" style={{ color: "#dc2626" }}>Clear</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Search by name, code, or email…"
                      value={referrerQuery}
                      onFocus={() => { setReferrerDropdownOpen(true); if (!referrerOptions.length) loadReferrers(""); }}
                      onChange={(e) => handleReferrerSearch(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ border: "1px solid #e5e7eb", color: "#111827" }}
                    />
                    {referrerDropdownOpen && (
                      <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg shadow-lg bg-white" style={{ border: "1px solid #e5e7eb" }}>
                        {referrerLoading ? (
                          <div className="px-3 py-2 text-xs" style={{ color: "#9bafc5" }}>Searching…</div>
                        ) : referrerOptions.length === 0 ? (
                          <div className="px-3 py-2 text-xs" style={{ color: "#9bafc5" }}>No matches — any customer, AMG team member, or external referrer can be selected.</div>
                        ) : (
                          referrerOptions.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => selectReferrer(r)}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between"
                            >
                              <span>{r.name}</span>
                              <span className="text-xs font-mono" style={{ color: "#9bafc5" }}>{ROLE_LABELS[r.roleCode] ?? r.roleCode} · {r.referrerCode}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#24315f" }}>Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none" style={{ border: "1px solid #e5e7eb", color: "#111827" }} />
              </div>
            </div>
            <div className="px-6 py-4 flex justify-end gap-2 flex-shrink-0" style={{ borderTop: "1px solid #e5e7eb" }}>
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg text-xs font-semibold" style={{ border: "1px solid #e5e7eb", color: "#374151" }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg text-xs font-bold text-white" style={{ background: "#41afeb", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : editCustomer ? "Save Changes" : "Create Customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
