/* ============================================================
   Originals Project Manager — Gachafruit Studio (v2)

   One permanent file per project entry:
     /data/originals/projects/<id>.json
   One permanent image folder per project:
     /assets/images/originals/projects/<id>/NN.ext
   A small manifest ties it together:
     /data/originals/projects-index.json   (authoritative for current/archive)

   Publishing paths:
     - File System Access API  → write straight into the repo folder
     - ZIP fallback            → repository-ready archive, extract at root

   Depends on: originals-repo-fs.js (window.RepoFS), JSZip (CDN).
   Self-contained IIFE.
   ============================================================ */

(function () {
  'use strict';

  // ---- Config ----------------------------------------------
  var DRAFT_KEY        = 'gachafruit_originals_project_draft';
  var LEGACY_DRAFT_KEY = 'gachafruit_originals_draft';           // old combined manager

  var REPO_INDEX_PATH   = 'data/originals/projects-index.json';
  var REPO_PROJECT_DIR  = 'data/originals/projects/';
  var REPO_IMG_DIR      = 'assets/images/originals/projects/';
  var REPO_LEGACY_PATH  = 'data/originals-content.json';
  var HTTP_BASE         = '../';                                 // admin/ -> repo root
  var PUBLIC_IMG_BASE   = '/assets/images/originals/projects/';

  // ---- State ----------------------------------------------
  var state = {
    index:   { schema: 2, updatedAt: null, current: null, projects: [] },
    editing: null,
  };

  var $ = function (id) { return document.getElementById(id); };

  // ===========================================================
  // Utilities
  // ===========================================================
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function nowISO() { return new Date().toISOString(); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function slugify(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/['"’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-').filter(Boolean).slice(0, 6).join('-');
  }

  var MONTHS = ['january','february','march','april','may','june','july',
                'august','september','october','november','december'];

  // Best-effort YYYY-MM-DD from a free-text display date.
  function computeSortDate(dateStr) {
    var s = String(dateStr || '').trim();
    if (s) {
      var d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

      var m = s.toLowerCase().match(/([a-z]+)\s+(\d{4})/);
      if (m && MONTHS.indexOf(m[1]) !== -1) {
        return m[2] + '-' + pad2(MONTHS.indexOf(m[1]) + 1) + '-01';
      }
      var y = s.match(/^(\d{4})$/);
      if (y) return y[1] + '-01-01';
    }
    return nowISO().slice(0, 10);
  }

  function makeProjectId(title, dateStr, takenIds) {
    var ym   = computeSortDate(dateStr).slice(0, 7); // YYYY-MM
    var base = ym + '-' + (slugify(title) || 'untitled-entry');
    var id   = base, n = 2;
    while (takenIds.indexOf(id) !== -1) { id = base + '-' + n; n++; }
    return id;
  }

  function takenIds(exceptId) {
    return state.index.projects
      .map(function (p) { return p.id; })
      .filter(function (id) { return id !== exceptId; });
  }

  // ===========================================================
  // Project object factories / cleaning
  // ===========================================================
  function blankProject() {
    return {
      id: makeProjectId('', '', takenIds()),
      title: '', subtitle: '', date: '', sortDate: computeSortDate(''),
      body: '', images: [],
      status: 'draft',
      createdAt: null, updatedAt: null, publishedAt: null, archivedAt: null,
      schema: 2,
      _persisted: false, _dirty: false,
    };
  }

  function hydrateProject(raw) {
    var p = Object.assign(blankProject(), raw);
    p.images = (Array.isArray(raw.images) ? raw.images : []).map(function (img) {
      if (typeof img === 'string') img = { src: img };
      // migrate legacy image shape
      var src = img.src;
      if (!src) {
        if (img.imageMode === 'remote' && img.remoteImage) src = img.remoteImage;
        else if (img.localImage) src = '/' + String(img.localImage).replace(/^\/+/, '');
      }
      return { src: src || '', alt: img.alt || '', _file: null, _preview: null, _new: false };
    });
    p._persisted = true;
    p._dirty = false;
    delete p.__fromIndexCurrent;
    return p;
  }

  function cleanProject(p) {
    return {
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      date: p.date,
      sortDate: p.sortDate,
      body: p.body,
      images: p.images
        .filter(function (i) { return i.src; })
        .map(function (i) { return { src: i.src, alt: i.alt || '' }; }),
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      publishedAt: p.publishedAt,
      archivedAt: p.archivedAt,
      schema: 2,
    };
  }

  // Absolute src for a project image (for index thumbnails / previews).
  function imageAbsSrc(projectId, img) {
    if (!img || !img.src) return '';
    var s = img.src;
    if (/^https?:\/\//i.test(s) || s.charAt(0) === '/') return s;
    return PUBLIC_IMG_BASE + projectId + '/' + s.replace(/^\/+/, '');
  }

  function firstImageAbs(p) {
    return p.images && p.images.length ? imageAbsSrc(p.id, p.images[0]) : '';
  }

  function nextImgNum(p) {
    var max = 0;
    p.images.forEach(function (img) {
      var m = String(img.src || '').match(/(\d+)\.[a-z0-9]+$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return max + 1;
  }

  // ===========================================================
  // Repo read (handle when connected, HTTP when merely served)
  // ===========================================================
  async function readRepoJSON(path) {
    if (window.RepoFS && RepoFS.isConnected()) {
      try {
        var t = await RepoFS.readText(path);
        return t ? JSON.parse(t) : null;
      } catch (_) { return null; }
    }
    try {
      var r = await fetch(HTTP_BASE + path, { cache: 'no-cache' });
      return r.ok ? await r.json() : null;
    } catch (_) { return null; }
  }

  // ===========================================================
  // Load index + associated projects
  // ===========================================================
  async function loadIndex() {
    var idx = await readRepoJSON(REPO_INDEX_PATH);
    if (idx && Array.isArray(idx.projects)) {
      state.index = Object.assign({ schema: 2, current: null, projects: [] }, idx);
    } else {
      state.index = { schema: 2, updatedAt: null, current: null, projects: [] };
    }
  }

  async function loadProjectFile(id) {
    var raw = await readRepoJSON(REPO_PROJECT_DIR + id + '.json');
    if (raw) return hydrateProject(raw);
    // fall back to the thin index entry
    var ref = state.index.projects.find(function (p) { return p.id === id; });
    return ref ? hydrateProject(ref) : null;
  }

  // ===========================================================
  // Repo bar (File System Access UI)
  // ===========================================================
  function initRepoBar() {
    var bar = $('repoBar');
    var connectBtn    = $('repoConnectBtn');
    var reconnectBtn  = $('repoReconnectBtn');
    var disconnectBtn = $('repoDisconnectBtn');

    if (!window.RepoFS || !RepoFS.supported) {
      $('repoStatusText').textContent = 'Direct publishing not supported in this browser';
      $('repoHint').innerHTML =
        'This browser has no File System Access API. Use <strong>Export Repository ZIP</strong> ' +
        'and extract it at the repository root. (Chrome, Edge and other Chromium browsers support direct publishing.)';
      connectBtn.disabled = true;
      return;
    }

    function paint(info) {
      bar.classList.toggle('is-connected', info.connected);
      bar.classList.toggle('needs-attention', !info.connected && !!info.needsPermission);
      connectBtn.style.display    = info.connected ? 'none' : (info.needsPermission ? 'none' : '');
      reconnectBtn.style.display  = (!info.connected && info.needsPermission) ? '' : 'none';
      disconnectBtn.style.display = info.connected ? '' : 'none';
      $('reloadRepoBtn').style.display = info.connected ? '' : 'none';

      if (info.connected) {
        $('repoStatusText').textContent = 'Connected — publishing writes directly to the repo';
        $('repoPath').textContent = info.name ? '(' + info.name + '/)' : '';
        $('repoHint').textContent =
          'Save / Publish / Archive write files straight into this folder. Commit them with git afterwards.';
      } else if (info.needsPermission) {
        $('repoStatusText').textContent = 'Repository folder remembered — permission needed';
        $('repoPath').textContent = '';
        $('repoHint').textContent = 'Click Reconnect to re-grant write access to the folder you used before.';
      } else {
        $('repoStatusText').textContent = 'Repository folder not connected';
        $('repoPath').textContent = '';
        $('repoHint').innerHTML =
          'Connect the local Gachafruit repository folder to publish files directly. ' +
          'Without it, use <strong>Export Repository ZIP</strong> and extract at the repo root.';
      }
    }

    RepoFS.onChange(paint);

    connectBtn.addEventListener('click', async function () {
      try {
        await RepoFS.connect();
        showStatus('Repository folder connected.', 'success');
        await refreshFromRepo();
      } catch (err) {
        showStatus(err.message || 'Could not connect folder.', 'error');
      }
    });

    reconnectBtn.addEventListener('click', async function () {
      try {
        await RepoFS.reconnect();
        showStatus('Repository folder reconnected.', 'success');
        await refreshFromRepo();
      } catch (err) {
        showStatus(err.message || 'Could not reconnect folder.', 'error');
      }
    });

    disconnectBtn.addEventListener('click', async function () {
      await RepoFS.disconnect();
      showStatus('Repository folder disconnected.', 'info');
    });

    $('reloadRepoBtn').addEventListener('click', refreshFromRepo);

    // Try silent restore of a previously-authorised folder.
    RepoFS.restore().then(function (res) {
      paint(RepoFS.status().connected ? RepoFS.status() : { connected: false, needsPermission: res.needsPermission });
      if (res.connected) refreshFromRepo();
    });

    paint(RepoFS.status());
  }

  async function refreshFromRepo() {
    var keepId = state.editing && state.editing._persisted ? state.editing.id : null;
    await loadIndex();
    renderSidebar();
    if (keepId && state.index.projects.some(function (p) { return p.id === keepId; })) {
      await openProject(keepId);
    } else if (!state.editing || !state.editing._dirty) {
      await openInitial();
    }
    showStatus('Loaded ' + state.index.projects.length + ' project(s) from repository.', 'info');
  }

  // ===========================================================
  // Sidebar
  // ===========================================================
  function statusBadge(status) {
    var map = {
      current:  ['published', 'Current'],
      archived: ['archived',  'Archived'],
      draft:    ['draft',     'Draft'],
    };
    var m = map[status] || map.draft;
    return '<span class="state-badge state-badge--' + m[0] + '">' + m[1] + '</span>';
  }

  function renderSidebar() {
    var list = $('pmProjectList');
    var entries = state.index.projects.slice().sort(function (a, b) {
      return String(b.sortDate || '').localeCompare(String(a.sortDate || ''));
    });

    $('pmProjectCount').textContent = entries.length ? entries.length + '' : '';

    if (!entries.length) {
      list.innerHTML = '<div class="pm-sidebar__empty">No projects yet. Create one, or import a legacy file.</div>';
      return;
    }

    list.innerHTML = '';
    entries.forEach(function (e) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pm-project';
      if (state.editing && state.editing.id === e.id && state.editing._persisted) {
        btn.classList.add('is-active');
      }
      var isCurrent = state.index.current === e.id;
      btn.innerHTML =
        '<span class="pm-project__title">' + esc(e.title || 'Untitled') + '</span>' +
        '<span class="pm-project__meta">' +
          statusBadge(isCurrent ? 'current' : e.status) +
          '<span>' + esc(e.date || e.sortDate || '') + '</span>' +
        '</span>' +
        '<span class="pm-project__id">' + esc(e.id) + '</span>';
      btn.addEventListener('click', function () {
        if (state.editing && state.editing._dirty &&
            !confirm('Discard unsaved changes to the open project?')) return;
        openProject(e.id);
      });
      list.appendChild(btn);
    });
  }

  // ===========================================================
  // Editor
  // ===========================================================
  function renderEditor() {
    var wrap = $('projectEditor');
    var p = state.editing;
    if (!p) { wrap.innerHTML = ''; return; }

    var idLine = p._persisted
      ? '<span class="pm-identity__id">ID: <strong>' + esc(p.id) + '</strong> · permanent</span>'
      : '<span class="pm-identity__id">ID: <strong>' + esc(p.id) + '</strong> · assigned on first save</span>';

    var localState = p._persisted
      ? (state.index.current === p.id ? 'published'
         : (p.status === 'archived' ? 'archived' : 'saved'))
      : 'draft';
    var stateLabels = {
      draft:     ['draft',     'Local draft'],
      saved:     ['saved',     'Saved to repository'],
      published: ['published', 'Published / current'],
      archived:  ['archived',  'Archived'],
    };
    var sl = stateLabels[localState];
    var badge = '<span class="state-badge state-badge--' + sl[0] + '">' + sl[1] +
      (p._dirty ? ' • unsaved edits' : '') + '</span>';

    wrap.innerHTML =
      '<div class="pm-identity">' + idLine + badge + '</div>' +

      '<div class="project-editor__body">' +

        '<div class="project-editor__row">' +
          '<div class="form-group">' +
            '<label class="form-label" for="pTitle">Title</label>' +
            '<input type="text" id="pTitle" placeholder="e.g., Fuel Pump Rebuild" value="' + esc(p.title) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="pSubtitle">Subtitle / Status <span class="form-label-optional">optional</span></label>' +
            '<input type="text" id="pSubtitle" placeholder="e.g., In Progress" value="' + esc(p.subtitle) + '">' +
          '</div>' +
        '</div>' +

        '<div class="form-group" style="max-width:220px;">' +
          '<label class="form-label" for="pDate">Display date <span class="form-label-optional">optional</span></label>' +
          '<input type="text" id="pDate" placeholder="e.g., August 2026" value="' + esc(p.date) + '">' +
        '</div>' +

        '<div class="form-group">' +
          '<label class="form-label" for="pBody">Body text</label>' +
          '<textarea id="pBody" rows="8" placeholder="Materials, process, inspiration. Blank line between paragraphs.">' + esc(p.body) + '</textarea>' +
        '</div>' +

        '<div class="form-group">' +
          '<div class="form-label">Images <span class="form-label-optional">stored in this project’s permanent folder</span></div>' +
          '<div class="gallery-editor">' +
            '<div class="gallery-editor__header">' +
              '<span>' + esc(PUBLIC_IMG_BASE + p.id + '/') + '</span>' +
              '<button class="btn btn-secondary btn-sm" id="pAddImg" type="button"><span class="btn-icon">+</span> Add image</button>' +
            '</div>' +
            '<div class="gallery-editor__list" id="pGalleryList"></div>' +
          '</div>' +
        '</div>' +

      '</div>' +

      '<div class="publish-row" id="pPublishRow"></div>';

    renderGallery();
    renderPublishRow();
    bindEditor();
  }

  function renderGallery() {
    var list = $('pGalleryList');
    var p = state.editing;
    if (!list) return;
    if (!p.images.length) {
      list.innerHTML = '<div class="gallery-empty">No images yet — click "Add image".</div>';
      return;
    }
    list.innerHTML = '';
    p.images.forEach(function (img, i) {
      var src = img._preview || imageAbsSrc(p.id, img);
      var thumb = src
        ? '<img class="gallery-item__thumb" src="' + esc(src) + '" alt="">'
        : '<div class="gallery-item__thumb"></div>';
      var name = /^https?:/i.test(img.src) ? 'Remote image'
               : (img.src ? img.src.split('/').pop() : 'No file');
      var flag = img._new
               ? ' <em style="color:var(--info-text);">new — will be written</em>'
               : (img.src && img.src.charAt(0) === '/'
                   ? ' <em style="color:var(--muted-light);">existing path</em>'
                   : '');
      var div = document.createElement('div');
      div.className = 'gallery-item';
      div.innerHTML =
        thumb +
        '<div class="gallery-item__info">' +
          '<div class="gallery-item__name">' + esc(name) + flag + '</div>' +
          '<input class="gallery-item__alt" type="text" placeholder="Alt text (optional)" value="' + esc(img.alt || '') + '">' +
        '</div>' +
        '<div class="gallery-item__controls">' +
          '<button class="move-btn" data-act="up"     title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="move-btn" data-act="down"   title="Move down"' + (i === p.images.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="move-btn" data-act="remove" title="Remove">×</button>' +
        '</div>';

      div.querySelector('.gallery-item__alt').addEventListener('input', function (e) {
        img.alt = e.target.value; markDirty();
      });
      div.querySelectorAll('.move-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.dataset.act, arr = p.images, idx = arr.indexOf(img);
          if (act === 'up' && idx > 0)   { arr[idx] = arr[idx - 1]; arr[idx - 1] = img; }
          else if (act === 'down' && idx < arr.length - 1) { arr[idx] = arr[idx + 1]; arr[idx + 1] = img; }
          else if (act === 'remove') { arr.splice(idx, 1); }
          markDirty(); renderGallery();
        });
      });
      list.appendChild(div);
    });
  }

  function renderPublishRow() {
    var row = $('pPublishRow');
    var p = state.editing;
    var isCurrent = p._persisted && state.index.current === p.id;

    var buttons = [];
    buttons.push('<button class="btn btn-secondary" id="pSaveBtn">Save to Repository</button>');
    if (!isCurrent) {
      buttons.push('<button class="btn btn-primary" id="pPublishBtn">' +
        (p.status === 'archived' ? 'Restore as Current' : 'Publish as Current') + '</button>');
    }
    buttons.push('<span class="publish-row__spacer"></span>');
    if (p._persisted && p.status !== 'archived') {
      buttons.push('<button class="btn btn-secondary" id="pArchiveBtn">Archive</button>');
    }
    if (p._persisted) {
      buttons.push('<button class="btn btn-secondary btn-danger-hover" id="pDeleteBtn">Delete</button>');
    }
    row.innerHTML = buttons.join('');

    if ($('pSaveBtn'))    $('pSaveBtn').addEventListener('click', function () { saveProject('save'); });
    if ($('pPublishBtn')) $('pPublishBtn').addEventListener('click', function () { saveProject('publish'); });
    if ($('pArchiveBtn')) $('pArchiveBtn').addEventListener('click', function () { saveProject('archive'); });
    if ($('pDeleteBtn'))  $('pDeleteBtn').addEventListener('click', deleteProject);
  }

  function bindEditor() {
    ['pTitle', 'pSubtitle', 'pDate', 'pBody'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { syncFromDOM(); });
    });
    if ($('pAddImg')) $('pAddImg').addEventListener('click', pickImages);
  }

  function syncFromDOM() {
    var p = state.editing;
    if (!p) return;
    if ($('pTitle'))    p.title    = $('pTitle').value;
    if ($('pSubtitle')) p.subtitle = $('pSubtitle').value.trim();
    if ($('pDate'))     p.date     = $('pDate').value.trim();
    if ($('pBody'))     p.body     = $('pBody').value;
    p.sortDate = computeSortDate(p.date);

    if (!p._persisted) {
      // identity stays fluid until first save
      var newId = makeProjectId(p.title, p.date, takenIds());
      if (newId !== p.id) {
        p.id = newId;
        var idEl = $('projectEditor').querySelector('.pm-identity__id strong');
        if (idEl) idEl.textContent = p.id;
        var hdr = $('projectEditor').querySelector('.gallery-editor__header span');
        if (hdr) hdr.textContent = PUBLIC_IMG_BASE + p.id + '/';
      }
    }
    markDirty();
  }

  function markDirty() {
    if (state.editing) state.editing._dirty = true;
    saveDraft();
    var b = $('projectEditor') && $('projectEditor').querySelector('.pm-identity .state-badge');
    if (b && b.textContent.indexOf('unsaved') === -1) b.textContent += ' • unsaved edits';
  }

  function pickImages() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var p = state.editing;
      Array.from(input.files).forEach(function (file) {
        if (!file.type.startsWith('image/')) return;
        var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        var num = nextImgNum(p);
        var img = { src: pad2(num) + '.' + ext, alt: '', _file: file, _preview: null, _new: true };
        p.images.push(img);
        var reader = new FileReader();
        reader.onload = function (ev) { img._preview = ev.target.result; markDirty(); renderGallery(); };
        reader.readAsDataURL(file);
      });
      document.body.removeChild(input);
      markDirty();
    });
    input.click();
  }

  // ===========================================================
  // Open / new
  // ===========================================================
  async function openProject(id) {
    var p = await loadProjectFile(id);
    if (!p) { showStatus('Could not load project ' + id + '.', 'error'); return; }
    state.editing = p;
    clearDraft();
    renderSidebar();
    renderEditor();
  }

  function newProject() {
    if (state.editing && state.editing._dirty &&
        !confirm('Discard unsaved changes to the open project?')) return;
    state.editing = blankProject();
    state.editing.createdAt = nowISO();
    clearDraft();
    renderSidebar();
    renderEditor();
    showStatus('New project — fill in the fields and Save to Repository.', 'info');
  }

  async function openInitial() {
    if (state.index.current) {
      await openProject(state.index.current);
    } else if (state.index.projects.length) {
      await openProject(state.index.projects[0].id);
    } else {
      state.editing = blankProject();
      renderEditor();
    }
  }

  // ===========================================================
  // Save / publish / archive / delete
  // ===========================================================
  function upsertIndexEntry(p) {
    var entry = {
      id: p.id, title: p.title, subtitle: p.subtitle,
      date: p.date, sortDate: p.sortDate, status: p.status,
      image: firstImageAbs(p),
    };
    var i = state.index.projects.findIndex(function (x) { return x.id === p.id; });
    if (i >= 0) state.index.projects[i] = entry;
    else state.index.projects.push(entry);
  }

  async function saveProject(intent) {
    var p = state.editing;
    if (!p) return;
    syncFromDOM();

    if (!p.title.trim() && intent === 'publish') {
      showStatus('Give the project a title before publishing.', 'error');
      return;
    }

    var first = !p._persisted;
    if (first) {
      p.id = makeProjectId(p.title, p.date, takenIds());
      p.createdAt = p.createdAt || nowISO();
    }
    p.updatedAt = nowISO();

    var extraFiles = [];

    if (intent === 'publish') {
      var prev = state.index.current;
      if (prev && prev !== p.id) {
        var pe = state.index.projects.find(function (x) { return x.id === prev; });
        if (pe) pe.status = 'archived';
        var demoted = await readRepoJSON(REPO_PROJECT_DIR + prev + '.json');
        if (demoted) {
          demoted.status = 'archived';
          demoted.archivedAt = demoted.archivedAt || nowISO();
          extraFiles.push({ path: REPO_PROJECT_DIR + prev + '.json',
                            content: JSON.stringify(demoted, null, 2) });
        }
      }
      p.status = 'current';
      p.publishedAt = p.publishedAt || nowISO();
      p.archivedAt = null;
      state.index.current = p.id;
    } else if (intent === 'archive') {
      p.status = 'archived';
      p.archivedAt = nowISO();
      if (state.index.current === p.id) state.index.current = null;
    } else { // save
      if (!p._persisted) p.status = 'draft';
      // otherwise keep existing status (content-only edit)
    }

    upsertIndexEntry(p);
    state.index.updatedAt = nowISO();

    var files = [
      { path: REPO_PROJECT_DIR + p.id + '.json', content: JSON.stringify(cleanProject(p), null, 2) },
    ];
    p.images.forEach(function (img) {
      if (img._new && img._file) {
        files.push({ path: REPO_IMG_DIR + p.id + '/' + img.src, blob: img._file });
      }
    });
    files.push({ path: REPO_INDEX_PATH, content: JSON.stringify(state.index, null, 2) });
    files = files.concat(extraFiles);

    await commit(files, intent);
  }

  async function commit(files, intent) {
    var verb = intent === 'publish' ? 'Published' : intent === 'archive' ? 'Archived' : 'Saved';
    if (window.RepoFS && RepoFS.isConnected()) {
      try {
        for (var i = 0; i < files.length; i++) {
          await RepoFS.writeFile(files[i].path, files[i].content != null ? files[i].content : files[i].blob);
        }
        state.editing._persisted = true;
        state.editing._dirty = false;
        state.editing.images.forEach(function (img) { img._new = false; });
        clearDraft();
        renderSidebar();
        renderEditor();
        showStatus(verb + ' — ' + files.length + ' file(s) written to the repository. Commit with git.', 'success');
      } catch (err) {
        showStatus('Write failed: ' + (err.message || err), 'error');
      }
      return;
    }

    // ZIP fallback
    try {
      await exportZip(files);
      state.editing._persisted = true;   // model advances; user extracts the ZIP
      state.editing._dirty = false;
      renderSidebar();
      renderEditor();
      showStatus(verb + ' locally — no repo folder connected, so a repository-ready ZIP was downloaded. Extract at the repo root, then commit.', 'info');
    } catch (err) {
      showStatus('ZIP export failed: ' + (err.message || err), 'error');
    }
  }

  async function deleteProject() {
    var p = state.editing;
    if (!p || !p._persisted) return;
    if (!confirm('Delete "' + (p.title || p.id) + '" permanently?\n\n' +
                 'The project file' + (RepoFS.isConnected() ? ' and its image folder' : '') +
                 ' will be removed and it will disappear from the archive.')) return;

    state.index.projects = state.index.projects.filter(function (x) { return x.id !== p.id; });
    if (state.index.current === p.id) state.index.current = null;
    state.index.updatedAt = nowISO();

    if (window.RepoFS && RepoFS.isConnected()) {
      try {
        await RepoFS.deleteFile(REPO_PROJECT_DIR + p.id + '.json');
        var imgs = await RepoFS.listDir(REPO_IMG_DIR + p.id);
        for (var i = 0; i < imgs.length; i++) {
          await RepoFS.deleteFile(REPO_IMG_DIR + p.id + '/' + imgs[i].name);
        }
        await RepoFS.deleteFile(REPO_IMG_DIR + p.id); // remove now-empty dir
        await RepoFS.writeFile(REPO_INDEX_PATH, JSON.stringify(state.index, null, 2));
        showStatus('Deleted "' + (p.title || p.id) + '" from the repository.', 'success');
      } catch (err) {
        showStatus('Delete partly failed: ' + (err.message || err), 'error');
      }
    } else {
      await exportZip([{ path: REPO_INDEX_PATH, content: JSON.stringify(state.index, null, 2) }]);
      showStatus('Removed from index (ZIP downloaded). Delete /data/originals/projects/' +
        p.id + '.json and its image folder manually, then commit.', 'info');
    }

    clearDraft();
    await openInitial();
    renderSidebar();
  }

  // ===========================================================
  // ZIP export (repository-ready layout)
  // ===========================================================
  async function exportZip(files) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip unavailable');
    var zip = new JSZip();
    files.forEach(function (f) {
      zip.file(f.path, f.content != null ? f.content : f.blob);
    });
    var blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'originals-projects-export.zip');
  }

  async function exportEverythingZip() {
    var p = state.editing;
    if (p) {
      syncFromDOM();
      if (!p._persisted) p.id = makeProjectId(p.title, p.date, takenIds());
      p.updatedAt = nowISO();
      upsertIndexEntry(p);
    }
    state.index.updatedAt = nowISO();

    var files = [{ path: REPO_INDEX_PATH, content: JSON.stringify(state.index, null, 2) }];
    if (p && (p.title || p.body || p.images.length)) {
      files.push({ path: REPO_PROJECT_DIR + p.id + '.json',
                   content: JSON.stringify(cleanProject(p), null, 2) });
      p.images.forEach(function (img) {
        if (img._new && img._file) files.push({ path: REPO_IMG_DIR + p.id + '/' + img.src, blob: img._file });
      });
    }
    try {
      await exportZip(files);
      showStatus('Repository ZIP downloaded (' + files.length + ' file(s)). Extract at the repo root.', 'success');
    } catch (err) {
      showStatus('ZIP export failed: ' + (err.message || err), 'error');
    }
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ===========================================================
  // Draft autosave (localStorage) — convenience only, not authoritative
  // ===========================================================
  function saveDraft() {
    if (!state.editing) return;
    try {
      var p = state.editing;
      var copy = Object.assign({}, p);
      copy.images = p.images.map(function (img) {
        return { src: img.src, alt: img.alt, _preview: img._preview || null, _new: !!img._new };
      });
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: nowISO(), project: copy }));
    } catch (_) {}
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  }

  // ===========================================================
  // Legacy import + old-manager draft recovery
  // ===========================================================
  function legacyImageToV2(img) {
    if (!img) return null;
    var src = '';
    if (img.imageMode === 'remote' && img.remoteImage) src = img.remoteImage;
    else if (img.localImage) src = '/' + String(img.localImage).replace(/^\/+/, '');
    else if (img.src) src = img.src;
    if (!src) return null;
    return { src: src, alt: img.alt || '', _file: null, _preview: img._preview || null, _new: false };
  }

  function legacyProjectToV2(raw, forcedStatus) {
    var id = makeProjectId(raw.title || '', raw.date || '', takenIds());
    var p = blankProject();
    Object.assign(p, {
      id: id,
      title: raw.title || '',
      subtitle: raw.subtitle || '',
      date: raw.date || '',
      sortDate: computeSortDate(raw.date || raw.archivedAt || raw.createdAt || ''),
      body: raw.body || '',
      images: (Array.isArray(raw.images) ? raw.images : []).map(legacyImageToV2).filter(Boolean),
      status: forcedStatus,
      createdAt: raw.createdAt || nowISO(),
      updatedAt: nowISO(),
      publishedAt: forcedStatus === 'current' ? nowISO() : null,
      archivedAt: forcedStatus === 'archived' ? (raw.archivedAt || nowISO()) : null,
      _persisted: false,
    });
    return p;
  }

  async function importLegacy(data) {
    var made = [];
    var currentRaw = data.currentProject || (data.currentProject === undefined && data.title ? data : null);

    if (currentRaw && (currentRaw.title || (currentRaw.images || []).length)) {
      made.push(legacyProjectToV2(currentRaw, currentRaw.enabled ? 'current' : 'draft'));
    }
    (Array.isArray(data.projectArchive) ? data.projectArchive : []).forEach(function (a) {
      made.push(legacyProjectToV2(a, 'archived'));
    });

    if (!made.length) {
      showStatus('Nothing to migrate — no currentProject or projectArchive found.', 'info');
      return;
    }

    var files = [];
    made.forEach(function (p) {
      p._persisted = true;
      upsertIndexEntry(p);
      if (p.status === 'current') state.index.current = p.id;
      files.push({ path: REPO_PROJECT_DIR + p.id + '.json',
                   content: JSON.stringify(cleanProject(p), null, 2) });
    });
    state.index.updatedAt = nowISO();
    files.push({ path: REPO_INDEX_PATH, content: JSON.stringify(state.index, null, 2) });

    if (window.RepoFS && RepoFS.isConnected()) {
      for (var i = 0; i < files.length; i++) {
        await RepoFS.writeFile(files[i].path, files[i].content);
      }
      showStatus('Migrated ' + made.length + ' project(s) into the repository. Note: image files referenced by old paths are kept as-is.', 'success');
    } else {
      await exportZip(files);
      showStatus('Migrated ' + made.length + ' project(s) — ZIP downloaded. Extract at repo root. Existing images keep their old paths.', 'info');
    }
    renderSidebar();
    await openProject(made[0].id);
  }

  function renderMigratePanel() {
    var wrap = $('migratePanelWrap');
    var legacy = null;
    try {
      var raw = localStorage.getItem(LEGACY_DRAFT_KEY);
      if (raw) legacy = JSON.parse(raw);
    } catch (_) {}

    if (!legacy || !legacy.currentProject ||
        (!legacy.currentProject.title && !(legacy.currentProject.images || []).length)) {
      wrap.innerHTML = '';
      return;
    }

    var title = legacy.currentProject.title || 'Untitled draft';
    wrap.innerHTML =
      '<div class="migrate-panel">' +
        '<div class="migrate-panel__title">A draft from the old Originals Manager was found</div>' +
        '<p class="migrate-panel__desc">' +
          '“' + esc(title) + '” is still cached in this browser from the previous combined manager. ' +
          'Recover it as a new v2 project entry (you may need to re-add image files).' +
        '</p>' +
        '<div class="migrate-panel__actions">' +
          '<button class="btn btn-primary btn-sm" id="recoverLegacyBtn">Recover as new project</button>' +
          '<button class="btn btn-secondary btn-sm" id="dismissLegacyBtn">Dismiss</button>' +
        '</div>' +
      '</div>';

    $('recoverLegacyBtn').addEventListener('click', function () {
      var p = legacyProjectToV2(legacy.currentProject, 'draft');
      state.editing = p;
      wrap.innerHTML = '';
      renderSidebar();
      renderEditor();
      showStatus('Draft recovered. Review it, re-add any images, then Save to Repository.', 'success');
    });
    $('dismissLegacyBtn').addEventListener('click', function () { wrap.innerHTML = ''; });
  }

  // ===========================================================
  // Status bar
  // ===========================================================
  var statusTimer = null;
  function showStatus(msg, type) {
    var bar = $('statusBar');
    if (!bar) return;
    bar.textContent = msg;
    bar.className = 'status-bar show ' + (type || 'info');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { bar.className = 'status-bar'; }, 6000);
  }

  // ===========================================================
  // Boot
  // ===========================================================
  async function init() {
    initRepoBar();

    $('newProjectBtn').addEventListener('click', newProject);
    $('pmSidebarNewBtn').addEventListener('click', newProject);
    $('exportZipBtn').addEventListener('click', exportEverythingZip);

    $('importLegacyBtn').addEventListener('click', function () { $('importLegacyFile').click(); });
    $('importLegacyFile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try { importLegacy(JSON.parse(ev.target.result)); }
        catch (_) { showStatus('Could not parse that JSON file.', 'error'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    await loadIndex();
    renderSidebar();
    renderMigratePanel();

    var draft = loadDraft();
    if (draft && draft.project) {
      state.editing = Object.assign(blankProject(), draft.project);
      state.editing.images = (draft.project.images || []).map(function (img) {
        return { src: img.src, alt: img.alt || '', _file: null, _preview: img._preview || null, _new: !!img._new };
      });
      // _persisted reflects whether it already lives in the index
      state.editing._persisted = state.index.projects.some(function (p) { return p.id === draft.project.id; });
      state.editing._dirty = true;
      renderEditor();
      showStatus('Restored an in-progress draft from ' +
        (draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'earlier') + '.', 'info');
    } else {
      await openInitial();
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();
