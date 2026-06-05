/* ============================================================
   NotebookHub — view renderers. Plain global functions.
   ============================================================ */
const ic = (id, cls) => `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="#${id}"/></svg>`;

function kindChips(kinds) {
  return `<div class="kinds nb-kinds">${kinds.map((k) =>
    `<span class="kind" style="--tc:${TYPE[k].color}" title="${TYPE[k].label}">${ic(TYPE[k].icon)}</span>`).join('')}</div>`;
}

function provBadge(source, fromName) {
  const s = SOURCES[source];
  const tail = fromName ? ` · ${fromName}` : '';
  return `<span class="prov p-${source}">${ic(s.icon)}${s.label}${tail}</span>`;
}

/* ---------- NotebookLM ---------- */
function renderNotebookLM() {
  const cards = NOTEBOOKS.map((nb) => `
    <article class="nb" style="--tc:${nb.color}" onclick="openNotebook('${nb.id}')">
      <div class="nb-body">
        <div class="nb-top"><span class="nb-id">#${nb.id}</span>${kindChips(nb.kinds)}</div>
        <h3>${nb.title}</h3>
        <p class="nb-meta"><span>${nb.sources} sources</span><span class="dot"></span><span>${nb.kinds.length} artifacts</span></p>
        <div class="nb-foot">
          <button class="act open" onclick="event.stopPropagation();openNotebook('${nb.id}')">${ic('i-nlm')}Open</button>
          <button class="act" onclick="event.stopPropagation();toast('Opening chat…')">${ic('i-chat')}Chat</button>
          <button class="act" onclick="event.stopPropagation();toast('Opening in Google NotebookLM ↗')">${ic('i-ext')}</button>
          <button class="act del" onclick="event.stopPropagation();toast('Notebook deleted')">${ic('i-trash')}</button>
        </div>
      </div>
    </article>`).join('');

  return `
    <div class="content">
      <div class="view-head">
        <div class="view-eyebrow"><span class="pip" style="background:#4a76a8"></span>Library · NotebookLM</div>
        <div class="head-row">
          <div>
            <div class="view-title"><h1>NotebookLM</h1></div>
            <p class="view-sub">Everything linked to your Google NotebookLM. Open a notebook to read, chat, or generate new artifacts from its sources.</p>
          </div>
          <button class="btn btn-primary" onclick="toast('New notebook…')">${ic('i-plus')}New notebook</button>
        </div>
      </div>

      <div class="head-row" style="margin-bottom:14px">
        <h2 style="font-size:18px;margin:0;font-weight:700;letter-spacing:-.01em">Your notebooks <span style="color:var(--muted);font-weight:600">· ${NOTEBOOKS.length}</span></h2>
        <div class="chips">
          <button class="chip on">All</button>
          ${[...new Set(NOTEBOOKS.map((n) => n.cat))].map((c) => `<button class="chip">${c}</button>`).join('')}
        </div>
      </div>
      <div class="grid">
        ${cards}
        <button class="new-tile" onclick="toast('New notebook…')"><span class="plus">${ic('i-plus')}</span><b>New notebook</b><small>from URL, file, or a research topic</small></button>
      </div>
    </div>`;
}

/* ---------- Notebook detail (tabbed) ---------- */
const SRC_KIND_ICON_V = { url: 'i-link', text: 'i-doc', file: 'i-report', research: 'i-search' };

function openNotebook(id) {
  const nb = NOTEBOOKS.find((n) => n.id === id);
  APP.view = 'notebook'; APP.param = id;
  if (!APP.nbTab) APP.nbTab = 'artifacts';
  setCrumbs([['nlm', 'NotebookLM'], [null, nb.title]]);
  setMain(`
    <div class="content">
      <div class="view-head" style="margin-bottom:0">
        <div class="view-eyebrow"><span class="pip" style="background:${nb.color}"></span>${nb.cat} · #${nb.id}</div>
        <div class="head-row">
          <div><div class="view-title"><h1 class="ser" style="font-weight:600">${nb.title}</h1></div>
          <p class="view-sub"><span id="nbSrcCount">${nb.srcList.length}</span> sources · ${nb.kinds.length} artifacts. Linked to Google NotebookLM.</p></div>
        </div>
      </div>
      <div class="tabbar" style="--tc:${nb.color}">
        ${nbTabBtn('artifacts', 'i-spark', 'Artifacts', nb.kinds.length)}
        ${nbTabBtn('sources', 'i-layers', 'Sources', nb.srcList.length)}
        ${nbTabBtn('chat', 'i-chat', 'Chat')}
      </div>
      <div id="nbTabBody">${nbTabBody(nb)}</div>
    </div>`);
}
function nbTabBtn(tab, icon, label, count) {
  const on = (APP.nbTab || 'artifacts') === tab;
  return `<button class="tab ${on ? 'on' : ''}" onclick="setNbTab('${tab}')">${ic(icon)}<span>${label}</span>${count != null ? `<span class="tab-x">${count}</span>` : ''}</button>`;
}
function setNbTab(tab) {
  APP.nbTab = tab;
  const nb = NOTEBOOKS.find((n) => n.id === APP.param);
  document.querySelectorAll('.tabbar .tab').forEach((b) => b.classList.toggle('on', b.getAttribute('onclick').includes(`'${tab}'`)));
  document.getElementById('nbTabBody').innerHTML = nbTabBody(nb);
}
function nbTabBody(nb) {
  if (APP.nbTab === 'sources') return nbSourcesTab(nb);
  if (APP.nbTab === 'chat') return nbChatTab(nb);
  return nbArtifactsTab(nb);
}

/* --- Artifacts tab --- */
function nbArtifactsTab(nb) {
  const genTypes = TYPES.filter((t) => t.generate && t.key !== 'mind');
  const tiles = genTypes.map((t) =>
    `<button class="gen-tile" style="--tc:${t.color}" onclick="openGenerate('${t.key}',{target:'notebook',notebook:'${nb.id}'})">
       <span class="g-ic">${ic(t.icon)}</span><span>${t.label}</span></button>`).join('');
  const made = ITEMS.filter((it) => it.source === 'notebooklm');
  const arts = nb.kinds.map((k) => {
    const sample = made.find((m) => m.type === k) || { title: `${TYPE[k].label} overview`, meta: '' };
    return `<div class="item" style="--tc:${TYPE[k].color}" onclick="toast('Opening artifact…')">
      <div class="item-top"><span class="t-ic">${ic(TYPE[k].icon)}</span></div>
      <h4>${sample.title}</h4><div class="i-meta">${TYPE[k].label}${sample.meta ? ' · ' + sample.meta : ''}</div></div>`;
  }).join('');
  return `
    <h2 class="sec-h" style="margin:0 0 14px">Artifacts <span style="color:var(--muted);font-weight:600">· ${nb.kinds.length}</span></h2>
    <div class="item-grid">${arts}</div>
    <div class="launcher" style="margin:26px 0 0">
      <div class="launcher-head"><span class="l-ic">${ic('i-spark')}</span><div><b>Generate a new artifact</b> &nbsp;<small>choose sources & options in the next step</small></div></div>
      <div class="gen-strip">${tiles}</div>
    </div>`;
}

/* --- Sources tab (managed table) --- */
function nbSourcesTab(nb) {
  return `
    <div class="src-toolbar">
      <div class="search" style="width:300px"><svg aria-hidden="true"><use href="#i-search"/></svg><input placeholder="Search sources…" oninput="filterSrcTable(this.value)" /></div>
      <span class="src-tool-count" id="srcBulk"></span>
      <div style="flex:1"></div>
      <button class="btn btn-soft" id="srcBulkDel" style="display:none" onclick="bulkRemoveSrc('${nb.id}')">${ic('i-trash')}Remove selected</button>
      <button class="btn btn-primary" onclick="openAddSource('${nb.id}')">${ic('i-plus')}Add source</button>
    </div>
    <div class="src-table" style="--tc:${nb.color}">
      <div class="srt-head">
        <span class="srt-check"><label class="cbox"><input type="checkbox" onchange="toggleAllRows('${nb.id}',this.checked)"><span>${ic('i-check')}</span></label></span>
        <span>Source</span><span>Type</span><span>Format</span><span>Added</span><span></span>
      </div>
      <div id="srtBody">${srcTableRows(nb)}</div>
    </div>`;
}
function srcTableRows(nb) {
  if (!nb.srcList.length) return `<div class="empty" style="padding:40px">${ic('i-layers')}<p style="margin:8px 0 0">No sources yet — add one to start generating.</p></div>`;
  const dates = ['Today', 'Yesterday', '2 days ago', 'Last week', 'Mar 14', 'Mar 12', 'Feb 28', 'Feb 20'];
  return nb.srcList.map((s, i) => `
    <div class="srt-row" data-idx="${i}" data-name="${s.name.toLowerCase()}">
      <span class="srt-check"><label class="cbox"><input type="checkbox" onchange="rowChecked('${nb.id}')"><span>${ic('i-check')}</span></label></span>
      <div class="srt-name"><span class="src-ic">${ic(SRC_KIND_ICON_V[s.kind] || 'i-report')}</span><span class="srt-nm">${s.name}</span></div>
      <span><span class="kind-badge kind-${s.kind}">${s.kind}</span></span>
      <span class="srt-mono">.${s.ext}</span>
      <span class="srt-date">${dates[i % dates.length]}</span>
      <span class="srt-act"><button class="src-del" title="Open" onclick="toast('Opening source…')">${ic('i-ext')}</button><button class="src-del" title="Remove" onclick="removeSrc('${nb.id}',${i})">${ic('i-trash')}</button></span>
    </div>`).join('');
}

/* --- Chat tab --- */
function nbChatTab(nb) {
  const suggestions = [
    'Summarise the key takeaways',
    'What are the main risks?',
    'Compare the sources on this topic',
  ];
  return `
    <div class="chat-wrap">
      <div class="chat-thread" id="chatThread">
        <div class="chat-empty">
          <div class="chat-orb" style="--tc:${nb.color}">${ic('i-chat')}</div>
          <h3>Chat with this notebook</h3>
          <p>Ask anything — answers are grounded in this notebook’s ${nb.srcList.length} sources, with citations.</p>
          <div class="chat-sugs">${suggestions.map((q) => `<button class="chip" onclick="nbChatAsk('${nb.id}', this.textContent)">${q}</button>`).join('')}</div>
        </div>
      </div>
      <div class="chat-input">
        <input id="chatInput" placeholder="Ask a question about this notebook…" onkeydown="if(event.key==='Enter')nbChatSend('${nb.id}')" />
        <button class="btn btn-primary" onclick="nbChatSend('${nb.id}')">${ic('i-chev')}</button>
      </div>
      <p class="chat-foot">Grounded in ${nb.srcList.length} sources · responses cite their origin</p>
    </div>`;
}

/* ---------- Collections ---------- */
function renderCollections() {
  const cards = COLLECTIONS.map((c) => {
    const mini = Object.entries(c.breakdown).map(([k, n]) =>
      `<span class="mk" style="--mk:${TYPE[k].color}" title="${n} ${TYPE[k].label}">${ic(TYPE[k].icon)}<span class="ct">${n}</span></span>`).join('');
    return `
    <article class="col-card" style="--tc:${c.color}" onclick="openCollection('${c.id}')">
      <div class="col-cover"><div class="pat"></div><div class="fic">${ic('i-folder')}</div></div>
      <div class="col-body">
        <div class="nb-cat">${c.cat}</div>
        <h3>${c.title}</h3>
        <div class="col-mini">${mini}</div>
        <div class="col-foot"><span>${c.items} items</span><span class="upd">${ic('i-clock')}${c.updated}</span></div>
      </div>
    </article>`;
  }).join('');
  return `
    <div class="content">
      <div class="view-head">
        <div class="view-eyebrow"><span class="pip" style="background:var(--accent)"></span>Library · Collections</div>
        <div class="head-row">
          <div><div class="view-title"><h1>Collections</h1></div>
          <p class="view-sub">Your own research, organized your way. Upload files — audio, video, documents, slides, spreadsheets — into collections, then turn them into any free form.</p></div>
          <button class="btn btn-primary" onclick="toast('New collection…')">${ic('i-plus')}New collection</button>
        </div>
      </div>
      <div class="grid">
        ${cards}
        <button class="new-tile" onclick="toast('New collection…')"><span class="plus">${ic('i-plus')}</span><b>New collection</b><small>group your uploads & research</small></button>
      </div>
    </div>`;
}

function openCollection(id) {
  const c = COLLECTIONS.find((x) => x.id === id);
  APP.view = 'collection'; APP.param = id;
  setCrumbs([['collections', 'Collections'], [null, c.title]]);
  let files = COLLECTION_FILES[id];
  if (!files) {
    files = [];
    Object.entries(c.breakdown).forEach(([k, n]) => {
      for (let i = 0; i < Math.min(n, 2); i++)
        files.push({ name: `${TYPE[k].label} — item ${i + 1}`, type: k, file: ({ audio: 'mp3', video: 'mp4', report: 'pdf', slides: 'pptx', table: 'xlsx', mind: 'mind' }[k] || 'pdf'), size: '—', date: 'recent' });
    });
  }
  const rows = files.map((f) => `
    <div class="file-row" style="--tc:${TYPE[f.type].color}" onclick="toast('Opening file…')">
      <span class="f-ic">${ic(TYPE[f.type].icon)}</span>
      <div><div class="f-name">${f.name}</div><div class="f-sub">${TYPE[f.type].label} · .${f.file}</div></div>
      <div class="f-col"><b>${f.size}</b></div>
      <div class="f-col">${f.date}</div>
      <div class="f-col"><span class="prov p-personal" style="font-size:10px;padding:3px 7px">${SOURCES.personal.label}</span></div>
      <button class="icon-btn" style="width:34px;height:34px;border:0;background:transparent" onclick="event.stopPropagation();toast('More…')">${ic('i-more')}</button>
    </div>`).join('');
  setMain(`
    <div class="content">
      <div class="view-head">
        <div class="view-eyebrow"><span class="pip" style="background:${c.color}"></span>${c.cat}</div>
        <div class="head-row">
          <div><div class="view-title"><h1 class="ser" style="font-weight:600">${c.title}</h1></div>
          <p class="view-sub">${c.items} items · updated ${c.updated}. All files here belong to this collection — generate any free form from them.</p></div>
          <div class="chips">
            <button class="btn btn-soft" onclick="toast('Choose files to upload…')">${ic('i-upload')}Upload</button>
            <button class="btn btn-primary" onclick="openCreatePick({target:'collection',collection:'${id}'},'generate')">${ic('i-spark')}Generate</button>
          </div>
        </div>
      </div>
      <div class="files">${rows}</div>
    </div>`);
}

/* ---------- Free Forms overview (grouped by type) ---------- */
function renderFreeFormsOverview() {
  const secs = TYPES.map((t) => {
    const items = ITEMS.filter((it) => it.type === t.key);
    if (!items.length) return '';
    const cards = items.slice(0, 4).map(itemCard).join('');
    return `<div class="ff-section" style="--tc:${t.color}">
      <div class="ff-sec-head">
        <span class="s-ic">${ic(t.icon)}</span>
        <h2>${t.label}${t.isNew ? ' <span class="n-new" style="vertical-align:middle">New</span>' : ''}</h2>
        <span class="s-count">${items.length}</span>
        <button class="chip s-all" onclick="openFFType('${t.key}')">See all ${ic('i-chev')}</button>
      </div>
      <div class="item-grid">${cards}</div>
    </div>`;
  }).join('');
  return `
    <div class="content">
      <div class="view-head">
        <div class="view-eyebrow"><span class="pip" style="background:var(--accent)"></span>Free Forms</div>
        <div class="head-row">
          <div><div class="view-title"><h1>Free Forms</h1></div>
          <p class="view-sub">Every output you've made, gathered by format — pulled from NotebookLM, your Collections, or created on their own. Each one shows where it came from.</p></div>
          <button class="btn btn-primary" onclick="openCreatePick({target:'standalone'})">${ic('i-plus')}New free form</button>
        </div>
      </div>
      ${secs}
    </div>`;
}

function itemCard(it) {
  const t = TYPE[it.type];
  return `<article class="item" style="--tc:${t.color}" onclick="openItem('${it.id}')">
    <div class="item-top"><span class="t-ic">${ic(t.icon)}</span>${provBadge(it.source)}</div>
    <h4>${it.title}</h4>
    <div class="i-meta">${it.date} · ${it.meta}</div>
  </article>`;
}

/* ---------- Free Forms — single type hub ---------- */
function openFFType(typeKey) {
  APP.view = 'fftype'; APP.param = typeKey; APP.ffFilter = 'all';
  const t = TYPE[typeKey];
  setCrumbs([['freeforms', 'Free Forms'], [null, t.label]]);
  renderFFType();
  setActiveNav('ff-' + typeKey);
}
function setFFFilter(src) { APP.ffFilter = src; renderFFType(); }
function renderFFType() {
  const t = TYPE[APP.param];
  const all = ITEMS.filter((it) => it.type === APP.param);
  const counts = { all: all.length, notebooklm: 0, personal: 0, standalone: 0 };
  all.forEach((it) => counts[it.source]++);
  const shown = APP.ffFilter === 'all' ? all : all.filter((it) => it.source === APP.ffFilter);
  const chip = (key, label, color) =>
    `<button class="chip ${APP.ffFilter === key ? 'on' : ''}" onclick="setFFFilter('${key}')">${color ? `<span class="c-dot" style="background:${color}"></span>` : ''}${label}<span class="c-x">${counts[key]}</span></button>`;
  const body = shown.length ? ffTableRows(shown)
    : `<div class="empty" style="padding:46px">${ic('i-layers')}<p>No ${t.label.toLowerCase()} from this source yet.</p></div>`;
  setMain(`
    <div class="content">
      <div class="view-head">
        <div class="view-eyebrow"><span class="pip" style="background:${t.color}"></span>Free Forms · ${t.label}</div>
        <div class="head-row">
          <div><div class="view-title">
            <span class="t-ic" style="--tc:${t.color};width:42px;height:42px;border-radius:11px">${ic(t.icon)}</span>
            <h1>${t.plural}</h1>${t.isNew ? '<span class="n-new" style="font-size:10px">New</span>' : ''}
          </div>
          <p class="view-sub">All ${t.plural.toLowerCase()} across your workspace — filter by where they came from.</p></div>
          <button class="btn btn-primary" onclick="openCreate('${t.key}',{target:'standalone'})">${ic('i-plus')}New ${t.label.toLowerCase()}</button>
        </div>
        <div class="chips" style="margin-top:18px">
          ${chip('all', 'All sources')}
          ${chip('notebooklm', 'NotebookLM', SOURCES.notebooklm.color)}
          ${chip('personal', 'Collections', SOURCES.personal.color)}
          ${chip('standalone', 'Free form', SOURCES.standalone.color)}
        </div>
      </div>
      <div class="ff-table" style="--tc:${t.color}">
        <div class="fft-head">
          <span>Name</span><span>Source</span><span>From</span><span>Details</span><span>Created</span><span></span>
        </div>
        <div id="fftBody">${body}</div>
      </div>
    </div>`);
}

function ffTableRows(items) {
  return items.map((it) => {
    const t = TYPE[it.type];
    const s = SOURCES[it.source];
    const from = it.source === 'standalone' ? '<span style="color:var(--muted)">—</span>' : it.from;
    return `<div class="fft-row" onclick="openItem('${it.id}')">
      <div class="fft-name"><span class="t-ic" style="--tc:${t.color};width:34px;height:34px">${ic(t.icon)}</span><span class="fft-nm">${it.title}</span></div>
      <span><span class="prov p-${it.source}" style="font-size:10.5px;padding:3px 8px 3px 6px">${ic(s.icon)}${s.label}</span></span>
      <span class="fft-from">${from}</span>
      <span class="fft-mono">${it.meta}</span>
      <span class="fft-date">${it.date}</span>
      <span class="fft-act">
        <button class="src-del" title="Open" onclick="event.stopPropagation();openItem('${it.id}')">${ic('i-ext')}</button>
        <button class="src-del" title="Download" onclick="event.stopPropagation();toast('Downloaded')">${ic('i-download')}</button>
        <button class="src-del" title="Delete" onclick="event.stopPropagation();toast('Deleted')">${ic('i-trash')}</button>
      </span>
    </div>`;
  }).join('');
}

/* ---------- Item detail modal ---------- */
function openItem(id) {
  const it = ITEMS.find((x) => x.id === id);
  const t = TYPE[it.type];
  const cover = it.type === 'mind' ? mindPreviewSVG(t.color) : `<div class="big">${ic(t.icon)}</div>`;
  const fromLabel = it.source === 'standalone' ? '—' : it.from;
  openModal(`
    <div class="modal" style="--tc:${t.color}" onclick="event.stopPropagation()">
      <div class="modal-cover"><div class="pat"></div>${cover}
        <button class="icon-btn x" onclick="closeModal()">${ic('i-close')}</button></div>
      <div class="modal-body">
        <div class="m-type">${t.label}${t.isNew ? ' · New' : ''}</div>
        <h2>${it.title}</h2>
        <div style="margin-top:14px">${provBadge(it.source, it.from)}</div>
        <dl class="kv">
          <dt>Format</dt><dd>${t.label}</dd>
          <dt>Source</dt><dd>${SOURCES[it.source].label}</dd>
          <dt>From</dt><dd>${fromLabel}</dd>
          <dt>Created</dt><dd>${it.date}, 2026</dd>
          <dt>Details</dt><dd>${it.meta}</dd>
        </dl>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" onclick="toast('Opening preview…')">${ic('i-ext')}Open</button>
        <button class="btn btn-soft" onclick="toast('Downloaded')">${ic('i-download')}Download</button>
        <button class="btn btn-soft" onclick="toast('Share link copied')">${ic('i-share')}Share</button>
        <button class="btn btn-ghost" style="margin-left:auto" onclick="toast('Deleted');closeModal()">${ic('i-trash')}Delete</button>
      </div>
    </div>`);
}

function mindPreviewSVG(color) {
  return `<svg class="mind-prev" viewBox="0 0 200 120" style="max-width:280px" aria-hidden="true">
    <g fill="none" stroke="${color}" stroke-width="1.4" opacity="0.55">
      <path d="M100 60 L52 30 M100 60 L150 28 M100 60 L48 92 M100 60 L154 90 M100 60 L40 60 M52 30 L24 18 M150 28 L176 16"/>
    </g>
    <g fill="${color}">
      <circle cx="100" cy="60" r="9"/><circle cx="52" cy="30" r="6"/><circle cx="150" cy="28" r="6"/>
      <circle cx="48" cy="92" r="6"/><circle cx="154" cy="90" r="6"/><circle cx="40" cy="60" r="5"/>
      <circle cx="24" cy="18" r="4"/><circle cx="176" cy="16" r="4"/>
    </g></svg>`;
}

/* ---------- Settings ---------- */
function renderSettings(which) {
  if (which === 'diagnose') {
    const checks = [
      ['Google NotebookLM', 'Session valid · cookies present', 'i-nlm'],
      ['Local storage', '34 artifacts · 1.8 GB cached', 'i-layers'],
      ['Embeddings (OCI GenAI)', 'multilingual-e5 · 1024d', 'i-spark'],
      ['Vector DB (Oracle ADB)', 'VECTOR(1024) · 12,418 chunks', 'i-table'],
    ];
    return `<div class="content"><div class="view-head">
      <div class="view-eyebrow"><span class="pip" style="background:#5f8a5a"></span>Settings · Diagnose</div>
      <div class="view-title"><h1>Diagnose</h1></div>
      <p class="view-sub">A quick health check of every subsystem NotebookHub depends on.</p></div>
      <div class="set-card"><h3>System status</h3><p class="s-d">All systems operational.</p>
        ${checks.map(([n, d, i]) => `<div class="set-row"><span class="s-ic">${ic(i)}</span><div class="s-main"><b>${n}</b><small>${d}</small></div><span class="health-pill ok"><span class="hd"></span>OK</span></div>`).join('')}
      </div></div>`;
  }
  return `<div class="content"><div class="view-head">
    <div class="view-eyebrow"><span class="pip" style="background:var(--accent)"></span>Settings · Session</div>
    <div class="view-title"><h1>Session</h1></div>
    <p class="view-sub">Your local session and connection to Google NotebookLM.</p></div>
    <div class="set-card"><h3>Account</h3><p class="s-d">Signed in locally — nothing leaves this machine except calls to your configured providers.</p>
      <div class="set-row"><span class="s-ic">${ic('i-nlm')}</span><div class="s-main"><b>Google NotebookLM</b><small>Connected · session refreshed 2h ago</small></div><span class="health-pill ok"><span class="hd"></span>Linked</span></div>
      <div class="set-row"><span class="s-ic">${ic('i-gear')}</span><div class="s-main"><b>Workspace</b><small>Mike Zhang · local</small></div><button class="btn btn-soft">Manage</button></div>
    </div>
    <div class="set-card"><h3>Appearance</h3><p class="s-d">Switch between light and dark — your choice is remembered.</p>
      <div class="set-row"><span class="s-ic">${ic('i-moon')}</span><div class="s-main"><b>Theme</b><small>Toggle anytime from the sidebar</small></div><button class="btn btn-soft" onclick="toggleTheme()">${ic('i-sun')}Toggle theme</button></div>
    </div>
    <div class="set-card"><h3 style="color:var(--accent)">Sign out</h3><p class="s-d">Clear the saved session from this browser.</p>
      <button class="btn btn-soft" onclick="toast('Session cleared')">Sign out (clear session)</button></div>
  </div>`;
}
