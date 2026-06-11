/**
 * Phase-2 client-side enhancements for rendered Markdown, applied after the
 * sanitised HTML is in the DOM (see {@link MarkdownView} in `./markdown`):
 *
 *   • Mermaid    — ```mermaid fenced blocks → inline SVG diagrams
 *   • highlight.js — syntax-highlight other fenced code blocks
 *   • KaTeX      — render $$…$$ / \[…\] (display) and \(…\) (inline) math
 *
 * Every library is loaded with a dynamic import() so none of them land in the
 * main bundle — they only download the first time a document actually needs a
 * diagram, a code block, or math. KaTeX math deliberately ignores single `$`
 * delimiters: our corpus is full of currency like "$1,035", which would
 * otherwise be mangled into math.
 */

/** Returns true when the in-flight render should stop (content changed/unmounted). */
type CancelFn = () => boolean;

let mermaidCounter = 0;

/** Run all enhancement passes over a freshly-rendered container. */
export async function enhanceMarkdown(el: HTMLElement, isCancelled: CancelFn): Promise<void> {
  await Promise.all([
    renderMermaid(el, isCancelled),
    highlightCode(el, isCancelled),
    renderMath(el, isCancelled),
  ]);
}

// ── Mermaid ──────────────────────────────────────────────────────────────────

async function renderMermaid(el: HTMLElement, isCancelled: CancelFn): Promise<void> {
  const blocks = Array.from(el.querySelectorAll<HTMLElement>('code.language-mermaid'));
  if (blocks.length === 0) return;

  // Swap each fence for a placeholder right away — the mermaid bundle is
  // ~1.5 MB, so on a cold cache the first diagram can take seconds to appear.
  const jobs = blocks.map((code) => {
    const host = (code.closest('pre') ?? code) as HTMLElement;
    const placeholder = document.createElement('div');
    placeholder.className = 'mermaid-loading';
    placeholder.textContent = 'Rendering diagram…';
    host.replaceWith(placeholder);
    return { host, placeholder, src: code.textContent ?? '' };
  });

  let mermaid: Awaited<typeof import('mermaid')>['default'];
  try {
    mermaid = (await import('mermaid')).default;
  } catch {
    // Bundle failed to load (offline?) — put the source blocks back.
    for (const { host, placeholder } of jobs) placeholder.replaceWith(host);
    return;
  }
  if (isCancelled()) return;

  const dark = document.body.dataset.theme === 'dark';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict', // sanitises diagram labels (strips scripts)
    theme: dark ? 'dark' : 'default',
    fontFamily: 'inherit',
  });

  for (const { host, placeholder, src } of jobs) {
    if (isCancelled()) return;
    const renderId = `mmd-${Date.now()}-${++mermaidCounter}`;
    try {
      const { svg } = await mermaid.render(renderId, src);
      if (isCancelled()) return;
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-diagram';
      wrap.innerHTML = svg; // SVG produced by mermaid in strict mode
      placeholder.replaceWith(wrap);
    } catch (err) {
      // A parse failure leaves mermaid's scratch element behind in <body>.
      document.getElementById(`d${renderId}`)?.remove();
      if (isCancelled()) return;
      const note = document.createElement('div');
      note.className = 'mermaid-error';
      note.textContent = `Mermaid error: ${err instanceof Error ? err.message : String(err)}`;
      placeholder.replaceWith(note, host); // keep the source block visible below the error
    }
  }
}

// ── Code highlighting ────────────────────────────────────────────────────────

async function highlightCode(el: HTMLElement, isCancelled: CancelFn): Promise<void> {
  const blocks = Array.from(el.querySelectorAll<HTMLElement>('pre code')).filter(
    (b) => !b.classList.contains('language-mermaid'),
  );
  if (blocks.length === 0) return;

  const hljs = (await import('highlight.js')).default;
  if (isCancelled()) return;

  for (const block of blocks) {
    if (isCancelled()) return;
    if (block.dataset.highlighted === 'yes') continue;
    hljs.highlightElement(block);
  }
}

// ── Math (KaTeX) ─────────────────────────────────────────────────────────────

// $$…$$ or \[…\] → display math; \(…\) → inline math. Single `$` is ignored.
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;

async function renderMath(el: HTMLElement, isCancelled: CancelFn): Promise<void> {
  const targets = collectMathTextNodes(el);
  if (targets.length === 0) return;

  const katex = (await import('katex')).default;
  await import('katex/dist/katex.min.css');
  if (isCancelled()) return;

  for (const node of targets) {
    if (isCancelled()) return;
    const text = node.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(MATH_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) frag.append(text.slice(last, idx));
      const display = m[1] != null || m[2] != null;
      const tex = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      const span = document.createElement('span');
      span.innerHTML = katex.renderToString(tex, { displayMode: display, throwOnError: false });
      frag.append(display ? wrapBlock(span) : span);
      last = idx + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    node.parentNode?.replaceChild(frag, node);
  }
}

/** Wrap a display-math span so it sits on its own centred line. */
function wrapBlock(span: HTMLSpanElement): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'katex-block';
  div.append(span);
  return div;
}

/** Text nodes that contain math delimiters and aren't inside code/svg/links. */
function collectMathTextNodes(el: HTMLElement): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent || parent.closest('code, pre, svg, a, .katex')) return NodeFilter.FILTER_REJECT;
      MATH_RE.lastIndex = 0;
      return MATH_RE.test(node.nodeValue ?? '')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}
