# notebooklm-client

[English](#english) | [中文](#中文)

---

<a id="english"></a>

Standalone CLI, library, **and local Web GUI** for Google's [NotebookLM](https://notebooklm.google.com/) — generate audio podcasts, reports, slides, quizzes, videos, infographics, data tables, flashcards, analyze content, manage notebooks, and chat.

> **New in v0.7.0** — **Audio / video transcription**: every audio podcast and video artifact in the research corpus now gets auto-transcribed via **OCI Speech (Whisper)** in the background, then chunked + embedded like any other text. Search and chat seamlessly cover spoken content (Chinese, English, 50+ languages via Whisper auto-detect). Status surfaces inline in the Library with a `⏳ → ✓` badge per row and a manual retry button. **5 free transcription hours / month per tenancy** covers normal personal use at zero cost.
>
> **v0.6.0** — **Chat over corpus**: a RAG chat page that answers questions grounded in your research corpus, with inline citations back to the underlying artifacts. Powered by OCI Generative AI (Cohere Command R / R+) with the same Oracle Autonomous Database vector search the rest of the corpus uses. See [Research corpus](./webapp/README.md#research-corpus-oracle-adb--object-storage--optional).
>
> **New in v0.5.0** — an optional **Research Corpus** on the Web GUI: every artifact you download (and anything you upload) is auto-ingested into Oracle ADB + Object Storage with 1024-dim multilingual embeddings, then made searchable semantically across notebooks. Library page for curation (rename, retag, delete, share links), deep-link cross-references back to the originating notebook.
>
> **New in v0.4.0** — a local-first webapp that wraps every CLI command in a friendly UI, plus a unified `client.downloadArtifact()` API. See [Web GUI](#web-gui) below.

## Requirements

- **Node.js 20+**
- **Google Chrome** — only needed for first-time login
- A Google account with NotebookLM access

## Install

```bash
npm i notebooklm-client
```

Or from source:

```bash
git clone https://github.com/icebear0828/notebooklm-client.git && cd notebooklm-client
npm install
npm run build
```

## Quick Start

### 1. Login (one-time)

```bash
npx notebooklm export-session
# Opens Chrome → log in to Google → done
```

### 2. Use

```bash
# List notebooks
npx notebooklm list --transport auto

# Generate audio podcast from a URL
npx notebooklm audio --transport auto --url "https://en.wikipedia.org/wiki/TypeScript" -o ./output -l en

# Generate audio podcast from a topic (debate format, short)
npx notebooklm audio --transport auto --topic "quantum computing" -o ./output --format debate --length short

# Generate a report (briefing doc, study guide, blog post, or custom)
npx notebooklm report --transport auto --url "https://example.com/article" -o ./output --template study_guide

# Generate slides
npx notebooklm slides --transport auto --url "https://example.com/article" -o ./output --instructions "Focus on key takeaways"

# Generate a quiz
npx notebooklm quiz --transport auto --url "https://example.com/article" -o ./output --difficulty medium

# Generate flashcards
npx notebooklm flashcards --transport auto --url "https://example.com/article" -o ./output

# Generate a video overview
npx notebooklm video --transport auto --url "https://example.com/article" -o ./output --format explainer --style whiteboard

# Generate an infographic
npx notebooklm infographic --transport auto --url "https://example.com/article" -o ./output --orientation landscape --style professional

# Generate a data table
npx notebooklm data-table --transport auto --url "https://example.com/article" -o ./output --instructions "Compare by category"

# Analyze content
npx notebooklm analyze --transport auto --url "https://example.com/paper.pdf" --question "What are the key findings?"

# Chat with a notebook
npx notebooklm chat <notebook-id> --transport auto --question "Summarize this"

# Show notebook details
npx notebooklm detail <notebook-id> --transport auto

# Add a source to an existing notebook (file / URL / text)
npx notebooklm source add <notebook-id> --transport auto --file ./report.pdf
npx notebooklm source add <notebook-id> --transport auto --url https://example.com/doc.pdf
npx notebooklm source add <notebook-id> --transport auto --text "..." --title "My Note"

# Diagnose issues
npx notebooklm diagnose
```

## Web GUI

A local Express + React webapp that exposes every CLI command through a friendly UI. Runs on your machine (or in Hugging Face Spaces via `Dockerfile.webapp`) and uses a **bring-your-own-session** auth model — you paste your exported NotebookLM session JSON once and it's sent with each request via the `X-NBLM-Session` header. Nothing is persisted server-side.

```bash
# One-time: install deps + build the library
npm install
npm run build

# Dev mode (Vite HMR on :5173, API on :7860)
npm run webapp:dev

# Production (single port :7860 serving API + static client)
npm run webapp:build
npm run webapp:start
```

Features:
- Notebook library: list, detail, delete, chat, add sources (url/text/file)
- Generate every artifact type with live SSE progress logs
- **One-click download** of any existing artifact (audio, report, quiz, flashcards, infographic, slides, data-table, video)
- Analyze & chat with citations
- **One-click session import** — click "⚡ Load from disk" on the login page to auto-load `~/.notebooklm/session.json` without copy-pasting JSON
- Session verify / refresh / download, diagnose page
- **Research Corpus** (optional, requires Oracle ADB + OCI Object Storage; supports multiple embedding and chat providers):
  - Auto-ingests every downloaded artifact in the background (generating 1024 or 3072-dimensional vector embeddings)
  - Supports OCI GenAI (Cohere), Google Gemini (free-tier `gemini-embedding-2`), and free in-database local ONNX models (e.g. `BGE_M3_MODEL`) for embeddings
  - Manual `/corpus/upload` page for any PDF/DOCX/HTML/MD/TXT/CSV/JSON
  - `/corpus` semantic search with kind + distance filters, notebook cross-links
  - `/corpus/chat` retrieval-augmented chat with inline citations (powered by OCI GenAI, Google Gemini, or Xiaomi Mimo LLMs, with dynamic model settings panel)
  - `/corpus/library` with rename, retag, per-row + bulk delete, shareable links (1 h – 7 d TTL)

Deploy to Hugging Face Spaces:

```bash
docker build -f Dockerfile.webapp -t notebooklm-webapp .
docker run -p 7860:7860 notebooklm-webapp
```

See [`webapp/README.md`](./webapp/README.md) for architecture and deployment notes.

## CLI Reference

### Shared options

```
  --transport <mode>       auto | browser (default: browser)
  --home <dir>             Config directory (default: ~/.notebooklm)
  --session-path <path>    Custom session file path
  --headless               Run browser without visible window
  --chrome-path <path>     Chrome executable path
  --proxy <url>            Proxy URL (http/socks5/socks5h, or set HTTPS_PROXY env)
```

### Commands

| Command | Description |
|---------|-------------|
| `export-session` | Login via browser and save session |
| `import-session <file\|json>` | Import session from file or JSON string |
| `list` | List all notebooks |
| `detail <id>` | Show notebook title and sources |
| `source add <id>` | Add a source (`--file` / `--url` / `--text`) to an existing notebook |
| `chat <id> --question "..."` | Chat with a notebook |
| `audio` | Generate audio podcast |
| `report` | Generate a report (briefing doc, study guide, blog post, custom) |
| `video` | Generate a video overview |
| `quiz` | Generate a quiz |
| `flashcards` | Generate flashcards |
| `infographic` | Generate an infographic |
| `slides` | Generate a slide deck |
| `data-table` | Generate a data table |
| `analyze` | Analyze content with a question |
| `diagnose` | Generate diagnostic report for troubleshooting |
| `skill install` | Install AI agent skill (Claude Code / Codex) |

### Source options (shared by all generation commands)

```
  --url <url>              Source URL
  --text <text>            Source text content
  --file <path>            Local file (pdf, txt, md, docx, csv, pptx, epub, mp3, wav, etc.)
  --topic <topic>          Research topic (web search)
  --research-mode <mode>   fast or deep (default: fast)
```

### `audio` options

```
  -o, --output <dir>       Output directory (required)
  -l, --language <lang>    Audio language (default: en)
  --instructions <text>    Custom generation instructions
  --custom-prompt <prompt> Alias for --instructions
  --format <fmt>           deep_dive | brief | critique | debate
  --length <len>           short | default | long
  --keep-notebook          Keep notebook after completion
```

### `report` options

```
  -o, --output <dir>       Output directory (required)
  --template <t>           briefing_doc | study_guide | blog_post | custom (default: briefing_doc)
  --instructions <text>    Custom instructions (appended to template, or full prompt for custom)
  -l, --language <lang>    Output language (default: en)
```

### `video` options

```
  -o, --output <dir>       Output directory (required)
  --format <fmt>           explainer | brief | cinematic
  --style <s>              auto | classic | whiteboard | kawaii | anime | watercolor | retro_print
  --instructions <text>    Custom instructions
  -l, --language <lang>    Output language (default: en)
```

### `quiz` / `flashcards` options

```
  -o, --output <dir>       Output directory (required)
  --instructions <text>    Custom instructions
  --quantity <q>           fewer | standard
  --difficulty <d>         easy | medium | hard
```

### `infographic` options

```
  -o, --output <dir>       Output directory (required)
  --instructions <text>    Custom instructions
  --orientation <o>        landscape | portrait | square
  --detail <d>             concise | standard | detailed
  --style <s>              sketch_note | professional | bento_grid
  -l, --language <lang>    Output language (default: en)
```

### `slides` options

```
  -o, --output <dir>       Output directory (required)
  --instructions <text>    Custom instructions
  --format <fmt>           detailed | presenter
  --length <len>           default | short
  -l, --language <lang>    Output language (default: en)
```

### `data-table` options

```
  -o, --output <dir>       Output directory (required)
  --instructions <text>    Custom instructions (describe desired table structure)
  -l, --language <lang>    Output language (default: en)
```

## Multi-Account

Use different config directories for different Google accounts:

```bash
# Default account
npx notebooklm list --transport auto

# Work account
npx notebooklm --home ~/.notebooklm-work list --transport auto

# Or via environment variable
NOTEBOOKLM_HOME=~/.notebooklm-work npx notebooklm list --transport auto
```

## Library API

```typescript
import { NotebookClient } from 'notebooklm-client';

const client = new NotebookClient();
await client.connect({ transport: 'auto' });

// List notebooks
const notebooks = await client.listNotebooks();

// Create notebook and add sources
const { notebookId } = await client.createNotebook();
await client.addUrlSource(notebookId, 'https://example.com');
await client.addTextSource(notebookId, 'Title', 'Content...');

// Chat
const detail = await client.getNotebookDetail(notebookId);
const { text } = await client.sendChat(notebookId, 'Summarize', detail.sources.map(s => s.id));

// Generate artifacts with typed options
const sourceIds = detail.sources.map(s => s.id);

await client.generateArtifact(notebookId, sourceIds, {
  type: 'audio', format: 'debate', length: 'short', instructions: 'Focus on key points',
});

await client.generateArtifact(notebookId, sourceIds, {
  type: 'report', template: 'study_guide', instructions: 'Include diagrams',
});

await client.generateArtifact(notebookId, sourceIds, {
  type: 'slide_deck', format: 'presenter', length: 'short',
});

await client.disconnect();
```

### Full API

```typescript
// Lifecycle
await client.connect(options)
await client.disconnect()
await client.exportSession(path?)
client.getTransportMode()

// Notebooks
await client.listNotebooks()                          // → NotebookInfo[]
await client.createNotebook()                         // → { notebookId }
await client.getNotebookDetail(notebookId)            // → { title, sources }
await client.deleteNotebook(notebookId)

// Sources
await client.addUrlSource(notebookId, url)            // → { sourceId, title }
await client.addTextSource(notebookId, title, text)   // → { sourceId, title }
await client.addFileSource(notebookId, filePath)       // → { sourceId }
await client.createWebSearch(notebookId, query, mode) // → { researchId }
await client.getSourceSummary(sourceId)               // → { summary }
await client.deleteSource(sourceId)

// Chat
await client.sendChat(notebookId, message, sourceIds) // → { text, threadId }
await client.deleteChatThread(threadId)

// Studio (dynamic — always fetch types from server)
await client.getStudioConfig(notebookId)              // → StudioConfig
await client.getAccountInfo()                          // → AccountInfo

// Artifacts (low-level)
await client.generateArtifact(notebookId, sourceIds, options)
await client.getArtifacts(notebookId)                 // → ArtifactInfo[]
await client.getInteractiveHtml(artifactId)            // → string (HTML)
await client.downloadAudio(downloadUrl, outputDir)    // → filePath
await client.downloadArtifact(notebookId, artifactId, outputDir)
                                                      // → { type, typeLabel, files, streamUrl? }
                                                      //   Dispatches by artifact type — works for audio,
                                                      //   report, quiz, flashcards, infographic, slides,
                                                      //   data-table, and video (best-effort MP4 else streamUrl).
await client.deleteArtifact(artifactId)

// High-level workflows (create notebook → add source → generate → download)
await client.runAudioOverview(options, onProgress?)   // → { audioPath, notebookUrl }
await client.runReport(options, onProgress?)           // → { htmlPath, notebookUrl }
await client.runVideo(options, onProgress?)            // → { videoUrl, notebookUrl }
await client.runQuiz(options, onProgress?)             // → { htmlPath, notebookUrl }
await client.runFlashcards(options, onProgress?)       // → { htmlPath, notebookUrl }
await client.runInfographic(options, onProgress?)      // → { htmlPath, notebookUrl }
await client.runSlideDeck(options, onProgress?)        // → { htmlPath, notebookUrl }
await client.runDataTable(options, onProgress?)        // → { htmlPath, notebookUrl }
await client.runAnalyze(options, onProgress?)          // → { answer, notebookUrl }
```

### Artifact types & options

| Type | Code | Options |
|------|------|---------|
| Audio | 1 | `format`, `length`, `instructions`, `language` |
| Report | 2 | `template`, `instructions`, `language` |
| Video | 3 | `format`, `style`, `instructions`, `language` |
| Quiz | 4 | `instructions`, `quantity`, `difficulty` |
| Flashcards | 4 | `instructions`, `quantity`, `difficulty` |
| Infographic | 7 | `orientation`, `detail`, `style`, `instructions`, `language` |
| Slide Deck | 8 | `format`, `length`, `instructions`, `language` |
| Data Table | 9 | `instructions`, `language` |

## Docker

```bash
docker build -t notebooklm .
docker run -v ~/.notebooklm:/root/.notebooklm notebooklm list --transport auto
```

## Agent Skill

Install the `/notecraft` skill for Claude Code or Codex:

```bash
npx notebooklm skill install              # Install for current user
npx notebooklm skill install --scope project  # Install for current project
npx notebooklm skill status               # Check install status
npx notebooklm skill uninstall            # Remove
```

After installing, use `/notecraft` in your agent to automate NotebookLM tasks.

## Troubleshooting

Run `npx notebooklm diagnose` and paste the output when [reporting issues](https://github.com/icebear0828/notebooklm-client/issues).

Common issues:
- **"No session available"** → Run `npx notebooklm export-session`
- **"Session expired"** → Tokens auto-refresh; if still fails, re-run `export-session`
- **Web GUI HTTP 400 loop** → The browser has a stale session (old `bl` build label). Click "Sign out" in the sidebar → "⚡ Load from disk" to import the fresh session from disk
- **Audio generation fails** → Check account limits with `getAccountInfo()`
- **Connection timeout (China)** → Use `--proxy socks5://127.0.0.1:7890` or set `HTTPS_PROXY` env var
- **Audio download returns login page** → Re-run `npx notebooklm export-session` to refresh cookies

## License

MIT

---

<a id="中文"></a>

# notebooklm-client（中文文档）

Google [NotebookLM](https://notebooklm.google.com/) 的独立 CLI、编程库 **和本地 Web GUI** —— 生成音频播客、报告、幻灯片、测验、视频、信息图、数据表、闪卡，分析内容、管理笔记本、对话。

> **v0.7.0 新增** —— **音视频自动转写**：研究语料库中的每个音频播客和视频产物现在都会通过 **OCI Speech（Whisper 模型）** 在后台自动转写，再按文本流程切块 + 嵌入。语义搜索和对话天然覆盖语音内容（中文、英文等 50+ 种语言，Whisper 自动检测）。Library 页每行带 `⏳ → ✓` 状态徽标和手动重试按钮。**每个租户每月 5 小时免费转写额度**通常足以覆盖个人使用，零成本。
>
> **v0.6.0** —— **基于语料库的 RAG 对话**：新增 `/corpus/chat` 页面，模型在你的研究语料库内检索片段后给出带有内联引用的答案。底层使用 OCI Generative AI（Cohere Command R / R+）+ Oracle Autonomous Database 向量检索。详见 webapp README 中的 [Research corpus](./webapp/README.md#research-corpus-oracle-adb--object-storage--optional)。
>
> **v0.5.0 新增** —— Web GUI 可选的 **研究语料库（Research Corpus）**：每次下载的产物（以及任意上传的文档）自动写入 Oracle ADB + Object Storage，生成 1024 维多语言向量嵌入，跨所有笔记本做语义搜索。Library 页面支持整理（重命名、改标签、删除、生成分享链接），每个条目都有反向链接跳回原始笔记本。
>
> **v0.4.0 新增** —— 本地网页界面，封装全部 CLI 命令，并提供统一的 `client.downloadArtifact()` API。详见下方 [Web GUI](#web-gui-1)。

## 环境要求

- **Node.js 20+**
- **Google Chrome** —— 仅首次登录需要
- 一个有 NotebookLM 访问权限的 Google 账号

## 安装

```bash
npm i notebooklm-client
```

或从源码安装：

```bash
git clone https://github.com/icebear0828/notebooklm-client.git && cd notebooklm-client
npm install
npm run build
```

## 快速开始

### 1. 登录（一次性）

```bash
npx notebooklm export-session
# 打开 Chrome → 登录 Google 账号 → 完成
```

### 2. 使用

```bash
# 列出笔记本
npx notebooklm list --transport auto

# 从 URL 生成音频播客
npx notebooklm audio --transport auto --url "https://zh.wikipedia.org/wiki/TypeScript" -o ./output -l zh

# 从话题生成音频播客（辩论格式，短篇）
npx notebooklm audio --transport auto --topic "量子计算" -o ./output --format debate --length short

# 生成报告（简报、学习指南、博客、自定义）
npx notebooklm report --transport auto --url "https://example.com/article" -o ./output --template study_guide

# 生成幻灯片
npx notebooklm slides --transport auto --url "https://example.com/article" -o ./output --instructions "突出要点"

# 生成测验
npx notebooklm quiz --transport auto --url "https://example.com/article" -o ./output --difficulty medium

# 生成闪卡
npx notebooklm flashcards --transport auto --url "https://example.com/article" -o ./output

# 生成视频概览
npx notebooklm video --transport auto --url "https://example.com/article" -o ./output --format explainer

# 生成信息图
npx notebooklm infographic --transport auto --url "https://example.com/article" -o ./output --style professional

# 生成数据表
npx notebooklm data-table --transport auto --url "https://example.com/article" -o ./output --instructions "按类别对比"

# 分析内容
npx notebooklm analyze --transport auto --url "https://example.com/paper.pdf" --question "主要发现是什么？"

# 与笔记本对话
npx notebooklm chat <notebook-id> --transport auto --question "帮我总结一下"

# 查看笔记本详情
npx notebooklm detail <notebook-id> --transport auto

# 向已有笔记本添加来源（文件 / URL / 文本）
npx notebooklm source add <notebook-id> --transport auto --file ./report.pdf
npx notebooklm source add <notebook-id> --transport auto --url https://example.com/doc.pdf
npx notebooklm source add <notebook-id> --transport auto --text "..." --title "我的笔记"

# 诊断问题
npx notebooklm diagnose
```

## Web GUI

基于 Express + React 的本地网页应用，通过友好 UI 暴露每一个 CLI 命令。在本机运行（或通过 `Dockerfile.webapp` 部署到 Hugging Face Spaces），采用**自带 session** 的认证模式 —— 粘贴一次导出的 NotebookLM session JSON，后续每次请求通过 `X-NBLM-Session` 头发送，服务端不做持久化。

```bash
# 一次性：安装依赖 + 构建库
npm install
npm run build

# 开发模式（Vite HMR :5173，API :7860）
npm run webapp:dev

# 生产模式（:7860 同时提供 API 和静态前端）
npm run webapp:build
npm run webapp:start
```

功能：
- 笔记本管理：列表、详情、删除、对话、添加来源（url/text/file）
- 生成所有产物类型，实时 SSE 进度日志
- **一键下载**任意已有产物（音频、报告、测验、闪卡、信息图、幻灯片、数据表、视频）
- 分析、带引用的对话
- **一键导入 Session** —— 登录页点击「⚡ 从磁盘加载」自动读取 `~/.notebooklm/session.json`，无需手动粘贴 JSON
- Session 验证 / 刷新 / 下载，诊断页面
- **研究语料库**（可选，需要 Oracle ADB + OCI Object Storage；支持多嵌入及问答服务商）：
  - 下载产物时后台自动入库（自动生成 1024 或 3072 维的高维向量嵌入）
  - 向量嵌入生成端支持 OCI GenAI (Cohere v3.0)、Google Gemini (`gemini-embedding-2`) 以及**免费**在库运行的本地 ONNX 模型 (如 `BGE_M3_MODEL` 等)
  - `/corpus/upload` 页面手动上传 PDF/DOCX/HTML/MD/TXT/CSV/JSON
  - `/corpus` 跨笔记本语义搜索，支持类型、距离阈值过滤，以及返回原始笔记本的反向链接
  - `/corpus/chat` 基于检索增强（RAG）的对话，回答带内联引用（支持 OCI GenAI、Google Gemini 和小米 Mimo 等主流后端，并在右侧支持动态模型设置）
  - `/corpus/library` 支持重命名、改标签、逐条/批量删除、生成分享链接（1 小时 – 7 天 TTL）

部署到 Hugging Face Spaces：

```bash
docker build -f Dockerfile.webapp -t notebooklm-webapp .
docker run -p 7860:7860 notebooklm-webapp
```

架构和部署细节见 [`webapp/README.md`](./webapp/README.md)。

## CLI 参考

### 通用选项

```
  --transport <mode>       auto | browser（默认 browser）
  --home <dir>             配置目录（默认 ~/.notebooklm）
  --session-path <path>    自定义 session 文件路径
  --headless               无头模式（不显示浏览器窗口）
  --chrome-path <path>     Chrome 可执行文件路径
  --proxy <url>            代理地址（http/socks5/socks5h，或设置 HTTPS_PROXY 环境变量）
```

### 命令

| 命令 | 说明 |
|------|------|
| `export-session` | 通过浏览器登录并保存 session |
| `import-session <file\|json>` | 从文件或 JSON 字符串导入 session |
| `list` | 列出所有笔记本 |
| `detail <id>` | 显示笔记本标题和来源 |
| `source add <id>` | 向已有笔记本添加来源（`--file` / `--url` / `--text`） |
| `chat <id> --question "..."` | 与笔记本对话 |
| `audio` | 生成音频播客 |
| `report` | 生成报告（简报、学习指南、博客、自定义） |
| `video` | 生成视频概览 |
| `quiz` | 生成测验 |
| `flashcards` | 生成闪卡 |
| `infographic` | 生成信息图 |
| `slides` | 生成幻灯片 |
| `data-table` | 生成数据表 |
| `analyze` | 分析内容并回答问题 |
| `diagnose` | 生成诊断报告（用于提交 issue） |
| `skill install` | 安装 AI agent skill（Claude Code / Codex） |

### 素材选项（所有生成命令共用）

```
  --url <url>              素材 URL
  --text <text>            素材文本内容
  --file <path>            本地文件（pdf, txt, md, docx, csv, pptx, epub, mp3, wav 等）
  --topic <topic>          研究话题（网页搜索）
  --research-mode <mode>   fast 或 deep（默认 fast）
```

### `audio` 选项

```
  -o, --output <dir>       输出目录（必填）
  -l, --language <lang>    音频语言（默认 en）
  --instructions <text>    自定义生成指令
  --custom-prompt <prompt> --instructions 别名
  --format <fmt>           deep_dive | brief | critique | debate
  --length <len>           short | default | long
  --keep-notebook          完成后保留笔记本
```

### `report` 选项

```
  -o, --output <dir>       输出目录（必填）
  --template <t>           briefing_doc | study_guide | blog_post | custom（默认 briefing_doc）
  --instructions <text>    自定义指令（追加到模板，或 custom 时为完整提示词）
  -l, --language <lang>    输出语言（默认 en）
```

### `video` 选项

```
  -o, --output <dir>       输出目录（必填）
  --format <fmt>           explainer | brief | cinematic
  --style <s>              auto | classic | whiteboard | kawaii | anime | watercolor | retro_print
  --instructions <text>    自定义指令
  -l, --language <lang>    输出语言（默认 en）
```

### `quiz` / `flashcards` 选项

```
  -o, --output <dir>       输出目录（必填）
  --instructions <text>    自定义指令
  --quantity <q>           fewer | standard
  --difficulty <d>         easy | medium | hard
```

### `infographic` 选项

```
  -o, --output <dir>       输出目录（必填）
  --instructions <text>    自定义指令
  --orientation <o>        landscape | portrait | square
  --detail <d>             concise | standard | detailed
  --style <s>              sketch_note | professional | bento_grid
  -l, --language <lang>    输出语言（默认 en）
```

### `slides` 选项

```
  -o, --output <dir>       输出目录（必填）
  --instructions <text>    自定义指令
  --format <fmt>           detailed | presenter
  --length <len>           default | short
  -l, --language <lang>    输出语言（默认 en）
```

### `data-table` 选项

```
  -o, --output <dir>       输出目录（必填）
  --instructions <text>    自定义指令（描述期望的表格结构）
  -l, --language <lang>    输出语言（默认 en）
```

## 多账号

不同 Google 账号使用不同配置目录：

```bash
# 默认账号
npx notebooklm list --transport auto

# 工作账号
npx notebooklm --home ~/.notebooklm-work list --transport auto

# 或通过环境变量
NOTEBOOKLM_HOME=~/.notebooklm-work npx notebooklm list --transport auto
```

## 编程 API

```typescript
import { NotebookClient } from 'notebooklm-client';

const client = new NotebookClient();
await client.connect({ transport: 'auto' });

// 列出笔记本
const notebooks = await client.listNotebooks();

// 创建笔记本并添加来源
const { notebookId } = await client.createNotebook();
await client.addUrlSource(notebookId, 'https://example.com');
await client.addTextSource(notebookId, '标题', '内容...');

// 对话
const detail = await client.getNotebookDetail(notebookId);
const { text } = await client.sendChat(notebookId, '帮我总结', detail.sources.map(s => s.id));

// 生成产物（带类型化选项）
const sourceIds = detail.sources.map(s => s.id);

await client.generateArtifact(notebookId, sourceIds, {
  type: 'audio', format: 'debate', length: 'short', instructions: '关注要点',
});

await client.generateArtifact(notebookId, sourceIds, {
  type: 'report', template: 'study_guide', instructions: '包含图表',
});

await client.generateArtifact(notebookId, sourceIds, {
  type: 'slide_deck', format: 'presenter', length: 'short',
});

await client.disconnect();
```

### 完整 API

```typescript
// 生命周期
await client.connect(options)
await client.disconnect()
await client.exportSession(path?)
client.getTransportMode()

// 笔记本
await client.listNotebooks()                          // → NotebookInfo[]
await client.createNotebook()                         // → { notebookId }
await client.getNotebookDetail(notebookId)            // → { title, sources }
await client.deleteNotebook(notebookId)

// 来源
await client.addUrlSource(notebookId, url)            // → { sourceId, title }
await client.addTextSource(notebookId, title, text)   // → { sourceId, title }
await client.addFileSource(notebookId, filePath)       // → { sourceId }
await client.createWebSearch(notebookId, query, mode) // → { researchId }
await client.getSourceSummary(sourceId)               // → { summary }
await client.deleteSource(sourceId)

// 对话
await client.sendChat(notebookId, message, sourceIds) // → { text, threadId }
await client.deleteChatThread(threadId)

// Studio（动态 —— 始终从服务端获取类型）
await client.getStudioConfig(notebookId)              // → StudioConfig
await client.getAccountInfo()                          // → AccountInfo

// 产物（底层）
await client.generateArtifact(notebookId, sourceIds, options)
await client.getArtifacts(notebookId)                 // → ArtifactInfo[]
await client.getInteractiveHtml(artifactId)            // → string (HTML)
await client.downloadAudio(downloadUrl, outputDir)    // → filePath
await client.downloadArtifact(notebookId, artifactId, outputDir)
                                                      // → { type, typeLabel, files, streamUrl? }
                                                      //   按产物类型分发 —— 支持音频、报告、测验、闪卡、
                                                      //   信息图、幻灯片、数据表、视频（优先 MP4 直下，
                                                      //   否则返回 streamUrl）。
await client.deleteArtifact(artifactId)

// 高级工作流（创建笔记本 → 添加来源 → 生成 → 下载）
await client.runAudioOverview(options, onProgress?)   // → { audioPath, notebookUrl }
await client.runReport(options, onProgress?)           // → { htmlPath, notebookUrl }
await client.runVideo(options, onProgress?)            // → { videoUrl, notebookUrl }
await client.runQuiz(options, onProgress?)             // → { htmlPath, notebookUrl }
await client.runFlashcards(options, onProgress?)       // → { htmlPath, notebookUrl }
await client.runInfographic(options, onProgress?)      // → { htmlPath, notebookUrl }
await client.runSlideDeck(options, onProgress?)        // → { htmlPath, notebookUrl }
await client.runDataTable(options, onProgress?)        // → { htmlPath, notebookUrl }
await client.runAnalyze(options, onProgress?)          // → { answer, notebookUrl }
```

### 产物类型和选项

| 类型 | 代码 | 选项 |
|------|------|------|
| 音频 | 1 | `format`, `length`, `instructions`, `language` |
| 报告 | 2 | `template`, `instructions`, `language` |
| 视频 | 3 | `format`, `style`, `instructions`, `language` |
| 测验 | 4 | `instructions`, `quantity`, `difficulty` |
| 闪卡 | 4 | `instructions`, `quantity`, `difficulty` |
| 信息图 | 7 | `orientation`, `detail`, `style`, `instructions`, `language` |
| 幻灯片 | 8 | `format`, `length`, `instructions`, `language` |
| 数据表 | 9 | `instructions`, `language` |

## Docker

```bash
docker build -t notebooklm .
docker run -v ~/.notebooklm:/root/.notebooklm notebooklm list --transport auto
```

## Agent Skill

安装 `/notecraft` skill 到 Claude Code 或 Codex：

```bash
npx notebooklm skill install              # 安装到当前用户
npx notebooklm skill install --scope project  # 安装到当前项目
npx notebooklm skill status               # 查看安装状态
npx notebooklm skill uninstall            # 卸载
```

安装后在 agent 中使用 `/notecraft` 即可自动化 NotebookLM 操作。

## 故障排除

运行 `npx notebooklm diagnose`，将输出贴到 [issue](https://github.com/icebear0828/notebooklm-client/issues) 中。

常见问题：
- **"No session available"** → 运行 `npx notebooklm export-session`
- **"Session expired"** → Token 会自动刷新；如果仍然失败，重新运行 `export-session`
- **Web GUI HTTP 400 循环** → 浏览器中有旧的 session（`bl` 构建标签过期）。点侧边栏「Sign out」→ 登录页「⚡ 从磁盘加载」导入最新 session
- **音频生成失败** → 通过 `getAccountInfo()` 检查账号限额
- **连接超时（中国用户）** → 使用 `--proxy socks5://127.0.0.1:7890` 或设置 `HTTPS_PROXY` 环境变量
- **下载音频拿到登录页** → 重新运行 `npx notebooklm export-session` 刷新 cookies

## 许可证

MIT

---

## Changelog / 更新日志

### v0.8.0 (2026-05-20)

- **Multi-provider Vector Embeddings** — You can now choose where to generate text embeddings via the `EMBEDDING_PROVIDER` env variable:
  - `oci` (default): OCI GenAI Cohere Multilingual v3.0 (1024 dimensions)
  - `database`: **Free** in-database ONNX model embeddings (e.g. `BGE_M3_MODEL` producing 1024-dim vectors) via SQL `VECTOR_EMBEDDING()` — runs entirely inside Oracle Autonomous Database at zero token cost and ultra-low latency. Script `webapp/server/corpus/onnx/convert_bge_m3.py` converts the model to augmented ONNX format, and `load_model.sql` loads it into ADB.
  - `gemini`: Google Gemini `gemini-embedding-2` model (3072 dimensions) — free tier via the batch embedding endpoint.
- **Multi-provider RAG Chat** — Chat over your corpus now supports multiple LLM backends via the `CHAT_PROVIDER` env variable or automatic detection:
  - `oci`: OCI GenAI Cohere Chat.
  - `gemini`: **Free** Google Gemini API (defaulting to `gemini-2.0-flash`, configurable to `gemini-2.5-flash` or `gemini-1.5-pro` etc.) with standard inline citation mapping (`[1]`, `[2]`) parsed dynamically.
  - `mimo`: Xiaomi Mimo API (OpenAI-compatible) using GPT models (e.g. `gpt-4o`, `gpt-4o-mini`) with inline source reference matching.
  - `disabled`: Turns off chat, keeping search and ingestion active.
- **Dynamic Model Discovery & Web GUI Sidebar Panel** — Added a "Model settings" panel in the chat page right rail. When configured, it dynamically queries available model lists from Google Gemini and Xiaomi Mimo API endpoints, enabling you to select your preferred chat model directly from the frontend.
- **Robust Re-embedding & Ingest Backfiller** — New script `webapp/scripts/reembed.ts` queries the database for any uploaded or downloaded artifacts lacking embedded chunks, downloads their raw files from Object Storage, re-extracts text, generates embeddings via the active provider (e.g., Gemini with rate-limit retry logic), and batch-inserts them back into Autonomous Database.
- **Database Schema Upgrades** — The default database schema (`schema.sql`) now allocates `VECTOR(3072, FLOAT32)` to natively support high-fidelity 3072-dimensional vector embeddings, matching Google Gemini's flagship embedding models.

---

- **多服务商向量嵌入支持** —— 可通过环境变量 `EMBEDDING_PROVIDER` 选择向量嵌入的生成地：
  - `oci`（默认）：OCI GenAI Cohere Multilingual v3.0（1024 维）—— 按 token 收费。
  - `database`：**免费**数据库内置 ONNX 模型嵌入（如 `BGE_M3_MODEL` 产生 1024 维向量）—— 通过 `VECTOR_EMBEDDING()` SQL 函数在 Oracle ADB 内部运行，免去外部 API 费用且拥有极低延迟。配套 `convert_bge_m3.py` 将模型转换为 Augmented ONNX 格式，`load_model.sql` 导入 ADB。
  - `gemini`：Google Gemini `gemini-embedding-2` 模型（3072 维）—— 使用免费 API 批量嵌入接口。
- **多服务商 RAG 对话后端** —— 跨语料库问答新增支持多种大模型后端，可通过 `CHAT_PROVIDER` 显式设置或自动探测：
  - `oci`：OCI GenAI Cohere 对话模型。
  - `gemini`：**免费** Google Gemini API（默认 `gemini-2.0-flash`，可选 `gemini-2.5-flash`/`gemini-1.5-pro` 等），结合 System Instruction 约束和正则解析，实现标准的 inline 引用标志（如 `[1]`, `[2]`）原生还原。
  - `mimo`：小米 Mimo API（OpenAI 兼容），支持通过 `gpt-4o`、`gpt-4o-mini` 开展 RAG 对话，自动匹配内联引用。
  - `disabled`：关闭 RAG 对话，保留常规库文件管理与检索。
- **动态模型发现与 Web 界面控制** —— 聊天页面右侧边栏新增「Model settings」模型设置面板。配置后能自动从 Gemini 和 Mimo 端点获取可用模型列表，支持在前端交互式随意切换大模型。
- **自动语料重构与补全脚本** —— 新增 `webapp/scripts/reembed.ts`，自动查找数据库中所有未切块或缺失向量的产物，重新从 Object Storage 读出原文、切块、调用当前嵌入服务商（针对 Gemini 具备自动限流等待和 5 次重试机制）并将高维 Float32 向量批量刷入 Autonomous Database。
- **向量维度升级** —— 数据库 schema 设计 (`schema.sql`) 升级至 `VECTOR(3072, FLOAT32)`，原生匹配 Google Gemini 高保真 3072 维高维向量嵌入。

---

### v0.7.1 (2026-05-17)

- **One-click session import from disk** — new `GET /api/session/local` endpoint reads `~/.notebooklm/session.json` from the server's filesystem. The SessionGate login page now shows a prominent "⚡ Load from disk" button that auto-loads and verifies the session in one click — no more manual JSON copy-paste after running `export-session`. Especially useful on Windows where `curl-impersonate` is unavailable and the in-browser token refresh cannot recover a stale build label (`bl`).
- **Stale session troubleshooting** — README now documents the HTTP 400 loop caused by an outdated `bl` build label in the browser's localStorage and the one-click fix.

---

- **一键从磁盘导入 Session** —— 新增 `GET /api/session/local` 端点，从服务器文件系统读取 `~/.notebooklm/session.json`。登录页新增醒目的「⚡ 从磁盘加载」按钮，一键完成加载 + 验证，无需再手动复制粘贴 JSON。在 Windows 上尤其有用——因为缺少 `curl-impersonate`，浏览器内 token 刷新无法恢复过期的 `bl` 构建标签。
- **Session 过期排错** —— README 新增关于浏览器 localStorage 中旧 `bl` 导致 HTTP 400 循环的说明及一键修复方法。

### v0.7.0 (2026-05-05)

- **Audio / video transcription via OCI Speech (Whisper)** — `audio` and `video` artifacts in the research corpus are now auto-transcribed in the background. Transcripts get chunked and embedded into the same `artifact_chunks` table the rest of the corpus uses, so they show up natively in `/corpus` semantic search and `/corpus/chat` answers. Whisper model + `auto` language detection works out of the box for Chinese, English, Japanese, Korean, and 50+ other languages.
- **Inline transcription status in the Library** — new "Transcript" column on `/corpus/library` per row: `—` for non-audio/video, pulsing amber `queued`/`running` for in-flight jobs, `✓` for done, `✗` (with hover tooltip) for failed. The detail drawer grows a Transcription sub-card with the status, finish timestamp, error detail, and a `Transcribe` / `Re-transcribe` button. The page auto-refreshes every 15 s while any visible row is in flight.
- **Background poller** — single in-process `setInterval` (default 30 s tick, configurable via `CORPUS_TRANSCRIBE_POLL_MS`) reconciles every `transcribing` row against OCI Speech, finalises `SUCCEEDED` jobs (chunk + embed + insert), and marks `FAILED` / `CANCELED` jobs accordingly. Bounded concurrency on finalisation keeps the embedding spend predictable.
- **State machine** — four new nullable columns on `artifacts`: `transcription_status` (`null|pending|transcribing|done|failed|skipped`), `transcription_job_ocid`, `transcribed_at`, `transcription_error`. Idempotent migration script (`webapp/server/corpus/schema.alter-transcription.sql`) for existing installs.
- **New endpoint + helpers** — `POST /api/corpus/artifacts/:id/transcribe` for the manual retry button; `GET /api/corpus/health` now also returns a `transcription: { enabled, ok, region, language, error? }` field. New backfill CLI: `npx tsx server/corpus/transcribe-backfill.ts [--apply] [--include-failed]`.
- **Cost** — **$0.50 / hour with 5 free hours / month per OCI tenancy**, shared with the rest of the account. A typical month of personal podcast / video research fits comfortably under the free cap. Set `OCI_SPEECH_ENABLED=false` to disable cleanly with no schema rollback.
- **Engineering reference** — full state machine, poller design, output parsing, error handling, cost model, and rollback steps documented at [`webapp/docs/corpus-transcription.md`](./webapp/docs/corpus-transcription.md).

---

- **基于 OCI Speech（Whisper）的音视频自动转写** —— 研究语料库中的 `audio` 和 `video` 产物现在会在后台自动转写。转写文本按和其它产物相同的流程切块 + 嵌入，写入同一张 `artifact_chunks` 表，因此可以原生出现在 `/corpus` 语义搜索结果和 `/corpus/chat` 答案中。Whisper 模型 + `auto` 语言检测开箱即用，覆盖中文、英文、日文、韩文以及 50+ 种其它语言。
- **Library 页内联转写状态** —— `/corpus/library` 表格新增 "Transcript" 列：非音视频显示 `—`；进行中显示带脉冲的琥珀色 `queued` / `running`；完成 `✓`；失败 `✗`（鼠标悬停显示错误详情）。详情抽屉新增"Transcription"子卡片，展示状态、完成时间、错误信息，以及 `Transcribe` / `Re-transcribe` 按钮。在有进行中任务时页面每 15 秒自动刷新一次。
- **后台轮询器** —— 进程内单一 `setInterval`（默认 30 秒一拍，可通过 `CORPUS_TRANSCRIBE_POLL_MS` 调整），把所有 `transcribing` 行同步到 OCI Speech 的最新状态：`SUCCEEDED` 走完结流程（切块 + 嵌入 + 入库），`FAILED` / `CANCELED` 写入错误。完结阶段并发受限，保证嵌入开销可预测。
- **状态机** —— `artifacts` 表新增 4 个可空列：`transcription_status`（`null|pending|transcribing|done|failed|skipped`）、`transcription_job_ocid`、`transcribed_at`、`transcription_error`。提供幂等迁移脚本 `webapp/server/corpus/schema.alter-transcription.sql`，可重复执行。
- **新端点 + 辅助工具** —— `POST /api/corpus/artifacts/:id/transcribe` 用于手动重试；`GET /api/corpus/health` 现在额外返回 `transcription: { enabled, ok, region, language, error? }` 字段。补录脚本：`npx tsx server/corpus/transcribe-backfill.ts [--apply] [--include-failed]`。
- **成本** —— **每小时 $0.50，每个租户每月 5 小时免费**（账号内共享）。个人研究的常规月用量基本都在免费额度内。设置 `OCI_SPEECH_ENABLED=false` 可干净禁用，无需回滚 schema。
- **工程参考** —— 完整的状态机、轮询器设计、输出解析、错误处理、成本模型与回滚步骤详见 [`webapp/docs/corpus-transcription.md`](./webapp/docs/corpus-transcription.md)。

### v0.6.0 (2026-05-05)

- **Chat over corpus (RAG)** — new `/corpus/chat` page that answers natural-language questions grounded in your ingested artifacts. Uses Cohere chat through OCI Generative AI with the corpus snippets passed as the model's `documents` array, so answers come back with first-class inline citations linking spans of text to specific artifacts and chunks.
- **Inline citation UI** — assistant turns render `[1]`, `[2]` superscript badges spliced into the answer text. Clicking a badge scrolls the matching source card into view; the source card shows the artifact title, kind, distance pill, originating notebook badge, and the exact snippets the model relied on.
- **Per-turn retrieval filters** — kind selector, max-sources slider (1–10), max-distance slider (0.4–1.0), all applied to *future* turns so prior conversation context isn't retroactively perturbed.
- **Optional gating** — controlled by a new `OCI_GENAI_CHAT_MODEL` env var (e.g. `cohere.command-r-plus-08-2024`). Leave it unset and chat is hidden, while the rest of the corpus subsystem keeps working unchanged.
- **New endpoint** — `POST /api/corpus/chat`. `GET /api/corpus/health` now also surfaces a `chat: { enabled, model? }` field so the UI can show/hide the page without a probe round-trip.

---

- **基于语料库的 RAG 对话** —— 新增 `/corpus/chat` 页面，回答关于已入库文档的自然语言问题。底层通过 OCI Generative AI 调用 Cohere chat，将检索到的片段作为模型的 `documents` 一起传入，因此回答里自带原生的内联引用，将文字片段精准映射回具体文档和块。
- **内联引用 UI** —— 模型回答中插入 `[1]`、`[2]` 上标徽标。点击徽标会自动滚动到对应的来源卡片；卡片展示文档标题、类型、距离标签、原始笔记本标识，以及模型实际依据的片段。
- **按轮检索过滤** —— 类型选择器、来源数（1–10）和距离阈值（0.4–1.0）滑块，仅作用于**后续**对话轮次，避免回溯式改变历史上下文。
- **可选启用** —— 由新的 `OCI_GENAI_CHAT_MODEL` 环境变量控制（推荐 `cohere.command-r-plus-08-2024`）；不设置时该页面隐藏，语料库其它功能照常运行。
- **新增端点** —— `POST /api/corpus/chat`。`GET /api/corpus/health` 现在额外返回 `chat: { enabled, model? }` 字段，前端无需额外探测即可决定是否显示。

### v0.5.0 (2026-05-05)

- **Research corpus (optional)** — opt-in personal knowledge base on top of Oracle Autonomous Database 23ai + OCI Object Storage + OCI Generative AI embeddings (`cohere.embed-multilingual-v3.0`, 1024-dim). Fully optional: if the env vars aren't set the webapp runs unchanged.
- **Auto-ingest on download** — every artifact you download through the UI is embedded and indexed in the background; a `✓ Saved to research corpus` badge lands on the row once it's queryable. Dedup via `(notebook_id, artifact_id)` unique index.
- **Three new pages** under a `Research` sidebar group:
  - `/corpus` — semantic kNN search grouped per artifact, distance-scored snippets, kind + max-distance filters, "originating notebook" cross-links.
  - `/corpus/library` — paginated table with kind / origin / title filters, row checkboxes, bulk delete, detail drawer with rename, retag, per-row delete, PAR download, and share-link generator (1 h – 7 d TTL).
  - `/corpus/upload` — drag-and-drop upload for PDF / DOCX / HTML / MD / TXT / CSV / JSON with tag editor.
- **New REST endpoints** — `POST /api/corpus/{ingest,search}`, `GET /api/corpus/artifacts[/:id]`, `PATCH /api/corpus/artifacts/:id`, `DELETE /api/corpus/artifacts/:id`, `POST /api/corpus/artifacts/:id/share`, `GET /api/corpus/health`.
- **OCI plumbing** — node-oracledb 6.x Thin mode with wallet-based mTLS (no Oracle Instant Client required), cross-region GenAI when the home region doesn't host embeddings (e.g. Tokyo → Osaka), storage PAR minting with idempotent `deleteObject`.

---

- **研究语料库（可选）** —— 基于 Oracle Autonomous Database 23ai + OCI Object Storage + OCI Generative AI 向量嵌入（`cohere.embed-multilingual-v3.0`，1024 维）的个人知识库。完全可选：未配置环境变量时 webapp 行为不变。
- **下载自动入库** —— 通过 UI 下载的每个产物都会在后台嵌入并索引；入库完成后行上会显示 `✓ Saved to research corpus` 标记。通过 `(notebook_id, artifact_id)` 唯一索引去重。
- **三个新页面**（侧边栏 `Research` 分组）：
  - `/corpus` —— 按产物聚合的语义 kNN 搜索，带距离分值的片段展示，类型 + 距离阈值过滤，指向原始笔记本的反向链接。
  - `/corpus/library` —— 分页列表，按类型 / 来源 / 标题过滤，行复选框、批量删除，详情抽屉支持重命名、改标签、单条删除、PAR 下载、分享链接（1 小时 – 7 天 TTL）。
  - `/corpus/upload` —— 拖拽上传 PDF / DOCX / HTML / MD / TXT / CSV / JSON，支持标签编辑。
- **新 REST 端点** —— `POST /api/corpus/{ingest,search}`、`GET /api/corpus/artifacts[/:id]`、`PATCH /api/corpus/artifacts/:id`、`DELETE /api/corpus/artifacts/:id`、`POST /api/corpus/artifacts/:id/share`、`GET /api/corpus/health`。
- **OCI 基础设施** —— node-oracledb 6.x Thin 模式 + 钱包 mTLS（无需安装 Oracle Instant Client），当主区域不支持嵌入时自动跨区域调用 GenAI（如 Tokyo → Osaka），幂等的 `deleteObject`，按需生成的 PAR URL。

### v0.4.0 (2026-05-03)

- **Local Web GUI** — Express + React + Tailwind webapp wrapping every CLI command with live SSE progress, one-click artifact downloads, and a bring-your-own-session auth model (`X-NBLM-Session` header). Deployable to Hugging Face Spaces via `Dockerfile.webapp`.
- **`client.downloadArtifact(notebookId, artifactId, outputDir)`** — new unified API that dispatches by artifact type to the right `save*` helper. Re-exported `downloadFileHttp`, `saveReport`, `saveQuizHtml`, `saveSlideDeck`, `saveInfographic`, `saveDataTable` from the package root.
- **Pure-Node download fallback** — `downloadFileHttp` now falls back to `undici` when `curl-impersonate` isn't available (Windows, slim Docker images), with cross-domain cookie rewriting for `*.googleusercontent.com` and the same CDN retry window.
- **npm workspaces** — root `package.json` gains `webapp:dev` / `webapp:build` / `webapp:start` scripts.
- **Compat** — `tlsclientwrapper` bumped to `^1.0.6`; `TlsClientTransport` supports both legacy and current APIs.

---

- **本地 Web GUI** —— Express + React + Tailwind 网页应用，封装每一个 CLI 命令，支持实时 SSE 进度、一键下载已有产物，采用自带 session 的认证模式（`X-NBLM-Session` 请求头）。可通过 `Dockerfile.webapp` 部署到 Hugging Face Spaces。
- **`client.downloadArtifact(notebookId, artifactId, outputDir)`** —— 新的统一下载 API，按产物类型分发到对应的 `save*` 辅助函数。包根部新增导出 `downloadFileHttp`、`saveReport`、`saveQuizHtml`、`saveSlideDeck`、`saveInfographic`、`saveDataTable`。
- **纯 Node 下载兜底** —— `downloadFileHttp` 在 `curl-impersonate` 不可用时（Windows、精简 Docker 镜像）自动回落到 `undici`，处理 `*.googleusercontent.com` 跨域 cookie 改写，保留相同的 CDN 重试窗口。
- **npm workspaces** —— 根 `package.json` 新增 `webapp:dev` / `webapp:build` / `webapp:start` 脚本。
- **兼容性** —— `tlsclientwrapper` 升级到 `^1.0.6`；`TlsClientTransport` 同时支持旧版和新版 API。

### v0.3.0 (2026-03-27)

- All artifact types: report, video, quiz, flashcards, infographic, slides, data table
- Custom instructions/prompts for every artifact type
- Audio format (deep_dive/brief/critique/debate) and length (short/default/long) options
- 7 new CLI commands: `report`, `video`, `quiz`, `flashcards`, `infographic`, `slides`, `data-table`
- Per-type payload builders with correct RPC structures
- Backward compatible `generateArtifact()` API

---

- 全部产物类型：报告、视频、测验、闪卡、信息图、幻灯片、数据表
- 所有产物类型支持自定义指令/提示词
- 音频格式（deep_dive/brief/critique/debate）和时长（short/default/long）选项
- 7 个新 CLI 命令：`report`、`video`、`quiz`、`flashcards`、`infographic`、`slides`、`data-table`
- 按类型独立构建正确的 RPC payload
- `generateArtifact()` API 向后兼容

### v0.2.0 (2026-03-16)

- `--transport auto` mode with automatic best-engine selection
- Auto-installed optimized HTTP engine on `npm install`
- Dynamic studio config: `getStudioConfig()` fetches available types from server
- Account API: `getAccountInfo()` returns plan type, notebook/source limits
- Multi-account support: `--home` flag and `NOTEBOOKLM_HOME` env var
- `diagnose` command for troubleshooting
- Docker support (amd64/arm64)

---

- `--transport auto` 模式，自动选择最佳引擎
- `npm install` 时自动安装优化 HTTP 引擎
- 动态 Studio 配置：`getStudioConfig()` 从服务端获取可用类型
- 账号 API：`getAccountInfo()` 返回计划类型、笔记本/来源限额
- 多账号支持：`--home` 参数和 `NOTEBOOKLM_HOME` 环境变量
- `diagnose` 诊断命令
- Docker 支持（amd64/arm64）

### v0.1.0 (2026-03-16)

- Full NotebookLM API: notebooks, sources, chat, audio generation
- Browser and headless modes
- Session persistence with auto token refresh
- CLI with all core commands

---

- 完整 NotebookLM API：笔记本、来源、对话、音频生成
- 浏览器和无头模式
- Session 持久化 + token 自动刷新
- CLI 包含所有核心命令
