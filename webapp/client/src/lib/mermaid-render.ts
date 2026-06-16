/**
 * Thin wrapper around the (bundled, lazily-imported) Mermaid library, shared by
 * the Diagram viewer and editor. Mermaid is ~1.5 MB, so it's pulled in via a
 * dynamic import only when a diagram is actually rendered. Mirrors the
 * configuration used by the Markdown renderer's ```mermaid pass.
 */
let counter = 0;

/** Parse + render Mermaid source to an SVG string. Rejects on a syntax error. */
export async function renderMermaid(src: string): Promise<string> {
  const trimmed = src.trim();
  if (!trimmed) throw new Error('Diagram is empty');
  const mermaid = (await import('mermaid')).default;
  const dark = document.body.dataset.theme === 'dark';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict', // sanitises diagram labels (strips scripts)
    theme: dark ? 'dark' : 'default',
    fontFamily: 'inherit',
  });
  const id = `dgm-${Date.now()}-${++counter}`;
  try {
    await mermaid.parse(trimmed);
    const { svg } = await mermaid.render(id, trimmed);
    return svg;
  } catch (err) {
    // A parse failure can leave mermaid's scratch element behind in <body>.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
    throw err instanceof Error ? err : new Error(String(err));
  }
}
