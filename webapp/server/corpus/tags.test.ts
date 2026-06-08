import { describe, it, expect } from 'vitest';
import { cleanTags, parseTagArray, mergeInheritedTags } from './tags.js';

describe('cleanTags', () => {
  it('lowercases, trims, dedupes, drops empties', () => {
    expect(cleanTags([' Q3 ', 'q3', 'Tencent', '', '  '])).toEqual(['q3', 'tencent']);
  });

  it('drops overlong tags and caps the count', () => {
    expect(cleanTags(['x'.repeat(33)])).toEqual([]);
    expect(cleanTags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(32);
  });

  it('handles null/undefined', () => {
    expect(cleanTags(undefined)).toEqual([]);
    expect(cleanTags(null)).toEqual([]);
  });
});

describe('parseTagArray', () => {
  it('accepts arrays, JSON strings, and rejects junk', () => {
    expect(parseTagArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseTagArray('["a","b"]')).toEqual(['a', 'b']);
    expect(parseTagArray('not json')).toEqual([]);
    expect(parseTagArray(null)).toEqual([]);
    expect(parseTagArray(42)).toEqual([]);
  });
});

describe('mergeInheritedTags', () => {
  it('adds inherited tags alongside manual ones (union)', () => {
    const r = mergeInheritedTags(['mine'], [], ['shared', 'q3']);
    expect(r.tags).toEqual(['mine', 'shared', 'q3']);
    expect(r.inherited).toEqual(['shared', 'q3']);
  });

  it('swaps the old inherited slice for the new one, keeping manual tags', () => {
    // Artifact currently shows manual 'mine' + previously-inherited 'old'.
    const r = mergeInheritedTags(['mine', 'old'], ['old'], ['new']);
    expect(r.tags).toEqual(['mine', 'new']);
    expect(r.inherited).toEqual(['new']);
  });

  it('removing a group tag removes only the inherited copy', () => {
    const r = mergeInheritedTags(['mine', 'shared'], ['shared'], []);
    expect(r.tags).toEqual(['mine']);
    expect(r.inherited).toEqual([]);
  });

  it('does not duplicate when a manual tag equals an inherited tag', () => {
    // 'shared' was manual; it also becomes inherited — stays once.
    const r = mergeInheritedTags(['shared'], [], ['shared']);
    expect(r.tags).toEqual(['shared']);
  });

  it('normalises case across manual and inherited', () => {
    const r = mergeInheritedTags(['Mine'], [], ['SHARED']);
    expect(r.tags).toEqual(['mine', 'shared']);
  });
});
