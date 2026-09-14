"use client";

import { useState, useEffect, useCallback } from "react";

export function useWhitelist(collectionId: string) {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [customers, setCustomers] = useState<Record<string, { userCode: string | null; name: string | null }>>({});
  const [stats, setStats] = useState<{
    merkleRoot: string;
    manualOverride: boolean;
    lastUpdated: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addAddressLoading, setAddAddressLoading] = useState(false);
  const [removeAddressLoading, setRemoveAddressLoading] = useState(false);
  const [testAddressLoading, setTestAddressLoading] = useState(false);
  const [clearMerkleRootOverrideLoading, setClearMerkleRootOverrideLoading] = useState(false);

  const load = useCallback(async () => {
    if (!collectionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whitelist?limit=1000&collection_id=${collectionId}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setAddresses(data.addresses ?? []);
      setCustomers(data.customers ?? {});
      if (data.metadata) {
        setStats({
          merkleRoot: data.metadata.merkle_root ?? "0x0",
          manualOverride: Boolean(data.metadata.manual_override),
          lastUpdated: data.metadata.last_updated ?? "",
        });
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || "Failed to load whitelist");
    } finally {
      setIsLoading(false);
    }
  }, [collectionId]);

  useEffect(() => { load(); }, [load]);

  const addAddress = useCallback(async (address: string) => {
    setAddAddressLoading(true);
    try {
      const res = await fetch("/api/whitelist/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, collectionId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || data.error || "Failed to add address");
      }
      await load();
    } finally {
      setAddAddressLoading(false);
    }
  }, [load, collectionId]);

  const removeAddress = useCallback(async (address: string) => {
    setRemoveAddressLoading(true);
    try {
      const res = await fetch(`/api/whitelist/${encodeURIComponent(address)}?collection_id=${collectionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || data.error || "Failed to remove address");
      }
      await load();
    } finally {
      setRemoveAddressLoading(false);
    }
  }, [load, collectionId]);

  const testAddress = useCallback(async (address: string) => {
    setTestAddressLoading(true);
    try {
      const res = await fetch("/api/whitelist/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, collectionId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || data.error || "Failed to test address");
      }
      const data = await res.json();
      return { isWhitelisted: Boolean(data.is_whitelisted), proof: data.proof ?? [] };
    } finally {
      setTestAddressLoading(false);
    }
  }, [collectionId]);

  // Deliberately no setMerkleRoot() here -- an admin pasting an arbitrary
  // root with no validation against the real address list is exactly the
  // kind of silent-divergence footgun this app's collection-scoping work
  // has spent a lot of effort eliminating. The backend PUT /merkle-root
  // route still exists for genuine emergency recovery, but is intentionally
  // not one click away in the UI. clearMerkleRootOverride() below remains
  // as a safety valve to undo an override, never to create one.
  const clearMerkleRootOverride = useCallback(async () => {
    setClearMerkleRootOverrideLoading(true);
    try {
      const res = await fetch(`/api/whitelist/merkle-root?collection_id=${collectionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || data.error || "Failed to clear override");
      }
      await load();
    } finally {
      setClearMerkleRootOverrideLoading(false);
    }
  }, [load, collectionId]);

  const exportWhitelist = useCallback(async (fmt: "csv" | "json" | "txt") => {
    const res = await fetch(`/api/whitelist/export?format=${fmt}&collection_id=${collectionId}`);
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  }, [collectionId]);

  return {
    addresses, customers, stats, isLoading, error,
    addAddress, removeAddress, testAddress,
    clearMerkleRootOverride, exportWhitelist,
    addAddressLoading, removeAddressLoading,
    testAddressLoading, clearMerkleRootOverrideLoading,
  };
}
