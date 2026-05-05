# Chat over corpus — flow & logic

Engineering reference for the `/corpus/chat` page and `POST /api/corpus/chat`
endpoint introduced in **M6** (v0.6.0). This doc is intended to be exhaustive
enough to debug, extend, or rebuild the feature without re-reading every file.

> **TL;DR** — Every chat turn is `embed → Oracle vector search → Cohere chat
> with snippets as documents → citation re-keying`. All compute happens
> inside your OCI tenancy; NotebookLM is not in the request path.

---

## 1. Scope

The chat feature answers natural-language questions **grounded in the
contents of the user's research corpus**. Each artifact (PDFs, reports,
audio podcasts, slide decks, etc.) was previously ingested into Oracle
Autonomous Database with `cohere.embed-multilingual-v3.0` 1024-dim
embeddings (M2/M4) and is searchable via Oracle's native `VECTOR_DISTANCE`
function (M3).

The chat layer adds two pieces on top of that:

1. A **retrieval-augmented generation** orchestrator that turns retrieved
   snippets into a prompt for an OCI Generative AI chat model.
2. A React UI that renders the answer with **inline citations** mapping
   spans of text back to the source artifacts.

Neither piece touches the NotebookLM client, the `X-NBLM-Session` header,
or any Google API.

---

## 2. Architecture

```
                        ┌────────────────────────┐
                        │  React  /corpus/chat   │
                        │  (CorpusChatPage.tsx)  │
                        └────────────┬───────────┘
                                     │  POST /api/corpus/chat
                                     │  { question, history, kind?,
                                     │    notebookId?, maxSources?, ... }
                                     ▼
                        ┌────────────────────────┐
                        │  Express route          │
                        │  routes/corpus.ts       │
                        └────────────┬────────────┘
                                     │ chatCorpus(cfg, opts)
                                     ▼
                        ┌────────────────────────┐
                        │  Orchestrator           │
                        │  corpus/chat.ts         │
                        └─┬─────────────┬─────────┘
                          │             │
                          ▼             ▼
                ┌──────────────┐  ┌──────────────────────┐
                │ searchCorpus │  │   chatCohere         │
                │ (search.ts)  │  │   (oci/genai.ts)     │
                └──────┬───────┘  └──────────┬───────────┘
                       │                     │
       ┌───────────────┼─────────────┐       │
       ▼               ▼             ▼       ▼
  OCI GenAI       Oracle ADB    Oracle ADB   OCI GenAI
  embedTexts()    artifact_     artifacts    chat()
  (embed multi    chunks        (metadata    (cohere
   v3, 1024-d)    (vectors)     join)         command-r-plus)
       ▲               ▲             ▲       ▲
       │               │             │       │
       └─── all OCI services in your tenancy ┘
```

All bullets in the bottom row run in OCI; the orchestrator is the only
piece that holds them together.

---

## 3. End-to-end flow (one turn)

For a single user message, the server runs these six stages.

### Stage 0 — request validation

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\routes\corpus.ts:362-425`

- 503 if corpus subsystem is disabled (env vars missing).
- 503 if `OCI_GENAI_CHAT_MODEL` is not set (chat is gated separately so the
  rest of the corpus stack works without it).
- 400 if `question` is empty or > 4000 chars.
- `history` is normalised: only `{role: 'user'|'assistant', content}` pairs
  with non-empty content survive, and the array is **truncated to the last
  10 turns** to bound prompt size and input-token cost.

### Stage 1 — embed the question

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\oci\genai.ts:56-89`

```ts
const [qvec] = await embedTexts(cfg, [query], 'SEARCH_QUERY');
```

- Calls OCI Generative AI `EmbedText` with model
  `cohere.embed-multilingual-v3.0`.
- `inputType: SEARCH_QUERY` matches Cohere v3's two-headed training — query
  vectors are normalised differently from document vectors, so using the
  right side matters for accuracy.
- Result: a `number[]` of length 1024.

### Stage 2 — Oracle vector kNN

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\search.ts:182-200`

The vector is bound straight into a `VECTOR_DISTANCE(... COSINE)` query
against `artifact_chunks` (joined to `artifacts` so we can apply optional
`kind` / `notebookId` filters):

```sql
SELECT c.id          AS chunk_id,
       c.artifact_id AS artifact_id,
       c.ordinal     AS ordinal,
       VECTOR_DISTANCE(c.embedding, :qv, COSINE) AS dist,
       SUBSTR(c.text, 1, 1200) AS text,
       c.char_start  AS char_start,
       c.char_end    AS char_end
  FROM artifact_chunks c
  JOIN artifacts a ON a.id = c.artifact_id
  -- optional: WHERE a.kind = :f_kind AND a.notebook_id = :f_nb
 ORDER BY dist
 FETCH FIRST :cap ROWS ONLY
```

This is **Oracle Database 23ai's native vector search** — there is no
external vector store. The HNSW index defined in
`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\schema.sql`
is what makes this fast.

`:cap` defaults to `max(40, maxSources × snippetsPerSource × 4)` so we
always over-fetch: grouping by artifact tends to collapse the candidate
set, and we want healthy headroom.

### Stage 3 — group + filter + metadata join

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\search.ts:203-279`

1. Drop chunks whose `dist > maxDistance` (default 0.75).
2. Bucket the survivors by `artifact_id`.
3. One follow-up SQL fetches metadata (`title`, `kind`, `tags`,
   `notebook_id`, …) for the surviving artifacts.
4. Per-artifact, sort chunks by distance and keep the top
   `snippetsPerArtifact` (default 3, in chat default 2).
5. Sort artifacts by their *best* (lowest) chunk distance.
6. Cap to `artifactLimit` (chat default 6, max 10).

Returns `SearchResult { query, hits[], embedMs, sqlMs, candidatesScanned }`.

### Stage 4 — build Cohere `documents`

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\chat.ts:127-141`

Each surviving snippet becomes one Cohere "document" with a stable id
`doc_<sourceIdx>_<chunkOrd>`. The id encodes:

- `sourceIdx` — the 1-based artifact index in `result.sources` (this is
  what the UI will render as `[1]`, `[2]`, …).
- `chunkOrd` — the chunk's ordinal within its parent artifact (0-based).

```ts
documents.push({
  id: `doc_${src.index}_${snip.ordinal}`,
  title: `[${src.index}] ${src.artifact.title} · chunk #${snip.ordinal}`,
  snippet: snip.text,
});
```

The title is purely cosmetic for the model — only `id` and `snippet` affect
retrieval reasoning, but the title helps citation-quality models pick a
recognisable name.

### Stage 5 — Cohere chat

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\oci\genai.ts:128-188`

Calls `GenerativeAiInferenceClient.chat()` against `OCI_GENAI_CHAT_MODEL`
(default recommended: `cohere.command-r-plus-08-2024`) with a
`CohereChatRequest`:

| Field             | Value                                            |
|-------------------|--------------------------------------------------|
| `apiFormat`       | `'COHERE'`                                       |
| `message`         | the user's current question                      |
| `preambleOverride`| our research-grounded preamble (see §6)          |
| `chatHistory`     | prior turns, with `USER`/`CHATBOT` roles         |
| `documents`       | the snippets from stage 4                        |
| `maxTokens`       | 900                                              |
| `temperature`     | 0.2                                              |
| `isStream`        | `false`                                          |
| `citationQuality` | `'ACCURATE'`                                     |

Cohere chat has a **first-class `documents` parameter**. When it generates
the answer, it returns inline `Citation { start, end, text, documentIds }`
tying spans of the answer text to the document ids we provided. We don't
have to coax the model with prompt tricks; the API natively does it.

### Stage 6 — re-key citations

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\chat.ts:175-194`

Cohere returns `documentIds: ["doc_2_0", "doc_2_1"]`. The UI cares about
artifact-level indices, not chunk-level, so we strip the chunk suffix and
deduplicate:

```ts
const m = /^doc_(\d+)/.exec(id);
if (m?.[1]) set.add(parseInt(m[1], 10));
```

The result is a sorted array of 1-based source indices like `[2]` or
`[1, 3]`. The UI renders these as `[1]`, `[3]` superscript badges.

### Stage 7 — short-circuit when retrieval is empty

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\chat.ts:152-165`

If stage 3 produced zero documents, we **never call the chat model**.
Instead we return a hard-coded "I could not find anything…" answer with
`noSources: true`. This is intentional: with no context Cohere is more
likely to hallucinate than admit ignorance, and the model call is the
expensive part of the pipeline anyway. Surfacing a candid "ingest more
sources" reply is cheaper *and* more useful.

---

## 4. Data shapes

### 4.1 Request — `POST /api/corpus/chat`

```ts
{
  question: string;              // required, 1..4000 chars
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;                            // last 10 kept; older silently dropped
  kind?: ArtifactKind;           // 'audio' | 'report' | 'video' | ...
  notebookId?: string;           // ULID; restrict retrieval to one notebook
  maxSources?: number;           // 1..10, default 6
  snippetsPerSource?: number;    // 1..4, default 2
  maxDistance?: number;          // 0..2 cosine, default 0.75
}
```

### 4.2 Response

```ts
{
  answer: string;                // model's generated text
  citations: Array<{
    start: number;               // char offset into `answer` (0-based)
    end: number;                 // exclusive
    text: string;                // the cited span
    sourceIndices: number[];     // 1-based, sorted ascending
  }>;
  sources: Array<{
    index: number;               // 1-based, matches sourceIndices values
    artifact: {                  // full SearchHit['artifact'] payload
      id: string;
      kind: string;
      origin: 'notebooklm' | 'upload';
      title: string;
      notebookId: string | null;
      bucket: string;
      objectName: string;
      tags: string[];
      metadata: Record<string, unknown>;
      createdAt: string;
      // ...
    };
    snippets: Array<{
      chunkId: string;
      ordinal: number;
      distance: number;          // cosine, lower = more similar
      text: string;
      charStart: number;
      charEnd: number;
    }>;
    bestDistance: number;
  }>;
  retrievalMs: number;           // embed + kNN + grouping
  chatMs: number;                // OCI Generative AI chat call
  noSources: boolean;            // true if retrieval was empty
  finishReason?: 'COMPLETE' | 'MAX_TOKENS' | 'ERROR' | ...;
  inputTokens?: number;          // prompt + history + documents
  outputTokens?: number;         // generated text
}
```

### 4.3 Error responses

| Status | Trigger                                              |
|--------|------------------------------------------------------|
| 400    | `question` missing / empty / > 4000 chars            |
| 503    | corpus disabled (`getCorpusConfig()` returned null)  |
| 503    | `OCI_GENAI_CHAT_MODEL` not configured                |
| 500    | underlying Oracle / OCI failure (message in `error`) |

---

## 5. Configuration & gating

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\config.ts:33-47`

| Env var                | Required for…             | Notes                                           |
|------------------------|---------------------------|-------------------------------------------------|
| `OCI_GENAI_MODEL`      | embeddings (M2+)          | `cohere.embed-multilingual-v3.0`                |
| `OCI_GENAI_REGION`     | embeddings + chat         | falls back to `OCI_REGION`                      |
| `OCI_GENAI_CHAT_MODEL` | **chat only (M6)**        | unset → `/corpus/chat` is hidden, all else fine |
| `OCI_COMPARTMENT_OCID` | embeddings + chat         | passed in every GenAI call                      |

Health endpoint surfaces both:

```
GET /api/corpus/health
  →  { enabled: true, ..., chat: { enabled: true, model: "cohere.command-r-plus-08-2024" } }
```

The React app probes this once at sidebar render time and gates the **Chat**
nav entry on `chat.enabled`. The route itself is registered whenever
`enabled: true`, so navigating to `/corpus/chat` with the chat model unset
shows a friendly "set `OCI_GENAI_CHAT_MODEL` to enable" page rather than a
404.

---

## 6. The preamble

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\chat.ts:73-81`

```
You are a careful research assistant. You answer the user's questions
based ONLY on the documents provided to you through the retrieval step.
When you use a fact from a document, cite it inline in the form [1], [2],
etc., matching the document ids. If the documents do not contain enough
information to answer, say so explicitly instead of speculating. Prefer
concise, structured answers; use short bullet points when comparing
multiple items. Preserve numbers, dates, and proper nouns exactly as
they appear in the sources.
```

The preamble does three jobs:

1. Anchor the model to the documents (no general-knowledge contamination).
2. Establish the citation contract `[N]`.
3. Permit / encourage "I don't know" answers when documents are sparse.

It is `preambleOverride`, not appended to the user message — Cohere has a
dedicated slot for it.

---

## 7. UI rendering

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\client\src\pages\CorpusChatPage.tsx:1-200`

### 7.1 Inline citation badges

`renderAnswerWithCitations()` walks the `citations` array sorted by
`end` ascending and splices clickable `[n]` `<button>`s into the answer
text at each citation's `end` offset. Adjacent citations stay adjacent.

Implementation contract:

- Each `[n]` button is a real DOM button (not `<sup>`) so it's keyboard-
  reachable and screen-reader announces "[2], button".
- Buttons are styled as small brand-coloured pills, not text decoration —
  visually distinct from the answer prose.
- Clicking a `[n]` calls `jumpToSource(turnIndex, n)` which scrolls the
  matching `SourceCard` into view and briefly ring-highlights it.

### 7.2 Source cards (per assistant turn)

Each assistant turn renders a collapsible `<details>` panel listing every
`source`. A card shows:

- 1-based index badge (`[2]`)
- Kind pill (`Report`, `Audio`, …)
- Distance pill (`Strong`, `Good`, `Weak`, `Marginal`)
- Artifact title
- Originating notebook back-link if `notebookId` present
- "library ↗" link to `/corpus/library`
- All retrieved `snippets` rendered as small grey blocks

The summary line shows timing: `4 sources · retrieval 312 ms · chat
2148 ms · 1843 in / 412 out tokens` — useful for tuning `maxSources`
without opening dev tools.

### 7.3 Filters apply prospectively

The right-rail sliders (`kind`, `maxSources`, `maxDistance`) only affect
**future** turns. We deliberately do *not* re-run retrieval for prior
turns when filters change — that would silently mutate conversation
context the model has already conditioned on. The composer hint reminds
the user: "Filters apply to future turns only."

### 7.4 Empty-transcript prompts

When `turns.length === 0`, the page shows three clickable example prompts
that prefill the composer. Cosmetic but lowers the activation energy
for new users.

---

## 8. Citation re-keying — worked example

Suppose retrieval returned three artifacts, each contributing two snippets:

| sourceIdx | artifact title       | snippet ordinals |
|-----------|----------------------|------------------|
| 1         | Tencent Q2 earnings  | 0, 4             |
| 2         | Slide deck on macro  | 1, 2             |
| 3         | Audio podcast on Fed | 0, 1             |

We send Cohere these document ids:

```
doc_1_0  doc_1_4  doc_2_1  doc_2_2  doc_3_0  doc_3_1
```

Cohere generates an answer and returns:

```json
[
  { "start": 12, "end": 28, "text": "WeChat ad revenue", "documentIds": ["doc_1_0", "doc_1_4"] },
  { "start": 64, "end": 79, "text": "the Fed's pivot",   "documentIds": ["doc_3_0"] },
  { "start": 91, "end": 105, "text": "macro tailwinds",  "documentIds": ["doc_2_1", "doc_3_1"] }
]
```

After re-keying:

```json
[
  { "start": 12,  "end": 28,  "text": "WeChat ad revenue", "sourceIndices": [1] },
  { "start": 64,  "end": 79,  "text": "the Fed's pivot",   "sourceIndices": [3] },
  { "start": 91,  "end": 105, "text": "macro tailwinds",   "sourceIndices": [2, 3] }
]
```

Note the second-to-last citation collapsed `doc_1_0` and `doc_1_4` into a
single `[1]` (chunk-level → artifact-level), and the last one fanned out
into `[2][3]` because it cited two different artifacts.

---

## 9. Edge cases & failure modes

| Symptom                                                        | Cause                                                    | Handling                                              |
|----------------------------------------------------------------|----------------------------------------------------------|-------------------------------------------------------|
| Answer with zero `[n]` badges                                  | Cohere chose not to cite anything                         | UI just renders plain text. Sources panel still shows. |
| `noSources: true`                                              | No chunk passed `maxDistance` filter                     | Hard-coded "I could not find anything…" reply, no model call. |
| 503 with `corpus chat is disabled`                             | `OCI_GENAI_CHAT_MODEL` unset                             | UI shows "configure this env var" page.               |
| 503 with `corpus subsystem is disabled`                        | DB / Storage / GenAI env vars missing                    | UI hides whole Research nav.                          |
| `finishReason: 'MAX_TOKENS'`                                   | Answer was truncated at 900 tokens                       | Visible in sources-panel summary.                     |
| `errorMessage` on Cohere response                              | Content-policy block, model deprecation, etc.            | Surfaces as a 500 with the message.                   |
| Embedding 400 ("input too long")                               | Question > ~512 tokens                                   | Caught by the 4000-char request guard upstream.       |
| Stale/garbage citation offset (start/end out of range)         | Model hallucinated character indices                     | `renderAnswerWithCitations` clamps to `[cursor, len]`. |

---

## 10. Performance & cost

Typical per-turn breakdown on `cohere.command-r-plus-08-2024` in
`ap-osaka-1`, ~200-row corpus:

| Stage                              | Wall time      | OCI cost (rough) |
|------------------------------------|----------------|------------------|
| Embed query (1024-d, 1 input)      | 60–150 ms      | < $0.0001        |
| Oracle vector kNN (40 candidates)  | 80–200 ms      | included in ADB  |
| Cohere chat (≈ 1500 in / 400 out)  | 1500–4000 ms   | ~$0.01–$0.02     |

Knobs:

- **`maxSources` lower** → fewer documents → smaller prompt → cheaper +
  faster, but worse coverage.
- **`maxDistance` lower** → stricter filter → more "no sources" replies
  but higher precision.
- **`OCI_GENAI_CHAT_MODEL = cohere.command-r-08-2024`** (vs `-plus`) →
  ~3× cheaper, ~2× faster, slightly worse synthesis quality.

The `inputTokens` / `outputTokens` returned in the response is a direct
cost signal — wire to a Grafana dashboard if usage scales.

---

## 11. Limits & non-goals (current scope)

- **No streaming.** The route returns one JSON blob. Cohere supports
  streaming with `isStream: true`; layering this on means switching the
  route to SSE and threading partial-text events through the React UI.
- **No tool use / function calling.** Cohere chat supports `tools`; we
  pass none. Adding "search the web", "run SQL", or "embed and re-search"
  tools would be straightforward extensions.
- **No re-ranking.** We feed Cohere the snippets in cosine order. A
  cross-encoder rerank step (e.g. `rerank-multilingual-v3`) before the
  chat call would tighten precision at the cost of one more OCI call.
- **No long-document context window juggling.** Each chunk is ≤ 1200
  chars; with `maxSources × snippetsPerSource = 6 × 2 = 12` documents
  that's ~14 KB of context — well below Command R's ~128k window.
- **History-only memory.** No vector memory of prior turns; the next
  turn re-retrieves from scratch. This is a design choice — turn-aware
  retrieval pollutes results when the conversation drifts.

---

## 12. Testing recipes

### 12.1 Health probe

```bash
curl http://localhost:7860/api/corpus/health | jq '.chat'
# expected: { "enabled": true, "model": "cohere.command-r-plus-08-2024" }
```

### 12.2 Cold-start chat

```bash
curl -sX POST http://localhost:7860/api/corpus/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"What did Tencent say about WeChat ads in Q2?"}' | jq
```

Look for: non-empty `answer`, `citations[].sourceIndices` populated,
`sources[].snippets[].text` containing the cited spans, `chatMs` > 0.

### 12.3 Empty-corpus fallback

```bash
curl -sX POST http://localhost:7860/api/corpus/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"What did this random thing say?","maxDistance":0.3}' | jq
```

Expected: `noSources: true`, `chatMs: 0`, hard-coded answer.

### 12.4 Multi-turn

```bash
# turn 1
A1=$(curl -sX POST http://localhost:7860/api/corpus/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"Summarise the slide deck"}' | jq -r '.answer')

# turn 2 (with history)
curl -sX POST http://localhost:7860/api/corpus/chat \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg a1 \"$A1\" '{
        question: "expand on point 2",
        history: [
          {role: "user",      content: "Summarise the slide deck"},
          {role: "assistant", content: $a1}
        ]
      }')" | jq
```

Expected: the second answer references content from the first.

### 12.5 Cohere SDK regression

If a future SDK bump changes the `chat()` return shape, the type cast at

`@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\oci\genai.ts:163-178`

is the fragile spot. Fail mode: `result.text` becomes `''` and the page
silently shows an empty bubble. Smoke-test with §12.2 after SDK bumps.

---

## 13. Future extensions (not implemented)

| Idea                                  | Effort | Notes                                                       |
|---------------------------------------|--------|-------------------------------------------------------------|
| SSE streaming of tokens               | M      | Switch `isStream: true`, parse the SDK's stream, splice into transcript with React state. |
| Cross-encoder rerank before chat      | S      | One extra `rerankText` call between stages 3 and 4.         |
| Per-notebook chat (deep-link)         | S      | UI passes `notebookId` to the existing endpoint param.      |
| Tool: "re-search the corpus"          | M      | Lets the model expand context mid-answer; needs a tools loop. |
| Audio transcription before embedding  | L      | Wire OCI Speech (or Whisper) into the ingest extractor so audio kinds gain real text content. |
| Persisted conversation history        | M      | Store in `chat_threads` + `chat_messages` Oracle tables.    |
| Cited snippet hover-to-highlight      | S      | Map `snippet.charStart..charEnd` back to the original blob preview. |

---

## 14. File map

| Concern                       | File                                                                                  |
|-------------------------------|---------------------------------------------------------------------------------------|
| Config / env var              | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\config.ts:33-47`      |
| Chat SDK wrapper              | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\oci\genai.ts:128-188` |
| Embedding (shared with M2)    | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\oci\genai.ts:56-89`   |
| Vector kNN search             | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\search.ts:132-289`    |
| Orchestrator (the brains)     | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\chat.ts:91-200`       |
| REST route + validation       | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\routes\corpus.ts:362-425`    |
| Health surface (`chat.enabled`)| `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\index.ts:50-93`      |
| Client lib helper             | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\client\src\lib\corpus.ts:236-282`   |
| React page                    | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\client\src\pages\CorpusChatPage.tsx:1-497` |
| Nav + route gating            | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\client\src\App.tsx:49-101`          |
| Oracle schema                 | `@c:\Users\mike_zhang\Documents\GitHub\notebooklm-client\webapp\server\corpus\schema.sql:1-123`     |

---

*Last updated: 2026-05-05, M6 / v0.6.0.*
