/* ============================================================
   NotebookHub — app shell, router, drawer, modal, theme.
   ============================================================ */
const APP = { view: 'nlm', param: null, crumbs: [], ffFilter: 'all' };

/* ---------- sidebar nav config ---------- */
const NAV_LIB = [
  { id: 'nlm', label: 'NotebookLM', sub: 'Google NotebookLM', icon: 'i-nlm', count: NOTEBOOKS.length, view: 'nlm' },
  { id: 'collections', label: 'Collections', sub: 'Your research', icon: 'i-folder', count: COLLECTIONS.length, view: 'collections' },
];
const NAV_SET = [
  { id: 'session', label: 'Session', icon: 'i-gear', view: 'session' },
  { id: 'diagnose', label: 'Diagnose', icon: 'i-pulse', view: 'diagnose' },
];

function buildSidebar() {
  const lib = NAV_LIB.map((n) => `
    <button class="nav-item" data-nav="${n.id}" onclick="go('${n.view}')">
      <span class="col-ic">${ic(n.icon)}</span>
      <span class="n-label">${n.label}<span class="sub">${n.sub}</span></span>
      <span class="n-count">${n.count}</span>
    </button>`).join('');

  const ff = TYPES.map((t) => {
    const count = ITEMS.filter((it) => it.type === t.key).length;
    return `<button class="nav-item" data-nav="ff-${t.key}" style="--tc:${t.color}" onclick="openFFType('${t.key}')">
      ${ic(t.icon)}<span class="n-label">${t.label}</span>
      ${t.isNew ? '<span class="n-new">New</span>' : `<span class="n-count">${count}</span>`}
    </button>`;
  }).join('');

  const set = NAV_SET.map((n) => `
    <button class="nav-item" data-nav="${n.id}" onclick="go('${n.view}')">${ic(n.icon)}<span class="n-label">${n.label}</span></button>`).join('');

  document.getElementById('side').innerHTML = `
    <div class="side-brand"><span class="mark">${ic('i-book')}</span><b>Notebook<span>Hub</span></b></div>
    <div class="side-scroll">
      <div class="nav-sec nav-lib"><div class="nav-label">Library</div>${lib}</div>
      <div class="nav-sec">
        <div class="nav-label"><button onclick="go('freeforms')" style="all:unset;cursor:pointer;letter-spacing:.15em">Free Forms</button><button class="lab-x" onclick="go('freeforms')" style="all:unset;cursor:pointer;font-family:'JetBrains Mono',monospace;opacity:.8" title="Overview">All ›</button></div>
        ${ff}
      </div>
      <div class="nav-sec"><div class="nav-label">Settings</div>${set}</div>
    </div>
    <div class="side-foot">
      <span class="avatar">MZ</span>
      <div class="who"><b>Mike Zhang</b><small>Local workspace</small></div>
      <button class="ghost-ic" id="themeBtn" onclick="toggleTheme()" title="Toggle theme">${ic('i-moon')}</button>
    </div>`;
}

function setActiveNav(id) {
  document.querySelectorAll('.nav-item[data-nav]').forEach((el) =>
    el.classList.toggle('active', el.getAttribute('data-nav') === id));
}

/* ---------- topbar + main render ---------- */
function topbarHTML() {
  const crumbs = APP.crumbs.map((c, i) => {
    const [view, label] = c;
    const last = i === APP.crumbs.length - 1;
    const sep = i > 0 ? ic('i-chev') : '';
    if (last) return `${sep}<b>${label}</b>`;
    if (view) return `${sep}<a style="cursor:pointer;color:inherit" onclick="go('${view}')">${label}</a>`;
    return `${sep}<span>${label}</span>`;
  }).join('');
  return `<div class="topbar">
    <div class="crumbs">${crumbs}</div>
    <div class="spacer"></div>
    <div class="search">${ic('i-search')}<input placeholder="Search notebooks, collections & free forms…" /></div>
    <button class="icon-btn" title="Refresh" onclick="toast('Refreshed')">${ic('i-refresh')}</button>
  </div>`;
}
function setMain(html) {
  closeModal();
  document.getElementById('main').innerHTML = topbarHTML() + html;
  document.getElementById('main').scrollTop = 0;
}
function setCrumbs(arr) { APP.crumbs = arr; }

/* ---------- router ---------- */
function go(view, param) {
  closeDrawer();
  if (view === 'nlm') { setCrumbs([[null, 'NotebookLM']]); setMain(renderNotebookLM()); setActiveNav('nlm'); }
  else if (view === 'collections') { setCrumbs([[null, 'Collections']]); setMain(renderCollections()); setActiveNav('collections'); }
  else if (view === 'freeforms') { setCrumbs([[null, 'Free Forms']]); setMain(renderFreeFormsOverview()); setActiveNav(''); }
  else if (view === 'session') { setCrumbs([['', 'Settings'], [null, 'Session']]); setMain(renderSettings('session')); setActiveNav('session'); }
  else if (view === 'diagnose') { setCrumbs([['', 'Settings'], [null, 'Diagnose']]); setMain(renderSettings('diagnose')); setActiveNav('diagnose'); }
}
// open* helpers (in views.js) call setMain; ensure their nav highlight:
const _openNotebook = openNotebook;
openNotebook = function (id) { closeDrawer(); _openNotebook(id); setActiveNav('nlm'); };
const _openCollection = openCollection;
openCollection = function (id) { closeDrawer(); _openCollection(id); setActiveNav('collections'); };

/* ---------- theme ---------- */
function toggleTheme() {
  const dark = document.body.getAttribute('data-theme') === 'dark';
  setTheme(dark ? 'light' : 'dark');
  try { localStorage.setItem('nh-theme', dark ? 'light' : 'dark'); } catch (e) {}
}
function setTheme(mode) {
  document.body.setAttribute('data-theme', mode);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.innerHTML = ic(mode === 'dark' ? 'i-sun' : 'i-moon');
}

/* ---------- toast ---------- */
let toastT;
function toast(msg, ok) {
  const el = document.getElementById('toast');
  el.innerHTML = (ok === false ? '' : ic('i-check')) + `<span>${msg}</span>`;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- modal ---------- */
function openModal(html) {
  const root = document.getElementById('modal');
  root.innerHTML = html;
  root.classList.add('show');
  root.onclick = closeModal;
  document.getElementById('scrim').classList.add('show');
}
function closeModal() {
  const root = document.getElementById('modal');
  if (!root.classList.contains('show')) return;
  root.classList.remove('show'); root.innerHTML = '';
  if (!document.getElementById('drawer').classList.contains('open'))
    document.getElementById('scrim').classList.remove('show');
}

/* ---------- create: choose upload vs generate ---------- */
// openCreatePick: pick an artifact type first (no type preselected), then route.
//   mode 'create'  -> show Upload-or-Generate chooser for the chosen type
//   mode 'generate'-> go straight to the generate settings drawer (e.g. Collections)
function openCreatePick(ctx, mode) {
  ctx = ctx || { target: 'standalone' };
  mode = mode || 'create';
  const where = ctx.target === 'collection'
    ? `into “${(COLLECTIONS.find((c) => c.id === ctx.collection) || {}).title}”`
    : 'as a standalone free form';
  const tiles = TYPES.map((t) =>
    `<button class="pick-tile" style="--tc:${t.color}" onclick='afterTypePick("${t.key}", ${JSON.stringify(ctx)}, "${mode}")'>
       <span class="g-ic">${ic(t.icon)}</span><span>${t.label}</span>${t.isNew ? '<span class="n-new" style="font-size:8.5px">New</span>' : ''}
     </button>`).join('');
  openModal(`
    <div class="modal" style="--tc:var(--accent);width:600px" onclick="event.stopPropagation()">
      <div class="modal-pad">
        <div class="modal-tt">
          <div><div class="m-type">${mode === 'generate' ? 'Generate' : 'Create'}</div><h2>What do you want to make?</h2>
          <p class="m-desc">Pick a format — it'll be saved ${where}.</p></div>
          <button class="icon-btn x" onclick="closeModal()">${ic('i-close')}</button>
        </div>
        <div class="pick-grid">${tiles}</div>
      </div>
    </div>`);
}
function afterTypePick(typeKey, ctx, mode) {
  closeModal();
  if (mode === 'generate') openGenerate(typeKey, ctx);
  else openCreate(typeKey, ctx);
}

// openCreate: a type IS known -> offer Upload or Generate.
function openCreate(typeKey, ctx) {
  ctx = ctx || { target: 'standalone' };
  const t = TYPE[typeKey];
  openModal(`
    <div class="modal" style="--tc:${t.color};width:560px" onclick="event.stopPropagation()">
      <div class="modal-pad">
        <div class="modal-tt">
          <div style="display:flex;align-items:center;gap:13px">
            <span class="t-ic" style="--tc:${t.color};width:46px;height:46px;border-radius:12px">${ic(t.icon)}</span>
            <div><div class="m-type">New ${t.label}</div><h2 style="margin-top:2px">Add a ${t.label.toLowerCase()}</h2></div>
          </div>
          <button class="icon-btn x" onclick="closeModal()">${ic('i-close')}</button>
        </div>
        <div class="choose2">
          <button class="choose-card" onclick="closeModal();openUpload('${typeKey}',${JSON.stringify(ctx).replace(/"/g, '&quot;')})">
            <span class="ch-ic">${ic('i-upload')}</span>
            <b>Upload a file</b>
            <small>Bring in an existing ${t.label.toLowerCase()} you already have.</small>
          </button>
          <button class="choose-card primary" onclick="closeModal();openGenerate('${typeKey}',${JSON.stringify(ctx).replace(/"/g, '&quot;')})">
            <span class="ch-ic">${ic('i-spark')}</span>
            <b>Generate with AI</b>
            <small>Create a new ${t.label.toLowerCase()} from your sources.</small>
          </button>
        </div>
      </div>
    </div>`);
}

// openUpload: simple upload drawer for a known type.
function openUpload(typeKey, ctx) {
  ctx = ctx || { target: 'standalone' };
  const t = TYPE[typeKey];
  const accept = { audio: 'mp3 · wav · m4a', video: 'mp4 · mov', report: 'pdf · docx · md', slides: 'pptx · pdf', table: 'csv · xlsx', info: 'png · pdf', quiz: 'json · html', flash: 'csv · json', mind: 'json · opml' }[typeKey] || 'pdf';
  const where = ctx.target === 'collection'
    ? `“${(COLLECTIONS.find((c) => c.id === ctx.collection) || {}).title}”`
    : 'Free Forms (standalone)';
  const drawer = document.getElementById('drawer');
  drawer.style.setProperty('--tc', t.color);
  drawer.innerHTML = `
    <div class="drawer-head">
      <span class="d-ic">${ic('i-upload')}</span>
      <div class="d-tt"><b>Upload ${t.label}</b><small>saved to ${where}</small></div>
      <button class="icon-btn x" onclick="closeDrawer()">${ic('i-close')}</button>
    </div>
    <div class="drawer-body">
      <div class="field"><label>File</label>
        <div class="dropzone" onclick="toast('File picker…')">${ic('i-upload')}<div style="margin-top:6px;font-size:13px">Drop your ${t.label.toLowerCase()} here or click to browse<br><small>${accept}</small></div></div>
      </div>
      <div class="field"><label>Name <span style="color:var(--muted);font-weight:500">(optional)</span></label>
        <input class="input" id="upName" placeholder="e.g. ${t.label} — ${ctx.target === 'collection' ? 'collection import' : 'my upload'}" /></div>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-primary" style="flex:1" onclick="toast('${t.label} uploaded');closeDrawer()">${ic('i-check')}Upload ${t.label}</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancel</button>
    </div>`;
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  document.getElementById('scrim').classList.add('show');
}

/* ---------- generate drawer ---------- */
const SRC_KIND_ICON = { url: 'i-link', text: 'i-doc', file: 'i-report', research: 'i-search' };

function openGenerate(typeKey, ctx) {
  ctx = ctx || { target: 'standalone' };
  const t = TYPE[typeKey];
  const spec = GEN_SPEC[typeKey] || { fields: [], instructions: true, language: true };
  const nb = ctx.notebook ? NOTEBOOKS.find((n) => n.id === ctx.notebook) : null;
  const col = ctx.collection ? COLLECTIONS.find((c) => c.id === ctx.collection) : null;

  const targetLabel = ctx.target === 'notebook'
    ? (nb ? `from “${nb.title}”` : 'from a NotebookLM notebook')
    : ctx.target === 'collection'
      ? `from “${(col || {}).title}”`
      : 'as a standalone free form';

  // ---- segmented option fields (use real <select> for long lists) ----
  const optionFields = spec.fields.map((f) => {
    if (f.opts.length <= 3) {
      return `<div class="field"><label>${f.label}</label>
        <div class="seg" style="grid-template-columns:repeat(${f.opts.length},1fr)" data-opt="${f.key}">
          ${f.opts.map((o, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" onclick="pickOpt(this)">${o}</button>`).join('')}
        </div></div>`;
    }
    return `<div class="field"><label>${f.label}</label><select class="selectbox">${f.opts.map((o) => `<option>${o}</option>`).join('')}</select></div>`;
  }).join('');

  const instructionsField = spec.instructions
    ? `<div class="field"><label>Instructions <span style="color:var(--muted);font-weight:500">(optional)</span></label>
         <textarea class="input" placeholder="Steer tone, focus, what to emphasise…"></textarea></div>`
    : '';
  const languageField = spec.language
    ? `<div class="field"><label>Language</label><select class="selectbox">${LANGS.map((l) => `<option>${l}</option>`).join('')}</select></div>`
    : '';

  // ---- source block ----
  let sourceBlock = '';
  if (ctx.target === 'notebook' && nb) {
    // choose among the notebook's existing sources
    const rows = nb.srcList.map((s, i) => `
      <label class="src-pick">
        <input type="checkbox" checked onchange="updateSrcCount()" />
        <span class="src-ic">${ic(SRC_KIND_ICON[s.kind] || 'i-report')}</span>
        <span class="src-name">${s.name}<small>.${s.ext}</small></span>
        <span class="src-check">${ic('i-check')}</span>
      </label>`).join('');
    sourceBlock = `<div class="field">
        <label style="display:flex;align-items:center;justify-content:space-between">
          <span>Sources <span id="srcCount" style="color:var(--muted);font-weight:600">· ${nb.srcList.length} of ${nb.srcList.length}</span></span>
          <button type="button" class="mini-link" id="srcToggleAll" onclick="toggleAllSrc()">Select none</button>
        </label>
        <div class="src-list" id="srcList">${rows}</div>
        <div class="hint">Choose which of this notebook’s sources to generate from.</div>
      </div>`;
  } else if (ctx.target === 'notebook' && !nb) {
    sourceBlock = `<div class="field"><label>Source notebook</label>
      <select class="selectbox" id="nbPick" onchange="reopenGenForNb('${typeKey}', this.value)">
        <option value="" disabled selected>Choose a notebook…</option>
        ${NOTEBOOKS.map((n) => `<option value="${n.id}">${n.title}</option>`).join('')}
      </select><div class="hint">Pick a notebook to choose its sources.</div></div>`;
  } else if (ctx.target === 'collection' && col) {
    sourceBlock = `<div class="field"><label>Sources</label>
      <div class="src-summary">${ic('i-folder')}<div><b>${col.title}</b><small>${col.items} files in this collection</small></div></div>
      <div class="hint">Generated from the files in this collection.</div></div>`;
  } else {
    // standalone — this is the only place raw input lives now
    sourceBlock = `<div class="field"><label>Source</label>
        <div class="seg" style="grid-template-columns:repeat(4,1fr)" id="srcSeg">
          <button type="button" class="on" onclick="genSrc(this,'url')">URL</button>
          <button type="button" onclick="genSrc(this,'text')">Text</button>
          <button type="button" onclick="genSrc(this,'file')">File</button>
          <button type="button" onclick="genSrc(this,'research')">Research</button>
        </div>
        <div id="srcBody">
          <div data-src="url"><input class="input" style="margin-top:10px" placeholder="https://example.com/article" /></div>
          <div data-src="text" hidden><textarea class="input" style="margin-top:10px" placeholder="Paste text or markdown…"></textarea></div>
          <div data-src="file" hidden><div class="dropzone" style="margin-top:10px" onclick="toast('File picker…')">${ic('i-upload')}<div style="margin-top:6px;font-size:13px">Drop a file or click to upload<br><small>pdf · docx · mp3 · mp4 · csv · pptx</small></div></div></div>
          <div data-src="research" hidden><input class="input" style="margin-top:10px" placeholder="Research topic, e.g. quantum error correction" /></div>
        </div>
        <div class="hint">Where the content comes from.</div>
      </div>`;
  }

  const body = `${sourceBlock}${optionFields}${instructionsField}${languageField}`;

  const drawer = document.getElementById('drawer');
  drawer.style.setProperty('--tc', t.color);
  drawer.innerHTML = `
    <div class="drawer-head">
      <span class="d-ic">${ic(t.icon)}</span>
      <div class="d-tt"><b>Generate ${t.label}</b><small>${targetLabel}</small></div>
      <button class="icon-btn x" onclick="closeDrawer()">${ic('i-close')}</button>
    </div>
    <div class="drawer-body" id="drawerBody">${body}</div>
    <div class="drawer-foot">
      <button class="btn btn-primary" style="flex:1" id="genBtn" onclick="runGenerate('${typeKey}')">${ic('i-spark')}Generate ${t.label}</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancel</button>
    </div>`;
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  document.getElementById('scrim').classList.add('show');
}
function reopenGenForNb(typeKey, nbId) { if (nbId) openGenerate(typeKey, { target: 'notebook', notebook: nbId }); }
function pickOpt(btn) { btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn)); }
function genSrc(btn, kind) {
  btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  document.querySelectorAll('#srcBody [data-src]').forEach((d) => { d.hidden = d.getAttribute('data-src') !== kind; });
}
function updateSrcCount() {
  const boxes = [...document.querySelectorAll('#srcList input[type=checkbox]')];
  const on = boxes.filter((b) => b.checked).length;
  const el = document.getElementById('srcCount');
  if (el) el.textContent = `· ${on} of ${boxes.length}`;
  const tg = document.getElementById('srcToggleAll');
  if (tg) tg.textContent = on === boxes.length ? 'Select none' : 'Select all';
  const btn = document.getElementById('genBtn');
  if (btn) { btn.disabled = on === 0; btn.style.opacity = on === 0 ? '.5' : '1'; }
}
function toggleAllSrc() {
  const boxes = [...document.querySelectorAll('#srcList input[type=checkbox]')];
  const allOn = boxes.every((b) => b.checked);
  boxes.forEach((b) => { b.checked = !allOn; });
  updateSrcCount();
}

/* ---------- manage sources drawer ---------- */
const ADD_SRC = { kind: 'file' };
function openAddSource(nbId) {
  const nb = NOTEBOOKS.find((n) => n.id === nbId);
  ADD_SRC.kind = 'file';
  const drawer = document.getElementById('drawer');
  drawer.style.setProperty('--tc', nb.color);
  drawer.innerHTML = `
    <div class="drawer-head">
      <span class="d-ic">${ic('i-plus')}</span>
      <div class="d-tt"><b>Add a source</b><small>${nb.title}</small></div>
      <button class="icon-btn x" onclick="closeDrawer()">${ic('i-close')}</button>
    </div>
    <div class="drawer-body" id="drawerBody">
      <div class="field">
        <label>Source type</label>
        <div class="seg" style="grid-template-columns:repeat(4,1fr)">
          <button type="button" class="on" onclick="addSrcKind(this,'file')">File</button>
          <button type="button" onclick="addSrcKind(this,'url')">URL</button>
          <button type="button" onclick="addSrcKind(this,'text')">Text</button>
          <button type="button" onclick="addSrcKind(this,'research')">Research</button>
        </div>
        <div id="addSrcBody" style="margin-top:12px"></div>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-primary" style="flex:1" onclick="commitAddSrc('${nbId}')">${ic('i-plus')}Add to notebook</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancel</button>
    </div>`;
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  document.getElementById('scrim').classList.add('show');
  renderAddSrcBody();
}
function addSrcKind(btn, kind) {
  btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  ADD_SRC.kind = kind; renderAddSrcBody();
}
function renderAddSrcBody() {
  const el = document.getElementById('addSrcBody');
  if (!el) return;
  const map = {
    file: `<div class="dropzone" onclick="toast('File picker…')">${ic('i-upload')}<div style="margin-top:6px;font-size:13px">Drop a file or click to upload<br><small>pdf · docx · mp3 · mp4 · csv · pptx</small></div></div>`,
    url: `<input class="input" id="addSrcInput" placeholder="https://example.com/article" />`,
    text: `<textarea class="input" id="addSrcInput" placeholder="Paste text or markdown…"></textarea>`,
    research: `<input class="input" id="addSrcInput" placeholder="Research topic, e.g. quantum error correction" />`,
  };
  el.innerHTML = map[ADD_SRC.kind];
}
function commitAddSrc(nbId) {
  const nb = NOTEBOOKS.find((n) => n.id === nbId);
  const input = document.getElementById('addSrcInput');
  const extMap = { file: 'pdf', url: 'web', text: 'txt', research: 'topic' };
  let name;
  if (ADD_SRC.kind === 'file') name = 'Uploaded document';
  else { name = (input && input.value.trim()) || ''; if (!name) { toast('Enter a source first', false); return; } }
  if (ADD_SRC.kind === 'url') name = name.replace(/^https?:\/\//, '').slice(0, 42);
  if (ADD_SRC.kind === 'text') name = name.slice(0, 42) + (name.length > 42 ? '…' : '');
  nb.srcList.push({ name, kind: ADD_SRC.kind, ext: extMap[ADD_SRC.kind] });
  nb.sources = nb.srcList.length;
  refreshSources(nb);
  closeDrawer();
  toast('Source added');
}
function removeSrc(nbId, idx) {
  const nb = NOTEBOOKS.find((n) => n.id === nbId);
  nb.srcList.splice(idx, 1);
  nb.sources = nb.srcList.length;
  refreshSources(nb);
  toast('Source removed');
}
function refreshSources(nb) {
  // re-render the sources table body (if the Sources tab is showing)
  const body = document.getElementById('srtBody');
  if (body) body.innerHTML = srcTableRows(nb);
  // header counts
  const c = document.getElementById('nbSrcCount'); if (c) c.textContent = nb.srcList.length;
  const tabX = document.querySelector('.tabbar .tab.on .tab-x'); if (tabX && APP.nbTab === 'sources') tabX.textContent = nb.srcList.length;
  rowChecked(nb.id);
}
/* table selection + filtering */
function toggleAllRows(nbId, on) {
  document.querySelectorAll('#srtBody .srt-row input[type=checkbox]').forEach((b) => { b.checked = on; });
  rowChecked(nbId);
}
function rowChecked(nbId) {
  const boxes = [...document.querySelectorAll('#srtBody .srt-row input[type=checkbox]')];
  const sel = boxes.filter((b) => b.checked).length;
  const bulk = document.getElementById('srcBulk');
  const del = document.getElementById('srcBulkDel');
  if (bulk) bulk.textContent = sel ? `${sel} selected` : '';
  if (del) del.style.display = sel ? '' : 'none';
}
function bulkRemoveSrc(nbId) {
  const nb = NOTEBOOKS.find((n) => n.id === nbId);
  const idxs = [...document.querySelectorAll('#srtBody .srt-row')]
    .filter((r) => r.querySelector('input[type=checkbox]').checked)
    .map((r) => +r.getAttribute('data-idx'))
    .sort((a, b) => b - a);
  idxs.forEach((i) => nb.srcList.splice(i, 1));
  nb.sources = nb.srcList.length;
  const head = document.querySelector('.srt-head input[type=checkbox]'); if (head) head.checked = false;
  refreshSources(nb);
  toast(`${idxs.length} source${idxs.length > 1 ? 's' : ''} removed`);
}
function filterSrcTable(q) {
  q = (q || '').toLowerCase();
  document.querySelectorAll('#srtBody .srt-row').forEach((r) => {
    r.style.display = r.getAttribute('data-name').includes(q) ? '' : 'none';
  });
}
/* ---------- notebook chat ---------- */
const CHAT_REPLIES = [
  'Based on the attached sources, the headline is a steady margin expansion driven by higher-value segments. The earnings call transcript and the 10-Q both point to operating leverage rather than one-off gains.',
  'Two risks stand out across the sources: concentration in a single revenue line, and FX exposure noted in the filing. The analyst note frames both as manageable over the next two quarters.',
  'The sources broadly agree on direction but differ on magnitude — the press release is more optimistic on guidance than the independent analyst note, which applies a wider confidence band.',
];
let chatTurn = 0;
function nbChatAsk(nbId, q) { const i = document.getElementById('chatInput'); if (i) i.value = q; nbChatSend(nbId); }
function nbChatSend(nbId) {
  const nb = NOTEBOOKS.find((n) => n.id === nbId);
  const input = document.getElementById('chatInput');
  const q = (input.value || '').trim(); if (!q) return;
  const thread = document.getElementById('chatThread');
  const empty = thread.querySelector('.chat-empty'); if (empty) empty.remove();
  thread.insertAdjacentHTML('beforeend', `<div class="msg user"><div class="bubble">${q}</div></div>`);
  input.value = '';
  const cites = nb.srcList.slice(0, 3).map((s) =>
    `<span class="cite" title="${s.name}">${ic(SRC_KIND_ICON[s.kind] || 'i-report')}${s.name.length > 26 ? s.name.slice(0, 24) + '…' : s.name}</span>`).join('');
  const typing = `<div class="msg bot" id="typingMsg"><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
  thread.insertAdjacentHTML('beforeend', typing);
  thread.scrollTop = thread.scrollHeight;
  setTimeout(() => {
    const t = document.getElementById('typingMsg'); if (t) t.remove();
    const reply = CHAT_REPLIES[chatTurn % CHAT_REPLIES.length]; chatTurn++;
    thread.insertAdjacentHTML('beforeend',
      `<div class="msg bot"><div class="bubble">${reply}<div class="cites">${cites}</div></div></div>`);
    thread.scrollTop = thread.scrollHeight;
  }, 900);
}
function closeDrawer() {
  const d = document.getElementById('drawer');
  if (!d.classList.contains('open')) return;
  d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
  if (!document.getElementById('modal').classList.contains('show'))
    document.getElementById('scrim').classList.remove('show');
}

const DL_EXT = { audio: ['mp3'], report: ['md', 'pdf'], video: ['mp4'], quiz: ['html'], flash: ['html'], info: ['png'], slides: ['pptx', 'pdf'], table: ['csv'], mind: ['mind', 'png'] };
function runGenerate(typeKey) {
  const t = TYPE[typeKey];
  const btn = document.getElementById('genBtn');
  btn.innerHTML = `<span class="spinner"></span>Generating…`; btn.disabled = true; btn.style.opacity = '.8';
  const body = document.getElementById('drawerBody');
  body.insertAdjacentHTML('afterbegin', `<div class="proglog" id="plog" style="margin-bottom:18px"></div>`);
  const log = document.getElementById('plog');
  const steps = [
    ['info', 'queued', 'Request sent; streaming progress…'],
    ['prog', 'fetch', 'Fetching source material…'],
    ['prog', 'extract', 'Extracting & chunking content…'],
    ['prog', 'generate', `Generating ${t.label.toLowerCase()}…`],
    ['prog', 'render', 'Rendering output…'],
    ['done', 'done', 'Completed.'],
  ];
  let i = 0;
  const tick = () => {
    if (i >= steps.length) return finishGenerate(typeKey);
    const [kind, stat, msg] = steps[i];
    const tk = new Date().toLocaleTimeString('en-GB');
    log.insertAdjacentHTML('beforeend', `<div class="ln ${kind}"><span class="tk">${tk}</span><span class="stat">[${stat}]</span><span class="msg">${msg}</span></div>`);
    log.scrollTop = log.scrollHeight;
    i++; setTimeout(tick, 520 + Math.random() * 260);
  };
  tick();
}
function finishGenerate(typeKey) {
  const t = TYPE[typeKey];
  const btn = document.getElementById('genBtn');
  btn.innerHTML = `${ic('i-check')}Generate again`; btn.disabled = false; btn.style.opacity = '1';
  const dls = (DL_EXT[typeKey] || ['out']).map((ext) =>
    `<div class="dl-row" style="--tc:${t.color};margin-bottom:8px">${ic('i-download')}<span style="flex:1">${t.label.toLowerCase().replace(/\s/g, '-')}.${ext}</span><button class="act" onclick="toast('Saved to library')">${ic('i-plus')}Save to library</button></div>`).join('');
  document.getElementById('drawerBody').insertAdjacentHTML('afterbegin',
    `<div class="result" style="--tc:${t.color};margin-bottom:18px"><h4>${ic('i-check')} Output ready</h4>${dls}</div>`);
  toast(`${t.label} generated`);
}

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });

/* ---------- boot ---------- */
(function boot() {
  try { const s = localStorage.getItem('nh-theme'); if (s) setTheme(s); } catch (e) {}
  buildSidebar();
  go('nlm');
})();
