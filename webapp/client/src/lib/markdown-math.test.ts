import { describe, it, expect } from 'vitest';
import { findMath } from './markdown-enhance';
import { parseMarkdown } from './markdown';

const tex = (s: string) => findMath(s).map((m) => m.tex);

describe('findMath — inline $…$', () => {
  it('renders TeX commands between single dollars', () => {
    // The shape that sent us here: a Chinese lineage list joined by arrows.
    const line =
      '水（演、源，源远流长） $\\rightarrow$ 代（化、善，祖德功勋） $\\rightarrow$ 文（敬、赦、政）。';
    expect(tex(line)).toEqual(['\\rightarrow', '\\rightarrow']);
  });

  it('handles subscripts and superscripts', () => {
    expect(tex('Inline $x_i^2$ works')).toEqual(['x_i^2']);
  });

  it('reports offsets covering the delimiters', () => {
    const [m] = findMath('a $x$ b');
    expect([m!.start, m!.end]).toEqual([2, 5]);
    expect(m!.display).toBe(false);
  });
});

describe('findMath — currency is not math', () => {
  // The corpus is full of prices; every one of these used to be safe only
  // because single-$ math was unsupported outright.
  it.each([
    '费用 $1,035 和 $2,000 元',
    '价格 $5和$10',
    'From $1,035 to $2,000 in Q3',
    'cost $12.50, sold $13.75 today',
    'US$100–US$200 range',
    'a price of $ 5 and $ 6',
    'The $ARG var and $HOME dir',
    'Unbalanced $ alone',
    'escaped \\$5 and \\$9',
  ])('leaves %j alone', (s) => {
    expect(findMath(s)).toEqual([]);
  });

  it('does not run math across a line break', () => {
    expect(findMath('costs $5\nand $6 more')).toEqual([]);
  });
});

describe('findMath — display forms', () => {
  it('reads $$…$$ as display math', () => {
    const [m] = findMath('Pythagoras: $$a^2+b^2=c^2$$.');
    expect(m).toMatchObject({ tex: 'a^2+b^2=c^2', display: true });
  });

  it('reads \\[…\\] as display and \\(…\\) as inline', () => {
    expect(findMath('\\[E = mc^2\\]')).toMatchObject([{ tex: 'E = mc^2', display: true }]);
    expect(findMath('\\(y = 2\\)')).toMatchObject([{ tex: 'y = 2', display: false }]);
  });

  it('prefers $$ over $ at the same position', () => {
    expect(tex('$$a$$')).toEqual(['a']);
  });
});

describe('parseMarkdown keeps math delimiters intact', () => {
  it('survives CommonMark backslash escaping', () => {
    // Without the mathDelimiter extension marked unescapes these to bare
    // brackets and KaTeX never sees a delimiter.
    const html = parseMarkdown('Display \\[E = mc^2\\] and inline \\(y = 2\\).');
    expect(html).toContain('\\[E = mc^2\\]');
    expect(html).toContain('\\(y = 2\\)');
  });

  it('still parses markdown links', () => {
    expect(parseMarkdown('a [text](http://x.y) link')).toContain('<a href="http://x.y">text</a>');
  });

  it('leaves delimiters in code spans and fences untouched', () => {
    expect(parseMarkdown('`\\(x\\)`')).toContain('<code>\\(x\\)</code>');
    expect(parseMarkdown('```\n\\[block\\]\n```')).toContain('\\[block\\]');
  });
});
