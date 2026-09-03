/* ============================================================
   Heritage Gallery manager — Gachafruit Content Admin (v2)

   Owns the `heritage` section of /data/featured-creations.json
   (heritage.items[] — the Heritage page slideshow). Each slide:
   image (local upload or remote URL) + alt text + enabled state.
   Public slideshow behaviour and data format are unchanged.

   Depends on: originals-repo-fs.js, admin-common.js, JSZip
   ============================================================ */

(function () {
  'use strict';

  var DATA_PATH  = 'data/featured-creations.json';
  var IMG_DIR    = 'assets/images/heritage/gallery';
  var COUNT      = 10;
  var DRAFT_KEY  = 'gachafruit_heritage_draft';
  var LEGACY_KEY = 'gachafruit_featured_draft';

  var AC = window.AdminCommon;
  var esc = AC.esc;

  var items        = [];
  var repoSnapshot = null;
  var repoFileData = null;
  var dirty        = false;
  var savedOnce    = false;

  var $ = function (id) { return document.getElementById(id); };
  var status = AC.statusController($('statusBar'));

  // ---------------------------------------------------------
  function defaultItem(n) {
    var id = 'H' + n;
    return {
      id: id, enabled: false, alt: '',
      imageMode: 'local', localImage: IMG_DIR + '/' + id + '.jpg', remoteImage: '',
      _file: null, _preview: null, _localExt: 'jpg',
    };
  }

  function cleanItem(t) {
    return {
      id: t.id, enabled: !!t.enabled, alt: t.alt || '',
      imageMode: t.imageMode || 'local',
      localImage: t.localImage || (IMG_DIR + '/' + t.id + '.jpg'),
      remoteImage: t.remoteImage || '',
    };
  }
  function cleanList() { return items.map(cleanItem); }
  function snapshot()  { return JSON.stringify(cleanList()); }

  var getEditor = function (id) { return document.querySelector('[data-tile-id="' + id + '"]'); };

  // ---------------------------------------------------------
  // Card
  // ---------------------------------------------------------
  function buildCard(item) {
    var div = document.createElement('div');
    div.className = 'tile-card tile-card--heritage' + (item.enabled ? '' : ' is-disabled');
    div.dataset.tileId = item.id;
    div.innerHTML =
      '<div class="tile-header">' +
        '<span class="tile-id">' + esc(item.id) + '</span>' +
        '<label class="toggle-label">' +
          '<input type="checkbox" class="toggle-checkbox tile-enabled"' + (item.enabled ? ' checked' : '') + '>' +
          '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
          '<span class="toggle-text">Enabled</span>' +
        '</label>' +
      '</div>' +
      '<div class="tile-body">' +
        '<div class="tile-form">' +
          '<div class="form-group">' +
            '<label class="form-label">Alt Text <span class="form-label-optional">optional</span></label>' +
            '<input type="text" class="tile-alt" placeholder="Brief image description" value="' + esc(item.alt) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Image</label>' +
            '<div class="mode-tabs">' +
              '<button class="mode-tab' + (item.imageMode === 'remote' ? '' : ' active') + '" data-mode="local">Upload</button>' +
              '<button class="mode-tab' + (item.imageMode === 'remote' ? ' active' : '') + '" data-mode="remote">URL</button>' +
            '</div>' +
          '</div>' +
          '<div class="image-section image-section-local' + (item.imageMode === 'remote' ? ' hidden' : '') + '">' +
            '<div class="upload-zone" tabindex="0" role="button" aria-label="Upload image">' +
              '<div class="upload-icon">⬆</div>' +
              '<div class="upload-text">Click or drag an image here</div>' +
              '<div class="upload-hint">JPG, PNG, WebP — recommended 1200×900px</div>' +
            '</div>' +
            '<input type="file" class="file-input" accept="image/*" style="display:none">' +
            '<div class="local-preview' + (item._preview ? ' show' : '') + '">' +
              '<img class="local-preview-thumb" src="' + (item._preview || '') + '" alt="">' +
              '<div class="local-preview-info">' +
                '<div class="local-preview-name">' + (item._preview ? esc(String(item.localImage).split('/').pop()) : '') + '</div>' +
                '<div class="local-preview-path">' + esc(item.localImage || '') + '</div>' +
              '</div>' +
              '<button class="clear-local-btn" type="button">Remove</button>' +
            '</div>' +
          '</div>' +
          '<div class="image-section image-section-remote' + (item.imageMode === 'remote' ? '' : ' hidden') + '">' +
            '<div class="form-group">' +
              '<input type="url" class="tile-remote-image" placeholder="https://..." value="' + esc(item.remoteImage) + '">' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="tile-preview">' +
          '<div class="preview-label">Preview</div>' +
          '<div class="preview-card' + (item.enabled ? '' : ' is-disabled') + '">' +
            '<div class="preview-img-wrap"><div class="preview-img-placeholder"></div></div>' +
          '</div>' +
          '<div class="preview-disabled-note' + (item.enabled ? '' : ' show') + '">Slide is inactive — will not appear in the slideshow</div>' +
        '</div>' +
      '</div>';
    return div;
  }

  function updatePreview(item, editor) {
    editor = editor || getEditor(item.id);
    if (!editor) return;
    var wrap = editor.querySelector('.preview-img-wrap');
    var card = editor.querySelector('.preview-card');
    var note = editor.querySelector('.preview-disabled-note');
    card.classList.toggle('is-disabled', !item.enabled);
    note.classList.toggle('show', !item.enabled);

    var src = null;
    if (item.imageMode !== 'remote' && item._preview) src = item._preview;
    else if (item.imageMode === 'remote' && item.remoteImage) src = item.remoteImage;

    var existing = wrap.querySelector('img');
    if (src) {
      if (!existing) { wrap.innerHTML = ''; existing = document.createElement('img'); wrap.appendChild(existing); }
      existing.alt = item.alt || '';
      existing.onerror = function () { wrap.innerHTML = '<div class="preview-img-placeholder"></div>'; };
      existing.src = src;
    } else {
      wrap.innerHTML = '<div class="preview-img-placeholder"></div>';
    }
  }

  function bindCard(item) {
    var editor = getEditor(item.id);
    if (!editor) return;

    editor.querySelector('.tile-alt').addEventListener('input', function (e) {
      item.alt = e.target.value.trim(); updatePreview(item, editor); onEdit();
    });
    editor.querySelector('.tile-remote-image').addEventListener('input', function (e) {
      item.remoteImage = e.target.value.trim(); updatePreview(item, editor); onEdit();
    });
    editor.querySelector('.tile-enabled').addEventListener('change', function (e) {
      item.enabled = e.target.checked;
      editor.classList.toggle('is-disabled', !item.enabled);
      updatePreview(item, editor); onEdit();
    });
    editor.querySelectorAll('.mode-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        item.imageMode = btn.dataset.mode;
        editor.querySelectorAll('.mode-tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
        editor.querySelector('.image-section-local').classList.toggle('hidden', item.imageMode === 'remote');
        editor.querySelector('.image-section-remote').classList.toggle('hidden', item.imageMode !== 'remote');
        updatePreview(item, editor); onEdit();
      });
    });

    var zone = editor.querySelector('.upload-zone');
    var fileInput = editor.querySelector('.file-input');
    zone.addEventListener('click', function () { fileInput.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault(); zone.classList.remove('dragover');
      var file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) handleUpload(item, file, editor);
    });
    fileInput.addEventListener('change', function (e) {
      if (e.target.files[0]) handleUpload(item, e.target.files[0], editor);
    });
    editor.querySelector('.clear-local-btn').addEventListener('click', function () {
      item._file = null; item._preview = null; item._localExt = 'jpg';
      item.localImage = IMG_DIR + '/' + item.id + '.jpg';
      editor.querySelector('.local-preview').classList.remove('show');
      editor.querySelector('.file-input').value = '';
      updatePreview(item, editor); onEdit();
    });
  }

  function handleUpload(item, file, editor) {
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    item._file = file;
    item._localExt = ext;
    item.localImage = IMG_DIR + '/' + item.id + '.' + ext;
    var reader = new FileReader();
    reader.onload = function (e) {
      item._preview = e.target.result;
      editor.querySelector('.local-preview-thumb').src = item._preview;
      editor.querySelector('.local-preview-name').textContent = file.name;
      editor.querySelector('.local-preview-path').textContent = item.localImage;
      editor.querySelector('.local-preview').classList.add('show');
      updatePreview(item, editor); onEdit();
    };
    reader.readAsDataURL(file);
  }

  // ---------------------------------------------------------
  function build() {
    var grid = $('heritageGrid');
    grid.innerHTML = '';
    items.forEach(function (item) {
      grid.appendChild(buildCard(item));
      bindCard(item);
      updatePreview(item);
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
  function applyItems(src) {
    items = [];
    for (var i = 1; i <= COUNT; i++) {
      var it = defaultItem(i);
      var s = (src || []).find(function (x) { return x.id === it.id; }) || (src || [])[i - 1];
      if (s) {
        it.enabled     = s.enabled !== undefined ? !!s.enabled : true;
        it.alt         = s.alt || '';
        it.imageMode   = s.imageMode || 'local';
        it.localImage  = s.localImage || it.localImage;
        it.remoteImage = s.remoteImage || '';
        it._localExt   = (String(it.localImage).split('.').pop() || 'jpg').toLowerCase();
      }
      items.push(it);
    }
  }

  async function loadFromRepo(silent) {
    var data = await AC.readRepoJSON(DATA_PATH);
    if (!data) {
      if (!silent) status.show('Could not read featured-creations.json (connect the repo or serve the site).', 'error');
      return false;
    }
    repoFileData = data;
    applyItems((data.heritage && data.heritage.items) || []);
    repoSnapshot = snapshot();
    dirty = false;
    savedOnce = false;
    build();
    renderState();
    clearDraft();
    if (!silent) status.show('Loaded Heritage Gallery from the repository.', 'info');
    return true;
  }

  // ---------------------------------------------------------
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        items: items.map(function (t) {
          var c = cleanItem(t); c._preview = t._preview || null; c._localExt = t._localExt; return c;
        }),
      }));
    } catch (_) {}
  }
  function loadDraftRaw() {
    try { var r = localStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null; } catch (_) { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} }

  function applyDraft(draft) {
    applyItems(draft.items || []);
    (draft.items || []).forEach(function (src, i) { if (items[i] && src._preview) items[i]._preview = src._preview; });
    build();
  }

  function showConflict(draft) {
    var wrap = $('conflictWrap');
    wrap.innerHTML =
      '<div class="conflict-banner">' +
        '<div class="conflict-banner__text">' +
          'A local draft from ' + esc(draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'earlier') +
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
  async function save() {
    var base = (await AC.readRepoJSON(DATA_PATH)) || repoFileData || {};
    base.heritage = { items: cleanList() };
    base.updatedAt = new Date().toISOString();

    var files = [{ path: DATA_PATH, content: JSON.stringify(base, null, 2) }];
    items.forEach(function (t) {
      if (t.imageMode !== 'remote' && t._file) {
        files.push({ path: String(t.localImage).replace(/^\/+/, ''), blob: t._file });
      }
    });

    var res = await AC.commit(files, {
      zipName: 'heritage-gallery-export.zip',
      verb: 'Saved Heritage Gallery',
      status: status,
    });

    repoFileData = base;
    repoSnapshot = snapshot();
    dirty = false;
    savedOnce = true;
    items.forEach(function (t) { t._file = null; });
    if (res.mode) clearDraft();
    renderState();
  }

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
          applyItems((data.heritage && data.heritage.items) || []);
          build();
          dirty = (snapshot() !== repoSnapshot);
          renderState();
          status.show('Imported Heritage Gallery from file. Review and Save.', 'success');
        } catch (_) { status.show('Could not parse that JSON file.', 'error'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  // ---------------------------------------------------------
  async function init() {
    AC.initRepoBar({ onConnected: function () { if (!dirty) loadFromRepo(true); } });
    bindToolbar();

    applyItems([]);
    build();

    var loaded = await loadFromRepo(true);

    var draft = loadDraftRaw();
    if (!draft) {
      var legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch (_) {}
      var lh = legacy && legacy.heritage && legacy.heritage.tiles;
      if (lh && lh.some(function (t) { return t.alt || t._preview || t.remoteImage; })) {
        applyItems(lh);
        lh.forEach(function (src, i) { if (items[i] && src._preview) items[i]._preview = src._preview; });
        build();
        dirty = (snapshot() !== repoSnapshot);
        renderState();
        status.show('Recovered Heritage Gallery from the old combined manager’s draft. Review and Save.', 'info');
        return;
      }
    }

    if (draft) {
      applyDraft(draft);
      var draftSnap = snapshot();
      if (loaded && draftSnap !== repoSnapshot) {
        applyItems((repoFileData.heritage || {}).items || []);
        build();
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
