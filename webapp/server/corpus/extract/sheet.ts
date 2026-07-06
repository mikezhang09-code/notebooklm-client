/**
 * Excel workbook (.xlsx / .xls) text extraction via SheetJS.
 *
 * Emits one CSV block per sheet, prefixed with the sheet name, so the
 * chunker sees real cell text instead of the raw ZIP bytes (which would
 * UTF-8-decode into mojibake and pollute search/chat embeddings).
 */
import * as XLSX from 'xlsx';

export async function extractSheet(buf: Buffer): Promise<string> {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws).trim();
    if (csv.length === 0) continue;
    parts.push(wb.SheetNames.length > 1 ? `## ${name}\n${csv}` : csv);
  }
  return parts.join('\n\n');
}
