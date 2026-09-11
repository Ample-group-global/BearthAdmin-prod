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
  filebaseBucket: null as string | null,
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
    if (!effectiveCid) return;

    fetch(`/api/layers?collectionId=${effectiveCid}`)
      .then(r => r.json())
      .then((data: Layer[]) => { if (data.length) applyLayers(data); })
      .catch(() => { });
  }, [activeFolder, collectionId]);

  useEffect(() => {
    fetch('/api/session/collection').then(r => r.json()).catch(() => ({})).then((sessionData) => {
      const savedId: string | null = sessionData?.collectionId ?? null;
      loadLayers(undefined, savedId || undefined);

      if (savedId) {
        setCollectionId(savedId);
        setSessionRestored(true);
        const s = sessionData?.supply;
        if (s && s > 0) setCollection(prev => ({ ...prev, supply: s }));
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
            filebaseBucket: c.filebaseBucket ?? prev.filebaseBucket,
          }));
          if (Array.isArray(c.conflictRules)) setConflicts(c.conflictRules);
        });
      }
    });
  }, []);

  const handleWeightChange = useCallback((folder: string, stem: string, value: number) => {
    setWeights(prev => ({ ...prev, [folder]: { ...prev[folder], [stem]: value } }));

    const traitId = layers.find(l => l.folder === folder)?.assets.find((a: LayerAsset) => a.stem === stem)?.id;
    if (!traitId) {
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
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `PUT /api/nft-gen/traits/${traitId} failed (${res.status})`);
      }
    }).catch(err => {
      console.error('Rarity weight save failed:', err);
      const asset = layers.find(l => l.folder === folder)?.assets.find((a: LayerAsset) => a.stem === stem);
      setWeights(prev => {
        if (asset?.defaultWeight == null) return prev;
        return { ...prev, [folder]: { ...prev[folder], [stem]: asset.defaultWeight } };
      });
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

  async function handleCollectionContinue() {
    setSyncing(true);
    setSyncError('');
    try {
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
            conflictRules: conflicts.length > 0 ? conflicts : undefined,
          }),
        });
        const data = await r.json();
        cid = data?.collection?.id ?? data?.id ?? null;
        if (cid) {
          setCollectionId(cid);
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
            conflictRules: conflicts.length > 0 ? conflicts : undefined,
          }),
        });
        await fetch('/api/session/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collectionId: cid, supply: collection.supply }),
        }).catch(() => {});
      }

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
        if (conflicts.length > 0) await saveConflicts(conflicts);
        loadLayers(undefined, cid);

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
              filebaseBucket: c.filebaseBucket ?? prev.filebaseBucket,
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
        <header className="header">
          <div className="logo">🐻 Bearth <span>NFT Studio</span></div>
          <StepNav step={step} onStep={goToStep} />
          <div style={{ minWidth: 120 }} />
        </header>

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

        {step === 'rarity' && (
          <RarityTab
            layers={layers}
            weights={weights}
            collection={collection}
          />
        )}

        {step === 'preview' && (
          <PreviewPanel
            weights={weights}
            layers={layers}
            collection={collection}
            conflicts={conflicts}
            collectionId={collectionId as never}
          />
        )}

        {step === 'export' && (
          <ExportPanel
            weights={weights}
            layers={layers as never[]}
            collection={collection}
            conflicts={conflicts}
            collectionId={collectionId as never}
          />
        )}

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
