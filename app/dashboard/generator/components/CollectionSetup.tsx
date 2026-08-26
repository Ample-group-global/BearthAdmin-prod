// @ts-nocheck
'use client';
import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useLayerFiles } from '../LayerFilesContext';

// Generic: normalizes any folder/sheet name the same way labels are derived
// elsewhere in this file (strip a leading number+separator, case/whitespace-
// insensitive) so an Excel sheet name matches a layer folder name regardless
// of what this particular collection's layers happen to be called.
function normalizeLayerKey(s) {
  return String(s || '').replace(/^\d+[-_]/, '').trim().toLowerCase();
}

// Generic trait-names + weights extractor — works with ANY workbook where
// each sheet name matches a layer folder and has a header row with a column
// whose header text contains "name" (e.g. "Trait Name", "Name", "Asset
// Name") and, optionally, one containing "weight" (e.g. "Weight (%)").
// Never assumes a specific column position or specific sheet/layer names —
// different collections will have completely different layers/traits.
// Weight cells may be a plain number or a percentage string ("2.78 %") —
// both parse to the same underlying number; percentages aren't normalized
// to 0-1 since nft_traits.rarity_weight is a relative weight, not a
// probability (weights only need to be proportionally correct to each
// other within a layer, not sum to 100).
function parseWeightCell(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseTraitNamesFromWorkbook(workbook) {
  const result = {};
  const resultWeights = {};
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    if (!rows.length) continue;
    const header = rows[0].map(h => String(h || '').trim().toLowerCase());
    const nameColIdx = header.findIndex(h => h.includes('name'));
    if (nameColIdx === -1) continue; // no name-like column on this sheet — not a trait sheet
    const weightColIdx = header.findIndex(h => h.includes('weight'));
    // Stop at the first fully-blank row rather than skipping over it — a
    // mid-sheet blank row silently shifts every later name onto the wrong
    // trait (count still "matches" if we just filtered blanks out, since the
    // filter runs the same way on every re-parse — nothing would catch it).
    // Stopping short instead makes the row count come up short, which trips
    // the existing count-validation in applyTraitNamesFromExcel and refuses
    // to apply anything rather than silently mislabeling traits.
    const names = [];
    const weights = [];
    for (const r of rows.slice(1)) {
      if (!r.some(c => String(c ?? '').trim() !== '')) break;
      const name = String(r[nameColIdx] ?? '').trim();
      if (!name) break;
      names.push(name);
      weights.push(weightColIdx === -1 ? null : parseWeightCell(r[weightColIdx]));
    }
    if (names.length) {
      const key = normalizeLayerKey(sheetName);
      result[key] = names;
      // Only keep weights if EVERY row had a valid number — a partially-
      // filled weight column is more likely a data-entry gap than intentional,
      // and applying nulls would silently reset those traits to default.
      if (weights.length && weights.every(w => w != null)) resultWeights[key] = weights;
    }
  }
  return { names: result, weights: resultWeights };
}

function deriveLabelFromFolder(fname) {
  return fname.replace(/^\d+[-_]/, '').replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()).trim() || fname;
}

function clientGetName(folder, stem, rel) {
  // Nested path (e.g. "10-hand/10-6-panda/10-6-7.png") → extract name from parent dir
  if (rel) {
    const parts = rel.split('/');
    if (parts.length >= 3) {
      const parentDir = parts[parts.length - 2];
      const d2 = parentDir.replace(/^\d+[-_]\d+[-_]/, '').trim();
      if (d2 && /[a-zA-Z]/.test(d2))
        return d2.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
      const d1 = parentDir.replace(/^\d+[-_]/, '').trim();
      if (d1 && /[a-zA-Z]/.test(d1))
        return d1.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    }
  }
  // Numeric stem (e.g. "1-7", "2-14") — use the stem as-is.
  // DB holds proper names set by the artist; this is just a local placeholder.
  if (/^\d+-\d+$/.test(stem)) return stem;
  // Non-numeric: derive a readable label from the stem text
  const inner = stem.replace(/^\d+[-_]/, '') || stem;
  return inner.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || stem;
}

// Parse layer structure from dropped files client-side (mirrors server scanLayers).
// excelData is optional — { names: {[normalizedLayerKey]: string[]}, weights:
// {[normalizedLayerKey]: number[]} } from an artist-supplied trait workbook
// (any layer set, any sheet/column naming — see parseTraitNamesFromWorkbook).
// Names/weights are only applied when a layer's matched sheet has exactly as
// many rows as that layer has traits; otherwise falls back to the existing
// stem-derived placeholder name / default weight of 1, same as when no Excel
// is provided.
function parseLayersFromFiles(files, excelData = {}) {
  const excelNames = excelData.names ?? {};
  const excelWeights = excelData.weights ?? {};
  const groups = new Map(); // folder -> [{ file, stem, rel }]
  const fileMap = new Map(); // rel -> File

  for (const file of files) {
    const wpath = file.webkitRelativePath || file.name;
    const parts = wpath.split('/').filter(Boolean);
    const layerIdx = parts.findIndex(p => /^\d+[-_]/.test(p));
    if (layerIdx === -1) continue;
    if (!file.name.match(/\.(png|webp|jpg|jpeg|gif)$/i)) continue;

    const layerName = parts[layerIdx];
    const rel = parts.slice(layerIdx).join('/');
    const stem = file.name.replace(/\.(png|webp|jpg|jpeg|gif)$/i, '');

    if (!groups.has(layerName)) groups.set(layerName, []);
    groups.get(layerName).push({ file, stem, rel });
    fileMap.set(rel, file);
  }

  const sorted = [...groups.entries()].sort((a, b) => {
    const na = parseInt(a[0]), nb = parseInt(b[0]);
    return (isNaN(na) ? 999 : na) - (isNaN(nb) ? 999 : nb);
  });

  const layers = sorted.map(([folder, entries]) => {
    const label = folder
      .replace(/^\d+[-_]/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || folder;
    const assets = entries
      .map(({ stem, rel }) => ({
        stem,
        name: clientGetName(folder, stem, rel),
        rel,
        defaultWeight: 1,
      }))
      .sort((a, b) => a.stem.localeCompare(b.stem, undefined, { numeric: true, sensitivity: 'base' }));

    // Positional Excel names, only when the matched sheet's row count exactly
    // equals this layer's trait count — a mismatch means the sheet doesn't
    // actually correspond 1:1 to these files, so we don't guess.
    const layerKey = normalizeLayerKey(folder);
    const namesForLayer = excelNames[layerKey];
    if (namesForLayer && namesForLayer.length === assets.length) {
      assets.forEach((a, i) => { a.name = namesForLayer[i]; });
    }
    const weightsForLayer = excelWeights[layerKey];
    if (weightsForLayer && weightsForLayer.length === assets.length) {
      assets.forEach((a, i) => { a.defaultWeight = weightsForLayer[i]; });
    }

    // Disambiguate duplicate display names (same logic as server-side buildCache)
    const nameCounts = {};
    for (const a of assets) nameCounts[a.name] = (nameCounts[a.name] ?? 0) + 1;
    const nameIdx = {};
    for (const a of assets) {
      if (nameCounts[a.name] > 1) {
        nameIdx[a.name] = (nameIdx[a.name] ?? 0) + 1;
        a.name = `${a.name} ${nameIdx[a.name]}`;
      }
    }

    return { folder, label, count: assets.length, optional: false, assets };
  });

  return { layers, fileMap };
}

function applyNameFormat(fmt, idx) {
  if (!fmt) return `#${idx}`;
  if (fmt.includes('{{id}}')) return fmt.replace(/\{\{id\}\}/g, idx);
  if (fmt.includes('{id}'))   return fmt.replace(/\{id\}/g, idx);
  if (/\d/.test(fmt)) {
    return fmt.replace(/(\d+)(?=[^0-9]*$)/, m => String(idx).padStart(m.length, '0'));
  }
  return `${fmt} #${idx}`;
}

const BLOCKCHAINS = [
  { value: 'ethereum', label: 'Ethereum (+ Base, Polygon & other EVM chains)' },
  { value: 'solana',   label: 'Solana' },
  { value: 'base',     label: 'Base' },
  { value: 'polygon',  label: 'Polygon' },
  { value: 'cardano',  label: 'Cardano' },
  { value: 'xrp',      label: 'XRP' },
];

// Recursively collect all files from a DataTransferEntry (folder or file)
function readEntry(entry) {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(f => {
        // Attach full path so we can determine layer folder later
        Object.defineProperty(f, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, ''), writable: false });
        resolve([f]);
      }, () => resolve([]));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const allEntries = [];
      const readAll = () => {
        reader.readEntries(async batch => {
          if (!batch.length) {
            const nested = await Promise.all(allEntries.map(readEntry));
            resolve(nested.flat());
          } else {
            allEntries.push(...batch);
            readAll(); // readEntries may return < 100 items; keep reading
          }
        }, () => resolve([]));
      };
      readAll();
    } else {
      resolve([]);
    }
  });
}

export default function CollectionSetup({ collection, onChange, onNext, onReset, onLayersChange, syncing = false, syncError = '', sessionRestored = false, collectionId = undefined, onDismissRestore = undefined }) {
  const [dragOver,      setDragOver]      = useState(false);
  const [uploading,     setUploading]     = useState(false);
  const [uploadDone,    setUploadDone]    = useState(false);
  const [uploadMsg,     setUploadMsg]     = useState('');
  const [uploadFailedLayers, setUploadFailedLayers] = useState<string[]>([]);
  const [errors,        setErrors]        = useState({});
  const [excelData,     setExcelData]     = useState({ names: {}, weights: {} });
  const [excelFileName, setExcelFileName] = useState('');
  const [excelMsg,      setExcelMsg]      = useState('');
  const folderRef = useRef(null);
  const excelRef  = useRef(null);
  const lastFilesRef = useRef(null); // remembers the dropped image files so a
                                      // later-uploaded Excel can re-apply names
  const { storeFiles } = useLayerFiles();

  const set = (k, v) => {
    onChange({ ...collection, [k]: v });
    // Clear the error for this field as the user edits it
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  function validate() {
    const e = {};
    if (!collection.name?.trim())   e.name   = 'Collection Name is required.';
    if (!collection.symbol?.trim()) e.symbol  = 'Token Symbol is required.';
    const s = Number(collection.supply);
    if (!collection.supply || isNaN(s) || s < 1) e.supply = 'Collection Size must be at least 1.';
    if (!collection.width  || Number(collection.width)  < 1) e.width  = 'Width is required.';
    if (!collection.height || Number(collection.height) < 1) e.height = 'Height is required.';
    return e;
  }

  function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    onNext?.();
  }

  async function handleFolderUpload(files, replace = false) {
    if (!files.length) return;
    setUploading(true);
    setUploadMsg('Reading files…');
    lastFilesRef.current = files;

    // ── 1. Parse layers client-side — instant ────────────────────────────────
    const { layers: parsedLayers, fileMap } = parseLayersFromFiles(files, excelData);
    storeFiles(fileMap);
    onLayersChange?.(parsedLayers);

    // Show success immediately — no need to block the UI on the network
    setUploading(false);
    setUploadDone(true);
    setUploadFailedLayers([]);
    setUploadMsg(`${parsedLayers.length} layers imported!`);

    // ── 2. Upload to S3 in the background, but await + verify each layer ───────
    // Previously these were fire-and-forget with .catch(() => {}), so if any
    // single layer's request failed (network blip, timeout, whatever) its
    // images silently never reached Filebase while the DB still recorded
    // the trait rows as if nothing was wrong — confirmed live 2026-08-17,
    // two full layers came back with zero uploaded objects and no error
    // anywhere. Now every layer's result is checked and failures surface in
    // the UI instead of vanishing.
    const doServerUpload = async () => {
      const groups: Record<string, { file: File; subpath: string }[]> = {};
      for (const file of files) {
        if (!file.type.startsWith('image/') && !file.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) continue;
        const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean);
        const layerIdx = parts.findIndex(p => /^\d+[-_]/.test(p));
        if (layerIdx === -1) continue;
        const layerName = parts[layerIdx];
        const subpath = parts.slice(layerIdx + 1).join('/');
        if (!groups[layerName]) groups[layerName] = [];
        groups[layerName].push({ file, subpath });
      }
      if (Object.keys(groups).length === 0) return;

      // Each layer's stale files are cleaned up server-side, scoped to that
      // layer's own prefix, only after its new files finish uploading
      // successfully — see /upload route. No blanket bucket wipe here: that
      // used to run unconditionally before every drop and could empty the
      // shared bucket for everyone if an upload failed partway through.
      const results = await Promise.allSettled(
        Object.entries(groups).map(async ([layer, entries]) => {
          const form = new FormData();
          form.append('layer', layer);
          for (const { file, subpath } of entries) {
            form.append('files', file);
            form.append('subpaths', subpath);
          }
          const res = await fetch('/api/upload', { method: 'POST', body: form });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json().catch(() => ({}));
          if (data.s3Uploaded?.length !== entries.length) {
            throw new Error(`only ${data.s3Uploaded?.length ?? 0}/${entries.length} files uploaded`);
          }
          return layer;
        }),
      );

      const failed = Object.keys(groups).filter((_, i) => results[i].status === 'rejected');
      if (failed.length) {
        console.error('[upload] layer(s) failed to upload to S3:', failed);
        setUploadFailedLayers(failed);
      }
    };
    doServerUpload();
  }

  // Optional: artist supplies a trait-names (+ optional weight) workbook (any
  // layer set, any sheet/column layout). Re-parses already-dropped image
  // files (if any) so names/weights apply whether the Excel arrives before
  // or after the image folder. Force/Block rules are NOT read from Excel —
  // those stay UI-driven, set/edited in the Organise tab's Rules panel.
  async function handleExcelUpload(file) {
    if (!file) return;
    setExcelMsg('Reading workbook…');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const data = parseTraitNamesFromWorkbook(wb);
      const matchedSheets = Object.keys(data.names).length;
      const weightSheets = Object.keys(data.weights).length;
      setExcelData(data);
      setExcelFileName(file.name);
      if (!matchedSheets) {
        setExcelMsg('No matching sheets found — check that sheet names match your layer folder names and have a column with "name" in its header.');
        return;
      }
      if (lastFilesRef.current) {
        const { layers: parsedLayers } = parseLayersFromFiles(lastFilesRef.current, data);
        onLayersChange?.(parsedLayers);
        const appliedCount = parsedLayers.reduce((n, l) => {
          const layerNames = data.names[normalizeLayerKey(l.folder)];
          return n + (layerNames && layerNames.length === l.assets.length ? l.assets.length : 0);
        }, 0);
        const weightNote = weightSheets ? `, weights applied for ${weightSheets} layer(s)` : '';
        setExcelMsg(`${matchedSheets} sheet(s) matched, ${appliedCount} trait name(s) applied${weightNote}.`);
      } else {
        setExcelMsg(`${matchedSheets} sheet(s) read — names/weights will apply once you drop the layer folder.`);
      }
    } catch (err) {
      console.error('[excel] parse failed:', err);
      setExcelMsg('Could not read this file — is it a valid .xlsx workbook?');
    }
  }

  // Generates a workbook matching whatever layers are currently dropped —
  // one sheet per layer folder, a reference Stem column (ignored by the
  // parser — it only reads whichever column has "name" in its header) plus
  // a blank Trait Name column in file order for the artist to fill in.
  function handleDownloadTemplate() {
    if (!lastFilesRef.current) {
      setExcelMsg('Drop your assets folder first — the template is built to match your actual layers and trait counts.');
      return;
    }
    const { layers: parsedLayers } = parseLayersFromFiles(lastFilesRef.current, {});
    const wb = XLSX.utils.book_new();
    for (const layer of parsedLayers) {
      const rows = [['Stem (reference only — do not edit)', 'Trait Name']];
      for (const a of layer.assets) rows.push([a.stem, '']);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const sheetName = layer.folder.slice(0, 31).replace(/[\\/?*[\]:]/g, '-');
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    // Build the file ourselves and trigger the download via a manually-made
    // anchor tag instead of XLSX.writeFile() — its internal browser-vs-node
    // detection doesn't reliably survive Next.js/Turbopack bundling, which
    // was producing a UUID-named file with no extension instead of a real
    // filename (confirmed live: chrome://downloads showed a bare GUID).
    const wbArray = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([wbArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trait-names-template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const items = [...e.dataTransfer.items];
    const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    // Dropping a folder = replace; dropping individual files = merge
    const hasFolder = entries.some(en => en.isDirectory);
    if (entries.length) {
      const nested = await Promise.all(entries.map(readEntry));
      await handleFolderUpload(nested.flat(), hasFolder);
    } else {
      await handleFolderUpload([...e.dataTransfer.files], false);
    }
  }

  return (
    <div className="setup-page">

      {/* Session restore banner — informational only; destructive reset is in the footer */}
      {sessionRestored && collectionId && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '9px 14px', marginBottom: 16,
          background: 'rgba(65,175,235,0.07)', border: '1px solid rgba(65,175,235,0.22)',
          borderRadius: 8, fontSize: 12.5, color: '#2e9fd8',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>
              <strong>Previous session resumed.</strong> Your collection and layers are loaded — switch to the <strong>Organize</strong> tab to continue.
              To start over, use <strong>Start a new collection</strong> below.
            </span>
          </div>
          <button
            onClick={() => onDismissRestore?.()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9bafc5', padding: '0 2px', fontSize: 16, lineHeight: 1, flexShrink: 0 }}
            title="Dismiss"
            aria-label="Dismiss session restore notice"
          >×</button>
        </div>
      )}

      <div className="setup-two-col">

        {/* ── Left: form ── */}
        <div className="setup-left">
          <div className="setup-section-head">Collection Settings</div>

          <div className="setup-field">
            <label>Collection Name <span style={{color:'#ef4444'}}>*</span></label>
            <input
              placeholder="No Name"
              value={collection.name}
              onChange={e => set('name', e.target.value)}
              style={errors.name ? { borderColor: '#ef4444' } : undefined}
            />
            {errors.name && <span className="field-error">{errors.name}</span>}
          </div>

          <div className="setup-field">
            <label>Token Symbol <span style={{color:'#ef4444'}}>*</span></label>
            <input
              placeholder="BRT"
              maxLength={10}
              value={collection.symbol}
              onChange={e => set('symbol', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
              style={errors.symbol ? { borderColor: '#ef4444' } : undefined}
            />
            <span className="field-hint">Short uppercase identifier (e.g. BAYC, AZUKI). Max 10 characters.</span>
            {errors.symbol && <span className="field-error">{errors.symbol}</span>}
          </div>

          <div className="setup-field">
            <label>Collection Description</label>
            <input
              placeholder="The description will appear in the NFT metadata"
              value={collection.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>

          <div className="setup-row2">
            <div className="setup-field">
              <label>Collection Size <span style={{color:'#ef4444'}}>*</span></label>
              <input
                type="number" min="1" max="100000"
                placeholder="e.g. 9999"
                value={collection.supply ?? ''}
                onChange={e => set('supply', e.target.value ? Math.max(1, +e.target.value) : undefined)}
                style={errors.supply ? { borderColor: '#ef4444' } : undefined}
              />
              {errors.supply && <span className="field-error">{errors.supply}</span>}
            </div>
            <div className="setup-field">
              <label>Name of each NFT</label>
              <input
                value={collection.nameFormat}
                onChange={e => set('nameFormat', e.target.value)}
              />
              <span className="field-hint">
                Preview: {[1, 2, 3].map(i => applyNameFormat(collection.nameFormat, i)).join(', ')}, ...
              </span>
            </div>
          </div>

          <div className="setup-field">
            <label>Blockchain</label>
            <select value={collection.blockchain} onChange={e => set('blockchain', e.target.value)}>
              {BLOCKCHAINS.map(b => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>

          <div className="setup-field">
            <label>Export Format</label>
            <div className="setup-format-row">
              {[{v:'png',l:'PNG'},{v:'webp',l:'Webp'}].map(f => (
                <button
                  key={f.v}
                  className={`fmt-sel-btn${collection.format === f.v ? ' fmt-sel-active' : ''}`}
                  onClick={() => set('format', f.v)}
                >{f.l}</button>
              ))}
            </div>
          </div>

          <div className="setup-field">
            <label>Dimensions <span style={{color:'#ef4444'}}>*</span></label>
            <div className="setup-hint">Required. Output dimensions of each NFT image in pixels (e.g. 2000x2000).</div>
            <div className="setup-dim-row">
              <input
                type="number"
                min="1"
                placeholder="Width"
                value={collection.width ?? ''}
                onChange={e => set('width', e.target.value ? Math.max(1, +e.target.value) : undefined)}
                style={errors.width ? { borderColor: '#ef4444' } : undefined}
              />
              <span className="setup-dim-x">×</span>
              <input
                type="number"
                min="1"
                placeholder="Height"
                value={collection.height ?? ''}
                onChange={e => set('height', e.target.value ? Math.max(1, +e.target.value) : undefined)}
                style={errors.height ? { borderColor: '#ef4444' } : undefined}
              />
            </div>
            {(errors.width || errors.height) && <span className="field-error">{errors.width || errors.height}</span>}
          </div>

          {/* Artwork Optional */}
          <div className="setup-artwork">
            <div className="setup-artwork-title">Import Artwork Layers</div>
            <div className="setup-artwork-hint">
              Drag and Drop your assets folder into the box below. We will automatically detect your folder name and import all layers.
            </div>
            <div
              className={`setup-drop-zone${dragOver ? ' drag-over' : ''}${uploadDone ? ' done' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => folderRef.current?.click()}
            >
              {uploading ? (
                <>
                  <div className="setup-drop-icon"><div className="spinner" /></div>
                  <div className="setup-drop-label">{uploadMsg || 'Uploading…'}</div>
                </>
              ) : uploadDone ? (
                <>
                  <div className="setup-drop-icon">✅</div>
                  <div className="setup-drop-label">{uploadMsg || 'Assets imported!'}</div>
                  <div className="setup-drop-sub">Click to add more</div>
                </>
              ) : (
                <>
                  <div className="setup-drop-icon">☁</div>
                  <div className="setup-drop-label">Drop your assets folder ↓</div>
                  <div className="setup-drop-sub">Drag the entire exported_layers folder — we'll import everything</div>
                </>
              )}
            </div>
            {uploadFailedLayers.length > 0 && (
              <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>
                ⚠ {uploadFailedLayers.length} layer(s) failed to upload to storage: {uploadFailedLayers.join(', ')}.
                Drop the folder again to retry — do not continue until this clears.
              </div>
            )}
            <input
              ref={folderRef}
              type="file"
              {...{ webkitdirectory: 'true' }}
              multiple
              style={{ display: 'none' }}
              onChange={e => e.target.files?.length && handleFolderUpload([...e.target.files], true)}
            />

            {/* Optional trait-names workbook — any layer set, any sheet/column
                layout, matched generically by sheet-name↔folder-name and a
                header containing "name". Falls back to file-stem naming when
                not provided or when a sheet's row count doesn't match. */}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="setup-excel-btn"
                onClick={() => excelRef.current?.click()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                {excelFileName ? `${excelFileName} — change file` : 'Import trait names from Excel (optional)'}
              </button>
              <button
                type="button"
                className="setup-excel-btn"
                onClick={handleDownloadTemplate}
                disabled={!uploadDone}
                title={uploadDone ? undefined : 'Drop your assets folder first — the template is built to match your actual layers and trait counts.'}
                style={uploadDone ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download matching template
              </button>
              {excelMsg && <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>{excelMsg}</span>}
            </div>
            <div className="setup-artwork-hint" style={{ marginTop: 4 }}>
              Each sheet name should match a layer folder, with a column whose header contains "name" — trait names are applied automatically when a sheet's row count matches that layer's file count. Not sure of the format? Download a template pre-filled with your actual layers and trait order.
            </div>
            <input
              ref={excelRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && handleExcelUpload(e.target.files[0])}
            />
          </div>

          {syncError && <div style={{color:'#ef4444',fontSize:13,marginBottom:8}}>⚠ {syncError}</div>}

          <button
            className="btn btn-primary btn-lg setup-continue-btn"
            onClick={handleSubmit}
            disabled={syncing}
          >
            {syncing ? (
              <><span className="spinner" style={{width:14,height:14,marginRight:6}} />Saving to database…</>
            ) : 'Save & Continue'}
          </button>
          <div className="setup-footer-links">
            <button className="link-btn" onClick={onReset}>Start a new collection</button>
          </div>
        </div>

        {/* ── Right: info panel ── */}
        <div className="setup-right">
          <div className="setup-info-title">Collection Settings</div>
          <div className="setup-info-sub">
            The most powerful no-code NFT tool trusted by the world's largest NFT creators.
          </div>

          <div className="setup-info-steps">
            <div className="setup-info-step">
              <div className="setup-info-num">1</div>
              <div className="setup-info-body">
                <div className="setup-info-step-title">Setup your NFT Collection</div>
                <div className="setup-info-step-desc">
                  Select the desired Blockchain, give your collection a name, a description, and set up the size of the final art pieces. Once you are ready, click "Save & Continue" button to proceed to the next step.
                </div>
              </div>
            </div>
            <div className="setup-info-step">
              <div className="setup-info-num">2</div>
              <div className="setup-info-body">
                <div className="setup-info-step-title">Import your art into the tool</div>
                <div className="setup-info-step-desc">
                  You can import a single image or a folder of images. The tool will automatically generate the corresponding metadata for each image.
                </div>
              </div>
            </div>
            <div className="setup-info-step">
              <div className="setup-info-num">3</div>
              <div className="setup-info-body">
                <div className="setup-info-step-title">Preview and Generate your collection</div>
                <div className="setup-info-step-desc">
                  Once the metadata is generated, download the metadata file. You can also upload the metadata file to IPFS to generate the NFTs.
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
