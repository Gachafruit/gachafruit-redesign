/* ============================================================
   Originals Listings Manager — Gachafruit Studio (v2 split)

   Owns the marketplace-facing parts of the Originals page:
     - Etsy section display settings
     - Free Models tiles
   Reads / writes /data/originals-content.json  ({ etsySettings, freeModels }).

   Publishing: File System Access API when connected, ZIP fallback otherwise.
   Ported from the Etsy + Free Models sections of the old combined
   Originals Manager. Depends on originals-repo-fs.js + JSZip.
   ============================================================ */

(function () {
  'use strict';

  var STORAGE_KEY        = 'gachafruit_originals_listings_draft';
  var FREE_MODEL_IMG_DIR = 'assets/images/originals/free-models';
  var REPO_CONTENT_PATH  = 'data/originals-content.json';
  var HTTP_BASE          = '../';

  var etsySettings   = defaultEtsySettings();
  var freeModelTiles = [];
  var importedData   = null;

  var $ = function (id) { return document.getElementById(id); };

  // ===========================================================
  // Defaults
  // ===========================================================
  function defaultEtsySettings() {
    return {
      eyebrow: 'GACHAFRUIT ON ETSY',
      sectionTitle: 'Shop Our Originals',
      itemCount: 6,
      seeAllUrl: '/explore-all/',
    };
  }

  function defaultFreeModelTile(n) {
    var id = 'FM' + n;
    return {
      id: id, enabled: true, title: '', alt: '', url: '',
      buttonText: 'Download', imageMode: 'local',
      localImage: FREE_MODEL_IMG_DIR + '/' + id + '.jpg',
      remoteImage: '',
      _file: null, _preview: null, _localExt: 'jpg', _imageDir: FREE_MODEL_IMG_DIR,
    };
  }

  function nextFreeModelIdNum() {
    if (!freeModelTiles.length) return 1;
    return Math.max.apply(null, freeModelTiles.map(function (t) {
      return parseInt(String(t.id).slice(2), 10) || 0;
    })) + 1;
  }

  // ===========================================================
  // Init
  // ===========================================================
  function init() {
    initRepoBar();
    bindToolbar();
    buildEtsySettings();
    buildFreeModelsGrid();
    var hadDraft = loadDraft();
    // Only auto-pull from the repo when there is no local draft to preserve.
    if (!hadDraft) loadFromRepo(true);
    else showStatus('Restored local draft. Use "Reload from repo" to discard it.', 'info');
  }

  // ===========================================================
  // Repo bar
  // ===========================================================
  function initRepoBar() {
    var bar = $('repoBar');
    var connectBtn = $('repoConnectBtn'), reconnectBtn = $('repoReconnectBtn'),
        disconnectBtn = $('repoDisconnectBtn');

    if (!window.RepoFS || !RepoFS.supported) {
      $('repoStatusText').textContent = 'Direct publishing not supported in this browser';
      $('repoHint').innerHTML = 'Use <strong>Save / Publish</strong> to download a repository-ready file/ZIP.';
      connectBtn.disabled = true;
      return;
    }

    function paint(info) {
      bar.classList.toggle('is-connected', info.connected);
      bar.classList.toggle('needs-attention', !info.connected && !!info.needsPermission);
      connectBtn.style.display    = info.connected || info.needsPermission ? 'none' : '';
      reconnectBtn.style.display  = (!info.connected && info.needsPermission) ? '' : 'none';
      disconnectBtn.style.display = info.connected ? '' : 'none';
      if (info.connected) {
        $('repoStatusText').textContent = 'Connected — Save / Publish writes directly to the repo';
        $('repoPath').textContent = info.name ? '(' + info.name + '/)' : '';
      } else if (info.needsPermission) {
        $('repoStatusText').textContent = 'Repository folder remembered — click Reconnect';
        $('repoPath').textContent = '';
      } else {
        $('repoStatusText').textContent = 'Repository folder not connected';
        $('repoPath').textContent = '';
      }
    }

    RepoFS.onChange(paint);
    connectBtn.addEventListener('click', function () {
      RepoFS.connect().then(function () { showStatus('Repository connected.', 'success'); loadFromRepo(); })
        .catch(function (e) { showStatus(e.message, 'error'); });
    });
    reconnectBtn.addEventListener('click', function () {
      RepoFS.reconnect().then(function () { showStatus('Reconnected.', 'success'); loadFromRepo(); })
        .catch(function (e) { showStatus(e.message, 'error'); });
    });
    disconnectBtn.addEventListener('click', function () {
      RepoFS.disconnect().then(function () { showStatus('Disconnected.', 'info'); });
    });

    RepoFS.restore().then(function (res) {
      paint(RepoFS.status().connected ? RepoFS.status() : { connected: false, needsPermission: res.needsPermission });
      if (res.connected) loadFromRepo();
    });
    paint(RepoFS.status());
  }

  async function readRepoJSON(path) {
    if (window.RepoFS && RepoFS.isConnected()) {
      try { var t = await RepoFS.readText(path); return t ? JSON.parse(t) : null; }
      catch (_) { return null; }
    }
    try { var r = await fetch(HTTP_BASE + path, { cache: 'no-cache' }); return r.ok ? await r.json() : null; }
    catch (_) { return null; }
  }

  async function loadFromRepo(silent) {
    var data = await readRepoJSON(REPO_CONTENT_PATH);
    if (!data) { if (!silent) showStatus('Could not read originals-content.json.', 'error'); return; }
    applyData(data);
    importedData = data;
    if (!silent) showStatus('Loaded listings from repository.', 'info');
  }

  // ===========================================================
  // Etsy settings panel
  // ===========================================================
  function buildEtsySettings() {
    var wrap = $('etsySettingsWrap');
    wrap.innerHTML =
      '<div class="settings-panel">' +
        '<div class="settings-group settings-group-wide">' +
          '<div class="settings-label">Eyebrow Text</div>' +
          '<input type="text" id="etsyEyebrow" class="settings-input" value="' + esc(etsySettings.eyebrow) + '">' +
        '</div>' +
        '<div class="settings-group settings-group-wide">' +
          '<div class="settings-label">Section Title</div>' +
          '<input type="text" id="etsySectionTitle" class="settings-input" value="' + esc(etsySettings.sectionTitle) + '">' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-label">Items to show</div>' +
          '<input type="number" id="etsyItemCount" class="settings-input" value="' + (etsySettings.itemCount || 6) + '" min="1" max="20">' +
        '</div>' +
        '<div class="settings-group settings-group-wide">' +
          '<div class="settings-label">"See All" URL</div>' +
          '<input type="url" id="etsySeeAllUrl" class="settings-input" value="' + esc(etsySettings.seeAllUrl) + '">' +
        '</div>' +
      '</div>';

    ['etsyEyebrow', 'etsySectionTitle', 'etsyItemCount', 'etsySeeAllUrl'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        etsySettings.eyebrow      = $('etsyEyebrow').value.trim();
        etsySettings.sectionTitle = $('etsySectionTitle').value.trim();
        etsySettings.itemCount    = parseInt($('etsyItemCount').value, 10) || 6;
        etsySettings.seeAllUrl    = $('etsySeeAllUrl').value.trim();
        saveDraft();
      });
    });
  }

  // ===========================================================
  // Free Models grid  (ported from old manager)
  // ===========================================================
  function buildFreeModelsGrid() {
    var grid = $('freeModelsTilesGrid');
    grid.innerHTML = '';
    freeModelTiles.forEach(function (tile) {
      grid.appendChild(buildFreeModelTileCard(tile));
      bindFreeModelTileEvents(tile);
    });
  }

  function getEditor(id) { return document.querySelector('[data-tile-id="' + id + '"]'); }

  function buildFreeModelTileCard(tile) {
    var div = document.createElement('div');
    div.className = 'tile-card' + (tile.enabled ? '' : ' is-disabled');
    div.dataset.tileId = tile.id;
    div.innerHTML =
      '<div class="tile-header">' +
        '<div class="tile-id-group">' +
          '<span class="tile-id">' + tile.id + '</span>' +
          '<div class="move-controls">' +
            '<button class="move-btn" data-dir="up" title="Move up">↑</button>' +
            '<button class="move-btn" data-dir="down" title="Move down">↓</button>' +
          '</div>' +
        '</div>' +
        '<label class="toggle-label">' +
          '<input type="checkbox" class="toggle-checkbox tile-enabled"' + (tile.enabled ? ' checked' : '') + '>' +
          '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
          '<span class="toggle-text">Enabled</span>' +
        '</label>' +
      '</div>' +
      '<div class="tile-body">' +
        '<div class="tile-form">' +
          '<div class="form-group"><label class="form-label">Title</label>' +
            '<input type="text" class="tile-title" value="' + esc(tile.title) + '"></div>' +
          '<div class="form-group"><label class="form-label">Button Text <span class="form-label-optional">default: Download</span></label>' +
            '<input type="text" class="tile-button-text" value="' + esc(tile.buttonText || 'Download') + '"></div>' +
          '<div class="form-group"><label class="form-label">Alt Text <span class="form-label-optional">optional</span></label>' +
            '<input type="text" class="tile-alt" value="' + esc(tile.alt) + '"></div>' +
          '<div class="form-group"><label class="form-label">Destination URL</label>' +
            '<input type="url" class="tile-url" placeholder="https://www.printables.com/model/..." value="' + esc(tile.url) + '"></div>' +
          '<div class="form-group"><label class="form-label">Image</label>' +
            '<div class="mode-tabs">' +
              '<button class="mode-tab' + (tile.imageMode === 'local' ? ' active' : '') + '" data-mode="local">Upload</button>' +
              '<button class="mode-tab' + (tile.imageMode === 'remote' ? ' active' : '') + '" data-mode="remote">URL</button>' +
            '</div>' +
          '</div>' +
          '<div class="image-section image-section-local' + (tile.imageMode !== 'local' ? ' hidden' : '') + '">' +
            '<div class="upload-zone" tabindex="0" role="button" aria-label="Upload image">' +
              '<div class="upload-icon">⬆</div><div class="upload-text">Click or drag an image here</div>' +
              '<div class="upload-hint">JPG, PNG, WebP — recommended 800×800px</div>' +
            '</div>' +
            '<input type="file" class="file-input" accept="image/*" style="display:none">' +
            '<div class="local-preview' + (tile._preview ? ' show' : '') + '">' +
              '<img class="local-preview-thumb" src="' + (tile._preview || '') + '" alt="">' +
              '<div class="local-preview-info">' +
                '<div class="local-preview-name">' + (tile._preview ? esc(tile.localImage.split('/').pop()) : '') + '</div>' +
                '<div class="local-preview-path">' + esc(tile.localImage || '') + '</div>' +
              '</div>' +
              '<button class="clear-local-btn" type="button">Remove</button>' +
            '</div>' +
          '</div>' +
          '<div class="image-section image-section-remote' + (tile.imageMode !== 'remote' ? ' hidden' : '') + '">' +
            '<div class="form-group"><input type="url" class="tile-remote-image" placeholder="https://..." value="' + esc(tile.remoteImage) + '"></div>' +
          '</div>' +
        '</div>' +
        '<div class="tile-preview">' +
          '<div class="preview-label">Preview</div>' +
          '<div class="preview-card' + (tile.enabled ? '' : ' is-disabled') + '">' +
            '<div class="preview-img-wrap"><div class="preview-img-placeholder"></div></div>' +
            '<div class="preview-body">' +
              '<div class="preview-title' + (tile.title ? '' : ' empty') + '">' + (tile.title ? esc(tile.title) : 'No title yet') + '</div>' +
              '<div class="preview-btn">' + esc(tile.buttonText || 'Download') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="preview-disabled-note' + (tile.enabled ? '' : ' show') + '">Tile is inactive — will not appear on page</div>' +
        '</div>' +
      '</div>';
    setTimeout(function () { updateFreeModelPreview(getEditor(tile.id), tile); }, 0);
    return div;
  }

  function updateFreeModelPreview(editor, tile) {
    if (!editor) return;
    var src = tile._preview || (tile.imageMode === 'remote' ? tile.remoteImage : '') || '';
    var imgWrap = editor.querySelector('.preview-img-wrap');
    if (src) {
      var img = imgWrap.querySelector('img');
      if (!img) { imgWrap.innerHTML = ''; img = document.createElement('img'); imgWrap.appendChild(img); }
      img.src = src; img.alt = tile.alt || '';
    } else {
      imgWrap.innerHTML = '<div class="preview-img-placeholder"></div>';
    }
    var titleEl = editor.querySelector('.preview-title');
    if (titleEl) { titleEl.textContent = tile.title || 'No title yet'; titleEl.classList.toggle('empty', !tile.title); }
    var btnEl = editor.querySelector('.preview-btn');
    if (btnEl) btnEl.textContent = tile.buttonText || 'Download';
    editor.querySelector('.preview-card').classList.toggle('is-disabled', !tile.enabled);
    editor.querySelector('.preview-disabled-note').classList.toggle('show', !tile.enabled);
  }

  function bindFreeModelTileEvents(tile) {
    var editor = getEditor(tile.id);
    if (!editor) return;

    var onText = function () {
      tile.title       = editor.querySelector('.tile-title').value.trim();
      tile.buttonText  = editor.querySelector('.tile-button-text').value.trim();
      tile.alt         = editor.querySelector('.tile-alt').value.trim();
      tile.url         = editor.querySelector('.tile-url').value.trim();
      tile.remoteImage = editor.querySelector('.tile-remote-image').value.trim();
      saveDraft();
      updateFreeModelPreview(editor, tile);
    };
    editor.querySelectorAll('.tile-title, .tile-button-text, .tile-alt, .tile-url, .tile-remote-image')
      .forEach(function (el) { el.addEventListener('input', onText); });

    editor.querySelector('.tile-enabled').addEventListener('change', function (e) {
      tile.enabled = e.target.checked;
      editor.classList.toggle('is-disabled', !tile.enabled);
      saveDraft();
      updateFreeModelPreview(editor, tile);
    });

    editor.querySelectorAll('.mode-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        tile.imageMode = btn.dataset.mode;
        editor.querySelectorAll('.mode-tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
        editor.querySelector('.image-section-local').classList.toggle('hidden', tile.imageMode !== 'local');
        editor.querySelector('.image-section-remote').classList.toggle('hidden', tile.imageMode !== 'remote');
        saveDraft();
        updateFreeModelPreview(editor, tile);
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
      if (file && file.type.startsWith('image/')) handleFileUpload(tile.id, file);
    });
    fileInput.addEventListener('change', function (e) {
      if (e.target.files[0]) handleFileUpload(tile.id, e.target.files[0]);
    });

    editor.querySelector('.clear-local-btn').addEventListener('click', function () {
      tile._file = null; tile._preview = null; tile._localExt = 'jpg';
      tile.localImage = tile._imageDir + '/' + tile.id + '.jpg';
      editor.querySelector('.local-preview').classList.remove('show');
      editor.querySelector('.file-input').value = '';
      saveDraft();
      updateFreeModelPreview(editor, tile);
    });

    editor.querySelectorAll('.move-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dir = btn.dataset.dir, idx = freeModelTiles.findIndex(function (t) { return t.id === tile.id; });
        if (dir === 'up' && idx > 0) { swap(idx, idx - 1); buildFreeModelsGrid(); }
        else if (dir === 'down' && idx < freeModelTiles.length - 1) { swap(idx, idx + 1); buildFreeModelsGrid(); }
        saveDraft();
      });
    });
  }

  function swap(a, b) { var t = freeModelTiles[a]; freeModelTiles[a] = freeModelTiles[b]; freeModelTiles[b] = t; }

  function handleFileUpload(tileId, file) {
    var tile = freeModelTiles.find(function (t) { return t.id === tileId; });
    if (!tile) return;
    var editor = getEditor(tileId);
    tile._file = file;
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    tile._localExt = ext;
    tile.localImage = tile._imageDir + '/' + tileId + '.' + ext;
    var reader = new FileReader();
    reader.onload = function (ev) {
      tile._preview = ev.target.result;
      editor.querySelector('.local-preview-thumb').src = ev.target.result;
      editor.querySelector('.local-preview-name').textContent = file.name;
      editor.querySelector('.local-preview-path').textContent = tile.localImage;
      editor.querySelector('.local-preview').classList.add('show');
      saveDraft();
      updateFreeModelPreview(editor, tile);
    };
    reader.readAsDataURL(file);
  }

  // ===========================================================
  // Toolbar
  // ===========================================================
  function bindToolbar() {
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try { applyData(JSON.parse(ev.target.result)); importedData = JSON.parse(ev.target.result); showStatus('Imported.', 'success'); }
        catch (_) { showStatus('Could not parse JSON.', 'error'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    $('reloadBtn').addEventListener('click', function () { loadFromRepo(); });
    $('addFreeModelBtn').addEventListener('click', function () {
      var tile = defaultFreeModelTile(nextFreeModelIdNum());
      freeModelTiles.push(tile);
      buildFreeModelsGrid();
      saveDraft();
    });
    $('publishBtn').addEventListener('click', publish);
  }

  // ===========================================================
  // Apply imported / loaded data
  // ===========================================================
  function applyData(data) {
    if (data.etsySettings) etsySettings = Object.assign(defaultEtsySettings(), data.etsySettings);
    if (Array.isArray(data.freeModels)) {
      freeModelTiles = data.freeModels.map(function (m) {
        return Object.assign(defaultFreeModelTile(0), m, {
          _file: null, _preview: null, _imageDir: FREE_MODEL_IMG_DIR,
          _localExt: (String(m.localImage || 'x.jpg').split('.').pop() || 'jpg').toLowerCase(),
        });
      });
    }
    buildEtsySettings();
    buildFreeModelsGrid();
  }

  // ===========================================================
  // Publish
  // ===========================================================
  function cleanFreeModel(t) {
    return {
      id: t.id, enabled: t.enabled, title: t.title, alt: t.alt, url: t.url,
      buttonText: t.buttonText || 'Download', imageMode: t.imageMode,
      localImage: t.localImage, remoteImage: t.remoteImage,
    };
  }

  async function publish() {
    var payload = {
      _note: 'Listings-only file for the Originals page (Etsy section + Free Models). Project entries live in /data/originals/.',
      updatedAt: new Date().toISOString(),
      etsySettings: Object.assign({}, etsySettings),
      freeModels: freeModelTiles.map(cleanFreeModel),
    };
    // Preserve any legacy keys still present in the source file, untouched.
    if (importedData) {
      ['currentProject', 'projectArchive'].forEach(function (k) {
        if (importedData[k] !== undefined && payload[k] === undefined) payload[k] = importedData[k];
      });
    }

    var json = JSON.stringify(payload, null, 2);
    var files = [{ path: REPO_CONTENT_PATH, content: json }];
    freeModelTiles.forEach(function (t) {
      if (t.imageMode === 'local' && t._file) {
        files.push({ path: t.localImage.replace(/^\/+/, ''), blob: t._file });
      }
    });

    if (window.RepoFS && RepoFS.isConnected()) {
      try {
        for (var i = 0; i < files.length; i++) {
          await RepoFS.writeFile(files[i].path, files[i].content != null ? files[i].content : files[i].blob);
        }
        showStatus('Published — ' + files.length + ' file(s) written to the repository. Commit with git.', 'success');
      } catch (err) {
        showStatus('Write failed: ' + (err.message || err), 'error');
      }
      return;
    }

    // Fallback: ZIP if images present, else plain JSON
    if (files.length > 1 && typeof JSZip !== 'undefined') {
      var zip = new JSZip();
      files.forEach(function (f) { zip.file(f.path, f.content != null ? f.content : f.blob); });
      var blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, 'originals-listings-export.zip');
      showStatus('Downloaded originals-listings-export.zip — extract at the repo root.', 'info');
    } else {
      downloadBlob(new Blob([json], { type: 'application/json' }), 'originals-content.json');
      showStatus('Downloaded originals-content.json — place it at /data/.', 'info');
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
  // Draft (localStorage)
  // ===========================================================
  function saveDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        etsySettings: etsySettings,
        freeModels: freeModelTiles.map(function (t) {
          var c = Object.assign({}, t); delete c._file; return c;
        }),
      }));
    } catch (_) {}
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (d.etsySettings) etsySettings = Object.assign(defaultEtsySettings(), d.etsySettings);
      if (Array.isArray(d.freeModels)) {
        freeModelTiles = d.freeModels.map(function (m) {
          return Object.assign(defaultFreeModelTile(0), m, { _file: null, _imageDir: FREE_MODEL_IMG_DIR });
        });
      }
      buildEtsySettings();
      buildFreeModelsGrid();
      return true;
    } catch (_) { return false; }
  }

  // ===========================================================
  // Status / helpers
  // ===========================================================
  var statusTimer = null;
  function showStatus(msg, type) {
    var bar = $('statusBar');
    bar.textContent = msg;
    bar.className = 'status-bar show ' + (type || 'info');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { bar.className = 'status-bar'; }, 6000);
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);

})();
