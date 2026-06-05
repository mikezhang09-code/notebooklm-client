/* ============================================================
   NotebookHub — shared data for the prototype.
   Plain global script (no modules) — loaded before views/app.
   ============================================================ */

// Output / artifact types. Mindmap is the new one (Free Forms only-ish).
const TYPES = [
  { key: 'audio',  label: 'Audio',       plural: 'Audio',        icon: 'i-audio',  color: '#c15a37', generate: true },
  { key: 'report', label: 'Report',      plural: 'Reports',      icon: 'i-report', color: '#4a76a8', generate: true },
  { key: 'video',  label: 'Video',       plural: 'Videos',       icon: 'i-video',  color: '#8a6aa8', generate: true },
  { key: 'quiz',   label: 'Quiz',        plural: 'Quizzes',      icon: 'i-quiz',   color: '#b9892a', generate: true },
  { key: 'flash',  label: 'Flashcards',  plural: 'Flashcards',   icon: 'i-flash',  color: '#5f8a5a', generate: true },
  { key: 'info',   label: 'Infographic', plural: 'Infographics', icon: 'i-info',   color: '#c1503f', generate: true },
  { key: 'slides', label: 'Slides',      plural: 'Slides',       icon: 'i-slides', color: '#467b86', generate: true },
  { key: 'table',  label: 'Data table',  plural: 'Data tables',  icon: 'i-table',  color: '#8a7c4a', generate: true },
  { key: 'mind',   label: 'Mindmap',     plural: 'Mindmaps',     icon: 'i-mind',   color: '#5b6bbf', generate: true, isNew: true },
];
const TYPE = Object.fromEntries(TYPES.map((t) => [t.key, t]));

// Sources of provenance.
const SOURCES = {
  notebooklm: { label: 'NotebookLM', icon: 'i-nlm',    color: '#4a76a8' },
  personal:   { label: 'Collections', icon: 'i-folder', color: '#c15a37' },
  standalone: { label: 'Free form',  icon: 'i-spark',  color: '#8a7c4a' },
};

// ---- NotebookLM notebooks ----
// srcList: the sources attached to each notebook (used by generate + manage sources)
const NOTEBOOKS = [
  { id: 'a7f3c1', title: 'Tencent Q2 Earnings Call', cat: 'Finance',     sources: 5, kinds: ['audio', 'report', 'table'], color: '#c15a37',
    srcList: [
      { name: 'Q2 2026 earnings press release', kind: 'file', ext: 'pdf' },
      { name: 'Earnings call transcript', kind: 'url', ext: 'web' },
      { name: 'Investor presentation deck', kind: 'file', ext: 'pdf' },
      { name: '10-Q filing — segment detail', kind: 'file', ext: 'pdf' },
      { name: 'Analyst note — segment revenue', kind: 'text', ext: 'txt' },
    ] },
  { id: 'b1d9e4', title: 'Quantum Computing, from First Principles', cat: 'Science', sources: 3, kinds: ['video', 'flash', 'quiz'], color: '#8a6aa8',
    srcList: [
      { name: 'Nielsen & Chuang — Chapter 1', kind: 'file', ext: 'pdf' },
      { name: '“Quantum supremacy” — Nature', kind: 'url', ext: 'web' },
      { name: 'Lecture notes — MIT 8.370', kind: 'file', ext: 'pdf' },
    ] },
  { id: 'c8a200', title: 'Climate Policy 2030 — Briefing Pack', cat: 'Policy', sources: 8, kinds: ['report', 'slides', 'info'], color: '#5f8a5a',
    srcList: [
      { name: 'IPCC AR6 — Summary for Policymakers', kind: 'file', ext: 'pdf' },
      { name: 'IEA World Energy Outlook 2025', kind: 'file', ext: 'pdf' },
      { name: 'EU Green Deal — progress review', kind: 'url', ext: 'web' },
      { name: 'National pledges (NDC) tracker', kind: 'url', ext: 'web' },
      { name: 'Carbon pricing mechanisms — note', kind: 'text', ext: 'txt' },
      { name: 'Renewables cost curves 2010–25', kind: 'file', ext: 'csv' },
      { name: 'Adaptation finance gap report', kind: 'file', ext: 'pdf' },
      { name: 'Methane action — research topic', kind: 'research', ext: 'topic' },
    ] },
  { id: 'd4e7b9', title: 'Designing Data-Intensive Apps · Ch. 1–4', cat: 'Engineering', sources: 4, kinds: ['flash', 'quiz', 'audio'], color: '#4a76a8',
    srcList: [
      { name: 'DDIA — Ch.1 Reliable, Scalable…', kind: 'file', ext: 'pdf' },
      { name: 'DDIA — Ch.2 Data Models', kind: 'file', ext: 'pdf' },
      { name: 'DDIA — Ch.3 Storage & Retrieval', kind: 'file', ext: 'pdf' },
      { name: 'DDIA — Ch.4 Encoding & Evolution', kind: 'file', ext: 'pdf' },
    ] },
  { id: 'e2c5f8', title: '广告 AI 增长策略 2026', cat: 'Strategy', sources: 6, kinds: ['report', 'audio', 'info'], color: '#b9892a',
    srcList: [
      { name: '2026 广告业务规划', kind: 'file', ext: 'docx' },
      { name: 'AI 推荐系统技术白皮书', kind: 'file', ext: 'pdf' },
      { name: '竞品分析 — 抖音 vs 视频号', kind: 'url', ext: 'web' },
      { name: '季度投放 ROI 数据', kind: 'file', ext: 'xlsx' },
      { name: '用户增长复盘纪要', kind: 'text', ext: 'txt' },
      { name: '生成式创意趋势', kind: 'research', ext: 'topic' },
    ] },
  { id: 'f9b614', title: 'Renaissance Art & the Economics of Patronage', cat: 'History', sources: 7, kinds: ['video', 'slides', 'report'], color: '#467b86',
    srcList: [
      { name: 'Burckhardt — Civilization of the Renaissance', kind: 'file', ext: 'pdf' },
      { name: 'Medici bank ledgers (translated)', kind: 'file', ext: 'pdf' },
      { name: 'Vasari — Lives of the Artists (excerpt)', kind: 'text', ext: 'txt' },
      { name: 'Met Museum — patronage essay', kind: 'url', ext: 'web' },
      { name: 'Guild commission records', kind: 'file', ext: 'csv' },
      { name: 'Florence wealth distribution 1427', kind: 'file', ext: 'pdf' },
      { name: 'Fresco cost accounting — notes', kind: 'text', ext: 'txt' },
    ] },
];

// ---- Personal Collections ----
const COLLECTIONS = [
  { id: 'col-kyoto', title: 'Field Research — Kyoto 2025', cat: 'Field notes', items: 14, color: '#c15a37',
    breakdown: { report: 4, audio: 3, video: 2, table: 2, mind: 1, slides: 2 }, updated: '2 days ago' },
  { id: 'col-teardown', title: 'Q3 Competitive Teardown', cat: 'Strategy', items: 21, color: '#4a76a8',
    breakdown: { report: 8, slides: 5, table: 4, info: 4 }, updated: '5 hours ago' },
  { id: 'col-phd', title: 'PhD — Reading List & Notes', cat: 'Academic', items: 38, color: '#8a6aa8',
    breakdown: { report: 18, flash: 9, quiz: 6, mind: 5 }, updated: 'Yesterday' },
  { id: 'col-interviews', title: 'Product Discovery Interviews', cat: 'Research', items: 17, color: '#5f8a5a',
    breakdown: { audio: 9, report: 5, table: 3 }, updated: 'Last week' },
  { id: 'col-ferment', title: 'Cooking & Fermentation Log', cat: 'Personal', items: 9, color: '#b9892a',
    breakdown: { report: 3, video: 2, info: 2, table: 2 }, updated: '3 weeks ago' },
];

// ---- Files inside a single collection (used by collection detail) ----
const COLLECTION_FILES = {
  'col-kyoto': [
    { name: 'Nishijin weaving — interview transcript', type: 'report', file: 'docx', size: '48 KB', date: 'Mar 14' },
    { name: 'Temple soundscape — Fushimi Inari', type: 'audio', file: 'mp3', size: '12.4 MB', date: 'Mar 14' },
    { name: 'Machiya architecture survey', type: 'slides', file: 'pptx', size: '6.1 MB', date: 'Mar 13' },
    { name: 'Artisan census 1990–2025', type: 'table', file: 'xlsx', size: '88 KB', date: 'Mar 12' },
    { name: 'Walking tour — Higashiyama', type: 'video', file: 'mp4', size: '210 MB', date: 'Mar 11' },
    { name: 'Craft lineage mindmap', type: 'mind', file: 'mind', size: '34 KB', date: 'Mar 11' },
    { name: 'Indigo dyeing notes', type: 'report', file: 'pdf', size: '1.2 MB', date: 'Mar 10' },
  ],
};

// ---- Free-form items (aggregated across all sources) ----
const ITEMS = [
  { id: 'it01', title: 'Tencent Q2 — Deep Dive', type: 'audio', source: 'notebooklm', from: 'Tencent Q2 Earnings Call', date: 'Jun 4', meta: '18 min · EN' },
  { id: 'it02', title: 'Temple soundscape — Fushimi Inari', type: 'audio', source: 'personal', from: 'Kyoto 2025', date: 'Mar 14', meta: '12.4 MB · field' },
  { id: 'it03', title: 'On attention & transformers', type: 'audio', source: 'standalone', from: null, date: 'May 28', meta: '9 min · EN' },
  { id: 'it04', title: 'Discovery call — Acme Corp', type: 'audio', source: 'personal', from: 'Discovery Interviews', date: 'May 20', meta: '41 min' },

  { id: 'it05', title: 'Climate Policy 2030 — Briefing', type: 'report', source: 'notebooklm', from: 'Climate Policy 2030', date: 'Jun 2', meta: 'Briefing doc' },
  { id: 'it06', title: 'Competitive teardown — summary', type: 'report', source: 'personal', from: 'Q3 Teardown', date: 'Jun 1', meta: 'Study guide' },
  { id: 'it07', title: '广告 AI 增长策略 — 摘要', type: 'report', source: 'notebooklm', from: '广告 AI 增长策略', date: 'May 30', meta: 'Briefing · ZH' },

  { id: 'it08', title: 'Renaissance patronage — explainer', type: 'video', source: 'notebooklm', from: 'Renaissance Art', date: 'May 27', meta: 'Cinematic · 4 min' },
  { id: 'it09', title: 'Higashiyama walking tour', type: 'video', source: 'personal', from: 'Kyoto 2025', date: 'Mar 11', meta: '210 MB' },

  { id: 'it10', title: 'Quantum basics — 12 questions', type: 'quiz', source: 'notebooklm', from: 'Quantum Computing', date: 'May 24', meta: 'Medium' },
  { id: 'it11', title: 'Spaced-repetition deck — DDIA', type: 'flash', source: 'notebooklm', from: 'Designing Data-Intensive Apps', date: 'May 22', meta: '48 cards' },
  { id: 'it12', title: 'PhD reading — key terms', type: 'flash', source: 'personal', from: 'PhD Reading List', date: 'May 18', meta: '120 cards' },

  { id: 'it13', title: 'Climate levers — bento grid', type: 'info', source: 'notebooklm', from: 'Climate Policy 2030', date: 'May 16', meta: 'Bento · landscape' },
  { id: 'it14', title: 'Market map — Q3', type: 'info', source: 'personal', from: 'Q3 Teardown', date: 'May 15', meta: 'Professional' },

  { id: 'it15', title: 'Renaissance — presenter deck', type: 'slides', source: 'notebooklm', from: 'Renaissance Art', date: 'May 12', meta: '22 slides' },
  { id: 'it16', title: 'Teardown readout', type: 'slides', source: 'personal', from: 'Q3 Teardown', date: 'May 11', meta: '14 slides' },

  { id: 'it17', title: 'Artisan census 1990–2025', type: 'table', source: 'personal', from: 'Kyoto 2025', date: 'May 9', meta: 'CSV · 6 cols' },
  { id: 'it18', title: 'Earnings — segment revenue', type: 'table', source: 'notebooklm', from: 'Tencent Q2', date: 'May 8', meta: 'CSV · 9 cols' },

  { id: 'it19', title: 'Craft lineage mindmap', type: 'mind', source: 'personal', from: 'Kyoto 2025', date: 'May 6', meta: '32 nodes' },
  { id: 'it20', title: 'Thesis argument map', type: 'mind', source: 'standalone', from: null, date: 'May 2', meta: '18 nodes' },
  { id: 'it21', title: 'DDIA — systems overview', type: 'mind', source: 'notebooklm', from: 'Designing Data-Intensive Apps', date: 'Apr 30', meta: '27 nodes' },
];

// language options for the generate form
const LANGS = ['English', 'Chinese', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Portuguese'];

// Per-type artifact options, in display order, exactly per the spec table.
const OPTS = {
  audioFormat:  ['Deep dive', 'Brief', 'Critique', 'Debate'],
  videoFormat:  ['Explainer', 'Brief', 'Cinematic'],
  slidesFormat: ['Detailed', 'Presenter'],
  length:       ['Short', 'Default', 'Long'],
  template:     ['Briefing doc', 'Study guide', 'Blog post', 'Custom'],
  videoStyle:   ['Auto', 'Classic', 'Whiteboard', 'Anime', 'Watercolor'],
  infoStyle:    ['Sketch note', 'Professional', 'Bento grid'],
  orientation:  ['Landscape', 'Portrait', 'Square'],
  detail:       ['Concise', 'Standard', 'Detailed'],
  quantity:     ['Fewer', 'Standard'],
  difficulty:   ['Easy', 'Medium', 'Hard'],
  mindDepth:    ['Overview', 'Standard', 'Exhaustive'],
  mindLayout:   ['Radial', 'Tree', 'Org'],
};
const GEN_SPEC = {
  audio:  { fields: [{ key: 'format', label: 'Format', opts: OPTS.audioFormat }, { key: 'length', label: 'Length', opts: OPTS.length }], instructions: true, language: true },
  report: { fields: [{ key: 'template', label: 'Template', opts: OPTS.template }], instructions: true, language: true },
  video:  { fields: [{ key: 'format', label: 'Format', opts: OPTS.videoFormat }, { key: 'style', label: 'Style', opts: OPTS.videoStyle }], instructions: true, language: true },
  quiz:   { fields: [{ key: 'quantity', label: 'Quantity', opts: OPTS.quantity }, { key: 'difficulty', label: 'Difficulty', opts: OPTS.difficulty }], instructions: true, language: false },
  flash:  { fields: [{ key: 'quantity', label: 'Quantity', opts: OPTS.quantity }, { key: 'difficulty', label: 'Difficulty', opts: OPTS.difficulty }], instructions: true, language: false },
  info:   { fields: [{ key: 'orientation', label: 'Orientation', opts: OPTS.orientation }, { key: 'detail', label: 'Detail', opts: OPTS.detail }, { key: 'style', label: 'Style', opts: OPTS.infoStyle }], instructions: true, language: true },
  slides: { fields: [{ key: 'format', label: 'Format', opts: OPTS.slidesFormat }, { key: 'length', label: 'Length', opts: OPTS.length }], instructions: true, language: true },
  table:  { fields: [], instructions: true, language: true },
  mind:   { fields: [{ key: 'depth', label: 'Depth', opts: OPTS.mindDepth }, { key: 'layout', label: 'Layout', opts: OPTS.mindLayout }], instructions: true, language: true },
};
