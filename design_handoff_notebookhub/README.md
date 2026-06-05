# Handoff: NotebookHub — GUI Redesign

## Overview
NotebookHub is a **local web GUI** that wraps the `notebooklm-client` CLI/library. This handoff covers a full visual + IA redesign of that GUI, moving it from generic Tailwind admin-panel styling to a calm, **editorial** aesthetic (warm paper neutrals + a terracotta/amber accent, serif display type, light & dark themes).

The redesign also restructures the app's information architecture into three areas:

- **Library** → two sub-areas: **NotebookLM** (notebooks linked to Google NotebookLM) and **Collections** (the user's own uploaded research, grouped).
- **Free Forms** → every generated/uploaded artifact, organized **by output type** (Audio, Report, Video, Quiz, Flashcards, Infographic, Slides, Data table, Mindmap), aggregated across all sources with provenance.
- **Settings** → Session + Diagnose.

The previous "Generate" / "Ask" / "Research" sidebar groups are removed; generation now lives **inside each notebook**.

---

## About the Design Files
The files in `reference/` are a **design reference created in HTML/CSS/vanilla JS** — a clickable prototype that demonstrates the intended look, layout, and behavior. **They are not production code to copy directly.**

The task is to **recreate these designs in the target codebase's environment.** The real app (`notebooklm-client`) ships a web client at `webapp/client` built with **React + TypeScript + Vite + React Router + Tailwind**. Implement this redesign there, using that stack and its conventions (component files, hooks, the Tailwind config). Where the prototype uses plain DOM string-rendering, translate to idiomatic React components and state.

The prototype is structured to make this easy:
- `reference/data.js` — all the demo data + the **artifact type registry** and the **per-type generate-option spec**. This maps almost 1:1 to TS types/constants.
- `reference/views.js` — pure render functions per screen (what becomes your components).
- `reference/app.js` — routing, the slide-in drawer, modals, theme, toasts, and all interaction logic.
- `reference/styles.css` — the full token system + every component style.
- `reference/NotebookHub.html` — the shell + the complete inline SVG icon sprite.

---

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, shadows, and interactions are final. Recreate the UI faithfully. The exact token values are in the **Design Tokens** section below and in `reference/styles.css` (`:root` and `body[data-theme="dark"]`).

---

## Global Layout & Shell

**App shell** is a two-column CSS grid, full viewport height, no page scroll (each column scrolls internally):
- `grid-template-columns: 266px 1fr;` `height: 100vh; overflow: hidden;`
- **Left:** fixed sidebar (`.side`), dark "espresso" rail in both themes.
- **Right:** `.main`, scrolls vertically; contains a sticky top bar + the routed view.

### Sidebar (`.side`, width 266px)
Dark rail (`--rail`) with three stacked nav sections, a brand lockup at top, and a user/footer row at the bottom.

- **Brand** (top, padding 20px 18px 16px): a 34×34 rounded-square mark (accent background `--accent`, white book icon, radius 9px) + wordmark "Notebook**Hub**" where "Notebook" is `Hanken Grotesk` 700 and "Hub" is `Newsreader` italic 500 in a warm tint (`#e8c0ab`). Font-size 17px.
- **Section: LIBRARY** — two large nav items (`.nav-lib .nav-item`, padding 11px, radius 11px, 14px/600):
  - Each has a 30×30 rounded icon tile (`.col-ic`) + a two-line label: bold name + a smaller `.sub` caption + a right-aligned mono count.
  - **NotebookLM** — icon `#i-nlm`, sub "Google NotebookLM", count = number of notebooks (6).
  - **Collections** — icon `#i-folder`, sub "Your research", count = number of collections (5).
- **Section: FREE FORMS** — the section label is itself clickable (routes to the Free Forms overview) and has an "All ›" affordance on the right. Below it, one nav item **per artifact type** (icon + label + mono count; Mindmap shows a "New" pill instead of a count). Each item carries its type accent via `--tc`.
- **Section: SETTINGS** — Session (`#i-gear`), Diagnose (`#i-pulse`).
- **Footer** (`.side-foot`, border-top): 34×34 accent avatar "MZ", name "Mike Zhang" / "Local workspace", and a **theme toggle** ghost icon button (moon/sun) on the right.

**Nav item states:** default text `#b9ad9d` on transparent; hover → `--rail-soft` bg, lighter text; **active** → `--accent` bg, white text & icon. Active is driven by the current route. Icons are 17×17, `--rail-muted` until active/hover.

### Top bar (`.topbar`, inside `.main`, sticky)
- `position: sticky; top: 0;` translucent bg (`color-mix(in srgb, var(--bg) 88%, transparent)`) + `backdrop-filter: blur(8px)`, `border-bottom: 1px solid var(--line)`, padding 16px 34px.
- **Left:** breadcrumbs (`.crumbs`) — muted text, last crumb bold `--ink`, `#i-chev` separators, intermediate crumbs are clickable.
- **Right:** a 290px search field (`.search`) + a refresh icon button (`.icon-btn`).

### Content scaffold
Each view renders inside `.content` (padding 26px 34px 56px; `max-width: 1320px`). A standard `.view-head` block contains:
- `.view-eyebrow` — a colored pip + mono uppercase label (e.g. "LIBRARY · NOTEBOOKLM").
- `.view-title h1` — 30px / 800 / -0.02em. A variant `h1.ser` uses `Newsreader` 500 italic for detail titles (notebook/collection names).
- `.view-sub` — muted 14px description, `max-width: 64ch`.
- `.head-row` — flex row that right-aligns a primary action button.

---

## Screens / Views

### 1. NotebookLM (library landing) — `renderNotebookLM()`
**Purpose:** browse notebooks linked to Google NotebookLM; create a new notebook.

- **Header:** title "NotebookLM", sub describing the area, and a primary **"New notebook"** button (top-right).
- **Sub-header row:** "Your notebooks · N" heading + filter **chips** (All + one per category). `All` is active by default (`.chip.on` = ink bg, bg-colored text).
- **Card grid** (`.grid`, `repeat(3, 1fr)`, gap 16px) of notebook cards + a trailing dashed **"New notebook"** tile (`.new-tile`).

**Notebook card (`.nb`) — editorial style:**
- `.nb` — `--card` bg, 1px `--line` border, radius 14px, min-height 196px, flex column. Hover: lift `translateY(-3px)`, `--shadow`, border tints toward the card's `--tc`.
- `.nb-body` padding 20px.
- **Top row** (`.nb-top`): left = `#id` in mono 10.5px muted; right = artifact **kind chips** (`.kinds` → `.kind` 28×28 rounded tiles, each tinted by its type color).
- **Title** (`.nb h3`): `Newsreader` 500, 20px, line-height 1.22, `text-wrap: balance`, margin-top 15px.
- **Meta** (`.nb-meta`): "N sources · M artifacts", muted 12px, dot separator.
- **Footer** (`.nb-foot`, margin-top auto, border-top `--line-soft`): action buttons (`.act`) — **Open** (accent, `#i-nlm`), **Chat** (`#i-chat`), an external-link icon, and a trailing **delete** (`.act.del`, right-aligned, danger hover).

Each card has a `--tc` set to the notebook's color (used for hover border + kind chips).

### 2. Notebook detail (tabbed) — `openNotebook(id)`
**Purpose:** work inside one notebook. Title uses `h1.ser`. Eyebrow shows "CATEGORY · #id". Sub shows "N sources · M artifacts. Linked to Google NotebookLM."

A **tab bar** (`.tabbar`) with three tabs (`.tab`, active tab underlined + colored with the notebook's `--tc`, each with a mono count pill `.tab-x`):

#### Tab A — Artifacts (`nbArtifactsTab`)
- **Artifacts grid first** (`.item-grid`, `repeat(4,1fr)`) — one `.item` card per existing artifact kind (type icon tile + title + meta).
- **Then** a **"Generate a new artifact"** launcher (`.launcher`) below it: a header row (spark icon tile + label "choose sources & options in the next step") and a `.gen-strip` of 8 generate tiles (`.gen-tile`, one per generatable type except Mindmap). Clicking a tile opens the **Generate drawer** for that type, scoped to this notebook.

#### Tab B — Sources (`nbSourcesTab`) — managed TABLE
Built for long lists.
- **Toolbar** (`.src-toolbar`): a 300px search input (filters rows live by name), a "(N selected)" counter, a hidden-until-selection **"Remove selected"** button, and a primary **"Add source"** button.
- **Table** (`.src-table`): header row (`.srt-head`) + body rows (`.srt-row`), grid columns `44px 1fr 110px 90px 110px 84px`:
  - **Checkbox** (`.cbox` — custom 20×20, checked = `--tc` fill, white check). Header checkbox toggles all.
  - **Source** — type icon (`.src-ic`) + name.
  - **Type** — a pill badge (`.kind-badge.kind-{url|file|text|research}`), color-coded per source kind.
  - **Format** — `.ext` in mono.
  - **Added** — a date string.
  - **Actions** — open (`#i-ext`) + remove (`#i-trash`).
- Empty state when no sources.

#### Tab C — Chat (`nbChatTab`)
- **Empty state:** a 58×58 rounded "orb" (type/notebook color), a serif heading "Chat with this notebook", a muted description ("grounded in this notebook's N sources, with citations"), and suggestion **chips**.
- **Thread** (`.chat-thread`): user messages right-aligned (accent bubble, white text); assistant messages left-aligned (`--card` bubble, border). Assistant bubbles include a **citations** row (`.cites` → `.cite` chips, each = source icon + truncated source name).
- **Typing indicator** (`.typing`, 3 blinking dots) shown ~900ms before the reply.
- **Input bar** (`.chat-input`): text input + a send button (chevron). Enter submits. A muted footer "Grounded in N sources · responses cite their origin".

### 3. Collections (library) — `renderCollections()`
**Purpose:** browse the user's own research collections; create new.
- Header "Collections" + primary **"New collection"** button.
- **Card grid** (`.grid`, 3-up) of collection cards + dashed new tile.

**Collection card (`.col-card`):**
- A 92px **cover** (`.col-cover`) tinted by the collection's `--tc`, with a dotted radial pattern (`.pat`) and a 46×46 floating folder icon (`.fic`, solid `--tc`, overlapping the body edge).
- Body: category eyebrow (in `--tc`), serif-ish title (700, 17px), a row of **mini type tiles** (`.col-mini .mk` — 24×24, each shows a type icon + a small count badge `.ct`), and a footer with "N items" + an "updated X ago" clock.

### 4. Collection detail — `openCollection(id)`
- `h1.ser` title, sub "N items · updated …".
- Action chips: **Upload** (soft button) and **Generate** (primary). **Generate** opens the **type picker → generate** flow (see Create flow below), scoped to this collection.
- **Files table** (`.files` / `.file-row`, grid `40px 1fr 120px 90px 70px 40px`): type icon, name + "Type · .ext" subtext, size, date, a "Collections" provenance pill, and a more-menu (`#i-more`).

### 5. Free Forms overview — `renderFreeFormsOverview()`
**Purpose:** dashboard of all artifacts grouped by type.
- Header "Free Forms" + primary **"New free form"** button → opens the **type picker** (create mode).
- For each type that has items: a section (`.ff-section`) with a header (`.ff-sec-head` — type icon tile, label (+"New" pill for Mindmap), count, and a **"See all ›"** chip that routes to the type's table) and a **4-card preview** (`.item-grid` of `.item` cards). This overview stays card-based as a visual dashboard; the per-type page is the table.

### 6. Free Forms — single type page — `openFFType(typeKey)` / `renderFFType()`
**Purpose:** manage all items of one type. **This is a TABLE** (scales to long lists).
- Header: a 42×42 type icon tile + plural title (e.g. "Reports"), sub, and a primary **"New {type}"** button → opens the **Upload-or-Generate chooser** for that type.
- **Source filter chips** below the header: All sources / NotebookLM / Collections / Free form — each with a color dot + a count; clicking filters the table.
- **Table** (`.ff-table` / `.fft-row`, grid `minmax(0,1.7fr) 138px minmax(0,1fr) 130px 88px 96px`):
  - **Name** — type icon tile + title.
  - **Source** — a **provenance badge** (`.prov.p-{notebooklm|personal|standalone}`): icon + label, color-coded (NotebookLM = blue `#4a76a8`, Collections = accent terracotta, Free form = olive `#8a7c4a`).
  - **From** — origin notebook/collection name, or "—" for standalone.
  - **Details** — meta string (mono).
  - **Created** — date.
  - **Actions** — open / download / delete.
  - Row click → item detail modal.

### 7. Item detail modal — `openItem(id)`
A centered modal (`.modal`, width 560px) with:
- A 150px **cover** tinted by the type color, dotted pattern, and a 64×64 solid type-icon tile centered. For **Mindmap** items the cover instead shows a small node-graph SVG preview (`mindPreviewSVG`).
- Body: mono type label, 22px/800 title, a provenance badge, and a **key/value list** (`.kv`): Format, Source, From, Created, Details.
- Footer actions: **Open** (primary), **Download**, **Share**, and a right-aligned **Delete**.

### 8. Settings — `renderSettings('session' | 'diagnose')`
- **Session:** cards for Account (Google NotebookLM "Linked" health pill, Workspace "Manage"), Appearance (theme toggle), and a danger "Sign out (clear session)".
- **Diagnose:** a "System status" card listing subsystems (NotebookLM session, local storage, embeddings, vector DB) each with an **"OK" health pill** (`.health-pill.ok`, green dot).

---

## Create / Generate / Upload flows

These are the most important interaction flows — implement them carefully.

### Generate drawer — `openGenerate(typeKey, ctx)`
A **right-side slide-in drawer** (`.drawer`, width 460px, transform-based slide, with a `.scrim` backdrop). `ctx.target` ∈ `'notebook' | 'collection' | 'standalone'` (+ `ctx.notebook` / `ctx.collection` id).

Drawer body composition (in order):
1. **Source block** — depends on target:
   - **`notebook` (with id):** a **checkbox list of THAT notebook's sources** (`.src-pick` rows: checkbox + source icon + name/.ext + custom check), with a header "Sources · N of M" and a **Select all / Select none** toggle. *No URL/text/file input here.* If 0 selected, the Generate button is disabled.
   - **`notebook` (no id yet):** a "Source notebook" `<select>`; choosing one re-opens the drawer with that notebook's source checklist.
   - **`collection`:** a read-only **collection summary** card (`.src-summary`) — "generated from the files in this collection".
   - **`standalone`:** the **only** place raw input lives — a 4-way segmented control (URL / Text / File / Research) swapping between a URL input, a textarea, a dropzone, and a research-topic input.
2. **Per-type option fields** — driven by the spec (see below). Option sets with ≤3 choices render as a **segmented control** (`.seg` of buttons, first active); longer sets render as a `<select>`.
3. **Instructions** — optional textarea (present for all types).
4. **Language** — a `<select>` of languages — **present for all types EXCEPT Quiz and Flashcards** (see spec).

Footer: a primary **"Generate {Type}"** button + Cancel.

**Running generate** (`runGenerate`): button shows a spinner; a **progress log** (`.proglog`, mono, terminal-style with `[stat]` tags + timestamps) streams ~6 simulated steps; on completion a **result block** (`.result`) appears with per-format download rows (`.dl-row`) and a "Save to library" action; a success toast fires. (In production, wire these steps to the real CLI/streaming progress events; the download extensions per type are in `DL_EXT` in `app.js`.)

### Add source drawer — `openAddSource(nbId)`
Opened from the Sources tab. A lean drawer: a 4-way **Source type** segmented control (File / URL / Text / Research) that swaps the input area (dropzone vs URL/textarea/topic input), and an "Add to notebook" button. Adding pushes onto the notebook's `srcList`, updates the count badge, and re-renders the table behind the drawer (`refreshSources`). Removing a row (or bulk-removing checked rows) updates the same.

### Create chooser — `openCreate(typeKey, ctx)`
When a type **is** known (e.g. "New report" on a type page): a centered modal offering **two cards** (`.choose-card`): **"Upload a file"** (→ `openUpload`) and **"Generate with AI"** (→ `openGenerate`, primary). Generate keeps the exact drawer described above, unchanged.

### Type picker — `openCreatePick(ctx, mode)`
When the type is **not** known yet (Free Forms overview "New free form", Collection "Generate"): a modal "What do you want to make?" with a **9-tile grid** (`.pick-tile`, one per type, Mindmap flagged "New"). Picking a type:
- `mode='create'` → opens the **Create chooser** (Upload or Generate) for that type.
- `mode='generate'` (Collections) → goes **straight to the Generate drawer** for that type, scoped to the collection.

### Upload drawer — `openUpload(typeKey, ctx)`
A simple drawer: a dropzone with type-appropriate accepted extensions (see `accept` map in `app.js`), an optional Name field, and an "Upload {Type}" button. Saves to the target (collection or standalone Free Forms).

---

## Interactions & Behavior
- **Routing** (`go(view)` in `app.js`): client-side view switching with breadcrumb updates and sidebar active-state sync. Map to React Router routes: `/notebooklm`, `/notebooklm/:id` (with `?tab=artifacts|sources|chat`), `/collections`, `/collections/:id`, `/free-forms`, `/free-forms/:type`, `/settings/session`, `/settings/diagnose`.
- **Drawer & modal:** open/close with a shared `.scrim` backdrop (fade 0.25s). Drawer slides via `transform: translateX(100%)` → `none` over 0.3s `cubic-bezier(.4,0,.2,1)`. Modal pops via a 0.22s scale/translate animation. **Esc** closes both. Clicking the scrim/modal-root closes.
- **Theme toggle** (`toggleTheme`): flips `body[data-theme]` between `light`/`dark`, swaps the toggle icon, and **persists to `localStorage` key `nh-theme`**; restored on boot.
- **Toasts** (`toast(msg)`): bottom-center pill with a check icon, auto-dismiss ~2.2s.
- **Hover/active states:** cards lift + shadow + accent-tinted border; nav items/tabs/chips have explicit hover and active treatments (see CSS).
- **Transitions:** most are 0.12–0.18s on transform/background/border. Respect `prefers-reduced-motion` in production.
- **Table search filter:** live, case-insensitive substring on the row's name (`filterSrcTable`, and analogous for the FF table).

## State Management
Per-screen state needed (translate the prototype's `APP` object + module-level vars):
- **Current route/view** + param (notebook id, collection id, free-form type) + active **notebook tab** (`artifacts|sources|chat`).
- **Free Forms source filter** (`all|notebooklm|personal|standalone`) per type page.
- **Generate drawer:** open + target context, selected source ids (notebook target), chosen per-type options, instructions, language, and the generation run state (idle → streaming steps → result).
- **Add-source drawer:** selected source kind + input value.
- **Theme** (persisted).
- **Source list edits:** add/remove/bulk-remove mutate the notebook's `srcList` and derived counts.
- **Chat:** message thread per notebook + a pending/typing flag.

**Data fetching (production):** notebooks, a notebook's sources & artifacts, collections + their files, and the aggregated Free Forms items (by type, filterable by provenance) all come from the `notebooklm-client` backend. Generation and source-add should stream progress. See `data.js` for the exact shapes to model your API/types on.

---

## Design Tokens

Fonts (Google Fonts): **Newsreader** (serif display/italic), **Hanken Grotesk** (UI sans), **JetBrains Mono** (mono metadata/labels).

Type scale (px): page/section title 30/800; serif detail title 30 (Newsreader 500 italic); section heading 18/700; card title 17–20; body 14; sub/meta 12.5–13.5; mono labels 10.5–11.

### Light theme (`:root` / `body[data-theme="light"]`)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#f3ece1` | app background (sand) |
| `--bg-sink` | `#ece4d6` | recessed (progress log) |
| `--rail` | `#2a231d` | sidebar (espresso) |
| `--rail-soft` | `#372e26` | sidebar hover |
| `--rail-line` | `#443a30` | sidebar dividers |
| `--rail-ink` | `#d3c7b6` | sidebar text |
| `--rail-muted` | `#8a7c6c` | sidebar muted |
| `--card` | `#fffdf9` | cards/surfaces (ivory) |
| `--card-2` | `#faf4ea` | subtle fill |
| `--ink` | `#2a231d` | primary text |
| `--ink-soft` | `#5c5246` | secondary text |
| `--muted` | `#8c8173` | muted text |
| `--line` | `#e6dccb` | borders |
| `--line-soft` | `#efe7d8` | inner dividers |
| `--accent` | `#c15a37` | **terracotta accent** |
| `--accent-2` | `#a84a2c` | accent hover |
| `--accent-soft` | `#f3e1d7` | accent tint bg |
| `--shadow` | `0 22px 40px -28px rgba(70,45,25,.55)` | card hover |
| `--shadow-lg` | `0 40px 80px -40px rgba(60,40,20,.6)` | drawer/modal |

### Dark theme (`body[data-theme="dark"]`)
| Token | Value |
|---|---|
| `--bg` | `#181410` |
| `--bg-sink` | `#120f0c` |
| `--rail` | `#100d0a` |
| `--rail-soft` | `#221c16` |
| `--rail-line` | `#2c251d` |
| `--card` | `#221d17` |
| `--card-2` | `#1d1813` |
| `--ink` | `#efe6d6` |
| `--ink-soft` | `#c3b8a6` |
| `--muted` | `#998d7d` |
| `--line` | `#2f2820` |
| `--line-soft` | `#271f19` |
| `--accent` | `#d97a52` |
| `--accent-2` | `#e0876a` |
| `--accent-soft` | `#3a2a20` |

### Artifact type colors (`--tc`, from `TYPES` in `data.js`)
| Type | Key | Color | Icon id |
|---|---|---|---|
| Audio | `audio` | `#c15a37` | `#i-audio` |
| Report | `report` | `#4a76a8` | `#i-report` |
| Video | `video` | `#8a6aa8` | `#i-video` |
| Quiz | `quiz` | `#b9892a` | `#i-quiz` |
| Flashcards | `flash` | `#5f8a5a` | `#i-flash` |
| Infographic | `info` | `#c1503f` | `#i-info` |
| Slides | `slides` | `#467b86` | `#i-slides` |
| Data table | `table` | `#8a7c4a` | `#i-table` |
| Mindmap (NEW) | `mind` | `#5b6bbf` | `#i-mind` |

### Provenance colors (`SOURCES` in `data.js`)
- NotebookLM → `#4a76a8` (icon `#i-nlm`), Collections/personal → `--accent` (icon `#i-folder`), Free form/standalone → `#8a7c4a` (icon `#i-spark`).

### Other values
- **Radii:** cards 14–16px; tiles/buttons 9–11px; chips/pills 999px; small icon tiles 7–9px.
- **Spacing:** content padding 26px 34px; card padding 17–20px; grid gaps 14–18px.
- **Sidebar width** 266px; **drawer width** 460px; **search width** 290px; **content max-width** 1320px.
- **Color-mixing:** the prototype uses `color-mix(in srgb, var(--tc) X%, var(--card))` extensively for type-tinted backgrounds. Reproduce with `color-mix` (supported in modern browsers) or precompute tints.

---

## Per-type Generate Option Spec
Exact source of truth: `GEN_SPEC` + `OPTS` in `reference/data.js`. Summary (every type also gets an **Instructions** textarea):

| Type | Options (in order) | Language? |
|---|---|---|
| **Audio** | Format [Deep dive, Brief, Critique, Debate] · Length [Short, Default, Long] | Yes |
| **Report** | Template [Briefing doc, Study guide, Blog post, Custom] | Yes |
| **Video** | Format [Explainer, Brief, Cinematic] · Style [Auto, Classic, Whiteboard, Anime, Watercolor] | Yes |
| **Quiz** | Quantity [Fewer, Standard] · Difficulty [Easy, Medium, Hard] | **No** |
| **Flashcards** | Quantity [Fewer, Standard] · Difficulty [Easy, Medium, Hard] | **No** |
| **Infographic** | Orientation [Landscape, Portrait, Square] · Detail [Concise, Standard, Detailed] · Style [Sketch note, Professional, Bento grid] | Yes |
| **Slides** | Format [Detailed, Presenter] · Length [Default, Short] | Yes |
| **Data table** | _(no extra options)_ | Yes |
| **Mindmap** | Depth [Overview, Standard, Exhaustive] · Layout [Radial, Tree, Org] | Yes |

Rendering rule: ≤3 options → segmented control; >3 → dropdown.

---

## Assets
- **Icons:** all icons are inline SVG `<symbol>`/`<g>` definitions in the `<defs>` sprite at the top of `reference/NotebookHub.html` (ids prefixed `i-`). They're original, single-stroke line icons — reuse them directly, or map to your codebase's existing icon set (the ids/names indicate intent). No external icon library is required.
- **Fonts:** Newsreader, Hanken Grotesk, JetBrains Mono — via Google Fonts (`<link>` in the HTML head). Swap to self-hosted in production if preferred.
- **Images:** none. Covers/patterns are CSS (radial-dot patterns + color tints). The Mindmap preview is an inline SVG (`mindPreviewSVG` in `views.js`).
- No Anthropic brand assets are used.

---

## Files (in `reference/`)
| File | Contains |
|---|---|
| `NotebookHub.html` | App shell markup + the complete inline **SVG icon sprite** + font/style includes. |
| `styles.css` | Full **token system** (light/dark) + every component style. The styling source of truth. |
| `data.js` | Demo data + **`TYPES`/`TYPE`** registry, **`SOURCES`** provenance, **`NOTEBOOKS`** (with per-notebook `srcList`), **`COLLECTIONS`**, **`ITEMS`** (free-form artifacts), **`LANGS`**, and **`GEN_SPEC`/`OPTS`** (per-type generate options). Model your TS types on these. |
| `views.js` | Pure render functions per screen → your component breakdown. |
| `app.js` | Routing, generate/add-source/upload **drawers**, **create chooser & type picker**, item **modal**, **chat**, theme, toasts, and all interaction logic. |

To preview the reference: open `reference/NotebookHub.html` in a browser (it's self-contained aside from Google Fonts).
