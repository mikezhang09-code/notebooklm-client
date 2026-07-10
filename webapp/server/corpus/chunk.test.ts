import { describe, it, expect } from 'vitest';
import { detectTableHeader, chunkArtifactText } from './chunk.js';

const QS_STYLE =
  '2026 QS World University Rankings,,,,"Reference only"\n' +
  ',2026,2025,Institution,Location,,Classification\n' +
  'Index,Rank,Previous Rank,Name,Country/Territory,Region\n' +
  '1,1,1,Massachusetts Institute of Technology (MIT),United States of America,Americas\n' +
  '38,38,34,Columbia University,United States of America,Americas\n';

describe('detectTableHeader', () => {
  it('collects header lines up to the first data-looking row', () => {
    expect(detectTableHeader(QS_STYLE)).toBe(
      '2026 QS World University Rankings,,,,"Reference only"\n' +
        ',2026,2025,Institution,Location,,Classification\n' +
        'Index,Rank,Previous Rank,Name,Country/Territory,Region',
    );
  });

  it('handles a plain CSV whose first line is the header', () => {
    expect(detectTableHeader('name,rank,region,score\nHarvard University,1,United States,100')).toBe(
      'name,rank,region,score',
    );
  });

  it('treats rank-range and tie cells ("801+", "1201-1400", "7=") as numeric', () => {
    expect(detectTableHeader('a,b,c\n801+,1201-1400,7=\n')).toBe('a,b,c');
  });

  it('returns null when the text starts directly with data', () => {
    expect(detectTableHeader('1,2,3,x\n4,5,6,y')).toBeNull();
  });
});

describe('chunkArtifactText', () => {
  it('prefixes data_table chunks with title + detected header', () => {
    const chunks = chunkArtifactText(QS_STYLE, {
      kind: 'data_table',
      title: 'QS 2026 rankings',
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.text.startsWith('QS 2026 rankings\n2026 QS World University Rankings')).toBe(true);
      expect(c.text).toContain('Index,Rank,Previous Rank,Name');
    }
  });

  it('leaves non-tabular kinds untouched', () => {
    const chunks = chunkArtifactText('Some prose about universities.', {
      kind: 'report',
      title: 'essay',
    });
    expect(chunks[0]?.text).toBe('Some prose about universities.');
  });
});
