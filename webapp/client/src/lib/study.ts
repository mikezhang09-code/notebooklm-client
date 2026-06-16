/**
 * Shared logic for the three "study" artifact types — quizzes, flashcards, and
 * mind maps — that are authored visually in-app and stored as plain JSON files
 * (kind `quiz` / `flashcards` / `mind`). Holds the tolerant parsers the viewers
 * and editors share, the mind-map edit layout, and the save helper that targets
 * either a free-form file, a collection, or an existing artifact (edit).
 *
 * Ported from the research-corpus portal's library modals, adapted to this
 * project's corpus API (POST /api/corpus/ingest + PUT …/content).
 */
import { apiFormData, apiJson } from './api';
import { updateArtifactContent, type MindNode } from './artifacts';

export type StudyKind = 'quiz' | 'flashcards' | 'mind';

/** Whether an artifact kind is one of the in-app-authored study types. */
export function isStudyKind(kind: string): kind is StudyKind {
  return kind === 'quiz' || kind === 'flashcards' || kind === 'mind';
}

// ── Quiz ──────────────────────────────────────────────────────────────────────

export interface QuizOption {
  text: string;
  rationale: string;
  isCorrect: boolean;
}
export interface QuizQuestion {
  question: string;
  answerOptions: QuizOption[];
  hint?: string;
}

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Tolerant quiz JSON parser shared by the viewer and the editor. Accepts
 * `{questions: [...]}` (our shape), `{quiz: [...]}` (raw NotebookLM exports), or
 * a bare array; throws when no questions can be extracted.
 */
export function parseQuizQuestions(text: string): QuizQuestion[] {
  const parsed = JSON.parse(text) as Record<string, unknown> | unknown[];
  const raw: unknown = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)['questions'])
      ? (parsed as Record<string, unknown>)['questions']
      : Array.isArray((parsed as Record<string, unknown>)['quiz'])
        ? (parsed as Record<string, unknown>)['quiz']
        : null;
  if (!Array.isArray(raw)) throw new Error('Could not find a question list in the JSON');
  const normalized: QuizQuestion[] = raw
    .map((q: Record<string, unknown>) => {
      const optsRaw = q['answerOptions'] ?? q['options'];
      const opts = Array.isArray(optsRaw) ? optsRaw : [];
      return {
        question: String(q['question'] ?? q['prompt'] ?? ''),
        hint: q['hint'] != null ? String(q['hint']) : undefined,
        answerOptions: opts
          .map((o: Record<string, unknown>) => ({
            text: String(o['text'] ?? o['answer'] ?? ''),
            rationale: String(o['rationale'] ?? o['explanation'] ?? ''),
            isCorrect: Boolean(o['isCorrect'] ?? o['correct'] ?? false),
          }))
          .filter((o) => o.text),
      };
    })
    .filter((q) => q.question && q.answerOptions.length > 0);
  if (normalized.length === 0) throw new Error('No questions found');
  return normalized;
}

// ── Flashcards ──────────────────────────────────────────────────────────────

export interface Flashcard {
  front: string;
  back: string;
}

/**
 * Tolerant flashcard JSON parser. Accepts `{cards: [...]}` (our shape /
 * NotebookLM artifact), `{flashcards: [...]}`, or a bare array; card fields may
 * be front/back, f/b, or question/answer. Throws when no cards can be found.
 */
export function parseFlashcards(text: string): Flashcard[] {
  const parsed = JSON.parse(text) as Record<string, unknown> | unknown[];
  const raw: unknown = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)['cards'])
      ? (parsed as Record<string, unknown>)['cards']
      : Array.isArray((parsed as Record<string, unknown>)['flashcards'])
        ? (parsed as Record<string, unknown>)['flashcards']
        : null;
  if (!Array.isArray(raw)) throw new Error('Could not find a card list in the JSON');
  const normalized: Flashcard[] = raw
    .map((c: Record<string, unknown>) => ({
      front: String(c['front'] ?? c['f'] ?? c['question'] ?? ''),
      back: String(c['back'] ?? c['b'] ?? c['answer'] ?? ''),
    }))
    .filter((c) => c.front || c.back);
  if (normalized.length === 0) throw new Error('No cards found');
  return normalized;
}

// ── Mind map (edit model + layout) ────────────────────────────────────────────

// The editor works on a normalized tree where every node has a stable runtime
// id — positional ids ("root-0-1") shift when siblings are inserted or removed,
// which would corrupt selection/collapse state mid-edit. Ids live only in
// memory; saved JSON is plain { name, children }.
export interface MindEditNode {
  id: string;
  name: string;
  children: MindEditNode[];
}

/** A loose mind-map node as it may appear on disk (name or title; optional children). */
export interface RawMindNode {
  name?: string;
  title?: string;
  children?: RawMindNode[];
}

let mmIdCounter = 0;
const newMindId = () => `mm${++mmIdCounter}`;

export function toMindEditNode(n: RawMindNode): MindEditNode {
  return {
    id: newMindId(),
    name: n.name ?? n.title ?? '',
    children: (n.children ?? []).map(toMindEditNode),
  };
}

export function toMindPlain(n: MindEditNode): MindNode {
  return { name: n.name, children: n.children.map(toMindPlain) };
}

export const serializeMind = (root: MindEditNode) =>
  JSON.stringify(toMindPlain(root), null, 2);

export const seedMindRoot = (): MindEditNode => ({
  id: newMindId(),
  name: 'Central topic',
  children: [],
});

// Depth palette mirrors MindmapView so the editor and viewer read the same.
export const MM_FILLS = ['#5b6bbf', '#d8def8', '#cdebda', '#fbe6cf', '#f4d6e7', '#d6ecf6'];
export const MM_TEXTS = ['#ffffff', '#28324f', '#1d3b2e', '#5a3a16', '#582440', '#1d3f4d'];
export const MM_BORDERS = ['#4a59a8', '#b7c1ef', '#a7d8c1', '#f2cda3', '#e3b3cf', '#aed5e6'];

export const MM_NW = 184;
export const MM_NH = 46;
const MM_HG = 44;
const MM_VG = 10;
const MM_PAD = 24;

export interface MmLayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  depth: number;
  hasChildren: boolean;
}
export interface MmLayoutEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface MmLayout {
  nodes: MmLayoutNode[];
  edges: MmLayoutEdge[];
  width: number;
  height: number;
}

function subtreeH(node: MindEditNode, collapsed: Set<string>): number {
  if (!node.children.length || collapsed.has(node.id)) return MM_NH;
  let h = (node.children.length - 1) * MM_VG;
  for (const c of node.children) h += subtreeH(c, collapsed);
  return h;
}

/** Tidy left-to-right column layout for the editable mind-map tree. */
export function buildMindLayout(root: MindEditNode, collapsed: Set<string>): MmLayout {
  const nodes: MmLayoutNode[] = [];
  const edges: MmLayoutEdge[] = [];

  function visit(node: MindEditNode, depth: number, yOff: number) {
    const h = subtreeH(node, collapsed);
    const nx = MM_PAD + depth * (MM_NW + MM_HG);
    const ny = MM_PAD + yOff + (h - MM_NH) / 2;
    const hasChildren = node.children.length > 0;
    nodes.push({ id: node.id, label: node.name, x: nx, y: ny, depth, hasChildren });

    if (hasChildren && !collapsed.has(node.id)) {
      let cy = yOff;
      for (const child of node.children) {
        const ch = subtreeH(child, collapsed);
        const cnx = MM_PAD + (depth + 1) * (MM_NW + MM_HG);
        const cny = MM_PAD + cy + (ch - MM_NH) / 2;
        edges.push({ x1: nx + MM_NW, y1: ny + MM_NH / 2, x2: cnx, y2: cny + MM_NH / 2 });
        visit(child, depth + 1, cy);
        cy += ch + MM_VG;
      }
    }
  }

  visit(root, 0, 0);
  const width = nodes.reduce((m, n) => Math.max(m, n.x + MM_NW), 0) + MM_PAD;
  const height = nodes.reduce((m, n) => Math.max(m, n.y + MM_NH), 0) + MM_PAD;
  return { nodes, edges, width, height };
}

// ── immutable tree operations ─────────────────────────────────────────────────

export function mindUpdateName(node: MindEditNode, id: string, name: string): MindEditNode {
  if (node.id === id) return { ...node, name };
  return { ...node, children: node.children.map((c) => mindUpdateName(c, id, name)) };
}

export function mindAddChild(node: MindEditNode, parentId: string, child: MindEditNode): MindEditNode {
  if (node.id === parentId) return { ...node, children: [...node.children, child] };
  return { ...node, children: node.children.map((c) => mindAddChild(c, parentId, child)) };
}

export function mindAddSiblingAfter(node: MindEditNode, id: string, sibling: MindEditNode): MindEditNode {
  const idx = node.children.findIndex((c) => c.id === id);
  if (idx >= 0) {
    const next = [...node.children];
    next.splice(idx + 1, 0, sibling);
    return { ...node, children: next };
  }
  return { ...node, children: node.children.map((c) => mindAddSiblingAfter(c, id, sibling)) };
}

export function mindRemoveNode(node: MindEditNode, id: string): MindEditNode {
  return {
    ...node,
    children: node.children.filter((c) => c.id !== id).map((c) => mindRemoveNode(c, id)),
  };
}

export function mindMoveSibling(node: MindEditNode, id: string, dir: -1 | 1): MindEditNode {
  const idx = node.children.findIndex((c) => c.id === id);
  if (idx >= 0) {
    const j = idx + dir;
    if (j < 0 || j >= node.children.length) return node;
    const next = [...node.children];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    return { ...node, children: next };
  }
  return { ...node, children: node.children.map((c) => mindMoveSibling(c, id, dir)) };
}

export function mindFindNode(node: MindEditNode, id: string): MindEditNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = mindFindNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export function mindFindParent(node: MindEditNode, id: string): MindEditNode | null {
  if (node.children.some((c) => c.id === id)) return node;
  for (const c of node.children) {
    const hit = mindFindParent(c, id);
    if (hit) return hit;
  }
  return null;
}

export function mindCountDescendants(node: MindEditNode): number {
  return node.children.reduce((sum, c) => sum + 1 + mindCountDescendants(c), 0);
}

export const newMindNode = (name = 'New topic'): MindEditNode => ({
  id: newMindId(),
  name,
  children: [],
});

// ── Save (free-form file, into a collection, or overwrite on edit) ─────────────

/** Kinds authored in-app and stored as a single text/JSON file. */
export type AuthoredKind = StudyKind | 'diagram';

/**
 * Persist an authored artifact. On edit (`editId`) the stored content is
 * overwritten in place (preserving the file's object name + mime). Otherwise a
 * new file is ingested as a free-form artifact, or into `collectionId` when set.
 * Diagrams are raw Mermaid (.mmd); quizzes/flashcards/mind maps are JSON.
 */
export async function saveAuthoredArtifact(opts: {
  editId?: string;
  collectionId?: string;
  kind: AuthoredKind;
  title: string;
  content: string;
}): Promise<void> {
  const { editId, collectionId, kind, title, content } = opts;
  if (editId) {
    await updateArtifactContent(editId, { markdown: content, title });
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const isDiagram = kind === 'diagram';
  const prefix = kind === 'mind' ? 'mindmap' : kind;
  const ext = isDiagram ? 'mmd' : 'json';
  const mime = isDiagram ? 'text/vnd.mermaid' : 'application/json';
  const file = new File([content], `${prefix}-${stamp}.${ext}`, { type: mime });
  const form = new FormData();
  form.append('file', file);
  form.append('title', title.slice(0, 512));
  form.append('kind', kind);
  form.append('origin', 'upload');
  if (collectionId) form.append('collectionId', collectionId);
  await apiFormData('/api/corpus/ingest', form);
}

/**
 * Persist a quiz / flashcards / mind-map artifact (JSON). Thin wrapper over
 * {@link saveAuthoredArtifact} kept for the study editors' call sites.
 */
export function saveStudyArtifact(opts: {
  editId?: string;
  collectionId?: string;
  kind: StudyKind;
  title: string;
  json: string;
}): Promise<void> {
  return saveAuthoredArtifact({
    editId: opts.editId,
    collectionId: opts.collectionId,
    kind: opts.kind,
    title: opts.title,
    content: opts.json,
  });
}

// ── Diagram (Mermaid) AI assist ───────────────────────────────────────────────

export interface DiagramAssistResult {
  mermaid: string;
  explanation: string;
  /** Titles of collection artifacts the diagram was grounded in (empty when ungrounded). */
  usedSources?: string[];
}

/**
 * Ask the AI assistant to generate or revise a Mermaid diagram from a natural-
 * language instruction, optionally starting from the editor's current `code`.
 * When `collectionId` is provided, the diagram is grounded in that collection's
 * artifacts via scoped retrieval; otherwise it is generated from the instruction
 * alone (the free-form behaviour).
 */
export function assistDiagram(
  instruction: string,
  code: string,
  collectionId?: string,
): Promise<DiagramAssistResult> {
  return apiJson('/api/corpus/diagram/assist', { instruction, code, collectionId });
}
