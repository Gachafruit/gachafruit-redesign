/* ============================================================
   Featured Creations manager — Gachafruit Content Admin (v2)

   Owns the `featuredCreations` section of /data/featured-creations.json.
   Repository-aware: loads current data from the connected repo folder
   (or the served copy), edits it, writes it straight back. ZIP fallback
   when File System Access is unavailable.

   Depends on: originals-repo-fs.js, admin-common.js, admin-tiles.js, JSZip
   ============================================================ */

(function () {
  'use strict';

  var DATA_PATH      = 'data/featured-creations.json';
  var IMG_DIR        = 'assets/images/featured-creations';
  var COUNT          = 4;
  var DRAFT_KEY      = 'gachafruit_featured_creations_draft';
  var LEGACY_KEY     = 'gachafruit_featured_draft';

  var AC = window.AdminCommon;
  var AT = window.AdminTiles;

  var tiles        = [];
  var repoSnapshot = null;   // JSON string of the last loaded/saved clean tiles
  var repoFileData = null;   // last full file object seen (merge base)
  var dirty        = false;
  var savedOnce    = false;  // has a Save succeeded this session?

  var $ = function (id) { return document.getElementById(id); };
  var status = AC.statusController($('statusBar'));

  // ---------------------------------------------------------
  function defaultTile(n) {
    var id = 'F' + n;
    return {
      id: id, enabled: true, title: '', price: '', alt: '', url: '',
      imageMode: 'local', localImage: IMG_DIR + '/' + id + '.jpg', remoteImage: '',
      _file: null, _preview: null, _localExt: 'jpg', _imageDir: IMG_DIR,
    };
  }

  function cleanTile(t) {
    return {
      id: t.id, enabled: !!t.enabled, title: t.title || '', price: t.price || '',
      alt: t.alt || '', url: t.url || '', imageMode: t.imageMode || 'local',
      localImage: t.localImage || (IMG_DIR + '/' + t.id + '.jpg'),
      remoteImage: t.remoteImage || '',
    };
  }

  function cleanList() { return tiles.map(cleanTile); }
  function snapshot()  { return JSON.stringify(cleanList()); }

  // ---------------------------------------------------------
  // Build / render
  // ---------------------------------------------------------
  function build() {
    var grid = $('featuredGrid');
    grid.innerHTML = '';
    tiles.forEach(function (tile) {
      grid.appendChild(AT.buildCard(tile, { showMove: false }));
      AT.bindCard(tile, { onChange: onEdit });
      AT.refreshCard(tile);
    });
  }

  function onEdit() {
    dirty = (snapshot() !== repoSnapshot);
    saveDraft();
    renderState();
  }

  function renderState() {
    AC.renderStateStrip($('managerState'), {
      state: dirty ? 'draft' : (savedOnce ? 'saved' : (repoSnapshot ? 'repo' : 'draft')),
      dirty: dirty,
      detail: repoFileData && repoFileData.updatedAt
        ? 'repository updated ' + new Date(repoFileData.updatedAt).toLocaleString()
        : '',
    });
  }

  // ---------------------------------------------------------
  // Data apply
  // ---------------------------------------------------------
  function applyTiles(srcTiles) {
    tiles = [];
    for (var i = 1; i <= COUNT; i++) {
      var t = defaultTile(i);
      var src = (srcTiles || []).find(function (s) { return s.id === t.id; })
             || (srcTiles || [])[i - 1];
      if (src) {
        t.enabled     = src.enabled !== undefined ? !!src.enabled : true;
        t.title       = src.title || '';
        t.price       = src.price || '';
        t.alt         = src.alt || '';
        t.url         = src.url || '';
        t.imageMode   = src.imageMode || 'local';
        t.localImage  = src.localImage || t.localImage;
        t.remoteImage = src.remoteImage || '';
        t._localExt   = (String(t.localImage).split('.').pop() || 'jpg').toLowerCase();
      }
      tiles.push(t);
    }
  }

  async function loadFromRepo(silent) {
    var data = await AC.readRepoJSON(DATA_PATH);
    if (!data) {
      if (!silent) status.show('Could not read featured-creations.json (connect the repo or serve the site).', 'error');
      return false;
    }
    repoFileData = data;
    var fc = data.featuredCreations || (data.tiles ? { tiles: data.tiles } : { tiles: [] });
    applyTiles(fc.tiles || []);
    repoSnapshot = snapshot();
    dirty = false;
    savedOnce = false;
    build();
    renderState();
    clearDraft();
    if (!silent) status.show('Loaded Featured Creations from the repository.', 'info');
    return true;
  }

  // ---------------------------------------------------------
  // Draft (localStorage) — convenience only
  // ---------------------------------------------------------
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        tiles: tiles.map(function (t) {
          var c = cleanTile(t); c._preview = t._preview || null; c._localExt = t._localExt; return c;
        }),
      }));
    } catch (_) {}
  }
  function loadDraftRaw() {
    try { var r = localStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null; } catch (_) { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} }

  function applyDraft(draft) {
    applyTiles(draft.tiles || []);
    (draft.tiles || []).forEach(function (src, i) {
      if (tiles[i] && src._preview) { tiles[i]._preview = src._preview; }
    });
    build();
  }

  // ---------------------------------------------------------
  // Conflict banner (draft differs from repository)
  // ---------------------------------------------------------
  function showConflict(draft) {
    var wrap = $('conflictWrap');
    wrap.innerHTML =
      '<div class="conflict-banner">' +
        '<div class="conflict-banner__text">' +
          'A local draft from ' + AC.esc(draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'earlier') +
          ' differs from the current repository version. Resume the draft, or discard it and load what is live.' +
        '</div>' +
        '<div class="conflict-banner__actions">' +
          '<button class="btn btn-primary btn-sm" id="resumeDraftBtn">Resume draft</button>' +
          '<button class="btn btn-secondary btn-sm" id="loadRepoBtn">Load repository version</button>' +
        '</div>' +
      '</div>';
    $('resumeDraftBtn').addEventListener('click', function () {
      applyDraft(draft);
      dirty = (snapshot() !== repoSnapshot);
      wrap.innerHTML = '';
      renderState();
      status.show('Resumed local draft. Save to Repository when ready.', 'info');
    });
    $('loadRepoBtn').addEventListener('click', function () {
      wrap.innerHTML = '';
      loadFromRepo(false);
    });
  }

  // ---------------------------------------------------------
  // Save
  // ---------------------------------------------------------
  async function save() {
    // Re-read the file so the other sections are never clobbered.
    var base = (await AC.readRepoJSON(DATA_PATH)) || repoFileData || {};
    base.featuredCreations = { tiles: cleanList() };
    base.updatedAt = new Date().toISOString();

    var files = [{ path: DATA_PATH, content: JSON.stringify(base, null, 2) }];
    tiles.forEach(function (t) {
      if (t.imageMode !== 'remote' && t._file) {
        files.push({ path: String(t.localImage).replace(/^\/+/, ''), blob: t._file });
      }
    });

    var res = await AC.commit(files, {
      zipName: 'featured-creations-export.zip',
      verb: 'Saved Featured Creations',
      status: status,
    });

    repoFileData = base;
    repoSnapshot = snapshot();
    dirty = false;
    savedOnce = true;
    tiles.forEach(function (t) { t._file = null; });
    if (res.mode === 'repo' || res.mode === 'zip' || res.mode === 'json') clearDraft();
    renderState();
  }

  // ---------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------
  function bindToolbar() {
    $('saveBtn').addEventListener('click', save);
    $('reloadBtn').addEventListener('click', function () {
      if (dirty && !confirm('Discard unsaved edits and reload from the repository?')) return;
      $('conflictWrap').innerHTML = '';
      loadFromRepo(false);
    });
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          repoFileData = data;
          var fc = data.featuredCreations || (data.tiles ? { tiles: data.tiles } : { tiles: [] });
          applyTiles(fc.tiles || []);
          build();
          dirty = (snapshot() !== repoSnapshot);
          renderState();
          status.show('Imported Featured Creations from file. Review and Save.', 'success');
        } catch (_) { status.show('Could not parse that JSON file.', 'error'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  // ---------------------------------------------------------
  // Boot
  // ---------------------------------------------------------
  async function init() {
    AC.initRepoBar({
      onConnected: function () { if (!dirty) loadFromRepo(true); },
    });
    bindToolbar();

    applyTiles([]);           // start from 4 blank defaults
    build();

    var loaded = await loadFromRepo(true);

    var draft = loadDraftRaw();
    if (!draft) {
      // one-time recovery from the old combined manager's draft
      var legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch (_) {}
      var legacyTiles = legacy && legacy.featured && legacy.featured.tiles;
      if (legacyTiles && legacyTiles.some(function (t) { return t.title || t._preview; })) {
        applyTiles(legacyTiles);
        legacyTiles.forEach(function (src, i) { if (tiles[i] && src._preview) tiles[i]._preview = src._preview; });
        build();
        dirty = (snapshot() !== repoSnapshot);
        renderState();
        status.show('Recovered Featured Creations from the old combined manager’s draft. Review and Save.', 'info');
        return;
      }
    }

    if (draft) {
      applyDraft(draft);
      var differs = !loaded || snapshot() !== repoSnapshot;
      if (differs && loaded) {
        // keep the repo view rendered, offer a choice
        applyTiles((repoFileData.featuredCreations || {}).tiles || []);
        build();
        showConflict(draft);
      } else {
        dirty = (snapshot() !== repoSnapshot);
        status.show('Restored local draft.', 'info');
      }
    }
    renderState();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
