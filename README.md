# notebooklm-client

[English](#english) | [中文](#中文)

---

<a id="english"></a>

Standalone CLI, library, **and local Web GUI** for Google's [NotebookLM](https://notebooklm.google.com/) — generate audio podcasts, reports, slides, quizzes, videos, infographics, data tables, flashcards, analyze content, manage notebooks, and chat.

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
- Session verify / refresh / download, diagnose page

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
- **Audio generation fails** → Check account limits with `getAccountInfo()`
- **Connection timeout (China)** → Use `--proxy socks5://127.0.0.1:7890` or set `HTTPS_PROXY` env var
- **Audio download returns login page** → Re-run `npx notebooklm export-session` to refresh cookies

## License

MIT

---

<a id="中文"></a>

# notebooklm-client（中文文档）

Google [NotebookLM](https://notebooklm.google.com/) 的独立 CLI、编程库 **和本地 Web GUI** —— 生成音频播客、报告、幻灯片、测验、视频、信息图、数据表、闪卡，分析内容、管理笔记本、对话。

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
- Session 验证 / 刷新 / 下载，诊断页面

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
- **音频生成失败** → 通过 `getAccountInfo()` 检查账号限额
- **连接超时（中国用户）** → 使用 `--proxy socks5://127.0.0.1:7890` 或设置 `HTTPS_PROXY` 环境变量
- **下载音频拿到登录页** → 重新运行 `npx notebooklm export-session` 刷新 cookies

## 许可证

MIT

---

## Changelog / 更新日志

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
