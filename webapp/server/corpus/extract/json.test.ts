import { describe, it, expect } from 'vitest';
import { extractJson } from './json.js';
import { pickExtractor } from './index.js';

const buf = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8');

describe('extractJson', () => {
  it('renders an array of flat records as CSV with a header', async () => {
    const text = await extractJson(
      buf([
        { name: 'Harvard University', rank: '1', region: 'United States', score: 100 },
        { name: 'Stanford University', rank: '2', region: 'United States', score: 76.8 },
      ]),
    );
    expect(text).toBe(
      'name,rank,region,score\n' +
        'Harvard University,1,United States,100\n' +
        'Stanford University,2,United States,76.8',
    );
  });

  it('unions columns across records in first-seen order', async () => {
    const text = await extractJson(buf([{ a: 1 }, { a: 2, b: 'x' }]));
    expect(text).toBe('a,b\n1,\n2,x');
  });

  it('escapes cells containing commas and quotes', async () => {
    const text = await extractJson(buf([{ name: 'Foo, "Bar"', n: 1 }]));
    expect(text).toBe('name,n\n"Foo, ""Bar""",1');
  });

  it('unwraps a { data: [...] } wrapper object', async () => {
    const text = await extractJson(buf({ meta: 'x', data: [{ a: 1 }, { a: 2 }] }));
    expect(text).toBe('a\n1\n2');
  });

  it('serialises nested values as JSON inside the cell', async () => {
    const text = await extractJson(buf([{ a: { b: 1 } }]));
    expect(text).toBe('a\n"{""b"":1}"');
  });

  it('falls back to raw text for non-tabular JSON', async () => {
    const raw = JSON.stringify({ just: 'a config', nested: { deep: true } });
    expect(await extractJson(Buffer.from(raw, 'utf8'))).toBe(raw);
  });

  it('falls back to raw text for invalid JSON', async () => {
    expect(await extractJson(Buffer.from('not json', 'utf8'))).toBe('not json');
  });

  it('is selected for application/json mime and .json extension', () => {
    expect(pickExtractor('application/json')).toBe(extractJson);
    expect(pickExtractor(undefined, 'rankings.json')).toBe(extractJson);
    expect(pickExtractor('application/octet-stream', 'usnews.json')).toBe(extractJson);
  });
});
