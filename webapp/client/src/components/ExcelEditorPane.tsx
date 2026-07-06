/**
 * In-app spreadsheet editor — a virtualized react-data-grid for the grid UI
 * plus SheetJS (xlsx) for the file round-trip. Loads the workbook bytes from
 * the same-origin /file route, edits cell values, and saves by PUT-ing the
 * result via /api/corpus/artifacts/:id/sheet (which also re-extracts +
 * re-embeds so search/chat stay in sync with the edits).
 *
 * Why react-data-grid: the previous react-spreadsheet grid re-synced and
 * re-evaluated its whole model on every keystroke (it carries a formula
 * engine), so typing lagged even on small sheets. react-data-grid is canvas-
 * light, virtualized, and edits a single cell without re-rendering the sheet,
 * so typing is instant. It has no built-in multi-cell range paste, so block
 * copy/paste (TSV from Excel) is wired here against the selected cell.
 *
 * Cells display their formatted value (Excel-style); editing reveals the
 * underlying formula/raw text, and committed edits re-run a best-effort
 * formula recalc so dependent cells refresh live (see lib/sheet-recalc.ts).
 *
 * Scope: .xlsx saves patch only the changed cells inside the original file's
 * ZIP (see lib/sheet-patch.ts), so styling/charts/formulas survive; on an
 * unusual file we fall back to a SheetJS rewrite (values only) and say so.
 * CSV always uses the SheetJS path. Gated upstream to .xlsx and .csv (see
 * sheetBookType).
 *
 * Heavy dependency — always load this module lazily (React.lazy) so the main
 * bundle stays lean.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Note: pinned to v7.0.0-beta.47 — the last release whose internals actually
// work on React 18 (beta.48+ render <Context> directly, which is React-19-only
// syntax despite the declared peer range). DataGrid is its default export and
// the text editor is named `textEditor` (later betas: `renderTextEditor`).
import DataGrid, { textEditor, type Column, type CellSelectArgs } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import type { WorkBook } from 'xlsx';
import { Icon } from './Icon';
import { artifactFileUrl, updateArtifactSheet, XLSX_MIME } from '../lib/artifacts';
import { applyGridToSheet, displayAoa, isFormula, type CellVal } from '../lib/sheet-edit';
import { toast } from '../lib/toast';

// A grid row holds two values per column: `c{j}` is the editable text (a
// formula `=…` or the raw value — the source of truth we diff and save) and
// `d{j}` is the read-only display text (the formatted result Excel would show).
type Row = { __id: number; [key: string]: string | number };
type Formats = (string | number | undefined)[][];
type SheetState = { name: string; rows: Row[]; nCols: number; formats: Formats };
type XlsxModule = typeof import('xlsx');
type Recalc = (values: string[][], name: string) => Map<string, CellVal>;

function safeFmt(XLSX: XlsxModule, z: string | number, n: number): string {
  try {
    return XLSX.SSF.format(z, n);
  } catch {
    return String(n);
  }
}

// What a cell shows when it's not being edited: a formula → its formatted
// computed result; a plain number → formatted by the cell's number format;
// anything else → the raw text.
function displayText(
  XLSX: XlsxModule,
  editText: string,
  computed: CellVal | undefined,
  z: string | number | undefined,
  prev: string,
): string {
  if (editText === '') return '';
  if (isFormula(editText)) {
    if (computed == null) return prev; // couldn't evaluate — keep the last known value
    return z != null && typeof computed === 'number' ? safeFmt(XLSX, z, computed) : String(computed);
  }
  if (z != null) {
    const n = Number(editText);
    if (editText.trim() !== '' && Number.isFinite(n)) return safeFmt(XLSX, z, n);
  }
  return editText;
}

/** Recompute every `d{j}` display value for one sheet's rows. */
function withDisplay(
  XLSX: XlsxModule,
  recalc: Recalc,
  rows: Row[],
  nCols: number,
  name: string,
  formats: Formats,
): Row[] {
  const values = rows.map((r) => Array.from({ length: nCols }, (_, j) => String(r[`c${j}`] ?? '')));
  const computed = recalc(values, name);
  return rows.map((r, ri) => {
    const nr: Row = { ...r };
    for (let j = 0; j < nCols; j++) {
      nr[`d${j}`] = displayText(
        XLSX,
        String(r[`c${j}`] ?? ''),
        computed.get(`${ri},${j}`),
        formats[ri]?.[j],
        String(r[`d${j}`] ?? ''),
      );
    }
    return nr;
  });
}

// Excel-style A, B, … Z, AA column header for a 0-based index.
function colName(i: number): string {
  let s = '';
  let x = i;
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

const emptyRow = (id: number): Row => ({ __id: id });

/** One sheet's grid rows flattened to text[][] for diffing/serialization. */
function sheetValues(s: SheetState): string[][] {
  return s.rows.map((r) => Array.from({ length: s.nCols }, (_, j) => String(r[`c${j}`] ?? '')));
}
function textGrids(sheets: SheetState[]): { name: string; values: string[][] }[] {
  return sheets.map((s) => ({ name: s.name, values: sheetValues(s) }));
}

/** Style-stripping fallback: write the grids into the SheetJS model and re-serialize. */
function rebuildWithSheetJs(
  XLSX: XlsxModule,
  wb: WorkBook,
  grids: { name: string; values: string[][] }[],
  bookType: 'xlsx' | 'csv',
  recalc: Recalc,
): ArrayBuffer {
  for (const g of grids) {
    const ws = wb.Sheets[g.name];
    if (ws) applyGridToSheet(XLSX, ws, g.values, recalc(g.values, g.name));
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
  // Raw bytes + SheetJS parse of the file as last loaded/saved (surgical-save
  // source of truth + diff baseline); re-anchored after every successful save.
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const wbRef = useRef<WorkBook | null>(null);
  // Monotonic id for rows added after load — starts well past the initial
  // 0..n-1 ids so it never collides within a sheet.
  const nextId = useRef(1_000_000);
  // Latest selected cell (for block copy/paste), tracked outside render.
  const selected = useRef<{ rowIdx: number; colIdx: number } | null>(null);
  // xlsx + recalc, loaded lazily on the first edit (keeps the initial open fast;
  // display values then refresh formula/formatted results after each commit).
  const deps = useRef<{ XLSX: XlsxModule; recalc: Recalc } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);
    setActive(0);
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
          // `c{j}` = editable text: formulas as `=…` (Excel's edit line); the
          // cell's cached formatted text (`.w`) seeds the `d{j}` display so the
          // grid shows values, not formulas, until edited.
          const aoa = displayAoa(XLSX, ws);
          const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
          const nCols = Math.max(aoa.reduce((m, r) => Math.max(m, r.length), 1), 1);
          const formats: Formats = [];
          const rows: Row[] = aoa.map((r, i) => {
            const row: Row = { __id: i };
            const fr: (string | number | undefined)[] = [];
            for (let j = 0; j < nCols; j++) {
              const cell = ws[XLSX.utils.encode_cell({ r: range.s.r + i, c: range.s.c + j })];
              const edit = r[j] ?? '';
              row[`c${j}`] = edit;
              row[`d${j}`] = cell?.w ?? (cell?.v != null ? String(cell.v) : edit);
              fr.push(typeof cell?.z === 'string' || typeof cell?.z === 'number' ? cell.z : undefined);
            }
            formats.push(fr);
            return row;
          });
          // Guarantee at least one editable row so an empty sheet is usable.
          if (rows.length === 0) {
            rows.push(emptyRow(0));
            formats.push([]);
          }
          return { name, rows, nCols, formats };
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

  const columns = useMemo<Column<Row>[]>(() => {
    const n = current?.nCols ?? 0;
    const cols: Column<Row>[] = [
      {
        key: '__row',
        name: '',
        frozen: true,
        width: 52,
        resizable: false,
        cellClass: 'rdg-rownum',
        renderCell: ({ rowIdx }) => rowIdx + 1,
      },
    ];
    for (let j = 0; j < n; j++) {
      cols.push({
        key: `c${j}`,
        name: colName(j),
        editable: true,
        resizable: true,
        width: 130,
        // Show the formatted display value; the editor still edits `c{j}`.
        renderCell: ({ row, column }) => String(row[`d${column.key.slice(1)}`] ?? ''),
        renderEditCell: textEditor,
      });
    }
    return cols;
  }, [current?.nCols]);

  // Recompute the active sheet's `d{j}` display values (formulas + number
  // formats) after an edit. Runs on commit (Enter/blur/paste), not per
  // keystroke, so it stays cheap; loads xlsx + recalc lazily the first time.
  const refreshDisplay = useCallback(() => {
    void (async () => {
      if (!deps.current) {
        const [XLSX, mod] = await Promise.all([import('xlsx'), import('../lib/sheet-recalc')]);
        deps.current = { XLSX, recalc: mod.recalcSheet };
      }
      const { XLSX, recalc } = deps.current;
      setSheets((prev) => {
        if (!prev) return prev;
        const sheet = prev[active]!;
        const copy = prev.slice();
        copy[active] = {
          ...sheet,
          rows: withDisplay(XLSX, recalc, sheet.rows, sheet.nCols, sheet.name, sheet.formats),
        };
        return copy;
      });
    })();
  }, [active]);

  const onRowsChange = useCallback(
    (rows: Row[]) => {
      setSheets((prev) => {
        if (!prev) return prev;
        const copy = prev.slice();
        copy[active] = { ...copy[active]!, rows };
        return copy;
      });
      refreshDisplay();
    },
    [active, refreshDisplay],
  );

  const onSelectedCellChange = useCallback((args: CellSelectArgs<Row>) => {
    const key = args.column?.key ?? '';
    selected.current = { rowIdx: args.rowIdx, colIdx: key.startsWith('c') ? Number(key.slice(1)) : -1 };
  }, []);

  // Block paste: parse clipboard TSV and write it starting at the selected
  // cell, growing rows/cols as needed (react-data-grid has no native
  // multi-cell paste).
  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text/plain');
    const sel = selected.current;
    if (!text || !sel || sel.colIdx < 0) return;
    e.preventDefault();
    const block = text
      .replace(/\r\n?/g, '\n')
      .replace(/\n$/, '')
      .split('\n')
      .map((l) => l.split('\t'));
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = { ...copy[active]! };
      const rows = sheet.rows.slice();
      let nCols = sheet.nCols;
      while (rows.length < sel.rowIdx + block.length) rows.push(emptyRow(nextId.current++));
      for (let i = 0; i < block.length; i++) {
        const r = sel.rowIdx + i;
        const line = block[i]!;
        const patch: Row = { ...rows[r]! };
        for (let j = 0; j < line.length; j++) {
          const c = sel.colIdx + j;
          if (c + 1 > nCols) nCols = c + 1;
          patch[`c${c}`] = line[j]!;
        }
        rows[r] = patch;
      }
      sheet.rows = rows;
      sheet.nCols = nCols;
      copy[active] = sheet;
      return copy;
    });
    refreshDisplay();
  }

  // Copy the single selected cell (range copy isn't supported by the grid).
  function handleCopy(e: React.ClipboardEvent) {
    const sel = selected.current;
    if (!sel || sel.colIdx < 0 || !current) return;
    e.clipboardData.setData('text/plain', String(current.rows[sel.rowIdx]?.[`c${sel.colIdx}`] ?? ''));
    e.preventDefault();
  }

  const addRow = useCallback(() => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = copy[active]!;
      copy[active] = { ...sheet, rows: [...sheet.rows, emptyRow(nextId.current++)] };
      return copy;
    });
  }, [active]);

  const removeRow = useCallback(() => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = copy[active]!;
      if (sheet.rows.length <= 1) return prev;
      copy[active] = { ...sheet, rows: sheet.rows.slice(0, -1) };
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
      // Best-effort recalc so edited formulas (and formulas depending on edited
      // inputs) get a fresh cached value baked in for read-only viewers.
      const { recalcSheet } = await import('../lib/sheet-recalc');

      // Preferred path: patch only the changed cells inside the original file
      // so styling/themes/charts survive byte-for-byte (xlsx only).
      let out: ArrayBuffer;
      let styleLoss = false;
      if (bookType === 'xlsx') {
        try {
          const { diffSheetGrid, patchXlsx } = await import('../lib/sheet-patch');
          const patches = grids.flatMap((g) => {
            const ws = wb.Sheets[g.name];
            return ws
              ? [{ name: g.name, ...diffSheetGrid(XLSX, ws, g.values, recalcSheet(g.values, g.name)) }]
              : [];
          });
          const patched = patchXlsx(new Uint8Array(bytes), patches);
          out = patched.buffer.slice(
            patched.byteOffset,
            patched.byteOffset + patched.byteLength,
          ) as ArrayBuffer;
        } catch (err) {
          console.warn('[excel-editor] surgical patch failed; falling back to SheetJS rewrite:', err);
          styleLoss = true;
          out = rebuildWithSheetJs(XLSX, wb, grids, bookType, recalcSheet);
        }
      } else {
        out = rebuildWithSheetJs(XLSX, wb, grids, bookType, recalcSheet);
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

  if (error && !sheets) {
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
      <div className="excel-editor" style={{ flex: 1, minHeight: 0 }} onPaste={handlePaste} onCopy={handleCopy}>
        <DataGrid
          className="rdg-light"
          columns={columns}
          rows={current.rows}
          rowKeyGetter={(r) => r.__id}
          onRowsChange={onRowsChange}
          onSelectedCellChange={onSelectedCellChange}
          rowHeight={28}
          headerRowHeight={30}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}
