'use client';
import './studio.css';
import { useState, useEffect, useCallback } from 'react';
import StepNav from './components/StepNav';
import CollectionSetup from './components/CollectionSetup';
import Sidebar from './components/Sidebar';
import LayerContent from './components/LayerContent';
import PreviewPanel from './components/PreviewPanel';
import ExportPanel from './components/ExportPanel';
import RarityModal from './components/RarityModal';
import RarityTab from './components/RarityTab';
import { LayerFilesProvider } from './LayerFilesContext';

interface LayerAsset { id?: string; stem: string; name?: string; defaultWeight?: number; rel?: string; }
interface Layer { id?: string; folder: string; count: number; assets: LayerAsset[]; optional?: boolean; }
type Weights = Record<string, Record<string, number>>;
type ConflictRule = Record<string, unknown>;

const DEFAULT_COLLECTION = {
  name: '',
  symbol: '',
  description: '',
  supply: undefined as number | undefined,
  blockchain: 'ethereum',
  format: 'png',
  nameFormat: '#{{id}}',
  width: undefined as number | undefined,
  height: undefined as number | undefined,
};

export default function Page() {
  const [step, setStep] = useState('settings');
  const [collection, setCollection] = useState(DEFAULT_COLLECTION);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [sessionRestored, setSessionRestored] = useState(false);
  const [conflictSaveError, setConflictSaveError] = useState('');
  const [weightSaveError, setWeightSaveError] = useState('');
  const [layers, setLayers] = useState<Layer[]>([]);
  const [weights, setWeights] = useState<Weights>({});
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [gearFolder, setGearFolder] = useState<string | null>(null);
  const [gearFocusStem, setGearFocusStem] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRule[]>([]);

  // Single entry point for the layer modal — used by the sidebar gear icon,
  // the Advanced view's own "Layer Rarity" button, and clicking an individual
  // trait card. Previously each of those opened a different popup (or, for
  // the Advanced-view button, an under-propped copy of this same one missing
  // Layer Metadata/Rules); now there's exactly one modal, optionally scrolled
  // to a specific trait when opened from a card click.
  function openLayerModal(folder: string, focusStem?: string) {
    setGearFolder(folder);
    setGearFocusStem(focusStem ?? null);
  }

  function goToStep(newStep: string) {
    if (step !== 'organize' && newStep === 'organize') {
      const best = layers.find(l => l.count > 1) ?? layers[0];
      setActiveFolder(best?.folder ?? null);
    }
    setStep(newStep);
  }

  const loadLayers = useCallback((localLayers?: Layer[], cid?: string | null) => {
    const applyLayers = (data: Layer[]) => {
      setLayers(data);
      setWeights(prev => {
        const updated = { ...prev };
        data.forEach(l => {
          updated[l.folder] = Object.fromEntries(
            l.assets.map((a: LayerAsset) => [a.stem, a.defaultWeight ?? 1])
          );
        });
        return updated;
      });
      if (data.length && !activeFolder) {
        const best = data.find(l => l.count > 1) ?? data[0];
        setActiveFolder(best.folder);
      }
    };

    if (localLayers?.length) {
      applyLayers(localLayers);
      return;
    }

    const effectiveCid = cid ?? collectionId;
    if (!effectiveCid) return; // no upload and no saved collection — Organise stays empty

    fetch(`/api/layers?collectionId=${effectiveCid}`)
      .then(r => r.json())
      .then((data: Layer[]) => { if (data.length) applyLayers(data); })
      .catch(() => { /* layers load silently — page shows empty state */ });
  }, [activeFolder, collectionId]);

  useEffect(() => {
    // Conflicts and weights now live on the collection/trait rows in the DB —
    // both get picked up below from the same collection-detail fetches that
    // already run to restore name/symbol/supply/etc.
    fetch('/api/session/collection').then(r => r.json()).catch(() => ({})).then((sessionData) => {
      const savedId: string | null = sessionData?.collectionId ?? null;
      loadLayers(undefined, savedId || undefined);

      if (savedId) {
        setCollectionId(savedId);
        setSessionRestored(true);
        const s = sessionData?.supply;
        if (s && s > 0) setCollection(prev => ({ ...prev, supply: s }));
        // A single transient failure here (e.g. a pooled DB connection that
        // died mid-request — see project-bearthapi-v1-auth-pool-stale-connection-bug)
        // used to leave collection.supply permanently blank ('—' on the
        // Export tab) with no retry and no indication anything went wrong.
        // One retry, then a visible (non-fatal) warning, mirrors the fix
        // already applied to the session-cookie save above.
        const fetchCollection = () => fetch(`/api/nft-gen/collections/${savedId}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);
        fetchCollection().then(async data => {
          if (!data) data = await fetchCollection();
          if (!data) {
            setSyncError('Could not load this collection’s saved details — some fields may be missing until you reload the page.');
            return;
          }
          const c = data?.collection ?? data;
          if (!c?.id) {
            // The collection this browser had cached no longer exists in the
            // DB (deleted from elsewhere) — clear the stale cookie and reset
            // to a fresh Settings tab instead of leaving the summary card and
            // Generate button showing dead data that fails on every click.
            fetch('/api/session/collection', { method: 'DELETE' }).catch(() => {});
            setCollectionId(null);
            setSessionRestored(false);
            setCollection(DEFAULT_COLLECTION);
            return;
          }
          setCollection(prev => ({
            ...prev,
            name:        c.name        ?? prev.name,
            description: c.description ?? prev.description,
            symbol:      c.symbol      ?? prev.symbol,
            blockchain:  c.network ?? 'ethereum',
            width:       c.formatWidth  ?? prev.width,
            height:      c.formatHeight ?? prev.height,
            supply:      c.supply       ?? prev.supply,
            nameFormat:  c.nameFormat   ?? prev.nameFormat,
            format:      c.formatType   ?? prev.format,
          }));
          if (Array.isArray(c.conflictRules)) setConflicts(c.conflictRules);
        });
      }
      // No session cookie (e.g. a fresh browser, cleared cookies, or a
      // different artist who has never used this tool yet) means a fresh,
      // empty Settings tab — nothing more to do here. This used to fall back
      // to auto-loading the single most-recently-created collection in the
      // whole DB and silently attaching this browser's session to it, which
      // meant any artist with no cookie yet could land on and start editing
      // (or worse, re-generating over) a completely different artist's
      // collection. Never assume "no cookie" means "resume somebody else's work."
    });
  }, []);

  const handleWeightChange = useCallback((folder: string, stem: string, value: number) => {
    setWeights(prev => ({ ...prev, [folder]: { ...prev[folder], [stem]: value } }));

    // Weight lives on the trait row itself now — find its id and persist there.
    const traitId = layers.find(l => l.folder === folder)?.assets.find((a: LayerAsset) => a.stem === stem)?.id;
    if (!traitId) {
      // Layers state hasn't caught up with what's on screen yet — don't pretend the
      // edit was saved. Revert the optimistic update so the UI never shows a value
      // that was never persisted.
      setWeights(prev => {
        const original = layers.find(l => l.folder === folder)?.assets.find((a: LayerAsset) => a.stem === stem)?.defaultWeight;
        if (original == null) return prev;
        return { ...prev, [folder]: { ...prev[folder], [stem]: original } };
      });
      console.error(`Rarity weight edit for "${stem}" in "${folder}" could not be saved — trait not found yet. Please try again.`);
      return;
    }
    fetch(`/api/nft-gen/traits/${traitId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        value > 0 ? { rarityWeight: Math.max(1, Math.round(value)), isActive: true } : { isActive: false }
      ),
    }).then(async res => {
      if (!res.ok) {
        // Surface the server's actual reason — a validation rejection isn't
        // a network problem, and lumping both under one generic message
        // hides which one actually happened.
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `PUT /api/nft-gen/traits/${traitId} failed (${res.status})`);
      }
    }).catch(err => {
      // A failed save here used to only log to the console — the slider/tier
      // value stayed optimistically updated on screen with zero indication
      // it never actually persisted, which reads as "sometimes my selection
      // just doesn't take" with no way to tell why.
      console.error('Rarity weight save failed:', err);
      const asset = layers.find(l => l.folder === folder)?.assets.find((a: LayerAsset) => a.stem === stem);
      setWeights(prev => {
        if (asset?.defaultWeight == null) return prev;
        return { ...prev, [folder]: { ...prev[folder], [stem]: asset.defaultWeight } };
      });
      // Full technical detail stays in the console for debugging — the
      // artist-facing message stays plain, and names the trait by its
      // display name rather than the raw file stem she never sees elsewhere.
      setWeightSaveError(`Couldn't save the rarity change for "${asset?.name ?? stem}". Please try again.`);
    });
  }, [layers]);

  async function saveConflicts(rules: ConflictRule[]) {
    const prevConflicts = conflicts;
    setConflicts(rules);
    if (!collectionId) return;
    setConflictSaveError('');
    try {
      const r = await fetch(`/api/nft-gen/collections/${collectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conflictRules: rules }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        // Roll back the optimistic UI update — a rule that only "looks" saved
        // is worse than one that visibly failed, since the artist would have
        // no way to know it never persisted. The raw backend reason goes to
        // the console for debugging; what she sees stays plain and calm.
        console.error(`[saveConflicts] rule save failed (${r.status}):`, d.error);
        setConflicts(prevConflicts);
        setConflictSaveError("Couldn't save this rule. Please try again.");
        if (r.status === 404) {
          fetch('/api/session/collection', { method: 'DELETE' }).catch(() => {});
          setCollectionId(null);
          setSessionRestored(false);
          setCollection(DEFAULT_COLLECTION);
        }
      }
    } catch {
      setConflicts(prevConflicts);
      setConflictSaveError('Rule save failed — check your connection and try again.');
    }
  }

  async function handleToggleOptional(folder: string, optional: boolean) {
    const layerId = layers.find(l => l.folder === folder)?.id;
    if (!layerId) return;
    await fetch(`/api/nft-gen/layers/${layerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layerRarityPct: optional ? 80 : 100 }),
    });
    loadLayers();
  }

  async function handleSaveLayerMeta(folder: string, meta: { displayName?: string; isActive?: boolean; layerRarityPct?: number }) {
    const layerId = layers.find(l => l.folder === folder)?.id;
    if (!layerId) return;
    await fetch(`/api/nft-gen/layers/${layerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    }).catch(() => { });
    loadLayers();
  }

  async function handleRenameTrait(asset: { id?: string }, name: string) {
    if (!asset.id) return;
    await fetch(`/api/nft-gen/traits/${asset.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => { });
    loadLayers();
  }

  // Create/update collection in DB, then sync layers from disk
  async function handleCollectionContinue() {
    setSyncing(true);
    setSyncError('');
    try {
      // Create or update collection in DB
      let cid = collectionId;
      if (!cid) {
        const r = await fetch('/api/nft-gen/collections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: collection.name,
            description: collection.description,
            symbol: collection.symbol,
            network: collection.blockchain,
            formatWidth: collection.width ?? null,
            formatHeight: collection.height ?? null,
            shuffleOutput: true,
            supply:     collection.supply,
            nameFormat: collection.nameFormat,
            formatType: collection.format,
          }),
        });
        const data = await r.json();
        cid = data?.collection?.id ?? data?.id ?? null;
        if (cid) {
          setCollectionId(cid);
          // The collection itself is already saved at this point — this
          // cookie is only "which collection to resume on a fresh page
          // load." A silently-swallowed failure here left real, saved data
          // indistinguishable from data loss on the next visit (Organize
          // tab shows "No layers yet" with 214 real traits sitting in the
          // DB). One retry, then a visible (non-fatal) warning instead of
          // silence if it still doesn't take.
          const rememberCollection = () => fetch('/api/session/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              collectionId: cid,
              name:   collection.name,
              supply: collection.supply,
            }),
          });
          let remembered = await rememberCollection().then(r => r.ok).catch(() => false);
          if (!remembered) remembered = await rememberCollection().then(r => r.ok).catch(() => false);
          if (!remembered) {
            setSyncError('Collection saved, but this browser could not remember it for next time — reloading this page may show an empty Organize tab. Avoid refreshing until you finish this session.');
          }
        }
      } else {
        // Update existing — sync all editable fields back to DB
        await fetch(`/api/nft-gen/collections/${cid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name:         collection.name,
            description:  collection.description,
            symbol:       collection.symbol,
            network:      collection.blockchain,
            formatWidth:  collection.width  ?? null,
            formatHeight: collection.height ?? null,
            supply:       collection.supply,
            nameFormat:   collection.nameFormat,
            formatType:   collection.format,
          }),
        });
        await fetch('/api/session/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collectionId: cid, supply: collection.supply }),
        }).catch(() => {});
      }

      // Sync layers into DB — only when the user drag-dropped files this session.
      // With no fresh manifest, the DB already holds whatever was last synced;
      // there's no local-disk fallback to fall back to anymore.
      if (cid) {
        if (layers.length > 0) {
          const syncResp = await fetch(`/api/nft-gen/collections/${cid}/sync-from-disk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layers }),
          });
          if (!syncResp.ok) {
            const d = await syncResp.json().catch(() => ({}));
            throw new Error(d.error ?? 'Layer sync failed — please check your connection and try again.');
          }
        }
        // Persist any rules parsed from an Excel upload this session — for a
        // brand-new collection, saveConflicts() couldn't PUT them earlier
        // (collectionId was still null at upload time, see onConflictsChange
        // above), so it only updated local state. Harmless to call again for
        // an existing/resumed collection whose rules were already persisted
        // on upload — same array, idempotent PUT.
        if (conflicts.length > 0) await saveConflicts(conflicts);
        loadLayers(undefined, cid);

        // Re-fetch collection from DB so form reflects what was actually stored
        fetch(`/api/nft-gen/collections/${cid}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            const c = data?.collection ?? data;
            if (!c?.id) return;
            setCollection(prev => ({
              ...prev,
              name:        c.name        ?? prev.name,
              description: c.description ?? prev.description,
              symbol:      c.symbol      ?? prev.symbol,
              blockchain:  c.network ?? prev.blockchain,
              width:       c.formatWidth  ?? prev.width,
              height:      c.formatHeight ?? prev.height,
              supply:      c.supply       ?? prev.supply,
              nameFormat:  c.nameFormat   ?? prev.nameFormat,
              format:      c.formatType   ?? prev.format,
            }));
          })
          .catch(() => {});
      }

      goToStep('organize');
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : 'Failed to create collection');
    } finally {
      setSyncing(false);
    }
  }

  function resetCollection() {
    // Only clean up an upload that was never actually saved — collectionId
    // is set the moment a collection is either freshly saved OR resumed
    // from a prior session, so its layer files are real, persisted data at
    // that point and must never be touched here. Only a still-null
    // collectionId means "uploaded but abandoned before Save & Continue,"
    // which is the one case this cleanup exists for. And even then, only
    // this session's own upload folder (its random prefix, e.g.
    // "umt9sfflbxu1zrk") is ever touched — never the whole shared bucket,
    // which holds every artist's layers side by side. A bucket-wide wipe
    // here previously destroyed other artists'/other collections' files
    // (including a fully-generated one) the instant anyone clicked "Start
    // a new collection."
    const sessionPrefix = !collectionId ? layers[0]?.assets[0]?.rel?.split('/')[0] : undefined;
    setCollection(DEFAULT_COLLECTION);
    setCollectionId(null);
    setSessionRestored(false);
    setSyncError('');
    setLayers([]);
    fetch('/api/session/collection', { method: 'DELETE' }).catch(() => {});
    if (sessionPrefix) {
      fetch('/api/nft-gen/layers/clear-bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: sessionPrefix }),
      }).catch(() => {});
    }
  }

  const activeLayer = layers.find(l => l.folder === activeFolder) ?? null;

  return (
    <LayerFilesProvider>
      <div className="studio-wrap">
        {/* ── Header ── */}
        <header className="header">
          <div className="logo">🐻 Bearth <span>NFT Studio</span></div>
          <StepNav step={step} onStep={goToStep} />
          <div style={{ minWidth: 120 }} />
        </header>

        {/* ── Step 1: Settings ── */}
        {step === 'settings' && (
          <CollectionSetup
            collection={collection}
            onChange={setCollection}
            onNext={handleCollectionContinue}
            onReset={resetCollection}
            onLayersChange={loadLayers}
            onConflictsChange={saveConflicts}
            syncing={syncing}
            syncError={syncError}
            sessionRestored={sessionRestored}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            collectionId={collectionId as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onDismissRestore={(() => setSessionRestored(false)) as any}
          />
        )}

        {/* ── Step 2: Organize ── */}
        {step === 'organize' && (
          <div className="org-layout">
            <Sidebar
              layers={layers}
              collectionId={collectionId}
              activeFolder={activeFolder}
              onSelect={setActiveFolder}
              onLayersChange={loadLayers}
              onGearClick={openLayerModal}
              onToggleOptional={handleToggleOptional}
              onReorder={(newFolderOrder: string[]) => {
                // Apply the user's drag order immediately in state — no refetch.
                // Refetching would re-sort numerically and undo the drag.
                const map = new Map(layers.map(l => [l.folder, l]));
                const reordered = newFolderOrder.map(f => map.get(f)).filter(Boolean) as Layer[];
                setLayers(reordered);

                const items = reordered
                  .map((l, i) => ({ id: l.id, sortOrder: i }))
                  .filter((i): i is { id: string; sortOrder: number } => !!i.id);
                if (!items.length || !collectionId) return;
                fetch(`/api/nft-gen/collections/${collectionId}/layers/reorder`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ items }),
                }).catch(() => {});
              }}
            />
            <div className="org-main">
              {layers.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--dim)', textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 40 }}>🗂️</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>No layers yet</div>
                  <div style={{ fontSize: 13 }}>
                    Go to <strong>Settings</strong> and drop your layers folder into the import zone to get started.
                  </div>
                  <button className="btn btn-ghost" onClick={() => goToStep('settings')} style={{ marginTop: 8 }}>
                    ← Back to Settings
                  </button>
                </div>
              ) : activeLayer ? (
                <LayerContent
                  key={activeFolder}
                  layer={activeLayer}
                  layerWeights={weights[activeFolder!] ?? {}}
                  allWeights={weights}
                  supply={collection.supply}
                  // Same session-prefix namespace every layer in this
                  // collection already shares (from the initial bulk
                  // upload) — derived from ANY layer that already has an
                  // asset, not just the active one, since the active layer
                  // itself may still be empty. Adding files here without
                  // this would land in an unscoped flat key that a
                  // different artist's own upload could collide with —
                  // the exact incident this project's own upload route
                  // comment already documents.
                  sessionPrefix={layers.flatMap(l => l.assets ?? []).find(a => a?.rel)?.rel?.split('/')[0]}
                  onWeightChange={handleWeightChange}
                  onLayersChange={loadLayers}
                  onGenerate={() => goToStep('preview')}
                  onOpenLayerModal={openLayerModal}
                />
              ) : (
                <div className="loading"><div className="spinner" /></div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Rarity ── */}
        {/* Unreachable while StepNav's SHOW_RARITY_TAB flag is false — the nav never
            offers 'rarity' as a step, so setStep(...) can't land here. Kept (not
            deleted) so the tab can be restored by flipping that one flag. */}
        {step === 'rarity' && (
          <RarityTab
            layers={layers}
            weights={weights}
            collection={collection}
          />
        )}

        {/* ── Step 4: Preview ── */}
        {step === 'preview' && (
          <PreviewPanel
            weights={weights}
            layers={layers}
            collection={collection}
            conflicts={conflicts}
            collectionId={collectionId as never}
          />
        )}

        {/* ── Step 5: Export ── */}
        {step === 'export' && (
          <ExportPanel
            weights={weights}
            layers={layers as never[]}
            collection={collection}
            conflicts={conflicts}
            collectionId={collectionId as never}
          />
        )}

        {/* ── Layer gear modal (sidebar ⚙ click) ── */}
        {gearFolder && (() => {
          const gearLayer = layers.find(l => l.folder === gearFolder);
          if (!gearLayer) return null;
          return (
            <RarityModal
              layer={gearLayer}
              weights={weights[gearFolder] ?? {}}
              supply={collection.supply}
              allLayers={layers}
              conflicts={conflicts}
              focusStem={gearFocusStem}
              onSaveConflicts={saveConflicts}
              conflictSaveError={conflictSaveError}
              weightSaveError={weightSaveError}
              onDismissWeightSaveError={() => setWeightSaveError('')}
              onSaveLayerMeta={(meta: { displayName?: string; layerRarityPct?: number }) => handleSaveLayerMeta(gearFolder, meta)}
              onRenameTrait={handleRenameTrait}
              onSave={(newWs: Record<string, number>) => {
                Object.entries(newWs).forEach(([stem, val]) => handleWeightChange(gearFolder, stem, val));
              }}
              onTraitSaved={loadLayers}
              onDelete={async (asset: { id?: string; rel?: string }) => {
                if (!asset.rel || !asset.id) return;
                await fetch(`/api/nft-gen/traits/${asset.id}`, { method: 'DELETE' });
                loadLayers();
              }}
              onClose={() => { setGearFolder(null); setGearFocusStem(null); }}
            />
          );
        })()}
      </div>
    </LayerFilesProvider>
  );
}
