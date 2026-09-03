// @ts-nocheck
'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import NftPopup from './NftPopup';
import { TIER_META, Spinner, CheckIcon, RarityCard, ProgressBar, HLayerFilter } from './ExportGridParts';
import { fetchWithTimeout } from '../../../../lib/fetchWithTimeout';

// Every `error` field this component reads is assumed to be a plain string
// from our own Express error handler, but Vercel's own platform-level error
// responses (a function that times out or crashes before our code runs at
// all) return `error` as a nested {code, message} object instead. Feeding
// that object straight into `new Error(x)` or a template literal silently
// stringifies it to the literal text "[object Object]" -- confirmed live
// during Bearth V2's export ("Slice 5 failed to start: [object Object]").
// Route every error-field read through this so any shape produces a real
// message instead.
function errText(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (typeof e === 'object') {
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.code === 'string' && e.code) return e.code;
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ExportPanel({ weights, layers: layersProp = [], collection, conflicts, collectionId = null }) {
  const supply = Number(collection?.supply ?? 0);
  const targetW = collection?.width ?? null;
  const targetH = collection?.height ?? null;
  const wantWebp = collection?.format === 'webp';
  const imgExt = wantWebp ? 'webp' : 'png';
  const imgMime = wantWebp ? 'image/webp' : 'image/png';
  const nameFormat = collection?.nameFormat ?? '';
  const description = collection?.description ?? '';
  const collName = collection?.name ?? '';
  const THUMB = Math.min(280, targetW);
  const scale = Math.min(THUMB / targetW, THUMB / targetH, 1);
  const tW = Math.max(1, Math.round(targetW * scale));
  const tH = Math.max(1, Math.round(targetH * scale));

  const [phase, setPhase] = useState<'idle' | 'done'>('idle');
  const [sortBy, setSortBy] = useState<'rarity' | 'id'>('rarity');
  const [popup, setPopup] = useState(null);
  const [error, setError] = useState('');
  const [dbError, setDbError] = useState('');
  const [dbSaving, setDbSaving] = useState(false);
  const [dbSaved, setDbSaved] = useState(false);
  // True generation/save can succeed while the separate call that fetches
  // those rows back for grid display still fails (transient timeout/5xx) —
  // previously that left the grid silently empty forever with the success
  // banners still claiming everything worked. This tracks that specific
  // failure so the UI can say so honestly instead of showing the generic
  // "No NFTs match this filter" message for a filter that was never set.
  const [gridLoadError, setGridLoadError] = useState(false);

  // ── Server-side export state ──────────────────────────────────────────────
  const [svrBucket, setSvrBucket] = useState('');
  const [svrNewBucket, setSvrNewBucket] = useState('');
  const [svrSyncRecords, setSvrSyncRecords] = useState(false);
  const [svrResumeFrom, setSvrResumeFrom] = useState(0);
  const [resumeDetecting, setResumeDetecting] = useState(false);
  const [resumeDetected, setResumeDetected] = useState<number | null>(null);
  const [bucketList, setBucketList] = useState<string[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [bucketsError, setBucketsError] = useState('');
  const [svrStatus, setSvrStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [svrProgress, setSvrProgress] = useState(0);
  const [svrTotal, setSvrTotal] = useState(0);
  const [svrPhase, setSvrPhase] = useState('');
  const [svrError, setSvrError] = useState('');
  const svrExportIdRef = useRef<string | null>(null);
  const svrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const svrStartTimeRef = useRef<number | null>(null);
  const svrTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [svrElapsedSec, setSvrElapsedSec] = useState(0);

  // ── Offline ZIP download progress ─────────────────────────────────────────
  const [dlStatus, setDlStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [dlBytes, setDlBytes] = useState(0);
  const [dlTotalBytes, setDlTotalBytes] = useState<number | null>(null);
  const [dlElapsedSec, setDlElapsedSec] = useState(0);
  const [dlError, setDlError] = useState('');
  const dlStartRef = useRef<number | null>(null);
  const dlTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Refresh CIDs state ────────────────────────────────────────────────────
  const [cidStatus, setCidStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [cidProgress, setCidProgress] = useState(0);
  const [cidTotal, setCidTotal] = useState(0);
  const [cidResolved, setCidResolved] = useState(0);
  const [cidSkipped, setCidSkipped] = useState(0);
  const [cidPhase, setCidPhase] = useState('');
  const [cidError, setCidError] = useState('');
  const cidPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Real missing-CID count shown up front — previously this whole section
  // was a collapsed "Advanced" block with no indication of whether it was
  // even needed, so the artist had no way to know to open it.
  // (effect that populates this lives further down, after parStatus exists)
  const [missingCidCount, setMissingCidCount] = useState<number | null>(null);

  // ── Server-side generation state ──────────────────────────────────────────
  const [svrGenStatus, setSvrGenStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [svrGenProgress, setSvrGenProgress] = useState(0);
  const [svrGenTotal, setSvrGenTotal] = useState(0);
  const [svrGenPhase, setSvrGenPhase] = useState('');
  const [svrGenError, setSvrGenError] = useState('');
  const svrGenPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [layerStatus, setLayerStatus] = useState<'loading' | 'ok' | 'empty' | 'unknown'>('loading');

  const [rarityItems, setRarityItems] = useState<any[]>([]);
  const [bitmapsVer, setBitmapsVer] = useState(0);
  const [filter, setFilter] = useState<{ folder: string; stem: string; layerLabel: string; assetName: string } | null>(null);
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [gridPage, setGridPage] = useState(0);
  const jobBitmaps = useRef<Record<string, ImageBitmap>>({});
  const [layers, setLayers] = useState<any[]>(layersProp);
  const lastFailedJobIdRef = useRef<string | null>(null);
  const dbJobIdRef = useRef<string | null>(null);
  const generationStartedRef = useRef(false);
  // editionNumber → itemId UUID (populated during persistToDb, used for IPFS CID writeback)
  const editionItemMapRef = useRef<Record<number, string>>({});
  useEffect(() => {
    if (!collectionId) { setLayerStatus('unknown'); return; }
    if ((layersProp as any[]).length > 0 || layers.length > 0) {
      setLayerStatus('ok');
      return;
    }
    setLayerStatus('loading');
    fetch(`/api/nft-gen/collections/${collectionId}/layers`)
      .then(r => r.ok ? r.json() : { layers: [] })
      .then(data => {
        const active = (data.layers ?? []).filter((l) => l.is_active !== false);
        setLayerStatus(active.length > 0 ? 'ok' : 'empty');
      })
      .catch(() => setLayerStatus('unknown'));
  }, [collectionId, (layersProp as any[]).length, layers.length]);

  // ── Load Filebase bucket list for export dropdown ────────────────────────
  function loadBuckets() {
    let cancelled = false;
    setBucketsLoading(true);
    setBucketsError('');
    fetch('/api/filebase/buckets')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load buckets (HTTP ${r.status})`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        const names: string[] = (data.buckets ?? []).map((b: any) => b.name).filter(Boolean);
        setBucketList(names);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setBucketsError(e?.message ?? 'Failed to load buckets — check your connection and retry.');
      })
      .finally(() => { if (!cancelled) setBucketsLoading(false); });
    return () => { cancelled = true; };
  }
  useEffect(() => loadBuckets(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-detect real resume point from the selected bucket ────────────────
  // "Resume from edition" used to default to 0 with no way to know the real
  // number without manually checking Filebase — if an artist's tab closed
  // mid-export (computer slept, connection dropped, she just navigated away)
  // and she came back and clicked Start Export again without knowing that
  // number, it would silently restart from scratch instead of continuing.
  // Detect how many images are already in the selected bucket and pre-fill
  // it automatically, so clicking Start Export always just picks up correctly.
  useEffect(() => {
    const bucket = svrBucket === '__new__' ? '' : svrBucket.trim();
    if (!bucket || svrStatus !== 'idle') { setResumeDetected(null); return; }
    let cancelled = false;
    setResumeDetecting(true);
    fetch(`/api/filebase/objects?bucket=${encodeURIComponent(bucket)}`)
      .then(r => r.ok ? r.json() : { objects: [] })
      .then(data => {
        if (cancelled) return;
        // A raw count of uploaded images is only a safe resume point if
        // completion is strictly contiguous from edition 1 — true for most
        // of a run, but NOT guaranteed for whichever batch was in flight
        // when it was interrupted (batches upload with internal
        // concurrency, so the last partial batch can finish a few editions
        // out of order). The server's resume loop trusts this cutoff
        // unconditionally (`if (editionNum <= resumeFrom) continue`), so
        // using a plain count here carries the same class of risk fixed in
        // startParallelExport() — just a narrower window. Compute the real
        // contiguous prefix instead.
        const doneEditions = new Set<number>();
        for (const o of (data.objects ?? [])) {
          const key = String(o.key ?? o.Key ?? '');
          const m = key.match(/^images\/(\d+)\.\w+$/);
          if (m) doneEditions.add(Number(m[1]));
        }
        let contiguous = 0;
        while (doneEditions.has(contiguous + 1)) contiguous++;
        setResumeDetected(contiguous);
        if (contiguous > 0) setSvrResumeFrom(contiguous);
      })
      .catch(() => { if (!cancelled) setResumeDetected(null); })
      .finally(() => { if (!cancelled) setResumeDetecting(false); });
    return () => { cancelled = true; };
  }, [svrBucket, svrStatus]);

  // ── Auto-restore done state from DB on mount ─────────────────────────────
  useEffect(() => {
    if (!collectionId || phase !== 'idle') return;
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled || generationStartedRef.current) return;
        if (attempt > 0) await new Promise(r => setTimeout(r, 5_000));
        try {
          if (cancelled || generationStartedRef.current) return;
          const r = await fetch(`/api/nft-gen/jobs?collectionId=${collectionId}&status=complete`);
          if (!r.ok || cancelled || generationStartedRef.current) continue;
          const data = await r.json();
          if (cancelled || generationStartedRef.current || !data.jobs?.length) return;
          const latestJob = data.jobs[0];
          if (generationStartedRef.current) return; // real generation won the race — don't set dbJobIdRef to a stale job
          dbJobIdRef.current = latestJob.id;
          const loaded = await loadAndDisplayFromDb(latestJob.id);
          if (cancelled || generationStartedRef.current) return;
          setSvrGenStatus('done');
          setDbSaved(true);
          setGridLoadError(!loaded);
          setFilter(null);
          setTierFilter(null);
          setPhase('done');

          // A real export (images + metadata + CIDs, run to completion) may
          // already exist from a PRIOR browser session or even a different
          // machine — svrStatus/exportDone are pure client-side state
          // (React state + localStorage) that only ever get set by the tab
          // that actually ran the export, so a fresh tab had no way to know
          // and would show "Generate" again with no Download button despite
          // the export being genuinely done. Confirmed live: exported a full
          // 9,999-item collection via one browser session, opened a second
          // one, saw no progress bar and no Download button at all.
          // export_bucket is persisted server-side on every export attempt
          // (single or parallel), so it's a reliable pointer to check
          // without asking the artist to re-pick a bucket first.
          if (latestJob.export_bucket) {
            try {
              const cidRes = await fetch(`/api/nft-gen/export/cid-status?jobId=${latestJob.id}`);
              if (cidRes.ok) {
                const cidData = await cidRes.json();
                if (!cancelled && !generationStartedRef.current && cidData.total > 0 && cidData.missing === 0) {
                  setSvrBucket(latestJob.export_bucket);
                  setDlBucket(latestJob.export_bucket);
                  setExportDone(true);
                }
              }
            } catch { /* best-effort — Download stays hidden if this fails, same as before */ }
          }
          return;
        } catch { /* retry */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId]);

  // ── Check for pre-built ZIP after server export completes ────────────────
  useEffect(() => {
    if (svrStatus !== 'done' || !dbJobIdRef.current) return;
    const bucket = svrBucket === '__new__' ? svrNewBucket.trim() : svrBucket.trim();
    const qs = bucket ? `?bucket=${encodeURIComponent(bucket)}` : '';
    fetch(`/api/nft-gen/export/presigned-zip/${dbJobIdRef.current}${qs}`)
      .then(r => r.ok ? r.json() : { ready: false })
      .then(d => { if (d.ready) setZipReady(true); })
      .catch(() => { });
  }, [svrStatus]);

  // ── Restore "export done" from a prior session, so a reload doesn't hide
  // Download for a job that already finished exporting ──────────────────────
  const [exportDone, setExportDone] = useState(false);
  useEffect(() => {
    if (!dbSaved || !dbJobIdRef.current) return;
    try {
      if (localStorage.getItem(`nft-export-done:${dbJobIdRef.current}`) === '1') setExportDone(true);
    } catch { /* ignore */ }
  }, [dbSaved]);

  // ── Server export helpers ─────────────────────────────────────────────────
  const MAX_AUTO_RESUMES = 100; // tighter 30s stall detection means more (much shorter) cycles per run
  const svrLastProgressRef = useRef(0);
  const svrLastProgressTimeRef = useRef(0);

  async function startServerExport() {
    const bucket = svrBucket === '__new__' ? svrNewBucket.trim() : svrBucket.trim();
    if (!bucket || !dbJobIdRef.current) return;
    setSvrStatus('running');
    setSvrError('');
    // Persisted per-job so Download can find the real export bucket even
    // after a page reload — without this, svrBucket resets to empty on
    // reload and Download would silently fall back to recompositing from
    // raw layers instead of reading the already-exported files, producing
    // metadata that doesn't match what's actually on Filebase (no IPFS CID).
    try { localStorage.setItem(`nft-export-bucket:${dbJobIdRef.current}`, bucket); } catch { /* storage unavailable — non-fatal */ }

    // Elapsed-time clock covers the whole effort (from this first click),
    // not just since the last reconnect — a stall-and-resume shouldn't reset
    // the artist's sense of "how long has this actually been running."
    svrStartTimeRef.current = Date.now();
    setSvrElapsedSec(0);
    if (svrTickRef.current) clearInterval(svrTickRef.current);
    svrTickRef.current = setInterval(() => {
      if (svrStartTimeRef.current) {
        setSvrElapsedSec(Math.floor((Date.now() - svrStartTimeRef.current) / 1000));
      }
    }, 1000);
    await runExportAttempt(svrResumeFrom || 0, bucket, 0);
  }

  async function runExportAttempt(resumeFrom: number, bucket: string, resumeCount: number) {
    setSvrProgress(resumeFrom);
    setSvrPhase(resumeFrom > 0 ? `Resuming from ${resumeFrom.toLocaleString()}…` : 'Starting…');
    svrLastProgressRef.current = resumeFrom;
    svrLastProgressTimeRef.current = Date.now();

    try {
      const r = await fetch('/api/nft-gen/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: dbJobIdRef.current,
          bucket,
          format: imgExt,
          width: targetW,
          height: targetH,
          collectionName: collName,
          description,
          nameFormat,
          syncToRecords: svrSyncRecords,
          resumeFrom,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        // "Already running" isn't a dead end — the server hands back that
        // job's own id and live progress specifically so we can attach to
        // it instead of just telling the artist to wait with no visibility
        // into how far along it is or how much longer it'll take. Falls
        // through to the same polling loop below instead of returning.
        if (r.status === 409 && d.exportId) {
          console.log(`[export] attaching to already-running export ${d.exportId} at ${d.progress ?? 0}/${d.total ?? supply}`);
          svrExportIdRef.current = d.exportId;
          setSvrStatus('running');
          setSvrTotal(d.total ?? supply);
          setSvrProgress(d.progress ?? 0);
          setSvrPhase(d.phase ?? 'Attached to an in-progress export…');
          svrLastProgressRef.current = d.progress ?? 0;
          svrLastProgressTimeRef.current = Date.now();
        } else {
          setSvrStatus('error');
          setSvrError(errText(d.error) || 'Server error');
          return;
        }
      } else {
        svrExportIdRef.current = d.exportId;
        setSvrTotal(d.total ?? supply);
      }

      let exportPollFailures = 0;
      svrPollRef.current = setInterval(async () => {
        let resp: Response;
        let pr: any = null;
        try {
          resp = await fetchWithTimeout(`/api/nft-gen/export/${svrExportIdRef.current}`);
          pr = await resp.json();
        } catch { exportPollFailures++; if (exportPollFailures >= 3) { clearInterval(svrPollRef.current!); svrPollRef.current = null; setSvrStatus('error'); setSvrError('Lost connection to server. Please try again.'); } return; }
        if (!resp.ok) {
          clearInterval(svrPollRef.current!); svrPollRef.current = null;
          setSvrStatus('error');
          setSvrError(errText(pr?.error) || 'Server restarted during export. Please try again.');
          return;
        }
        const newProgress = pr.progress ?? 0;
        setSvrProgress(newProgress);
        setSvrPhase(pr.phase ?? '');
        setSvrTotal(pr.total ?? supply);
        if (newProgress !== svrLastProgressRef.current) {
          svrLastProgressRef.current = newProgress;
          svrLastProgressTimeRef.current = Date.now();
        }
        if (pr.status === 'done') {
          setSvrStatus('done');
          // Persisted so Download stays visible across a reload — the artist
          // must not have to re-run the whole export just because she
          // refreshed the page after it already finished.
          try { localStorage.setItem(`nft-export-done:${dbJobIdRef.current}`, '1'); } catch { /* non-fatal */ }
          if (svrPollRef.current) { clearInterval(svrPollRef.current); svrPollRef.current = null; }
          if (svrTickRef.current) { clearInterval(svrTickRef.current); svrTickRef.current = null; }
          return;
        } else if (pr.status === 'error') {
          setSvrStatus('error');
          setSvrError(errText(pr.error) || 'Export failed');
          if (svrPollRef.current) { clearInterval(svrPollRef.current); svrPollRef.current = null; }
          if (svrTickRef.current) { clearInterval(svrTickRef.current); svrTickRef.current = null; }
          return;
        }

        // A normal active burst reports new progress every ~10-14s (real
        // measured data from today's runs) — 100s of silence was far more
        // conservative than the evidence justifies and left every stall
        // visible to the artist for a minute and a half before recovering.
        // 30s is still ~2-3x the normal cadence (comfortable margin against
        // a single slow image), but cuts the visible freeze time by more
        // than half. Safe to tighten because a premature reconnect attempt
        // against a genuinely-still-alive invocation just gets attached to
        // (see the 409 handling above) instead of causing any real harm.
        const stalledForMs = Date.now() - svrLastProgressTimeRef.current;
        if (stalledForMs > 30_000) {
          if (svrPollRef.current) { clearInterval(svrPollRef.current); svrPollRef.current = null; }
          if (resumeCount >= MAX_AUTO_RESUMES) {
            setSvrStatus('error');
            setSvrError(`Export stalled at ${newProgress.toLocaleString()} / ${supply.toLocaleString()} after ${MAX_AUTO_RESUMES} automatic resume attempts. Use "Resume from edition" below to continue manually.`);
            return;
          }
          setSvrPhase(`No progress for ${Math.round(stalledForMs / 1000)}s — auto-resuming from ${newProgress.toLocaleString()} (attempt ${resumeCount + 1}/${MAX_AUTO_RESUMES})…`);
          runExportAttempt(newProgress, bucket, resumeCount + 1);
        }
      }, 2000);
    } catch (e: any) {
      setSvrStatus('error');
      setSvrError(e.message ?? 'Failed to start server export');
    }
  }

  function cancelServerExport() {
    if (svrPollRef.current) { clearInterval(svrPollRef.current); svrPollRef.current = null; }
    if (svrTickRef.current) { clearInterval(svrTickRef.current); svrTickRef.current = null; }
    setSvrStatus('idle');
  }

  // ── Parallel (range-fan-out) export ───────────────────────────────────────
  // A single export invocation's throughput is capped by that instance's own
  // CPU allocation, regardless of concurrency settings within it — this
  // fans the collection out across several concurrent invocations instead,
  // each on its own instance, to get real wall-clock speedup for large
  // collections. Separate from the Server-Side Export above, which stays
  // exactly as-is for smaller/normal runs.
  const PARALLEL_SLICE_COUNT = 8;
  const [parStatus, setParStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [parSlices, setParSlices] = useState<Array<{ rangeStart: number; rangeEnd: number; progress: number; status: 'idle' | 'running' | 'done' | 'error' }>>([]);
  const [parError, setParError] = useState('');
  const [parElapsedSec, setParElapsedSec] = useState(0);
  const parStartTimeRef = useRef<number | null>(null);
  const parTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const parPollRefs = useRef<Record<number, ReturnType<typeof setInterval> | null>>({});
  const parLastProgressRef = useRef<Record<number, number>>({});
  const parLastProgressTimeRef = useRef<Record<number, number>>({});
  const parResumeCountRef = useRef<Record<number, number>>({});
  const PAR_MAX_AUTO_RESUMES = 100;

  // ── Keep the machine awake while an export is running ────────────────────
  // Every stall-recovery mechanism above (30s watchdog + auto-resume, both
  // for single-shot and per-slice parallel export) runs on browser-side
  // setInterval timers. Chrome throttles those in a backgrounded tab but
  // still fires them (just slower) — the one thing nothing here can survive
  // is the OS actually sleeping, which freezes JS execution entirely,
  // watchdog included. Confirmed as the real recurring cause of Bearth V7's
  // repeated export stalls (resumed only after manually re-engaging the
  // tab). The Wake Lock API prevents the screen/machine from sleeping for
  // as long as an export is active; it's auto-released by the browser
  // whenever the tab is hidden, so it's re-requested on regaining
  // visibility too — best-effort only (unsupported browsers/no permission
  // just fall back to the existing resume logic, same as before).
  const wakeLockRef = useRef<any>(null);
  useEffect(() => {
    const isExporting = svrStatus === 'running' || parStatus === 'running';
    if (!isExporting) {
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => { }); wakeLockRef.current = null; }
      return;
    }
    let cancelled = false;
    async function acquire() {
      try {
        if ('wakeLock' in navigator) {
          const lock = await (navigator as any).wakeLock.request('screen');
          if (cancelled) { lock.release().catch(() => { }); return; }
          wakeLockRef.current = lock;
        }
      } catch { /* unsupported or denied — export still has its own resume logic */ }
    }
    acquire();
    function onVisibility() {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) acquire();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [svrStatus, parStatus]);

  useEffect(() => {
    if (!dbSaved || !dbJobIdRef.current || cidStatus !== 'idle') return;
    let cancelled = false;
    const fetchMissing = () => {
      fetch(`/api/nft-gen/export/cid-status?jobId=${encodeURIComponent(dbJobIdRef.current!)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setMissingCidCount(d.missing ?? 0); })
        .catch(() => { });
    };
    fetchMissing();
    // A single fetch right after Generate finishes was accurate in that
    // moment (export hasn't started, everything really is missing a CID)
    // but then never updated again -- during a live 9,999-item export this
    // showed a frozen "9,999 missing" the whole way through even once the
    // real count had dropped to near-zero. Poll while either export path is
    // actually running so the count reflects live progress instead.
    let interval: ReturnType<typeof setInterval> | null = null;
    if (svrStatus === 'running' || parStatus === 'running') {
      interval = setInterval(fetchMissing, 20_000);
    }
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [dbSaved, cidStatus, svrStatus, parStatus]);

  function computeSliceRanges(total: number, count: number): Array<{ rangeStart: number; rangeEnd: number }> {
    const size = Math.ceil(total / count);
    const ranges: Array<{ rangeStart: number; rangeEnd: number }> = [];
    for (let start = 0; start < total; start += size) {
      ranges.push({ rangeStart: start, rangeEnd: Math.min(start + size, total) });
    }
    return ranges;
  }

  async function startParallelExport() {
    const bucket = svrBucket === '__new__' ? svrNewBucket.trim() : svrBucket.trim();
    if (!bucket || !dbJobIdRef.current) return;

    setParStatus('running');
    setParError('');
    parStartTimeRef.current = Date.now();
    setParElapsedSec(0);
    if (parTickRef.current) clearInterval(parTickRef.current);
    parTickRef.current = setInterval(() => {
      if (parStartTimeRef.current) setParElapsedSec(Math.floor((Date.now() - parStartTimeRef.current) / 1000));
    }, 1000);

    const ranges = computeSliceRanges(supply, PARALLEL_SLICE_COUNT);

    // Detect real per-slice resume points from one bucket listing. This
    // MUST be computed per-range from the actual edition numbers present,
    // not from a single bucket-wide count — 8 slices run truly in parallel
    // and do NOT fill editions sequentially from 1 upward, so a raw total
    // (e.g. 2,286 images) says nothing about which specific editions are
    // done. Confirmed live after an interrupted run: progress was scattered
    // roughly evenly across all 8 ranges (304/150/386/300/220/300/258/368),
    // not a contiguous block. The old code did
    // `min(doneImageCount, rangeEnd)` per slice, which treated an entire
    // low-numbered range as "fully done" from a count that really belonged
    // to work spread across every range — and the server's resume loop
    // (`if (editionNum <= resumeFrom) continue`) trusts that cutoff
    // unconditionally, so it would have silently skipped hundreds of
    // editions that were never actually generated, while reporting the
    // slice complete.
    let doneEditions = new Set<number>();
    try {
      const r = await fetch(`/api/filebase/objects?bucket=${encodeURIComponent(bucket)}`);
      if (r.ok) {
        const data = await r.json();
        for (const o of (data.objects ?? [])) {
          const key = String(o.key ?? o.Key ?? '');
          const m = key.match(/^images\/(\d+)\.\w+$/);
          if (m) doneEditions.add(Number(m[1]));
        }
      }
    } catch { /* fall back to empty — every slice starts fresh */ }

    // Per-range resume point = the highest edition such that EVERY edition
    // from rangeStart+1 up to it is actually present — a true contiguous
    // prefix within that slice's own range, not a borrowed global count.
    function contiguousResumePoint(rangeStart: number, rangeEnd: number) {
      let n = rangeStart;
      while (n < rangeEnd && doneEditions.has(n + 1)) n++;
      return n;
    }

    setParSlices(ranges.map(rg => ({
      ...rg,
      progress: contiguousResumePoint(rg.rangeStart, rg.rangeEnd) - rg.rangeStart,
      status: 'running' as const,
    })));

    ranges.forEach((rg, i) => {
      const sliceResumeFrom = contiguousResumePoint(rg.rangeStart, rg.rangeEnd);
      runParallelSliceAttempt(i, rg.rangeStart, rg.rangeEnd, sliceResumeFrom, bucket, 0);
    });
  }

  async function runParallelSliceAttempt(index: number, rangeStart: number, rangeEnd: number, resumeFrom: number, bucket: string, resumeCount: number) {
    parLastProgressRef.current[index] = resumeFrom - rangeStart;
    parLastProgressTimeRef.current[index] = Date.now();

    try {
      const r = await fetch('/api/nft-gen/export/range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: dbJobIdRef.current, bucket,
          format: imgExt, width: targetW, height: targetH,
          collectionName: collName, description, nameFormat,
          rangeStart, rangeEnd, resumeFrom,
        }),
      });
      let sliceId: string;
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (r.status === 409 && d.exportId) {
          sliceId = d.exportId;
        } else {
          throw new Error(errText(d.error) || `HTTP ${r.status}`);
        }
      } else {
        sliceId = (await r.json()).exportId;
      }

      if (parPollRefs.current[index]) clearInterval(parPollRefs.current[index]!);
      parPollRefs.current[index] = setInterval(async () => {
        try {
          const pr = await fetch(`/api/nft-gen/export/range/${encodeURIComponent(sliceId)}`);
          if (pr.ok) {
            const state = await pr.json();
            const newProgress = state.progress ?? 0;

            setParSlices(prev => prev.map((s, i) => i === index ? { ...s, progress: newProgress, status: state.status } : s));

            if (newProgress !== parLastProgressRef.current[index]) {
              parLastProgressRef.current[index] = newProgress;
              parLastProgressTimeRef.current[index] = Date.now();
            }

            if (state.status === 'done') {
              clearInterval(parPollRefs.current[index]!); parPollRefs.current[index] = null;
              return;
            }
            if (state.status === 'error') {
              clearInterval(parPollRefs.current[index]!); parPollRefs.current[index] = null;
              setParStatus('error');
              setParError(`Slice ${index + 1} failed: ${errText(state.error) || 'unknown error'}`);
              return;
            }
          }
          // A failed poll (non-2xx, e.g. 404 when the tracked slice's
          // in-memory state isn't reachable from whichever server instance
          // served this request) falls through to the SAME stall check
          // below instead of silently doing nothing. Confirmed live: the
          // old code's `if (!pr.ok) return` skipped the stall check
          // entirely on every failed poll, so a slice whose status checks
          // all 404'd sat frozen forever with the auto-resume watchdog
          // never getting a chance to fire — no error ever surfaced.
        } catch {
          // fetch() itself threw (e.g. offline) — same treatment, fall
          // through to the stall check rather than silently retrying.
        }

        const stalledForMs = Date.now() - parLastProgressTimeRef.current[index];
        if (stalledForMs > 30_000) {
          clearInterval(parPollRefs.current[index]!); parPollRefs.current[index] = null;
          const nextResumeCount = (parResumeCountRef.current[index] ?? 0) + 1;
          parResumeCountRef.current[index] = nextResumeCount;
          if (nextResumeCount > PAR_MAX_AUTO_RESUMES) {
            setParStatus('error');
            setParError(`Slice ${index + 1} stalled after ${PAR_MAX_AUTO_RESUMES} resume attempts.`);
            return;
          }
          runParallelSliceAttempt(index, rangeStart, rangeEnd, rangeStart + parLastProgressRef.current[index], bucket, nextResumeCount);
        }
      }, 2000);
    } catch (e: any) {
      setParStatus('error');
      setParError(`Slice ${index + 1} failed to start: ${errText(e?.message) || errText(e) || 'unknown error'}`);
    }
  }

  // Overall status derives from the slices themselves rather than being set
  // independently — avoids the two ever disagreeing.
  useEffect(() => {
    if (parStatus !== 'running' || parSlices.length === 0) return;
    if (parSlices.every(s => s.status === 'done')) {
      setParStatus('done');
      if (parTickRef.current) { clearInterval(parTickRef.current); parTickRef.current = null; }
      Object.values(parPollRefs.current).forEach(id => { if (id) clearInterval(id); });
    }
  }, [parSlices, parStatus]);

  const parTotalProgress = parSlices.reduce((sum, s) => sum + s.progress, 0);

  function formatDuration(totalSec: number): string {
    if (!Number.isFinite(totalSec) || totalSec < 0) return '—';
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  async function startRefreshCids() {
    const bucket = svrBucket === '__new__' ? svrNewBucket.trim() : svrBucket.trim();
    if (!bucket) return;
    setCidStatus('running');
    setCidProgress(0);
    setCidTotal(0);
    setCidResolved(0);
    setCidSkipped(0);
    setCidPhase('Starting…');
    setCidError('');

    try {
      const r = await fetch('/api/nft-gen/export/refresh-cids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, format: imgExt, jobId: dbJobIdRef.current, syncToRecords: svrSyncRecords }),
      });
      let d: any = null;
      try { d = await r.json(); } catch { /* empty or non-JSON body */ }
      if (!r.ok) { setCidStatus('error'); setCidError(errText(d?.error) || `Server error (${r.status})`); return; }
      const refreshId = d?.refreshId;
      if (!refreshId) { setCidStatus('error'); setCidError('No refreshId returned from server'); return; }

      let cidPollFailures = 0;
      cidPollRef.current = setInterval(async () => {
        let resp: Response;
        let pr: any = null;
        try {
          resp = await fetchWithTimeout(`/api/nft-gen/export/refresh-cids/${refreshId}`);
          pr = await resp.json();
        } catch {
          cidPollFailures++;
          if (cidPollFailures >= 3) {
            clearInterval(cidPollRef.current!); cidPollRef.current = null;
            setCidStatus('error'); setCidError('Lost connection to server.');
          }
          return;
        }
        if (!resp.ok) {
          clearInterval(cidPollRef.current!); cidPollRef.current = null;
          setCidStatus('error'); setCidError(errText(pr?.error) || 'Refresh failed');
          return;
        }
        setCidProgress(pr.progress ?? 0);
        setCidTotal(pr.total ?? 0);
        setCidResolved(pr.resolved ?? 0);
        setCidSkipped(pr.skipped ?? 0);
        setCidPhase(pr.phase ?? '');
        if (pr.status === 'done') {
          setCidStatus('done');
          clearInterval(cidPollRef.current!); cidPollRef.current = null;
        } else if (pr.status === 'error') {
          setCidStatus('error'); setCidError(errText(pr.error) || 'Refresh failed');
          clearInterval(cidPollRef.current!); cidPollRef.current = null;
        }
      }, 2000);
    } catch (e: any) {
      setCidStatus('error');
      setCidError(e.message ?? 'Failed to start CID refresh');
    }
  }

  async function downloadOfflineZip() {
    if (!dbJobIdRef.current) return;
    let bucket = svrBucket === '__new__' ? svrNewBucket.trim() : svrBucket.trim();
    if (!bucket) {
      // svrBucket resets to empty on a page reload — recover the real
      // export bucket from where startServerExport persisted it, so a
      // reload doesn't silently downgrade Download to the recompositing
      // fallback for a collection that was already exported.
      try { bucket = localStorage.getItem(`nft-export-bucket:${dbJobIdRef.current}`) ?? ''; } catch { /* ignore */ }
    }

    // Fast path: check if a pre-built ZIP exists in Filebase from the last
    // server-side export. If so, use the pre-signed URL directly (a plain
    // navigation, not fetch() — it's a direct cross-origin S3 URL, and
    // fetching it from the page would need Filebase's bucket CORS to allow
    // this origin, which a same-tab navigation never required).
    try {
      const qs = bucket ? `?bucket=${encodeURIComponent(bucket)}` : '';
      const r = await fetch(`/api/nft-gen/export/presigned-zip/${dbJobIdRef.current}${qs}`);
      if (r.ok) {
        const d = await r.json();
        if (d.ready && d.url) {
          window.location.href = d.url;
          return;
        }
      }
    } catch { /* fall through to streaming */ }

    // Streaming fallback: re-renders on the fly, same-origin through our own
    // API — read via fetch()+reader instead of a raw navigation so real
    // progress (bytes received, elapsed time) can be shown in the UI.
    setDlStatus('running');
    setDlBytes(0);
    setDlTotalBytes(null);
    setDlError('');
    dlStartRef.current = Date.now();
    setDlElapsedSec(0);
    if (dlTickRef.current) clearInterval(dlTickRef.current);
    dlTickRef.current = setInterval(() => {
      if (dlStartRef.current) setDlElapsedSec(Math.floor((Date.now() - dlStartRef.current) / 1000));
    }, 1000);

    try {
      const params = new URLSearchParams({
        format: imgExt,
        width: String(targetW),
        height: String(targetH),
        collectionName: collName,
        description,
        nameFormat,
        ...(bucket ? { bucket } : {}),
      });
      const resp = await fetch(`/api/nft-gen/export/download-zip/${dbJobIdRef.current}?${params.toString()}`);
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(errText(err.error) || `Download failed (${resp.status})`);
      }
      // The fast path can't send a real Content-Length (the ZIP is built
      // on the fly, exact final size isn't known upfront) — it sends an
      // estimated total instead, close enough for a progress bar.
      const estHeader = resp.headers.get('x-estimated-zip-bytes');
      const lenHeader = resp.headers.get('content-length');
      if (estHeader) setDlTotalBytes(Number(estHeader));
      else if (lenHeader) setDlTotalBytes(Number(lenHeader));

      const reader = resp.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          setDlBytes(received);
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' });
      const objUrl = URL.createObjectURL(blob);
      const safeName = (collName || 'bearth-nft-collection').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `${safeName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);

      setDlStatus('done');
    } catch (e: any) {
      setDlStatus('error');
      setDlError(e.message ?? 'Download failed');
    } finally {
      if (dlTickRef.current) { clearInterval(dlTickRef.current); dlTickRef.current = null; }
    }
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  // ── Direct-to-folder bulk download ────────────────────────────────────────
  // Same strategy as scripts/download-filebase-bucket.js: list every object,
  // skip anything already saved with a matching size (free resumability —
  // just re-click after a failure/close, no state to track), download the
  // rest with high concurrency straight from Filebase via presigned URLs
  // (bypassing the Vercel-proxied API for the actual bytes entirely, so
  // there's no single-request timeout to hit regardless of collection
  // size — the real reason the old one-big-zip-stream approach couldn't
  // work for a real ~5GB collection).
  const [bulkDlStatus, setBulkDlStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [bulkDlDone, setBulkDlDone] = useState(0);
  const [bulkDlTotal, setBulkDlTotal] = useState(0);
  const [bulkDlFailed, setBulkDlFailed] = useState(0);
  const [bulkDlFolderName, setBulkDlFolderName] = useState('');
  const [bulkDlError, setBulkDlError] = useState('');
  const [dlBucket, setDlBucket] = useState('');
  const BULK_DL_CONCURRENCY = 40;
  const BULK_DL_URL_BATCH = 500;

  // Pre-fill with the bucket this collection was actually exported to, as a
  // convenience — but she can still pick a different one. Read-only listing
  // is a much lower-risk operation than export's write path, where a wrong
  // guess previously overwrote a bucket that should never have been touched.
  useEffect(() => {
    if (dlBucket || !dbJobIdRef.current) return;
    const svr = svrBucket === '__new__' ? '' : svrBucket.trim();
    if (svr) { setDlBucket(svr); return; }
    try {
      const persisted = localStorage.getItem(`nft-export-bucket:${dbJobIdRef.current}`);
      if (persisted) setDlBucket(persisted);
    } catch { /* ignore */ }
  }, [svrBucket, exportDone]);

  async function downloadAllFilesDirect() {
    if (!dbJobIdRef.current) return;
    const effectiveBucket = dlBucket.trim();
    if (!effectiveBucket) { setBulkDlStatus('error'); setBulkDlError('Select a bucket to download from.'); return; }

    if (!('showDirectoryPicker' in window)) {
      setBulkDlStatus('error');
      setBulkDlError('This browser cannot save directly to a folder — use Chrome or Edge.');
      return;
    }

    let dirHandle: any;
    try {
      dirHandle = await (window as any).showDirectoryPicker();
    } catch {
      return; // user cancelled the folder picker — not an error
    }

    setBulkDlStatus('running');
    setBulkDlDone(0);
    setBulkDlFailed(0);
    setBulkDlError('');
    setBulkDlFolderName(dirHandle.name ?? '');

    try {
      const imagesDir = await dirHandle.getDirectoryHandle('images', { create: true });
      const metadataDir = await dirHandle.getDirectoryHandle('metadata', { create: true });

      const listRes = await fetch(`/api/filebase/objects?bucket=${encodeURIComponent(effectiveBucket)}`);
      if (!listRes.ok) throw new Error(`Failed to list bucket objects (${listRes.status})`);
      const { objects } = await listRes.json();
      const relevant: Array<{ key: string; size: number }> = (objects ?? [])
        .filter((o: any) => o.key && (o.key.startsWith('images/') || o.key.startsWith('metadata/')))
        .map((o: any) => ({ key: o.key, size: o.size ?? 0 }));

      setBulkDlTotal(relevant.length);

      // Skip anything already saved locally with the same size — this alone
      // is the entire resumability mechanism, exactly like the script.
      const toFetch: Array<{ key: string; size: number }> = [];
      let alreadyDone = 0;
      for (const obj of relevant) {
        const [prefix, filename] = [obj.key.split('/')[0], obj.key.split('/')[1]];
        const dir = prefix === 'images' ? imagesDir : metadataDir;
        try {
          const fh = await dir.getFileHandle(filename);
          const file = await fh.getFile();
          if (file.size === obj.size) { alreadyDone++; continue; }
        } catch { /* doesn't exist yet — needs fetching */ }
        toFetch.push(obj);
      }
      setBulkDlDone(alreadyDone);

      let failedKeys: string[] = [];
      let doneCount = alreadyDone;

      for (let i = 0; i < toFetch.length; i += BULK_DL_URL_BATCH) {
        const batch = toFetch.slice(i, i + BULK_DL_URL_BATCH);
        const urlRes = await fetch('/api/filebase/presigned-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: effectiveBucket, keys: batch.map(b => b.key) }),
        });
        if (!urlRes.ok) throw new Error(`Failed to get download URLs (${urlRes.status})`);
        const { urls } = await urlRes.json();

        let cursor = 0;
        async function worker() {
          while (cursor < batch.length) {
            const obj = batch[cursor++];
            const [prefix, filename] = [obj.key.split('/')[0], obj.key.split('/')[1]];
            const dir = prefix === 'images' ? imagesDir : metadataDir;
            try {
              const resp = await fetch(urls[obj.key]);
              if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
              const fh = await dir.getFileHandle(filename, { create: true });
              const writable = await fh.createWritable();
              await resp.body.pipeTo(writable);
              doneCount++;
              setBulkDlDone(doneCount);
            } catch {
              failedKeys.push(obj.key);
              setBulkDlFailed(f => f + 1);
            }
          }
        }
        await Promise.all(Array.from({ length: BULK_DL_CONCURRENCY }, worker));
      }

      setBulkDlStatus('done');
    } catch (e: any) {
      setBulkDlStatus('error');
      setBulkDlError(e.message ?? 'Download failed');
    }
  }

  const [zipReady, setZipReady] = useState(false);
  const [syncingLayers, setSyncingLayers] = useState(false);
  async function syncLayersNow() {
    if (!collectionId || syncingLayers) return;
    setSyncingLayers(true);
    setError('');
    try {
      // A real layer set legitimately takes several seconds even with the
      // bulk sync fix — give this a longer budget than the default so a
      // large collection doesn't get cut off mid-sync.
      const r = await fetchWithTimeout(`/api/nft-gen/collections/${collectionId}/sync-from-disk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: layersProp }),
      }, 60_000);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(errText(d.error) || 'Layer sync failed. Try again.'); return; }
      setLayerStatus(d.layersSynced > 0 ? 'ok' : 'empty');
      if (d.layersSynced === 0) setError('No layers were synced. Go to Settings → Continue to rebuild your layer list.');
    } catch {
      setError('Layer sync failed. Check your connection.');
    } finally {
      setSyncingLayers(false);
    }
  }

  async function generateOnServer() {
    if (!collectionId) { setError('Save collection settings before generating.'); return; }
    if (!collection?.supply) { setError('Collection size is still loading — wait a moment and try again.'); return; }
    generationStartedRef.current = true;
    setSvrGenStatus('running');
    setSvrGenProgress(0);
    setSvrGenTotal(supply);
    setSvrGenPhase('Starting…');
    setSvrGenError('');
    setError('');

    try {
      const r = await fetch('/api/nft-gen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId, editionSize: supply }),
      });
      const d = await r.json();
      if (!r.ok) { setSvrGenStatus('error'); setSvrGenError(errText(d.error) || 'Server error'); return; }

      const genId = d.generateId;
      let pollFailures = 0;
      svrGenPollRef.current = setInterval(async () => {
        let resp: Response;
        let pr: any = null;
        try {
          resp = await fetchWithTimeout(`/api/nft-gen/generate/${genId}`);
          pr = await resp.json();
        } catch { pollFailures++; if (pollFailures >= 3) { clearInterval(svrGenPollRef.current!); svrGenPollRef.current = null; setSvrGenStatus('error'); setSvrGenError('Lost connection to server. Please try again.'); } return; }

        // 404 = server restarted and lost in-memory state
        if (!resp.ok) {
          clearInterval(svrGenPollRef.current!); svrGenPollRef.current = null;
          setSvrGenStatus('error');
          setSvrGenError(errText(pr?.error) || 'Server restarted during generation. Please try again.');
          return;
        }

        setSvrGenProgress(pr.progress ?? 0);
        setSvrGenPhase(pr.phase ?? '');
        setSvrGenTotal(pr.total ?? supply);
        if (pr.status === 'done') {
          if (svrGenPollRef.current) { clearInterval(svrGenPollRef.current); svrGenPollRef.current = null; }
          const jobIdDone = pr.jobId ?? null;
          let loaded = true;
          if (jobIdDone) {
            dbJobIdRef.current = jobIdDone;
            loaded = await loadAndDisplayFromDb(jobIdDone);
          }
          setSvrGenStatus('done');
          setDbSaved(true);
          setGridLoadError(!loaded);
          setFilter(null);
          setTierFilter(null);
          setDbSaving(false);
          setPhase('done');
        } else if (pr.status === 'error') {
          if (svrGenPollRef.current) { clearInterval(svrGenPollRef.current); svrGenPollRef.current = null; }
          setSvrGenStatus('error');
          setSvrGenError(errText(pr.error) || 'Generation failed');
          if (/collection not found/i.test(errText(pr.error))) {
            // The collection backing this job was deleted from elsewhere while
            // generation was in flight — clear the stale cookie so a reload
            // lands on a fresh Settings tab instead of the same dead end.
            fetch('/api/session/collection', { method: 'DELETE' }).catch(() => { });
          }
        }
      }, 2000);
    } catch (e: any) {
      setSvrGenStatus('error');
      setSvrGenError(e.message ?? 'Failed to start generation');
    }
  }

  async function loadAndDisplayFromDb(jobId: string, attempt = 0): Promise<boolean> {
    try {
      let layerData: any[] = layersProp.length ? layersProp : layers;
      if (!layerData.length) {
        if (collectionId) {
          try { const r = await fetch(`/api/layers?collectionId=${collectionId}`); layerData = await r.json(); } catch { }
        }
      }
      if (!layerData.length) {
        // Generation can finish before this component's own `layers` state
        // has loaded (Settings -> Export happens fast), and the fallback
        // fetch above can lose that same race too. This used to return
        // silently here -- the grid just stayed empty with zero indication
        // anything failed, and the artist's only signal was clicking
        // Generate again (which re-runs the whole generation a second time
        // just to get a working reload). Retry like the display-items call
        // below already does, instead of giving up on the first miss.
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          return loadAndDisplayFromDb(jobId, attempt + 1);
        }
        console.error('[loadAndDisplayFromDb] layers never loaded after 3 attempts — grid will stay empty.');
        return false;
      }
      setLayers(layerData);

      const rels = [...new Set(
        layerData.flatMap((l: any) => l.assets.filter((a: any) => a.rel).map((a: any) => a.rel))
      )] as string[];

      // Fetch items only — don't block on bitmap loading.
      // Fixed high limit (matches server's own safety ceiling), NOT the client
      // `supply` guess — `supply` can still be the ??100 fallback while
      // collection is loading, which would silently truncate the grid below
      // the real count. 50000 is a safety bound, not a business cap —
      // collections are expected to grow well past 10K.
      const itemsResp = await fetchWithTimeout(`/api/nft-gen/jobs/${jobId}/display-items?limit=50000`, {}, 30_000);

      if (!itemsResp.ok) {
        console.warn(`[loadAndDisplayFromDb] display-items HTTP ${itemsResp.status} — retrying (${attempt}/3)`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          return loadAndDisplayFromDb(jobId, attempt + 1);
        }
        return false;
      }

      const itemsResult = await itemsResp.json().catch(() => ({ items: [] }));

      if (!itemsResult.items?.length) {
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          return loadAndDisplayFromDb(jobId, attempt + 1);
        }
        return false;
      }

      const displayed = itemsResult.items.map((item: any) => {
        const traits: Array<{ traitType: string; traitValue: string; traitId?: string | null }> = item.traits ?? [];
        const combo: Record<string, any> = {};
        for (const t of traits) {
          const layer = layerData.find((l: any) => l.label === t.traitType);
          if (layer) {
            // Match by trait id first — a frozen name snapshot taken at
            // generation time (t.traitValue) no longer matches the current
            // trait name after a rename (e.g. via Excel re-import), which
            // used to make the thumbnail silently vanish here. Falls back to
            // name-match only when traitId is null (trait since deleted).
            const asset = t.traitId
              ? layer.assets.find((a: any) => a.id === t.traitId)
              : layer.assets.find((a: any) => a.name === t.traitValue);
            if (asset?.rel) {
              combo[layer.folder] = { rel: asset.rel, stem: asset.stem ?? asset.name, name: t.traitValue };
            }
          }
        }
        return {
          index: item.editionNumber,
          rank: item.rarityRank,
          score: item.rarityScore,
          tier: item.rarityTier,
          attrs: traits.map((t: any) => ({ trait_type: t.traitType, value: t.traitValue })),
          combo,
          total: supply,
        };
      });
      setRarityItems(displayed);

      // Load bitmaps in background, in small batches — bump bitmapsVer after
      // EACH batch instead of once at the very end. Previously this was one
      // giant Promise.all over every unique trait image in the whole
      // generated set, so the entire grid stayed blank until all of them
      // arrived (confirmed live: a 1000-NFT set with ~213 distinct trait
      // images left every visible card blank for several seconds after
      // "NFTs Ready" appeared). Cards already lazy-draw via
      // IntersectionObserver as soon as their own bitmaps exist, so
      // progressively unlocking bitmaps in batches lets visible cards start
      // filling in almost immediately instead of waiting for the whole set.
      const BITMAP_BATCH = 24;
      (async () => {
        for (let i = 0; i < rels.length; i += BITMAP_BATCH) {
          const batch = rels.slice(i, i + BITMAP_BATCH);
          await Promise.all(batch.map(async (rel) => {
            if (jobBitmaps.current[rel]) return;
            try {
              const res = await fetchWithTimeout(`/api/layer-raw/${rel}`);
              if (res.ok) {
                const blob = await res.blob();
                jobBitmaps.current[rel] = await createImageBitmap(blob);
              }
            } catch { }
          }));
          setBitmapsVer(v => v + 1);
        }
      })().catch(() => { });
      return true;
    } catch (e) {
      console.error('[loadAndDisplayFromDb]', e);
      return false;
    }
  }

  async function persistToDb(items: any[]) {
    if (!collectionId || !items.length) return;
    setDbSaving(true);
    setDbSaved(false);
    setDbError('');
    if (lastFailedJobIdRef.current) {
      await fetch(`/api/nft-gen/jobs/${lastFailedJobIdRef.current}`, { method: 'DELETE' }).catch(() => { });
      lastFailedJobIdRef.current = null;
    }

    // Retry helper — exponential backoff: 1 s → 2 s → 4 s → 8 s
    // 4xx errors are not retried (bad request / auth — retrying won't help).
    async function withRetry<T>(label: string, fn: () => Promise<T>, maxRetries = 4): Promise<T> {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const ms = 1_000 * Math.pow(2, attempt - 1);
          console.warn(`[nft-db/${label}] retry ${attempt}/${maxRetries} in ${ms}ms`);
          await new Promise(r => setTimeout(r, ms));
        }
        try { return await fn(); } catch (e: any) {
          lastErr = e;
          if (e?.retryable === false) throw e;
        }
      }
      throw lastErr;
    }

    let dbJobId: string | null = null;
    try {
      // ── 1. Create job ───────────────────────────────────────────────────────
      const jr = await withRetry('create-job', async () => {
        const res = await fetch(`/api/nft-gen/collections/${collectionId}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editionSize: items.length }),
        });
        if (!res.ok) {
          const err = new Error(`Job creation failed (${res.status})`);
          if (res.status >= 400 && res.status < 500) (err as any).retryable = false;
          throw err;
        }
        return res.json();
      });
      dbJobId = jr?.job?.id ?? jr?.id ?? null;
      if (!dbJobId) throw Object.assign(new Error('Job ID not returned from server'), { retryable: false });

      // ── 2. Start job ────────────────────────────────────────────────────────
      await withRetry('start-job', () =>
        fetch(`/api/nft-gen/jobs/${dbJobId}/start`, { method: 'POST' }),
      );
      editionItemMapRef.current = {};

      // ── 3. Insert items in batches — 5 concurrent requests ─────────────────
      // 500 items per batch × 5 parallel = processes 9999 in ~4 parallel groups.
      // ON CONFLICT DO NOTHING makes every batch retry fully idempotent.
      const ITEM_BATCH = 500;
      const BATCH_CONCUR = 5;
      const totalBatches = Math.ceil(items.length / ITEM_BATCH);
      let completedBatches = 0;

      const allChunks = Array.from({ length: totalBatches }, (_, bi) => {
        const start = bi * ITEM_BATCH;
        return {
          batchNum: bi + 1,
          chunk: items.slice(start, start + ITEM_BATCH).map((item: any) => ({
            editionNumber: item.index,
            dnaHash: (item.attrs as any[]).map((a: any) => `${a.trait_type}:${a.value}`).join('|'),
            score: item.score,
            rank: item.rank,
            tier: item.tier,
            traits: (item.attrs as any[]).map((a: any) => ({
              traitType: a.trait_type,
              traitValue: a.value,
            })),
          })),
        };
      });

      for (let g = 0; g < allChunks.length; g += BATCH_CONCUR) {
        const group = allChunks.slice(g, g + BATCH_CONCUR);
        await Promise.all(group.map(async ({ batchNum, chunk }) => {
          const batchData = await withRetry(`batch-${batchNum}/${totalBatches}`, async () => {
            const res = await fetch(`/api/nft-gen/jobs/${dbJobId}/items/batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: chunk }),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              const err = new Error(`Batch ${batchNum}/${totalBatches} failed (${res.status}): ${errText((body as any).error) || 'server error'}`);
              if (res.status >= 400 && res.status < 500) (err as any).retryable = false;
              throw err;
            }
            return res.json().catch(() => ({}));
          });
          for (const row of (batchData?.items ?? [])) {
            editionItemMapRef.current[row.editionNumber] = row.itemId;
          }
        }));

        completedBatches += group.length;
        const pctDone = Math.round((completedBatches / totalBatches) * 100);
        fetch(`/api/nft-gen/jobs/${dbJobId}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ progress: pctDone }),
        }).catch(() => { });
      }

      // ── 4. Complete job ─────────────────────────────────────────────────────
      await withRetry('complete-job', () =>
        fetch(`/api/nft-gen/jobs/${dbJobId}/complete`, { method: 'POST' }),
      );
      dbJobIdRef.current = dbJobId;
      setDbSaved(true);
    } catch (err: any) {
      if (dbJobId) {
        fetch(`/api/nft-gen/jobs/${dbJobId}/fail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ errorMessage: err?.message ?? 'Item batch insert failed' }),
        }).catch(() => { });
      }
      lastFailedJobIdRef.current = dbJobId;
      setDbError(err?.message ?? 'Unknown error saving to database');
    } finally {
      setDbSaving(false);
    }
  }

  const PAGE_SIZE = 200;

  const visibleItems = useMemo(() => {
    let base = filter
      ? rarityItems.filter(({ combo }) => combo[filter.folder]?.stem === filter.stem)
      : rarityItems;
    if (tierFilter) base = base.filter(item => item.tier === tierFilter);
    if (sortBy === 'rarity') return [...base].sort((a, b) => a.rank - b.rank);
    return [...base].sort((a, b) => a.index - b.index);
  }, [rarityItems, filter, tierFilter, sortBy]);

  // Only render one page at a time — full sort/filter on all items, display is paginated
  const pageItems = useMemo(() =>
    visibleItems.slice(gridPage * PAGE_SIZE, (gridPage + 1) * PAGE_SIZE),
    [visibleItems, gridPage]);

  const totalPages = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));

  // Reset to first page whenever filter or sort changes
  useEffect(() => { setGridPage(0); }, [filter, tierFilter, sortBy]);

  function handleTierClick(label: string) {
    setTierFilter(prev => prev === label ? null : label);
  }

  const layerBreakdown = useMemo(() =>
    layers.map(layer => ({ ...layer, count: layer.assets.length })),
    [layers]);

  function handleTraitClick(layer: any, asset: any) {
    setFilter(prev =>
      prev?.folder === layer.folder && prev?.stem === asset.stem
        ? null
        : { folder: layer.folder, stem: asset.stem, layerLabel: layer.label, assetName: asset.name }
    );
  }
  function clearFilter() { setFilter(null); }

  // ── Server-side generation in progress (must come before idle check) ─────────
  if (svrGenStatus === 'running') {
    const pctGen = svrGenTotal > 0 ? (svrGenProgress / svrGenTotal) * 100 : 0;
    return (
      <div className="export-page">
        <div className="exp-loading-card">
          <Spinner size={32} color="var(--accent)" />
          <div className="exp-loading-title">Generating {svrGenTotal > 0 ? svrGenTotal.toLocaleString() : supply.toLocaleString()} NFTs on server…</div>
          <div className="exp-loading-msg">{svrGenPhase || 'Starting…'}</div>
          {svrGenTotal > 0 && (
            <>
              <ProgressBar value={svrGenProgress} max={svrGenTotal} />
              <div className="exp-gen-pct">{pctGen.toFixed(1)}%</div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Idle ─────────────────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="export-page">
        <div className="exp-idle-card">
          {/* Header */}
          <div className="exp-idle-header">
            <div>
              <div className="exp-idle-title">Export Collection</div>
              <div className="exp-idle-sub">{supply > 0 ? `Generate all ${supply.toLocaleString()} NFTs \u2014 composite images, rarity scores, and metadata` : 'Configure your collection in Settings, then generate NFTs here'}</div>
            </div>
            <Link
              href="/dashboard/generator/sync-status"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', textDecoration: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {'\ud83d\udccb'} Collection Sync Status
            </Link>
          </div>

          {/* Collection summary */}
          <div className="exp-section">
            <div className="exp-section-label">Collection Summary</div>
            <div className="exp-summary-grid">
              {[
                { label: 'Name', value: collName || '—' },
                { label: 'Supply', value: collection?.supply ? Number(collection.supply).toLocaleString() : '—' },
                { label: 'Blockchain', value: collection?.network || collection?.blockchain || '—' },
                { label: 'Format', value: collection?.format ? collection.format.toUpperCase() : '—' },
                { label: 'Resolution', value: (collection?.width && collection?.height) ? collection.width + '×' + collection.height : '—' },
              ].map(item => (
                <div key={item.label} className="exp-summary-stat">
                  <div className="exp-summary-stat-label">{item.label}</div>
                  <div className="exp-summary-stat-val">{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {layerStatus === 'empty' && (
            <div className="exp-error-banner" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {(!collection?.width || !collection?.height) && (
                <div className="exp-error-banner">
                  Dimensions not configured — go to <strong>Settings</strong> and set Width and Height before generating.
                </div>
              )}
              <span>No active layers found for this collection.</span>
              {layersProp.length > 0 ? (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '3px 10px' }}
                  onClick={syncLayersNow}
                  disabled={syncingLayers}
                >
                  {syncingLayers ? '⌛ Syncing…' : '⚡ Sync layers to DB'}
                </button>
              ) : (
                <span>Go to <strong>Settings</strong> → <strong>Continue</strong> to sync your layers.</span>
              )}
            </div>
          )}
          {(error || svrGenError) && <div className="exp-error-banner">{error || svrGenError}</div>}

          <div className="exp-idle-actions">
            <button
              className="btn btn-primary btn-lg"
              onClick={generateOnServer}
              disabled={!collection?.width || !collection?.height || !collectionId || svrGenStatus === 'running' || layerStatus === 'loading' || layerStatus === 'empty'}
            >
              {layerStatus === 'loading' ? '⌛ Checking layers…' : supply > 0 ? `⚡ Generate ${supply.toLocaleString()} NFTs` : `⚡ Generate NFTs`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  return (
    <div className="export-page">
      <div className="export-card export-card-wide">

        {/* ── Top bar ── */}
        <div className="exp-top-bar">
          <div className="exp-top-left">
            <div className="exp-ready-badge">{rarityItems.length > 0 ? rarityItems.length.toLocaleString() : supply.toLocaleString()} NFTs Ready</div>
            <div className="exp-sort-group">
              <button
                className={`exp-sort-btn${sortBy === 'rarity' ? ' exp-sort-active' : ''}`}
                onClick={() => setSortBy('rarity')}
              >🏆 Rarity</button>
              <button
                className={`exp-sort-btn${sortBy === 'id' ? ' exp-sort-active' : ''}`}
                onClick={() => setSortBy('id')}
              ># ID</button>
            </div>
          </div>

          <div className="exp-top-right">
            <button className="btn btn-ghost" onClick={() => { setPhase('idle'); setRarityItems([]); setGridLoadError(false); setFilter(null); setTierFilter(null); }}>
              ↺ Regenerate
            </button>
          </div>
        </div>

        {error && <div className="exp-error-banner" style={{ marginBottom: 10 }}>{error}</div>}

        {/* ── DB save status ── */}
        {dbSaving && (
          <div className="exp-banner exp-banner-saving">
            <Spinner size={15} color="#41afeb" />
            <span>Saving {rarityItems.length.toLocaleString()} items to database…</span>
          </div>
        )}
        {dbSaved && !dbSaving && (
          <div className="exp-banner exp-banner-saved" data-job-id={dbJobIdRef.current ?? ''}>
            <CheckIcon size={15} />
            <span>{rarityItems.length > 0 ? rarityItems.length.toLocaleString() : supply.toLocaleString()} items saved to database</span>
          </div>
        )}
        {dbError && !dbSaving && (
          <div className="exp-banner exp-banner-error">
            <div className="exp-banner-error-body">
              <div className="exp-banner-error-msg">Failed to save to database: {dbError}</div>
              <div className="exp-banner-error-sub">
                Your {rarityItems.length.toLocaleString()} generated NFTs are still in memory.
                When the server recovers, click Retry to persist.
              </div>
            </div>
            <button className="exp-retry-btn" onClick={() => persistToDb(rarityItems)}>↺ Retry</button>
          </div>
        )}

        {/* ── Horizontal filter bar ── */}
        {layers.length > 0 && (
          <div className="exp-hfilter-bar">
            {filter && (
              <div className="plr-filter-badge">
                <span>{filter.layerLabel}: {filter.assetName}</span>
                <button className="plr-filter-clear" onClick={clearFilter}>✕</button>
              </div>
            )}
            {layerBreakdown.map(layer => (
              <HLayerFilter
                key={layer.folder}
                layer={layer}
                activeFilter={filter}
                onTraitClick={handleTraitClick}
              />
            ))}
          </div>
        )}

        {/* ── NFT grid ── */}
        {visibleItems.length > 0 && (
          <div className="exp-grid-nav">
            <div className="preview-count-row">
              <span className="preview-count-num">{visibleItems.length.toLocaleString()}</span>
              {' '}
              <span className="preview-count-label">
                {filter ? `of ${rarityItems.length.toLocaleString()} NFTs` : 'NFTs'}
              </span>
            </div>
            {totalPages > 1 && (
              <div className="exp-page-group">
                <button className="exp-sort-btn" onClick={() => setGridPage(p => Math.max(0, p - 1))} disabled={gridPage === 0}>← Prev</button>
                <span className="exp-page-label">Page {gridPage + 1} / {totalPages}</span>
                <button className="exp-sort-btn" onClick={() => setGridPage(p => Math.min(totalPages - 1, p + 1))} disabled={gridPage >= totalPages - 1}>Next →</button>
              </div>
            )}
          </div>
        )}
        <div className="exp-tier-legend">
          {TIER_META.map(t => (
            <button
              key={t.label}
              className={`exp-tier-pill exp-tier-pill-clickable${tierFilter === t.label ? ' exp-tier-pill-active' : ''}`}
              style={{
                borderColor: tierFilter === t.label ? t.color : `${t.color}33`,
                background: tierFilter === t.label ? `${t.color}18` : undefined,
              }}
              onClick={() => handleTierClick(t.label)}
              title={tierFilter === t.label ? `Showing only ${t.label} — click to clear` : `Show only ${t.label} NFTs`}
            >
              <span className="exp-tier-dot" style={{ background: t.color }} />
              <span style={{ color: t.color, fontWeight: 700 }}>{t.label}</span>
              <span className="exp-tier-pill-sub">{t.sub}</span>
            </button>
          ))}
          {tierFilter && (
            <button className="exp-tier-clear" onClick={() => setTierFilter(null)}>✕ Clear tier filter</button>
          )}
        </div>
        {pageItems.length > 0 ? (
          <div className="exp-nft-grid">
            {pageItems.map(item => (
              <RarityCard
                key={item.index}
                item={item}
                jobBitmaps={jobBitmaps}
                layers={layers}
                canvasW={tW}
                canvasH={tH}
                onClick={setPopup}
                bitmapsVer={bitmapsVer}
              />
            ))}
          </div>
        ) : gridLoadError && rarityItems.length === 0 ? (
          <div className="exp-empty-filter">
            <div>Grid failed to load — your {supply.toLocaleString()} items are saved in the database, this is just a display problem.</div>
            <button
              className="btn btn-ghost"
              style={{ marginTop: 8 }}
              onClick={async () => {
                if (!dbJobIdRef.current) return;
                setGridLoadError(false);
                const ok = await loadAndDisplayFromDb(dbJobIdRef.current, 0);
                setGridLoadError(!ok);
              }}
            >
              ↻ Retry loading
            </button>
          </div>
        ) : (
          <div className="exp-empty-filter">No NFTs match this filter.</div>
        )}
      </div>

      {/* ── Download All NFTs (legacy single-stream ZIP) — kept in source per
          explicit instruction, not deleted, just no longer wired to the
          visible button. Doesn't scale to a real ~5GB collection (no
          maxDuration works for one continuous stream that large); superseded
          by the direct-to-folder downloader below. ── */}
      {false && dbSaved && dbJobIdRef.current && (svrStatus === 'done' || exportDone) && (
        <div className="exp-fb-card exp-svr-card" data-testid="offline-download-section">
          <div className="exp-fb-header">
            <div className="exp-fb-title">Download All NFTs</div>
            <div className="exp-fb-sub">
              {zipReady
                ? 'Pre-built ZIP ready — instant download from Filebase'
                : 'Download the exported collection as a ZIP archive'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
            <button
              className="btn btn-primary"
              onClick={downloadOfflineZip}
              disabled={dlStatus === 'running'}
              data-testid="download-offline-zip-btn"
            >
              {zipReady ? '⚡ ' : '⬇ '}
              {dlStatus === 'running'
                ? 'Downloading…'
                : `Download ${supply.toLocaleString()} NFTs + Metadata (.zip)`}
            </button>
          </div>

          {dlStatus === 'running' && (
            <div style={{ marginTop: 12 }}>
              {dlTotalBytes ? (
                <>
                  <ProgressBar value={dlBytes} max={dlTotalBytes} />
                  <div className="exp-step-count">{formatBytes(dlBytes)} / {formatBytes(dlTotalBytes)}</div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{formatBytes(dlBytes)} received…</div>
              )}
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                Elapsed: {formatDuration(dlElapsedSec)}
              </div>
            </div>
          )}

          {dlStatus === 'done' && (
            <div className="exp-banner exp-banner-saved" style={{ marginTop: 12 }}>
              <CheckIcon size={15} />
              <span>Downloaded {formatBytes(dlBytes)} in {formatDuration(dlElapsedSec)}.</span>
            </div>
          )}

          {dlStatus === 'error' && (
            <div className="exp-banner exp-banner-error" style={{ marginTop: 12 }}>
              <span>Download failed: {dlError}</span>
              <button className="exp-retry-btn" onClick={downloadOfflineZip}>↺ Retry</button>
            </div>
          )}
        </div>
      )}

      {/* ── Download All NFTs (direct-to-folder) — hidden until export to
          Filebase has actually finished; before that the artist can only
          view NFTs above, not download them (nothing real to download yet).
          Same strategy as scripts/download-filebase-bucket.js: per-file,
          skip-if-already-saved resumability, no single-request timeout. ── */}
      {dbSaved && dbJobIdRef.current && (svrStatus === 'done' || exportDone) && (
        <div className="exp-fb-card exp-svr-card" data-testid="offline-download-section">
          <div className="exp-fb-header">
            <div className="exp-fb-title">Download All NFTs</div>
            <div className="exp-fb-sub">
              Pick a folder — images and metadata save directly into it, and re-running only fetches what's missing.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <select
              className="exp-fb-input"
              style={{ minWidth: 200 }}
              value={dlBucket}
              onChange={e => setDlBucket(e.target.value)}
              disabled={bulkDlStatus === 'running'}
            >
              {bucketList.length === 0 && <option value="">— no buckets found —</option>}
              {bucketList.length > 0 && <option value="">— select bucket —</option>}
              {bucketList.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              onClick={downloadAllFilesDirect}
              disabled={bulkDlStatus === 'running' || !dlBucket.trim()}
              data-testid="download-offline-zip-btn"
            >
              ⬇ {bulkDlStatus === 'running' ? 'Downloading…' : `Download ${supply.toLocaleString()} NFTs + Metadata`}
            </button>
          </div>

          {bulkDlStatus === 'running' && (
            <div style={{ marginTop: 12 }}>
              {bulkDlTotal > 0 && <ProgressBar value={bulkDlDone} max={bulkDlTotal} />}
              <div className="exp-step-count">
                {bulkDlDone.toLocaleString()} / {bulkDlTotal.toLocaleString()} files
                {bulkDlFailed > 0 ? ` · ${bulkDlFailed.toLocaleString()} failed so far` : ''}
              </div>
            </div>
          )}

          {bulkDlStatus === 'done' && (
            <div className="exp-banner exp-banner-saved" style={{ marginTop: 12 }}>
              <CheckIcon size={15} />
              <span>
                Saved {bulkDlDone.toLocaleString()} files to folder "{bulkDlFolderName}"
                {bulkDlFailed > 0 ? ` — ${bulkDlFailed.toLocaleString()} failed, click Download again to retry just those` : ''}.
              </span>
            </div>
          )}

          {bulkDlStatus === 'error' && (
            <div className="exp-banner exp-banner-error" style={{ marginTop: 12 }}>
              <span>Download failed: {bulkDlError}</span>
              <button className="exp-retry-btn" onClick={downloadAllFilesDirect}>↺ Retry</button>
            </div>
          )}
        </div>
      )}

      {/* ── Server-Side Export (single-threaded) — hidden, not removed. Its
          own subtitle used to say "Recommended for large collections",
          which was actively wrong: it's the slow path, and nothing steered
          an artist toward Parallel Export (the fast one) instead. Rather
          than leave two buttons where picking the "recommended"-sounding
          one gets you the slow result, this stays hidden until it's merged
          into a single always-fast flow. Code kept intact — it's still the
          only path that builds a pre-built ZIP and bundles NFT Records sync
          in one click, both useful to keep for reference/fallback.
          Was re-enabled per explicit request to test this path specifically;
          that testing is done, re-hidden 2026-09-03 per explicit request.
          Bucket selection moved out to its own always-visible section above,
          since Parallel Export/Fix Pending CIDs need it independently of
          whether this card is shown. ── */}
      {false && dbSaved && dbJobIdRef.current && (
        <div className="exp-fb-card exp-svr-card" data-testid="server-export-section">
          <div className="exp-fb-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="exp-fb-title">Server-Side Export</div>
              <div className="exp-fb-sub">
                Compositing and IPFS upload run on the server (no browser limits). Runs as a single stream — for
                large collections, use <strong>Parallel Export</strong> below instead for real wall-clock speedup.
              </div>
            </div>
          </div>

          {svrStatus === 'idle' && (
            <>
              <div className="exp-fb-bucket-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={startServerExport}
                  disabled={svrBucket === '__new__' ? !svrNewBucket.trim() : !svrBucket.trim()}
                >
                  ⚡ Start Export
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  id="syncToRecords"
                  checked={svrSyncRecords}
                  onChange={e => setSvrSyncRecords(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="syncToRecords" style={{ fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                  Sync to NFT Records (production only — leave unchecked for test runs)
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="number"
                  id="resumeFromInput"
                  data-testid="resume-from-input"
                  min={0}
                  max={supply}
                  value={svrResumeFrom || ''}
                  placeholder="0"
                  onChange={e => setSvrResumeFrom(Math.max(0, Number(e.target.value) || 0))}
                  className="exp-fb-input"
                  style={{ width: 90 }}
                />
                <label htmlFor="resumeFromInput" style={{ fontSize: 13, userSelect: 'none', color: 'var(--text-muted)' }}>
                  Resume from edition (0 = start fresh)
                </label>
                {resumeDetecting && (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Checking bucket for existing progress…</span>
                )}
                {!resumeDetecting && resumeDetected != null && resumeDetected > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--accent2)' }}>
                    ✓ Detected {resumeDetected.toLocaleString()} image{resumeDetected === 1 ? '' : 's'} already in this bucket — pre-filled to continue from there.
                  </span>
                )}
              </div>
              {svrError && <div className="exp-error-banner" style={{ marginTop: 10 }}>{svrError}</div>}
            </>
          )}

          {svrStatus === 'running' && (
            <div style={{ marginTop: 14 }} data-export-id={svrExportIdRef.current ?? ''}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Spinner size={16} color="var(--accent)" />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{svrPhase || 'Working…'}</span>
              </div>
              <ProgressBar value={svrProgress} max={svrTotal} />
              <div className="exp-step-count">{svrProgress.toLocaleString()} / {svrTotal.toLocaleString()}</div>
              {(() => {
                // Rate from progress-over-elapsed naturally self-corrects
                // for stalls as part of the average, rather than assuming a
                // best-case speed that never accounts for reconnect overhead.
                const rate = svrElapsedSec > 0 ? svrProgress / svrElapsedSec : 0;
                const remaining = svrTotal - svrProgress;
                const etaSec = rate > 0 && remaining > 0 ? remaining / rate : null;
                return (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 14 }}>
                    <span>Elapsed: {formatDuration(svrElapsedSec)}</span>
                    <span>Est. remaining: {etaSec != null ? formatDuration(etaSec) : 'calculating…'}</span>
                  </div>
                );
              })()}
              <button className="btn btn-ghost" onClick={cancelServerExport} style={{ marginTop: 8 }}>
                Stop polling
              </button>
            </div>
          )}

          {svrStatus === 'done' && (
            <div className="exp-banner exp-banner-saved exp-svr-done" style={{ marginTop: 14 }}>
              <CheckIcon size={15} />
              <span>{svrTotal.toLocaleString()} NFTs composited and uploaded to Filebase IPFS</span>
              <button className="btn btn-ghost" style={{ marginLeft: 'auto' }}
                onClick={() => { setSvrStatus('idle'); setSvrProgress(0); svrExportIdRef.current = null; }}
              >
                Export again
              </button>
            </div>
          )}

          {svrStatus === 'error' && (() => {
            // "An export is already running" isn't a failure — it's someone
            // else's export legitimately in progress on this collection.
            // Labeling it "Server export failed" and showing it in red reads
            // as something broke, when the honest message is just "wait your
            // turn" — confusing for an artist who did nothing wrong.
            const alreadyRunning = /already running/i.test(svrError);
            return (
              <div className={alreadyRunning ? 'exp-banner exp-banner-saved' : 'exp-banner exp-banner-error'} style={{ marginTop: 14 }}>
                <span>{alreadyRunning
                  ? 'An export is already running for this collection. Wait for it to finish, or refresh this page to see its progress.'
                  : `Server export failed: ${svrError}`}</span>
                <button className="exp-retry-btn" onClick={() => { setSvrStatus('idle'); setSvrError(''); }}>
                  {alreadyRunning ? 'OK' : '↺ Retry'}
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Parallel Export (Fast) ── */}
      {dbSaved && dbJobIdRef.current && (
        <div className="exp-fb-card exp-svr-card" data-testid="parallel-export-section">
          <div className="exp-fb-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="exp-fb-title">⚡ Parallel Export (Fast)</div>
              <div className="exp-fb-sub">
                Runs {PARALLEL_SLICE_COUNT} slices of the collection concurrently for real wall-clock speedup on large
                collections. No pre-built ZIP or NFT Records sync here — use those separately once this finishes.
              </div>
            </div>
            <Link
              href="/dashboard/generator/sync-status"
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)', textDecoration: 'none', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2 }}
            >
              {'📋'} All Collections
            </Link>
          </div>

          {/* Bucket selector — relocated here since Parallel Export and Fix
              Pending CIDs both read svrBucket/svrNewBucket and neither had
              its own selector before; the Server-Side Export card that used
              to own this UI is now hidden. Pure UI relocation — does not
              touch startParallelExport/runParallelSliceAttempt. */}
          {parStatus === 'idle' && (
            <div className="exp-fb-bucket-row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {bucketsLoading ? (
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Loading buckets…</span>
              ) : bucketsError ? (
                <>
                  <span style={{ fontSize: 13, color: '#ef4444' }}>⚠ {bucketsError}</span>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={loadBuckets}>
                    ↺ Retry
                  </button>
                </>
              ) : (
                <select
                  className="exp-fb-input"
                  style={{ minWidth: 200 }}
                  value={svrBucket}
                  onChange={e => { setSvrBucket(e.target.value); if (e.target.value !== '__new__') setSvrNewBucket(''); }}
                >
                  {bucketList.length === 0 && <option value="">— no buckets found —</option>}
                  {bucketList.length > 0 && <option value="">— select bucket —</option>}
                  {bucketList.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  <option value="__new__">+ Create new bucket…</option>
                </select>
              )}
              {svrBucket === '__new__' && (
                <input
                  className="exp-fb-input"
                  style={{ minWidth: 180 }}
                  placeholder="New bucket name"
                  value={svrNewBucket}
                  onChange={e => setSvrNewBucket(e.target.value)}
                  autoFocus
                />
              )}
            </div>
          )}

          {parStatus === 'idle' && (
            <button
              className="btn btn-primary"
              onClick={startParallelExport}
              disabled={!(svrBucket === '__new__' ? svrNewBucket.trim() : svrBucket.trim())}
              style={{ marginTop: 10 }}
            >
              ⚡ Start Parallel Export
            </button>
          )}

          {(parStatus === 'running' || parStatus === 'done') && (
            <div style={{ marginTop: 12 }}>
              <ProgressBar value={parTotalProgress} max={supply} />
              <div className="exp-step-count">{parTotalProgress.toLocaleString()} / {supply.toLocaleString()}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                Elapsed: {formatDuration(parElapsedSec)}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {parSlices.map((s, i) => (
                  <div
                    key={i}
                    title={`#${s.rangeStart + 1}-${s.rangeEnd}: ${s.progress}/${s.rangeEnd - s.rangeStart} (${s.status})`}
                    style={{
                      fontSize: 11, padding: '4px 8px', borderRadius: 6,
                      background: s.status === 'done' ? 'var(--accent2, #22c55e)' : 'var(--hover)',
                      color: s.status === 'done' ? '#fff' : 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    #{i + 1}: {s.progress}/{s.rangeEnd - s.rangeStart}
                  </div>
                ))}
              </div>
            </div>
          )}

          {parStatus === 'done' && (
            <div className="exp-banner exp-banner-saved" style={{ marginTop: 12 }}>
              <CheckIcon size={15} />
              <span>All {PARALLEL_SLICE_COUNT} slices complete — {parTotalProgress.toLocaleString()} NFTs uploaded in {formatDuration(parElapsedSec)}.</span>
            </div>
          )}

          {parStatus === 'error' && (
            <div className="exp-banner exp-banner-error" style={{ marginTop: 12 }}>
              <span>{parError}</span>
              <button className="exp-retry-btn" onClick={() => { setParStatus('idle'); setParError(''); }}>↺ Reset</button>
            </div>
          )}
        </div>
      )}

      {/* ── Advanced: Fix Pending CIDs ── */}
      {dbSaved && dbJobIdRef.current && (
        <details className="exp-fb-card exp-svr-card" style={{ padding: 0 }} data-testid="refresh-cids-section" open={!!missingCidCount}>
          <summary style={{ cursor: 'pointer', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none', listStyle: 'none', WebkitAppearance: 'none' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Fix Pending CIDs</span>
            {missingCidCount == null ? (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Checking…</span>
            ) : missingCidCount > 0 ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
                ⚠ {missingCidCount.toLocaleString()} NFT{missingCidCount === 1 ? '' : 's'} missing a CID — click to fix
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--accent2, #22c55e)' }}>✓ All CIDs resolved</span>
            )}
          </summary>
          <div style={{ padding: '0 20px 18px' }}>
            <div className="exp-fb-sub" style={{ marginBottom: 12 }}>
              The export automatically resolves IPFS CIDs during generation (Phase 2). Use this if some editions
              are still missing a real CID after export completes — for example, if Filebase was unusually slow
              during a large run, or an invocation was interrupted mid-batch.
            </div>

            {cidStatus === 'idle' && (
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn btn-ghost"
                  onClick={startRefreshCids}
                  disabled={!svrBucket.trim() && !svrNewBucket.trim()}
                  data-testid="refresh-cids-btn"
                >
                  🔄 Fix Pending CIDs
                </button>
                {cidError && <div className="exp-error-banner" style={{ marginTop: 8 }}>{cidError}</div>}
              </div>
            )}

            {cidStatus === 'running' && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Spinner size={16} color="var(--accent)" />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{cidPhase || 'Working…'}</span>
                </div>
                {cidTotal > 0 && (
                  <>
                    <ProgressBar value={cidProgress} max={cidTotal} />
                    <div className="exp-step-count">{cidProgress.toLocaleString()} / {cidTotal.toLocaleString()}</div>
                  </>
                )}
              </div>
            )}

            {cidStatus === 'done' && (
              <div className="exp-banner exp-banner-saved" style={{ marginTop: 14 }}>
                <CheckIcon size={15} />
                <span>
                  {cidResolved.toLocaleString()} CIDs resolved
                  {cidSkipped > 0 ? ` · ${cidSkipped.toLocaleString()} skipped (run again in 30 s to pick up remaining)` : ''}
                </span>
                <button className="btn btn-ghost" style={{ marginLeft: 'auto' }}
                  onClick={() => { setCidStatus('idle'); setCidProgress(0); setCidTotal(0); }}
                >
                  Run again
                </button>
              </div>
            )}

            {cidStatus === 'error' && (
              <div className="exp-banner exp-banner-error" style={{ marginTop: 14 }}>
                <span>CID refresh failed: {cidError}</span>
                <button className="exp-retry-btn" onClick={() => { setCidStatus('idle'); setCidError(''); }}>↺ Retry</button>
              </div>
            )}
          </div>
        </details>
      )}

      {popup && <NftPopup item={{ ...popup, total: supply }} onClose={() => setPopup(null)} />}
    </div>
  );
}
