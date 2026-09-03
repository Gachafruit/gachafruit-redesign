/* ============================================================
   Explore All manager — Gachafruit Content Admin (v2)

   Owns the `exploreAll` section of /data/featured-creations.json.
   Preserves the dual-source design (manual / api-with-fallback),
   API URL, homepage-visible count, View All URL, slot management
   and manual-tile ordering.

   Depends on: originals-repo-fs.js, admin-common.js, admin-tiles.js, JSZip
   ============================================================ */

(function () {
  'use strict';

  var DATA_PATH   = 'data/featured-creations.json';
  var IMG_DIR     = 'assets/images/explore-all';
  var DEFAULT_SLOTS = 12;
  var MAX_SLOTS   = 100;
  var DRAFT_KEY   = 'gachafruit_explore_all_draft';
  var LEGACY_KEY  = 'gachafruit_featured_draft';

  var AC = window.AdminCommon;
  var AT = window.AdminTiles;

  var settings = { mode: 'manual', apiUrl: '', homepageVisibleCount: 8, viewAllUrl: '', slotCount: DEFAULT_SLOTS };
  var tiles        = [];
  var repoSnapshot = null;
  var repoFileData = null;
  var dirty        = false;
  var savedOnce    = false;

  var $ = function (id) { return document.getElementById(id); };
  var status = AC.statusController($('statusBar'));

  // ---------------------------------------------------------
  function defaultTile(n) {
    var id = 'E' + n;
    return {
      id: id, enabled: false, title: '', price: '', alt: '', url: '',
      imageMode: 'local', localImage: IMG_DIR + '/' + id + '.jpg', remoteImage: '',
      _file: null, _preview: null, _localExt: 'jpg', _imageDir: IMG_DIR,
    };
  }

  function nextIdNum() {
    if (!tiles.length) return 1;
    return Math.max.apply(null, tiles.map(function (t) { return parseInt(String(t.id).slice(1), 10) || 0; })) + 1;
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
  function snapshot()  { return JSON.stringify({ s: settings, t: cleanList() }); }

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------
  function build() {
    var grid = $('exploreGrid');
    grid.innerHTML = '';
    tiles.forEach(function (tile) {
      grid.appendChild(AT.buildCard(tile, { showMove: true }));
      AT.bindCard(tile, { onChange: onEdit, onMove: moveTile });
      AT.refreshCard(tile);
    });
    updateMoveButtons();
  }

  function updateMoveButtons() {
    tiles.forEach(function (tile, idx) {
      var editor = AT.getEditor(tile.id);
      if (!editor) return;
      var btns = editor.querySelectorAll('.move-btn');
      if (btns[0]) btns[0].disabled = (idx === 0);
      if (btns[1]) btns[1].disabled = (idx === tiles.length - 1);
    });
  }

  function moveTile(tile, dir) {
    var idx = tiles.indexOf(tile);
    var target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= tiles.length) return;
    var tmp = tiles[idx]; tiles[idx] = tiles[target]; tiles[target] = tmp;
    build();
    onEdit();
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
  // Settings panel
  // ---------------------------------------------------------
  function refreshSettingsDOM() {
    document.querySelectorAll('.source-mode-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === settings.mode);
    });
    $('apiModeSettings').classList.toggle('hidden', settings.mode !== 'api-with-fallback');
    $('apiUrl').value = settings.apiUrl;
    $('homepageVisibleCount').value = settings.homepageVisibleCount;
    $('viewAllUrl').value = settings.viewAllUrl;
    $('slotCount').value = settings.slotCount;
  }

  function bindSettings() {
    document.querySelectorAll('.source-mode-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        settings.mode = btn.dataset.mode;
        refreshSettingsDOM();
        onEdit();
      });
    });
    $('apiUrl').addEventListener('input', function (e) { settings.apiUrl = e.target.value.trim(); onEdit(); });
    $('viewAllUrl').addEventListener('input', function (e) { settings.viewAllUrl = e.target.value.trim(); onEdit(); });
    $('homepageVisibleCount').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 1) { settings.homepageVisibleCount = v; onEdit(); }
    });
    $('applySlotCount').addEventListener('click', function () {
      var v = parseInt($('slotCount').value, 10);
      if (!isNaN(v)) applySlotCount(v);
    });
  }

  function applySlotCount(newCount) {
    var n = Math.max(1, Math.min(MAX_SLOTS, newCount || DEFAULT_SLOTS));
    var current = tiles.length;
    if (n > current) {
      var next = nextIdNum();
      for (var i = current; i < n; i++) tiles.push(defaultTile(next++));
    } else if (n < current) {
      var removed = tiles.slice(n);
      if (removed.some(function (t) { return t.title || t.url || t._preview || t._file; }) &&
          !confirm((current - n) + ' slot(s) at the end contain data and will be removed. Continue?')) {
        $('slotCount').value = current;
        return;
      }
      tiles.splice(n);
    }
    settings.slotCount = n;
    $('slotCount').value = n;
    build();
    onEdit();
    status.show('Explore All now has ' + n + ' manual slots.', 'success');
  }

  // ---------------------------------------------------------
  // Data apply
  // ---------------------------------------------------------
  function applySection(section) {
    section = section || {};
    settings.mode                 = section.mode || 'manual';
    settings.apiUrl               = section.apiUrl || '';
    settings.homepageVisibleCount = section.homepageVisibleCount || 8;
    settings.viewAllUrl           = section.viewAllUrl || '';

    var manual = Array.isArray(section.manualTiles) ? section.manualTiles : [];
    settings.slotCount = section.slotCount || Math.max(manual.length, DEFAULT_SLOTS);

    tiles = [];
    for (var i = 0; i < settings.slotCount; i++) {
      var t = defaultTile(i + 1);
      var src = manual[i];
      if (src) {
        if (src.id) t.id = src.id;
        t.enabled     = src.enabled !== undefined ? !!src.enabled : true;
        t.title       = src.title || '';
        t.price       = src.price || '';
        t.alt         = src.alt || '';
        t.url         = src.url || '';
        t.imageMode   = src.imageMode || 'local';
        t.localImage  = src.localImage || (IMG_DIR + '/' + t.id + '.jpg');
        t.remoteImage = src.remoteImage || '';
        t._localExt   = (String(t.localImage).split('.').pop() || 'jpg').toLowerCase();
      }
      tiles.push(t);
    }
  }

  function renderAll() {
    refreshSettingsDOM();
    build();
    renderState();
  }

  async function loadFromRepo(silent) {
    var data = await AC.readRepoJSON(DATA_PATH);
    if (!data) {
      if (!silent) status.show('Could not read featured-creations.json (connect the repo or serve the site).', 'error');
      return false;
    }
    repoFileData = data;
    applySection(data.exploreAll || {});
    repoSnapshot = snapshot();
    dirty = false;
    savedOnce = false;
    renderAll();
    clearDraft();
    if (!silent) status.show('Loaded Explore All from the repository.', 'info');
    return true;
  }

  // ---------------------------------------------------------
  // Draft
  // ---------------------------------------------------------
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        settings: settings,
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
    if (draft.settings) Object.assign(settings, draft.settings);
    var manual = (draft.tiles || []).map(function (t) { return t; });
    applySection({
      mode: settings.mode, apiUrl: settings.apiUrl,
      homepageVisibleCount: settings.homepageVisibleCount, viewAllUrl: settings.viewAllUrl,
      slotCount: settings.slotCount, manualTiles: manual,
    });
    (draft.tiles || []).forEach(function (src, i) { if (tiles[i] && src._preview) tiles[i]._preview = src._preview; });
    renderAll();
  }

  // ---------------------------------------------------------
  // Conflict banner
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
    $('loadRepoBtn').addEventListener('click', function () { wrap.innerHTML = ''; loadFromRepo(false); });
  }

  // ---------------------------------------------------------
  // Save
  // ---------------------------------------------------------
  async function save() {
    var base = (await AC.readRepoJSON(DATA_PATH)) || repoFileData || {};
    base.exploreAll = {
      mode: settings.mode,
      apiUrl: settings.apiUrl,
      homepageVisibleCount: settings.homepageVisibleCount,
      viewAllUrl: settings.viewAllUrl,
      slotCount: settings.slotCount,
      manualTiles: cleanList(),
    };
    base.updatedAt = new Date().toISOString();

    var files = [{ path: DATA_PATH, content: JSON.stringify(base, null, 2) }];
    tiles.forEach(function (t) {
      if (t.imageMode !== 'remote' && t._file) {
        files.push({ path: String(t.localImage).replace(/^\/+/, ''), blob: t._file });
      }
    });

    var res = await AC.commit(files, {
      zipName: 'explore-all-export.zip',
      verb: 'Saved Explore All',
      status: status,
    });

    repoFileData = base;
    repoSnapshot = snapshot();
    dirty = false;
    savedOnce = true;
    tiles.forEach(function (t) { t._file = null; });
    if (res.mode) clearDraft();
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
          applySection(data.exploreAll || {});
          renderAll();
          dirty = (snapshot() !== repoSnapshot);
          renderState();
          status.show('Imported Explore All from file. Review and Save.', 'success');
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
    AC.initRepoBar({ onConnected: function () { if (!dirty) loadFromRepo(true); } });
    bindSettings();
    bindToolbar();

    applySection({});
    renderAll();

    var loaded = await loadFromRepo(true);

    var draft = loadDraftRaw();
    if (!draft) {
      var legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch (_) {}
      var le = legacy && legacy.explore;
      if (le && Array.isArray(le.tiles) && le.tiles.some(function (t) { return t.title || t._preview; })) {
        if (le.settings) Object.assign(settings, le.settings);
        applySection({
          mode: settings.mode, apiUrl: settings.apiUrl,
          homepageVisibleCount: settings.homepageVisibleCount, viewAllUrl: settings.viewAllUrl,
          slotCount: settings.slotCount || (le.tiles.length), manualTiles: le.tiles,
        });
        le.tiles.forEach(function (src, i) { if (tiles[i] && src._preview) tiles[i]._preview = src._preview; });
        renderAll();
        dirty = (snapshot() !== repoSnapshot);
        renderState();
        status.show('Recovered Explore All from the old combined manager’s draft. Review and Save.', 'info');
        return;
      }
    }

    if (draft) {
      applyDraft(draft);
      var draftSnap = snapshot();
      if (loaded && draftSnap !== repoSnapshot) {
        // Draft and repository disagree — keep the live view, let the user choose.
        applySection(repoFileData.exploreAll || {});
        renderAll();
        showConflict(draft);
      } else {
        dirty = (draftSnap !== repoSnapshot);
        status.show('Restored local draft.', 'info');
      }
    }
    renderState();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
