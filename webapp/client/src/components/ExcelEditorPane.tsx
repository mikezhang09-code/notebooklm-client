/**
 * In-app spreadsheet editor — wraps react-spreadsheet for the grid UI and uses
 * SheetJS (xlsx) for the file round-trip. Loads the workbook bytes from the
 * same-origin /file route, edits cell values in place, and saves by writing
 * the edits back into the originally-loaded workbook and PUT-ing it via
 * /api/corpus/artifacts/:id/sheet (which also re-extracts + re-embeds so
 * search/chat stay in sync with the edits).
 *
 * Scope: .xlsx saves patch only the changed cells inside the original file's
 * ZIP (see lib/sheet-patch.ts), so styling (fills/fonts/themes), autofilters,
 * merges, widths, charts, and untouched formulas all survive. If patching
 * fails on an unusual file, we fall back to a SheetJS rewrite that keeps
 * values + structure but strips styling — and say so. CSV (no styling) always
 * uses the SheetJS path. Editing is gated upstream to .xlsx and .csv (see
 * sheetBookType).
 *
 * Heavy dependency — always load this module lazily (React.lazy) so the main
 * bundle stays lean.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Spreadsheet, { type CellBase, type Matrix } from 'react-spreadsheet';
import type { WorkBook } from 'xlsx';
import { Icon } from './Icon';
import { artifactFileUrl, updateArtifactSheet, XLSX_MIME } from '../lib/artifacts';
import { applyGridToSheet } from '../lib/sheet-edit';
import { toast } from '../lib/toast';

type Cell = CellBase<string>;
type SheetState = { name: string; data: Matrix<Cell> };
type XlsxModule = typeof import('xlsx');

/** Grid state flattened to plain text for diffing/serialization. */
function textGrids(sheets: SheetState[]): { name: string; values: string[][] }[] {
  return sheets.map((s) => ({
    name: s.name,
    values: s.data.map((row) => row.map((cell) => cell?.value ?? '')),
  }));
}

/** Style-stripping fallback: write the grids into the SheetJS model and re-serialize. */
function rebuildWithSheetJs(
  XLSX: XlsxModule,
  wb: WorkBook,
  grids: { name: string; values: string[][] }[],
  bookType: 'xlsx' | 'csv',
): ArrayBuffer {
  for (const g of grids) {
    const ws = wb.Sheets[g.name];
    if (ws) applyGridToSheet(XLSX, ws, g.values);
  }
  return XLSX.write(wb, { type: 'array', bookType, cellStyles: true }) as ArrayBuffer;
}

export default function ExcelEditorPane({
  id,
  title,
  bookType,
  onSaved,
}: {
  id: string;
  title: string;
  /** File kind, gated upstream to the two SheetJS can round-trip losslessly. */
  bookType: 'xlsx' | 'csv';
  /** Called after a successful save so the parent can refresh its preview. */
  onSaved?: () => void;
}) {
  const [sheets, setSheets] = useState<SheetState[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The file as last loaded/saved: raw bytes (source of truth the surgical
  // save patches) plus the SheetJS parse (the diff baseline for "what
  // changed"). Both are re-anchored after every successful save.
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const wbRef = useRef<WorkBook | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);
    bytesRef.current = null;
    wbRef.current = null;
    (async () => {
      try {
        const res = await fetch(artifactFileUrl(id));
        if (!res.ok) throw new Error(`Failed to load workbook (HTTP ${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const XLSX = await import('xlsx');
        // cellStyles keeps column widths / row heights on the parsed sheets.
        const wb = XLSX.read(buf, { type: 'array', cellStyles: true });
        bytesRef.current = buf;
        wbRef.current = wb;
        const parsed: SheetState[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
            header: 1,
            defval: '',
            blankrows: true,
          });
          const cols = aoa.reduce((m, r) => Math.max(m, r.length), 1);
          const data: Matrix<Cell> = aoa.map((row) =>
            Array.from({ length: cols }, (_, c) => ({
              value: row[c] == null ? '' : String(row[c]),
            })),
          );
          // Guarantee at least one editable row so an empty sheet is usable.
          if (data.length === 0) data.push(Array.from({ length: cols }, () => ({ value: '' })));
          return { name, data };
        });
        if (cancelled) return;
        if (parsed.length === 0) setError('Workbook has no sheets');
        else setSheets(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const current = sheets?.[active];

  const onChange = useCallback(
    (next: Matrix<Cell>) => {
      setSheets((prev) => {
        if (!prev) return prev;
        const copy = prev.slice();
        copy[active] = { ...copy[active]!, data: next };
        return copy;
      });
    },
    [active],
  );

  const addRow = useCallback(() => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = copy[active]!;
      const cols = sheet.data[0]?.length ?? 1;
      copy[active] = {
        ...sheet,
        data: [...sheet.data, Array.from({ length: cols }, () => ({ value: '' }))],
      };
      return copy;
    });
  }, [active]);

  const removeRow = useCallback(() => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = copy[active]!;
      if (sheet.data.length <= 1) return prev;
      copy[active] = { ...sheet, data: sheet.data.slice(0, -1) };
      return copy;
    });
  }, [active]);

  async function save() {
    if (saving || !sheets) return;
    setSaving(true);
    try {
      const XLSX = await import('xlsx');
      const wb = wbRef.current;
      const bytes = bytesRef.current;
      if (!wb || !bytes) throw new Error('Workbook not loaded yet');
      const grids = textGrids(sheets);

      // Preferred path: patch only the changed cells inside the original file
      // so styling/themes/charts survive byte-for-byte (xlsx only).
      let out: ArrayBuffer;
      let styleLoss = false;
      if (bookType === 'xlsx') {
        try {
          const { diffSheetGrid, patchXlsx } = await import('../lib/sheet-patch');
          const patches = grids.flatMap((g) => {
            const ws = wb.Sheets[g.name];
            return ws ? [{ name: g.name, ...diffSheetGrid(XLSX, ws, g.values) }] : [];
          });
          const patched = patchXlsx(new Uint8Array(bytes), patches);
          out = patched.buffer.slice(
            patched.byteOffset,
            patched.byteOffset + patched.byteLength,
          ) as ArrayBuffer;
        } catch (err) {
          console.warn('[excel-editor] surgical patch failed; falling back to SheetJS rewrite:', err);
          styleLoss = true;
          out = rebuildWithSheetJs(XLSX, wb, grids, bookType);
        }
      } else {
        out = rebuildWithSheetJs(XLSX, wb, grids, bookType);
      }

      const mime = bookType === 'csv' ? 'text/csv' : XLSX_MIME;
      const r = await updateArtifactSheet(id, out, `${title || 'workbook'}.${bookType}`, mime);
      // Re-anchor the diff baseline on what we just persisted, so the next
      // save diffs against the saved file rather than the original load.
      bytesRef.current = out;
      wbRef.current = XLSX.read(out, { type: 'array', cellStyles: true });
      toast(
        styleLoss
          ? 'Saved — but this file’s cell formatting could not be preserved'
          : r.embedSkipped
            ? 'Saved — not re-indexed (embedding failed; backfill in Settings → Diagnose)'
            : 'Saved to library',
      );
      onSaved?.();
    } catch (e) {
      toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const columnLabels = useMemo(() => {
    const n = current?.data[0]?.length ?? 0;
    // Excel-style A, B, … Z, AA, AB column headers.
    return Array.from({ length: n }, (_, i) => {
      let s = '';
      let x = i;
      do {
        s = String.fromCharCode(65 + (x % 26)) + s;
        x = Math.floor(x / 26) - 1;
      } while (x >= 0);
      return s;
    });
  }, [current]);

  if (error) {
    return (
      <div className="empty" style={{ color: 'var(--accent)' }}>
        {error}
      </div>
    );
  }
  if (!sheets || !current) {
    return <div className="empty">Loading workbook…</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          <Icon id="i-upload" /> {saving ? 'Saving…' : 'Save to library'}
        </button>
        <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
        <button className="btn btn-soft" onClick={addRow} title="Append an empty row">
          + Row
        </button>
        <button className="btn btn-soft" onClick={removeRow} title="Remove the last row">
          − Row
        </button>
      </div>

      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="excel-tabs">
          {sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              className={i === active ? 'excel-tab active' : 'excel-tab'}
              onClick={() => setActive(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="excel-editor" style={{ overflow: 'auto', flex: 1, padding: 16 }}>
        <Spreadsheet data={current.data} onChange={onChange} columnLabels={columnLabels} darkMode={false} />
      </div>
    </div>
  );
}
