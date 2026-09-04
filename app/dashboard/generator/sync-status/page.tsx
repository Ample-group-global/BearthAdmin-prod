// @ts-nocheck
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import SupplyBrowseModal from './components/SupplyBrowseModal';

// ── Types ─────────────────────────────────────────────────────────────────────
interface CollectionRow {
  srNo:           number;
  collectionId:   string;
  collectionName: string;
  supply:         number;
  createdAt:      string;
  jobId:          string | null;
  jobStatus:      string | null;
  filebaseCount:  number;
  filebaseTotal:  number;
  recordsCount:   number;
  filebaseSynced: boolean;
  recordsSynced:  boolean;
}

interface RowState {
  filebase: 'idle' | 'running' | 'done' | 'error';
  records:  'idle' | 'running' | 'done' | 'error';
  message:  string;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SyncStatusPage() {
  const [collections,    setCollections]    = useState<CollectionRow[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [pageError,      setPageError]      = useState('');
  const [rowStates,      setRowStates]      = useState<Record<string, RowState>>({});
  const [exportModal,    setExportModal]    = useState<{ collectionId: string; jobId: string; name: string } | null>(null);
  const [recordsModal,   setRecordsModal]   = useState<{ collectionId: string; jobId: string; name: string; count: number } | null>(null);
  // Set only when a sync attempt hit the "nft_records already holds a
  // different collection's data" conflict — offers force-retry instead of
  // just dead-ending on the error, since force was already supported
  // server-side with no way to reach it from this page.
  const [forceConflict,  setForceConflict]  = useState<{ collectionId: string; jobId: string; name: string; message: string } | null>(null);
  // Separate, deliberately more alarming modal — this wipes nft_records
  // entirely before rebuilding it from a bucket's real files, unlike the
  // per-collection sync above which only ever adds/updates rows.
  const [clearResyncModal, setClearResyncModal] = useState(false);
  const [clearResyncBucket, setClearResyncBucket] = useState('');
  const [clearResyncStatus, setClearResyncStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [clearResyncMessage, setClearResyncMessage] = useState('');
  // Click-a-collection's-Supply modal — reads Filebase directly, has no
  // relation to the DB-backed NFT List page (kept as a separate component).
  const [browseCollection, setBrowseCollection] = useState<{ name: string; supply: number } | null>(null);
  const [exportBucket,   setExportBucket]   = useState('');
  const [newBucket,      setNewBucket]      = useState('');
  const [bucketList,     setBucketList]     = useState<string[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const pollRefs = useRef<Record<string, any>>({});
  // Per-collection stall tracking — mirrors ExportPanel.tsx's resumable
  // export flow, so a large export started from this page recovers from a
  // killed invocation the same way instead of hanging on a dead exportId.
  const lastProgressRef = useRef<Record<string, number>>({});
  const lastProgressTimeRef = useRef<Record<string, number>>({});
  const resumeCountRef = useRef<Record<string, number>>({});
  const MAX_AUTO_RESUMES = 100;

  // ── Fetch collection sync status ──────────────────────────────────────────
  // silent=true skips the loading flag entirely -- used by the background
  // poll during an active export (every ~6s), which otherwise flipped the
  // same loading state as the real initial page load and made the whole
  // table + summary cards visibly unmount and reappear every cycle for the
  // full duration of any export.
  const fetchStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setPageError('');
    try {
      const r = await fetch('/api/nft-gen/collections/sync-status');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setCollections(data.collections ?? []);
    } catch (e: any) {
      setPageError(e.message ?? 'Failed to load status');
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Load bucket list when either modal that needs it opens
  useEffect(() => {
    if (!exportModal && !clearResyncModal) return;
    setBucketsLoading(true);
    fetch('/api/filebase/buckets')
      .then(r => r.ok ? r.json() : { buckets: [] })
      .then(data => {
        const names: string[] = (data.buckets ?? []).map((b: any) => b.name).filter(Boolean);
        setBucketList(names);
        // Never auto-select a bucket — see the identical fix/incident note
        // in ExportPanel.tsx. The admin must explicitly pick one every time.
      })
      .catch(() => {})
      .finally(() => setBucketsLoading(false));
  }, [exportModal, clearResyncModal]);

  // Cleanup all polling intervals on unmount
  useEffect(() => () => { Object.values(pollRefs.current).forEach(clearInterval); }, []);

  // ── Row state helpers ─────────────────────────────────────────────────────
  function patchRow(id: string, patch: Partial<RowState>) {
    setRowStates(prev => ({
      ...prev,
      [id]: { filebase: 'idle', records: 'idle', message: '', ...prev[id], ...patch },
    }));
  }

  // ── Filebase export ───────────────────────────────────────────────────────
  async function startFilebaseExport() {
    if (!exportModal) return;
    const { collectionId, jobId } = exportModal;
    const bucket = exportBucket === '__new__' ? newBucket.trim() : exportBucket;
    if (!bucket) return;
    setExportModal(null);
    resumeCountRef.current[collectionId] = 0;
    await runFilebaseExportAttempt(collectionId, jobId, bucket, 0);
  }

  async function runFilebaseExportAttempt(collectionId: string, jobId: string, bucket: string, resumeFrom: number) {
    const key = `${collectionId}:fb`;
    lastProgressRef.current[collectionId] = resumeFrom;
    lastProgressTimeRef.current[collectionId] = Date.now();
    patchRow(collectionId, {
      filebase: 'running',
      message: resumeFrom > 0 ? `Resuming from ${resumeFrom.toLocaleString()}…` : 'Starting export…',
    });

    try {
      const r = await fetch('/api/nft-gen/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId, jobId, bucket, syncToRecords: false, resumeFrom }),
      });
      let exportId: string;
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        // An export already running for this collection isn't a failure —
        // attach to its live progress instead of erroring out, same as
        // ExportPanel.tsx's main Studio export flow.
        if (r.status === 409 && err.exportId) {
          exportId = err.exportId;
          lastProgressRef.current[collectionId] = err.progress ?? resumeFrom;
          lastProgressTimeRef.current[collectionId] = Date.now();
          patchRow(collectionId, { message: err.phase ?? 'Attached to an in-progress export…' });
        } else {
          throw new Error(err.error ?? `HTTP ${r.status}`);
        }
      } else {
        exportId = (await r.json()).exportId;
      }

      let tick = 0;
      pollRefs.current[key] = setInterval(async () => {
        try {
          const pr = await fetch(`/api/nft-gen/export/${exportId}`);
          if (!pr.ok) return;
          const state = await pr.json();
          patchRow(collectionId, { message: state.phase ?? '' });
          tick++;
          if (tick % 3 === 0) fetchStatus({ silent: true });

          const newProgress = state.progress ?? 0;
          if (newProgress !== lastProgressRef.current[collectionId]) {
            lastProgressRef.current[collectionId] = newProgress;
            lastProgressTimeRef.current[collectionId] = Date.now();
          }

          if (state.status === 'done' || state.status === 'error') {
            clearInterval(pollRefs.current[key]);
            delete pollRefs.current[key];
            patchRow(collectionId, {
              filebase: state.status === 'done' ? 'done' : 'error',
              message:  state.status === 'done' ? `${state.total ?? 0} NFTs uploaded` : (state.error ?? 'Export failed'),
            });
            fetchStatus();
            return;
          }

          // Same 30s stall threshold as ExportPanel.tsx — a premature
          // reconnect against a still-alive invocation just attaches to it
          // (see the 409 handling above), so tightening this costs nothing.
          const stalledForMs = Date.now() - lastProgressTimeRef.current[collectionId];
          if (stalledForMs > 30_000) {
            // Before treating this as a real stall, check whether the export
            // actually already finished — an upload that completes right as
            // a poll is missed looks identical to a stalled one from here
            // (progress just stops changing either way), and restarting a
            // genuinely-finished export re-composites/re-uploads 9,999
            // already-correct files for nothing. A real bucket listing is
            // the only source that can't be fooled by a missed "done" poll.
            const supply = collections.find(c => c.collectionId === collectionId)?.supply ?? 0;
            if (supply > 0) {
              try {
                const br = await fetch(`/api/filebase/objects?bucket=${encodeURIComponent(bucket)}`);
                if (br.ok) {
                  const bdata = await br.json();
                  const imgCount = (bdata.objects ?? []).filter((o: any) =>
                    /^images\/\d+\.\w+$/.test(String(o.key ?? o.Key ?? ''))).length;
                  if (imgCount >= supply) {
                    clearInterval(pollRefs.current[key]);
                    delete pollRefs.current[key];
                    patchRow(collectionId, { filebase: 'done', message: `${supply.toLocaleString()} NFTs uploaded` });
                    fetchStatus();
                    return;
                  }
                }
              } catch { /* bucket check failed — fall through to normal stall handling below */ }
            }

            clearInterval(pollRefs.current[key]);
            delete pollRefs.current[key];
            const resumeCount = (resumeCountRef.current[collectionId] ?? 0) + 1;
            resumeCountRef.current[collectionId] = resumeCount;
            if (resumeCount > MAX_AUTO_RESUMES) {
              patchRow(collectionId, {
                filebase: 'error',
                message: `Export stalled at ${newProgress.toLocaleString()} after ${MAX_AUTO_RESUMES} automatic resume attempts.`,
              });
              return;
            }
            runFilebaseExportAttempt(collectionId, jobId, bucket, newProgress);
          }
        } catch { /* retry next tick */ }
      }, 2000);
    } catch (e: any) {
      patchRow(collectionId, { filebase: 'error', message: e.message ?? 'Export failed' });
    }
  }

  // ── Records sync ──────────────────────────────────────────────────────────
  async function runRecordsSync(collectionId: string, jobId: string, name: string, force: boolean) {
    patchRow(collectionId, { records: 'running', message: force ? 'Force syncing to NFT Records…' : 'Syncing to NFT Records…' });
    try {
      const r = await fetch('/api/nft-gen/export/sync-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, force }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const msg = err.error ?? `HTTP ${r.status}`;
        // Server-supported force retry existed with no way to reach it from
        // here — a real attempt just dead-ended on this exact message with
        // no path forward except a direct API call.
        if (!force && r.status === 409 && msg.includes('already holds data for')) {
          patchRow(collectionId, { records: 'idle', message: '' });
          setForceConflict({ collectionId, jobId, name, message: msg });
          return;
        }
        throw new Error(msg);
      }
      const { synced } = await r.json();
      patchRow(collectionId, { records: 'done', message: `${synced.toLocaleString()} records synced` });
      fetchStatus();
    } catch (e: any) {
      patchRow(collectionId, { records: 'error', message: e.message ?? 'Sync failed' });
    }
  }
  function startRecordsSync() {
    if (!recordsModal) return;
    const { collectionId, jobId, name } = recordsModal;
    setRecordsModal(null);
    runRecordsSync(collectionId, jobId, name, false);
  }
  function forceRecordsSync() {
    if (!forceConflict) return;
    const { collectionId, jobId, name } = forceConflict;
    setForceConflict(null);
    runRecordsSync(collectionId, jobId, name, true);
  }

  // ── Clear & resync all from Filebase ──────────────────────────────────────
  // Deliberately separate from the per-collection sync above: this deletes
  // EVERY row in nft_records first, then rebuilds it from whichever bucket
  // is given, using that bucket's real files as the source of truth — for
  // recovering from nft_records being lost or corrupted, or switching which
  // collection it holds. The backend route already required an explicit
  // bucket (no guessing, after a real incident where an unrelated bucket's
  // data got wiped); this only ever exposes that same requirement in the UI.
  async function startClearResync() {
    if (!clearResyncBucket.trim()) return;
    setClearResyncStatus('running');
    setClearResyncMessage('Deleting NFT Records and rebuilding from Filebase…');
    try {
      const r = await fetch('/api/nft-gen/jobs/sync-from-filebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: clearResyncBucket.trim() }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const { synced, skipped } = await r.json();
      setClearResyncStatus('done');
      setClearResyncMessage(`${synced.toLocaleString()} NFTs synced from ${clearResyncBucket}${skipped ? `, ${skipped} skipped` : ''}.`);
      fetchStatus();
    } catch (e: any) {
      setClearResyncStatus('error');
      setClearResyncMessage(e.message ?? 'Clear & resync failed');
    }
  }

  // ── Derived summary ───────────────────────────────────────────────────────
  const totalFbSynced  = collections.filter(c => c.filebaseSynced).length;
  const totalRecSynced = collections.filter(c => c.recordsSynced).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={styles.page} className="sync-page">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={styles.header} className="sync-header">
        <div style={styles.headerLeft}>
          <Link href="/dashboard/generator" style={styles.backLink}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/>
            </svg>
            NFT Studio
          </Link>
          <span style={{ color: 'var(--border)', margin: '0 4px' }}>›</span>
          <h1 style={styles.pageTitle}>Collection Sync Status</h1>
        </div>
        <div style={styles.headerActions} className="sync-header-actions">
          <button
            onClick={() => { setClearResyncBucket(''); setClearResyncStatus('idle'); setClearResyncMessage(''); setClearResyncModal(true); }}
            style={{ ...styles.refreshBtn, color: '#dc2626', borderColor: 'rgba(220,38,38,0.35)' }}
            title="Emergency recovery: wipes NFT Records and rebuilds it from a bucket's real files"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.518 11.598c.75 1.334-.213 2.987-1.743 2.987H3.482c-1.53 0-2.493-1.653-1.743-2.987L8.257 3.1zM11 14a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z" clipRule="evenodd"/>
            </svg>
            <span className="sync-btn-label">Clear &amp; Resync from Filebase</span>
          </button>
          <button onClick={fetchStatus} disabled={loading} style={styles.refreshBtn}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" className={loading ? 'spin' : undefined}>
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/>
            </svg>
            <span className="sync-btn-label">{loading ? 'Loading…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      {!loading && !pageError && collections.length > 0 && (
        <div style={styles.summaryGrid} className="sync-summary-grid">
          <StatCard label="Total Collections" value={String(collections.length)} accent="#818cf8" icon="layers" />
          <StatCard label="Filebase Synced"   value={`${totalFbSynced} / ${collections.length}`}  accent="#22c55e" icon="cloud" />
          <StatCard label="Records Synced"    value={`${totalRecSynced} / ${collections.length}`} accent="#3b82f6" icon="database" />
          <StatCard
            label="Total NFTs"
            value={collections.reduce((s, c) => s + c.supply, 0).toLocaleString()}
            accent="#f59e0b"
            icon="grid"
          />
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {pageError && (
        <div style={styles.errorBanner}>{pageError}</div>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={styles.loadingMsg}>
          <div style={styles.spinnerLg} className="spin" />
          Loading collection status…
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {!loading && !pageError && (
        <div style={styles.tableCard}>
          {collections.length === 0 ? (
            <div style={styles.emptyMsg}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.35, marginBottom: 12 }}>
                <path d="M3 7l2-3h14l2 3M3 7v12a1 1 0 001 1h16a1 1 0 001-1V7M3 7h18M9 11h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No collections yet</div>
              <div>Create one in{' '}
                <Link href="/dashboard/generator" style={{ color: '#60a5fa', fontWeight: 600 }}>NFT Studio</Link> to see it here.
              </div>
            </div>
          ) : (
            <div className="sync-table" role="table">
              <div className="sync-thead" role="rowgroup">
                <div className="sync-row sync-row-head" role="row">
                  <div className="sync-cell sync-cell-head" role="columnheader">#</div>
                  <div className="sync-cell sync-cell-head" role="columnheader">Collection</div>
                  <div className="sync-cell sync-cell-head" role="columnheader">Supply</div>
                  <div className="sync-cell sync-cell-head" role="columnheader">Filebase Sync</div>
                  <div className="sync-cell sync-cell-head" role="columnheader">NFT Records</div>
                  <div className="sync-cell sync-cell-head" role="columnheader">Actions</div>
                </div>
              </div>
              <div className="sync-tbody" role="rowgroup">
                {collections.map((col) => {
                  const rs  = rowStates[col.collectionId] ?? { filebase: 'idle', records: 'idle', message: '' };
                  const hasJob        = !!col.jobId;
                  const fbRunning     = rs.filebase === 'running';
                  const recRunning    = rs.records  === 'running';
                  const canFb         = hasJob && !col.filebaseSynced && rs.filebase === 'idle';
                  const canRec        = hasJob && col.filebaseSynced && !col.recordsSynced && rs.records === 'idle';
                  const allDone       = col.filebaseSynced && col.recordsSynced && rs.filebase === 'idle' && rs.records === 'idle';

                  return (
                    <div key={col.collectionId} className="sync-row" role="row">

                      {/* Sr. No */}
                      <div className="sync-cell" role="cell" data-label="#">
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{col.srNo}</span>
                      </div>

                      {/* Collection name + job info */}
                      <div className="sync-cell" role="cell" data-label="Collection">
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{col.collectionName}</div>
                          <div style={styles.subText}>
                            {hasJob
                              ? `Job ${col.jobId.slice(0, 8)}… · ${col.jobStatus}`
                              : 'No completed generation job'}
                          </div>
                          {col.createdAt && (
                            <div style={{ ...styles.subText, marginTop: 1 }}>
                              Created {new Date(col.createdAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Supply — click to browse every NFT straight from Filebase
                          (read-only check, separate from the NFT List/DB page) */}
                      <div className="sync-cell" role="cell" data-label="Supply">
                        <button
                          onClick={() => setBrowseCollection({ name: col.collectionName, supply: col.supply })}
                          title="Browse all NFTs for this collection directly from Filebase"
                          style={styles.supplyBtn}
                        >
                          {col.supply.toLocaleString()}
                        </button>
                      </div>

                      {/* Filebase sync */}
                      <div className="sync-cell" role="cell" data-label="Filebase Sync">
                        {fbRunning ? (
                          <RunningCell msg={rs.message || 'Exporting to Filebase…'} color="#60a5fa" />
                        ) : rs.filebase === 'error' ? (
                          <ErrorCell msg={rs.message} />
                        ) : rs.filebase === 'done' ? (
                          <DoneCell msg={rs.message} />
                        ) : (
                          <SyncBadge synced={col.filebaseSynced} count={col.filebaseCount} total={col.supply} />
                        )}
                      </div>

                      {/* NFT Records */}
                      <div className="sync-cell" role="cell" data-label="NFT Records">
                        {!hasJob ? (
                          <div style={styles.dimText}>Generate first</div>
                        ) : !col.filebaseSynced && rs.filebase === 'idle' ? (
                          <div style={styles.dimText}>Filebase sync required</div>
                        ) : recRunning ? (
                          <RunningCell msg={rs.message || 'Syncing records…'} color="#a78bfa" />
                        ) : rs.records === 'error' ? (
                          <ErrorCell msg={rs.message} />
                        ) : rs.records === 'done' ? (
                          <DoneCell msg={rs.message} />
                        ) : (
                          <SyncBadge synced={col.recordsSynced} count={col.recordsCount} total={col.supply} />
                        )}
                      </div>

                      {/* Actions */}
                      <div className="sync-cell" role="cell" data-label="Actions">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                          {/* Filebase export is no longer triggered from this
                              page — this page only shows status. Triggering it
                              here duplicated the Studio's own Parallel Export
                              flow with a separate, independently-buggy copy of
                              the same trigger/poll logic, which caused real
                              confusion (multiple job IDs, restart loops) on
                              Bearth Test1. Deep-link to the Studio instead. */}
                          {canFb && (
                            <Link href="/dashboard/generator" style={{ fontSize: 12, color: '#60a5fa', textDecoration: 'none', fontWeight: 600 }}>
                              Export in Studio →
                            </Link>
                          )}
                          {canRec && (
                            <ActionBtn
                              label="Sync → Records"
                              color="#8b5cf6"
                              onClick={() => setRecordsModal({ collectionId: col.collectionId, jobId: col.jobId, name: col.collectionName, count: col.filebaseCount })}
                            />
                          )}
                          {(fbRunning || recRunning) && (
                            <span style={{ color: '#60a5fa', fontSize: 12, fontWeight: 600 }}>Working…</span>
                          )}
                          {allDone && (
                            <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 700 }}>✓ All synced</span>
                          )}
                          {!hasJob && (
                            <Link href="/dashboard/generator" style={{ fontSize: 12, color: '#60a5fa', textDecoration: 'none', fontWeight: 600 }}>
                              Go to Studio →
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Filebase Export Modal ──────────────────────────────────────────── */}
      {exportModal && (
        <Overlay onClose={() => setExportModal(null)}>
          <ModalTitle>Export to Filebase</ModalTitle>
          <p style={styles.modalSub}>
            Select a bucket to export <strong>{exportModal.name}</strong> NFTs and metadata to Filebase IPFS.
            <br />nft_records will <em>not</em> be modified — use "Sync → Records" after confirming the export is correct.
          </p>
          <label style={styles.label}>Filebase Bucket</label>
          {bucketsLoading ? (
            <div style={styles.dimText}>Loading buckets…</div>
          ) : (
            <>
              <select
                value={exportBucket}
                onChange={e => { setExportBucket(e.target.value); if (e.target.value !== '__new__') setNewBucket(''); }}
                style={styles.select}
              >
                {bucketList.length === 0 && <option value="">— no buckets found —</option>}
                {bucketList.map(b => <option key={b} value={b}>{b}</option>)}
                <option value="__new__">+ Create new bucket…</option>
              </select>
              {exportBucket === '__new__' && (
                <input
                  style={{ ...styles.select, marginTop: 8 }}
                  placeholder="New bucket name"
                  value={newBucket}
                  onChange={e => setNewBucket(e.target.value)}
                  autoFocus
                />
              )}
            </>
          )}
          <div style={styles.modalFooter}>
            <button onClick={() => setExportModal(null)} style={styles.cancelBtn}>Cancel</button>
            <button
              onClick={startFilebaseExport}
              disabled={bucketsLoading || (exportBucket === '__new__' ? !newBucket.trim() : !exportBucket)}
              style={{ ...styles.confirmBtn('#3b82f6'), opacity: (bucketsLoading || (exportBucket === '__new__' ? !newBucket.trim() : !exportBucket)) ? 0.5 : 1 }}
            >
              Start Export
            </button>
          </div>
        </Overlay>
      )}

      {/* ── Records Sync Modal ─────────────────────────────────────────────── */}
      {recordsModal && (
        <Overlay onClose={() => setRecordsModal(null)}>
          <ModalTitle>Sync to NFT Records</ModalTitle>
          <p style={styles.modalSub}>
            Sync <strong>{recordsModal.count.toLocaleString()} NFTs</strong> from{' '}
            <strong>{recordsModal.name}</strong> into the <code style={{ background: 'var(--hover)', padding: '1px 5px', borderRadius: 4 }}>nft_records</code> table.
          </p>
          <div style={styles.warningBox}>
            Only run this when all NFT images and metadata are 100% confirmed correct. NFT Records data is never deleted — this is a permanent write.
          </div>
          <div style={styles.modalFooter}>
            <button onClick={() => setRecordsModal(null)} style={styles.cancelBtn}>Cancel</button>
            <button onClick={startRecordsSync} style={styles.confirmBtn('#8b5cf6')}>
              Confirm Sync
            </button>
          </div>
        </Overlay>
      )}

      {/* ── Force Sync Conflict Modal ──────────────────────────────────────── */}
      {forceConflict && (
        <Overlay onClose={() => setForceConflict(null)}>
          <ModalTitle>NFT Records Already Holds Different Data</ModalTitle>
          <p style={styles.modalSub}>{forceConflict.message}</p>
          <div style={styles.warningBox}>
            Forcing this sync leaves <strong>{forceConflict.name}</strong>&apos;s rows mixed in with whatever
            collection is already in <code style={{ background: 'var(--hover)', padding: '1px 5px', borderRadius: 4 }}>nft_records</code>.
            To fully replace it with just this collection, cancel here and use{' '}
            <strong>Clear &amp; Resync from Filebase</strong> instead.
          </div>
          <div style={styles.modalFooter}>
            <button onClick={() => setForceConflict(null)} style={styles.cancelBtn}>Cancel</button>
            <button onClick={forceRecordsSync} style={styles.confirmBtn('#dc2626')}>
              Force Sync Anyway
            </button>
          </div>
        </Overlay>
      )}

      {/* ── Clear & Resync From Filebase Modal ─────────────────────────────── */}
      {clearResyncModal && (
        <Overlay onClose={() => { if (clearResyncStatus !== 'running') setClearResyncModal(false); }}>
          <ModalTitle>Clear &amp; Resync NFT Records from Filebase</ModalTitle>
          <p style={styles.modalSub}>
            Deletes <strong>every row</strong> in <code style={{ background: 'var(--hover)', padding: '1px 5px', borderRadius: 4 }}>nft_records</code>,
            then rebuilds it entirely from the real files in whichever bucket you pick below — for recovering from
            corrupted/lost records, or switching which collection nft_records holds.
          </p>
          <div style={styles.warningBox}>
            This is destructive and cannot be undone. Pick the bucket carefully — the wrong bucket wipes real data
            and replaces it with the wrong collection.
          </div>
          <label style={{ ...styles.label, marginTop: 12 }}>Filebase Bucket</label>
          <select
            value={clearResyncBucket}
            onChange={e => setClearResyncBucket(e.target.value)}
            disabled={clearResyncStatus === 'running'}
            style={styles.select}
          >
            <option value="">— select bucket —</option>
            {bucketList.length === 0 && <option value="" disabled>— no buckets found —</option>}
            {bucketList.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          {clearResyncMessage && (
            <div style={{ marginTop: 12, fontSize: 13, color: clearResyncStatus === 'error' ? '#dc2626' : 'var(--text-muted)' }}>
              {clearResyncMessage}
            </div>
          )}
          <div style={styles.modalFooter}>
            <button onClick={() => setClearResyncModal(false)} disabled={clearResyncStatus === 'running'} style={styles.cancelBtn}>
              {clearResyncStatus === 'done' ? 'Close' : 'Cancel'}
            </button>
            <button
              onClick={startClearResync}
              disabled={!clearResyncBucket.trim() || clearResyncStatus === 'running'}
              style={styles.confirmBtn('#dc2626')}
            >
              {clearResyncStatus === 'running' ? 'Working…' : 'Delete & Resync'}
            </button>
          </div>
        </Overlay>
      )}

      {/* ── Browse-from-Filebase Modal ─────────────────────────────────────── */}
      {browseCollection && (
        <SupplyBrowseModal
          collectionName={browseCollection.name}
          supply={browseCollection.supply}
          onClose={() => setBrowseCollection(null)}
        />
      )}

      <style>{`
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }

        .sync-stat-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .sync-stat-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.12); }

        .sync-table { display: grid; grid-template-columns: 48px minmax(200px,2fr) 90px minmax(180px,1fr) minmax(180px,1fr) 160px; width: 100%; }
        .sync-thead { display: contents; }
        .sync-tbody { display: contents; }
        .sync-row { display: contents; }
        .sync-row:not(.sync-row-head):hover .sync-cell { background: var(--hover); }
        .sync-cell { padding: 15px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; min-width: 0; transition: background 0.12s ease; }
        .sync-cell-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); background: var(--hover); border-bottom: 2px solid var(--border); white-space: nowrap; }

        @media (max-width: 300px) {
          .sync-btn-label { display: none; }
        }

        @media (max-width: 860px) {
          .sync-page { padding: 16px !important; }
          .sync-header { flex-direction: column; align-items: flex-start !important; gap: 14px; }
          .sync-header-actions { width: 100%; }
          .sync-header-actions button { flex: 1; justify-content: center; }
          .sync-summary-grid { grid-template-columns: repeat(2, 1fr) !important; }

          .sync-table { display: block; }
          .sync-thead { display: none; }
          .sync-row { display: block; padding: 14px 16px; border-bottom: 1px solid var(--border); }
          .sync-row:hover { background: var(--hover); }
          .sync-cell { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 7px 0; border: none; background: none !important; }
          .sync-cell[data-label]::before {
            content: attr(data-label); font-size: 11px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.05em; color: var(--text-muted); flex: 0 0 auto; padding-top: 2px;
          }
          .sync-cell[data-label="#"] { display: none; }
        }

        @media (max-width: 480px) {
          .sync-summary-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const STAT_ICON_PATHS: Record<string, string> = {
  layers:   'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  cloud:    'M7 18a4 4 0 01-.5-7.97A5.5 5.5 0 0117.5 9.5 4 4 0 0117 18H7z',
  database: 'M12 3c-4.4 0-8 1.3-8 3s3.6 3 8 3 8-1.3 8-3-3.6-3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  grid:     'M4 4h6v6H4V4zM14 4h6v6h-6V4zM4 14h6v6H4v-6zM14 14h6v6h-6v-6z',
};

function StatCard({ label, value, accent, icon }: any) {
  return (
    <div style={styles.statCard} className="sync-stat-card">
      <div style={{ ...styles.statIconWrap, background: `${accent}1a`, color: accent }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d={STAT_ICON_PATHS[icon] ?? STAT_ICON_PATHS.grid} />
        </svg>
      </div>
      <div>
        <div style={styles.statLabel}>{label}</div>
        <div style={{ ...styles.statValue, color: accent }}>{value}</div>
      </div>
    </div>
  );
}

function SyncBadge({ synced, count, total }: any) {
  if (total === 0) {
    return <span style={styles.dimText}>No data</span>;
  }
  const pct = Math.round((count / total) * 100);
  if (synced) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#22c55e', fontSize: 18, lineHeight: 1 }}>✓</span>
        <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 14 }}>
          {count.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
    );
  }
  if (count > 0) {
    return (
      <div>
        <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: 14 }}>
          {count.toLocaleString()} / {total.toLocaleString()} ({pct}%)
        </span>
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${pct}%`, background: '#f59e0b' }} />
        </div>
      </div>
    );
  }
  return (
    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
      0 / {total.toLocaleString()} — not synced
    </span>
  );
}

function RunningCell({ msg, color }: any) {
  return (
    <div>
      <span style={{ color, fontSize: 13 }}>{msg}</span>
      <div style={styles.progressTrack}>
        <div style={{
          position: 'relative', height: '100%', width: '30%',
          background: color, borderRadius: 2,
          animation: 'shimmer 1.4s ease-in-out infinite',
        }} />
      </div>
    </div>
  );
}

function DoneCell({ msg }: any) {
  return <span style={{ color: '#22c55e', fontSize: 13, fontWeight: 600 }}>✓ {msg}</span>;
}

function ErrorCell({ msg }: any) {
  return <span style={{ color: '#ef4444', fontSize: 12 }}>{msg}</span>;
}

function ActionBtn({ label, color, onClick }: any) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 13px', fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: 'pointer',
      background: `${color}1a`, border: `1px solid ${color}55`, color, whiteSpace: 'nowrap',
    }}>
      {label}
    </button>
  );
}

function Th({ children, width }: any) {
  return (
    <th style={{
      padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)',
      width: width ?? undefined, whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

function Td({ children, center, muted, fw, fontSize }: any) {
  return (
    <td style={{
      padding: '15px 16px', verticalAlign: 'middle',
      textAlign: center ? 'center' : 'left',
      color: muted ? 'var(--text-muted)' : undefined,
      fontWeight: fw ?? undefined,
      fontSize: fontSize ?? undefined,
    }}>
      {children}
    </td>
  );
}

function Overlay({ children, onClose }: any) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '28px 32px', maxWidth: 500, width: '92%' }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function ModalTitle({ children }: any) {
  return <h3 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700 }}>{children}</h3>;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, any> = {
  page:       { padding: '24px 32px', maxWidth: 1280, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box' },
  header:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 14 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  headerActions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  pageTitle:  { margin: 0, fontSize: 22, fontWeight: 800 },
  backLink:   { display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', textDecoration: 'none', fontSize: 14, fontWeight: 500 },
  refreshBtn: {
    display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px',
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
    cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap',
  },
  summaryGrid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 },
  statCard:     { display: 'flex', alignItems: 'center', gap: 14, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  statIconWrap: { width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statLabel:    { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 },
  statValue:    { fontSize: 22, fontWeight: 800 },
  supplyBtn:    { background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: 16, color: 'var(--text)', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 3 },
  errorBanner:  { padding: '14px 18px', background: '#1e1e1e', border: '1px solid #ef4444', borderRadius: 9, color: '#ef4444', marginBottom: 20, fontSize: 14 },
  loadingMsg:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', padding: 64, color: 'var(--text-muted)', fontSize: 15 },
  spinnerLg:    { width: 28, height: 28, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: '#60a5fa' },
  tableCard:    { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  table:        { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  thead:        { background: 'var(--hover)', borderBottom: '2px solid var(--border)' },
  emptyMsg:     { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 },
  subText:      { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  dimText:      { color: 'var(--text-muted)', fontSize: 13 },
  progressTrack: { marginTop: 5, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', width: 130 },
  progressFill:  { height: '100%', borderRadius: 2, transition: 'width 0.4s ease' },
  // Modal
  modalSub:   { margin: '0 0 18px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 },
  label:      { display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, color: 'var(--text-muted)' },
  select:     { width: '100%', padding: '9px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' },
  warningBox: { padding: '12px 16px', background: 'rgba(139,92,246,0.09)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, fontSize: 13, color: '#c4b5fd', marginBottom: 20, lineHeight: 1.5 },
  modalFooter: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 },
  cancelBtn:  { padding: '9px 18px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text)', fontSize: 14 },
  confirmBtn: (color: string) => ({ padding: '9px 20px', background: color, border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', fontSize: 14, fontWeight: 700 }),
};
