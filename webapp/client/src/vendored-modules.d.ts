declare module 'highlight.js' {
  interface HighlightJsApi {
    highlightElement(element: HTMLElement): void;
  }
  const hljs: HighlightJsApi;
  export default hljs;
}

declare module 'mermaid' {
  interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    parse(source: string): Promise<unknown>;
    render(id: string, source: string): Promise<{ svg: string }>;
  }
  const mermaid: MermaidApi;
  export default mermaid;
}

declare module 'katex' {
  interface KatexRenderOptions {
    displayMode?: boolean;
    throwOnError?: boolean;
  }
  function renderToString(source: string, options?: KatexRenderOptions): string;
  const katex: { renderToString: typeof renderToString };
  export { renderToString };
  export default katex;
}
