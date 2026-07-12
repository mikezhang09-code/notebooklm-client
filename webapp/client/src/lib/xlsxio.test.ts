import { describe, it, expect } from 'vitest';
import { parseXlsx, buildXlsx } from './xlsxio';
import { diffWorkbook, parseRange, type RichWorkbook } from './sheet-model';

function sampleWorkbook(): RichWorkbook {
  return {
    sheets: [
      {
        name: 'Data',
        cells: [
          [
            { v: 'Name', style: { bold: true, bg: '#DDEBF7', hAlign: 'center' } },
            { v: 'Score', style: { bold: true, bg: '#DDEBF7' } },
            null,
          ],
          [{ v: 'alpha' }, { v: 12.5, style: { numFmt: '0.00' } }, { f: '=B2*2', v: 25 }],
          [
            { v: 'beta', style: { italic: true, color: '#C00000' } },
            { v: 7, style: { borderBottom: { style: 'thin', color: '#333333' } } },
            null,
          ],
        ],
        merges: ['A1:B1'],
        colWidths: [120, 80, null],
        rowHeights: [28, null, null],
      },
      {
        name: 'Notes',
        cells: [[{ v: 'second sheet' }]],
        merges: [],
        colWidths: [null],
        rowHeights: [null],
      },
    ],
  };
}

describe('xlsxio round-trip', () => {
  it('preserves values, formulas, styles, merges, and layout across build → parse', async () => {
    const buf = await buildXlsx(sampleWorkbook());
    const back = await parseXlsx(buf);

    expect(back.sheets.map((s) => s.name)).toEqual(['Data', 'Notes']);
    const data = back.sheets[0]!;

    expect(data.cells[0]?.[0]?.v).toBe('Name');
    expect(data.cells[0]?.[0]?.style?.bold).toBe(true);
    expect(data.cells[0]?.[0]?.style?.bg).toBe('#DDEBF7');
    expect(data.cells[0]?.[0]?.style?.hAlign).toBe('center');
    expect(data.cells[1]?.[1]?.style?.numFmt).toBe('0.00');

    expect(data.cells[1]?.[1]?.v).toBe(12.5);
    expect(data.cells[1]?.[2]?.f).toBe('=B2*2');
    expect(data.cells[1]?.[2]?.v).toBe(25);

    expect(data.cells[2]?.[0]?.style?.italic).toBe(true);
    expect(data.cells[2]?.[0]?.style?.color).toBe('#C00000');
    expect(data.cells[2]?.[1]?.style?.borderBottom).toEqual({
      style: 'thin',
      color: '#333333',
    });

    expect(data.merges).toEqual(['A1:B1']);
    expect(data.colWidths[0]).toBe(120);
    expect(data.rowHeights[0]).toBe(28);

    expect(back.sheets[1]?.cells[0]?.[0]?.v).toBe('second sheet');
  });
});

describe('diffWorkbook', () => {
  it('reports none when nothing changed', () => {
    expect(diffWorkbook(sampleWorkbook(), sampleWorkbook()).kind).toBe('none');
  });

  it('reports a values diff for pure cell edits', () => {
    const edited = sampleWorkbook();
    edited.sheets[0]!.cells[1]![0] = { v: 'ALPHA' };
    edited.sheets[0]!.cells[1]![2] = { f: '=B2*3', v: 37.5 };
    const res = diffWorkbook(sampleWorkbook(), edited);
    expect(res.kind).toBe('values');
    if (res.kind !== 'values') return;
    const changes = res.diff.perSheet[0]!.changes;
    expect(changes).toContainEqual({ r: 1, c: 0, text: 'ALPHA' });
    expect(changes).toContainEqual({ r: 1, c: 2, text: '=B2*3', value: 37.5 });
  });

  it('flags a recalculated formula (same text, new cached value) as a change', () => {
    const edited = sampleWorkbook();
    edited.sheets[0]!.cells[1]![2] = { f: '=B2*2', v: 99 };
    const res = diffWorkbook(sampleWorkbook(), edited);
    expect(res.kind).toBe('values');
    if (res.kind !== 'values') return;
    expect(res.diff.perSheet[0]!.changes).toContainEqual({
      r: 1,
      c: 2,
      text: '=B2*2',
      value: 99,
    });
  });

  it('falls back to full save on style changes', () => {
    const edited = sampleWorkbook();
    edited.sheets[0]!.cells[1]![0] = { v: 'alpha', style: { bold: true } };
    expect(diffWorkbook(sampleWorkbook(), edited).kind).toBe('full');
  });

  it('falls back to full save on merge/layout/sheet changes', () => {
    const merged = sampleWorkbook();
    merged.sheets[0]!.merges = ['A1:C1'];
    expect(diffWorkbook(sampleWorkbook(), merged).kind).toBe('full');

    const widened = sampleWorkbook();
    widened.sheets[0]!.colWidths[0] = 200;
    expect(diffWorkbook(sampleWorkbook(), widened).kind).toBe('full');

    const renamed = sampleWorkbook();
    renamed.sheets[1]!.name = 'Other';
    expect(diffWorkbook(sampleWorkbook(), renamed).kind).toBe('full');
  });
});

describe('sparse sheets', () => {
  it('parses a sheet with a blank row inside its used range', async () => {
    // A blank interior row makes exceljs's eachRow (includeEmpty: false) skip
    // it, leaving the row array sparse — this used to collapse the column
    // count to NaN and render every cell blank.
    const buf = await buildXlsx({
      sheets: [
        {
          name: 'Gap',
          cells: [
            [{ v: 'header', style: { bold: true } }, { v: 1 }],
            [null, null],
            [{ v: 'after-gap' }, { v: 2 }],
          ],
          merges: [],
          colWidths: [null, null],
          rowHeights: [null, null, null],
        },
      ],
    });
    const back = await parseXlsx(buf);
    const s = back.sheets[0]!;
    expect(s.cells[0]?.[0]?.v).toBe('header');
    expect(s.cells[0]?.[1]?.v).toBe(1);
    expect(s.cells[2]?.[0]?.v).toBe('after-gap');
    expect(s.cells[2]?.[1]?.v).toBe(2);
  });
});

describe('parseRange', () => {
  it('parses single cells and ranges', () => {
    expect(parseRange('B2')).toEqual({ startRow: 1, startCol: 1, endRow: 1, endCol: 1 });
    expect(parseRange('A1:C3')).toEqual({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 });
  });
});
