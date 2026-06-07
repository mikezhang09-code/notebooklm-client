/**
 * Interactive mind-map renderer for NotebookLM mind-map artifacts.
 *
 * Draws a NotebookLM-style horizontal tree: rounded, depth-coloured node boxes
 * connected by curved bezier links, laid out left-to-right with each parent
 * vertically centred on its children. Supports collapse/expand per node,
 * drag-to-pan, wheel/buttons to zoom, and a fit-to-screen reset — matching the
 * mind-map viewer in Google's NotebookLM.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MindNode } from '../lib/artifacts';

// ── Layout constants ─────────────────────────────────────────────────────────
const FONT = '500 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PAD_X = 14;
const PAD_Y = 9;
const LINE_H = 20;
const MIN_W = 84;
const MAX_W = 248;
const H_GAP = 56; // horizontal gap between a node and its children
const V_GAP = 14; // vertical gap between sibling subtrees
const MARGIN = 48; // padding around the whole diagram
const INITIAL_DEPTH = 1; // depth of the deepest layer shown before the user expands

// Depth-based palette (fixed colours so the map reads the same in light/dark).
const FILLS = ['#5b6bbf', '#d8def8', '#cdebda', '#fbe6cf', '#f4d6e7', '#d6ecf6'];
const TEXTS = ['#ffffff', '#28324f', '#1d3b2e', '#5a3a16', '#582440', '#1d3f4d'];
const BORDERS = ['#4a59a8', '#b7c1ef', '#a7d8c1', '#f2cda3', '#e3b3cf', '#aed5e6'];

interface LNode {
  id: string;
  name: string;
  lines: string[];
  w: number;
  h: number;
  depth: number;
  children: LNode[];
  x: number;
  y: number;
}

let _ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!_ctx) {
    const c = document.createElement('canvas');
    _ctx = c.getContext('2d')!;
  }
  _ctx.font = FONT;
  return _ctx;
}

/** Greedy word-wrap that also breaks CJK text (which has no spaces) per char. */
function wrap(text: string, maxTextW: number): string[] {
  const ctx = measureCtx();
  const tokens = text.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g) ?? [
    text,
  ];
  const lines: string[] = [];
  let cur = '';
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      if (cur) cur += ' ';
      continue;
    }
    const trial = cur + tok;
    if (ctx.measureText(trial).width <= maxTextW || cur === '') {
      cur = trial;
    } else {
      lines.push(cur.trimEnd());
      cur = tok;
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.length ? lines : [''];
}

/** Build a measured layout tree (sizes only; positions assigned later). */
function buildTree(node: MindNode, depth: number, id: string): LNode {
  const ctx = measureCtx();
  const lines = wrap(node.name || ' ', MAX_W - PAD_X * 2);
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = Math.min(MAX_W, Math.max(MIN_W, Math.ceil(textW) + PAD_X * 2));
  const h = lines.length * LINE_H + PAD_Y * 2;
  return {
    id,
    name: node.name,
    lines,
    w,
    h,
    depth,
    x: 0,
    y: 0,
    children: node.children.map((c, i) => buildTree(c, depth + 1, `${id}.${i}`)),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Collapse every node deeper than INITIAL_DEPTH so the map opens to two layers. */
function defaultCollapsed(node: LNode, acc: Set<string>): Set<string> {
  if (node.depth >= INITIAL_DEPTH && node.children.length > 0) acc.add(node.id);
  for (const c of node.children) defaultCollapsed(c, acc);
  return acc;
}

export default function MindmapView({ tree }: { tree: MindNode }) {
  const root = useMemo(() => buildTree(tree, 0, '0'), [tree]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    defaultCollapsed(root, new Set()),
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: MARGIN, y: MARGIN });
  const didFit = useRef(false);

  // Re-seed the collapsed layers and refit when a different mind map loads.
  useEffect(() => {
    setCollapsed(defaultCollapsed(root, new Set()));
    didFit.current = false;
  }, [root]);

  // Assign positions for the currently-visible nodes, then collect draw lists.
  const { nodes, edges, contentW, contentH } = useMemo(() => {
    const layoutY = (n: LNode, top: number): number => {
      const kids = collapsed.has(n.id) ? [] : n.children;
      if (kids.length === 0) {
        n.y = top + n.h / 2;
        return n.h;
      }
      let cursor = top;
      for (const k of kids) cursor += layoutY(k, cursor) + V_GAP;
      const span = cursor - V_GAP - top;
      n.y = (kids[0]!.y + kids[kids.length - 1]!.y) / 2;
      return Math.max(span, n.h);
    };
    const layoutX = (n: LNode, x: number) => {
      n.x = x;
      const kids = collapsed.has(n.id) ? [] : n.children;
      for (const k of kids) layoutX(k, x + n.w + H_GAP);
    };
    layoutY(root, MARGIN);
    layoutX(root, MARGIN);

    const nodes: LNode[] = [];
    const edges: { id: string; d: string }[] = [];
    let maxX = 0;
    let maxY = 0;
    let minY = Infinity;
    const walk = (n: LNode) => {
      nodes.push(n);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h / 2);
      minY = Math.min(minY, n.y - n.h / 2);
      if (collapsed.has(n.id)) return;
      for (const k of n.children) {
        const sx = n.x + n.w;
        const sy = n.y;
        const ex = k.x;
        const ey = k.y;
        const mx = sx + (ex - sx) / 2;
        edges.push({ id: k.id, d: `M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex},${ey}` });
        walk(k);
      }
    };
    walk(root);
    return {
      nodes,
      edges,
      contentW: maxX + MARGIN,
      contentH: maxY - Math.min(minY, MARGIN) + MARGIN,
    };
  }, [root, collapsed]);

  const fit = () => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const z = clamp(Math.min((cw - 32) / contentW, (ch - 32) / contentH, 1.25), 0.2, 1.5);
    setZoom(z);
    setPan({ x: (cw - contentW * z) / 2, y: (ch - contentH * z) / 2 });
  };

  // Fit to screen once after first layout.
  useLayoutEffect(() => {
    if (didFit.current) return;
    didFit.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentW, contentH]);

  // ── Pan (drag) ─────────────────────────────────────────────────────────────
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPan({
      x: drag.current.px + (e.clientX - drag.current.x),
      y: drag.current.py + (e.clientY - drag.current.y),
    });
  };
  const endDrag = (e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const zoomAt = (factor: number, cx: number, cy: number) => {
    setZoom((z) => {
      const nz = clamp(z * factor, 0.2, 2.5);
      const k = nz / z;
      setPan((p) => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
      return nz;
    });
  };
  const onWheel = (e: React.WheelEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const cx = e.clientX - (rect?.left ?? 0);
    const cy = e.clientY - (rect?.top ?? 0);
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, cx, cy);
  };
  const zoomCenter = (factor: number) => {
    const el = containerRef.current;
    zoomAt(factor, (el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2);
  };

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Prevent the page from scrolling when the wheel zooms the canvas.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  return (
    <div
      ref={containerRef}
      className="mindmap-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onWheel={onWheel}
    >
      <div
        className="mindmap-stage"
        style={{
          width: contentW,
          height: contentH,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        <svg
          width={contentW}
          height={contentH}
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
        >
          {edges.map((e) => (
            <path key={e.id} d={e.d} fill="none" stroke="#aab2dd" strokeWidth={1.6} />
          ))}
        </svg>

        {nodes.map((n) => {
          const di = Math.min(n.depth, FILLS.length - 1);
          const hasKids = n.children.length > 0;
          const isCollapsed = collapsed.has(n.id);
          return (
            <div key={n.id}>
              <div
                className="mindmap-node"
                style={{
                  left: n.x,
                  top: n.y - n.h / 2,
                  width: n.w,
                  minHeight: n.h,
                  background: FILLS[di],
                  color: TEXTS[di],
                  borderColor: BORDERS[di],
                  fontWeight: n.depth === 0 ? 600 : 500,
                }}
              >
                {n.lines.map((l, i) => (
                  <span key={i} className="mindmap-line">
                    {l}
                  </span>
                ))}
              </div>
              {hasKids && (
                <button
                  data-no-pan
                  className="mindmap-toggle"
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                  style={{ left: n.x + n.w + 5, top: n.y - 11 }}
                  onClick={() => toggle(n.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24">
                    <path
                      d="M14 7l-5 5 5 5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      transform={isCollapsed ? 'rotate(180 12 12)' : undefined}
                    />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mindmap-controls" data-no-pan>
        <button className="icon-btn" title="Zoom in" onClick={() => zoomCenter(1.2)}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button className="icon-btn" title="Zoom out" onClick={() => zoomCenter(1 / 1.2)}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button className="icon-btn" title="Fit to screen" onClick={fit}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
