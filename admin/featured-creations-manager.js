/* ============================================================
   Featured Creations Manager — Gachafruit Studio
   Manages 4 featured homepage tiles.
   Self-contained IIFE. Depends on JSZip (loaded via CDN).
   ============================================================ */

(function () {
  'use strict';

  // ---- Config -----------------------------------------------
  const TILE_COUNT   = 4;
  const STORAGE_KEY  = 'gachafruit_featured_draft';
  const IMAGE_DIR    = 'assets/images/featured-creations';

  // ---- State ------------------------------------------------
  let tiles        = [];   // runtime tile objects (includes _file, _preview)
  let importedData = null; // last successfully imported JSON snapshot

  // ---- Default tile factory ---------------------------------
  function defaultTile(n) {
    const id = `F${n}`;
    return {
      id,
      enabled:     true,
      title:       '',
      price:       '',
      alt:         '',
      url:         '',
      imageMode:   'local',
      localImage:  `${IMAGE_DIR}/${id}.jpg`,
      remoteImage: '',
      // runtime only (not exported to JSON)
      _file:       null,
      _preview:    null,
      _localExt:   'jpg',
    };
  }

  // ===========================================================
  // Init
  // ===========================================================
  function init() {
    // Build state array
    for (let i = 1; i <= TILE_COUNT; i++) {
      tiles.push(defaultTile(i));
    }

    buildAllTiles();
    bindToolbar();
    loadDraft();
  }

  // ===========================================================
  // Build tile card DOM
  // ===========================================================
  function buildAllTiles() {
    const grid = document.getElementById('tilesGrid');
    tiles.forEach(tile => {
      const card = buildTileCard(tile);
      grid.appendChild(card);
      bindTileEvents(tile.id);
    });
  }

  function buildTileCard(tile) {
    const div = document.createElement('div');
    div.className = 'tile-card';
    div.dataset.tileId = tile.id;
    div.innerHTML = `
      <!-- Header -->
      <div class="tile-header">
        <span class="tile-id">${tile.id}</span>
        <label class="toggle-label">
          <input type="checkbox" class="toggle-checkbox tile-enabled" checked>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">Enabled</span>
        </label>
      </div>

      <!-- Body: form (left) + preview (right) -->
      <div class="tile-body">

        <!-- Form -->
        <div class="tile-form">

          <div class="form-group">
            <label class="form-label">Title</label>
            <input type="text" class="tile-title" placeholder="e.g., Torii Gate Cable Organizer">
          </div>

          <div class="form-group">
            <label class="form-label">
              Price
              <span class="form-label-optional">optional</span>
            </label>
            <input type="text" class="tile-price" placeholder="e.g., $35.00">
          </div>

          <div class="form-group">
            <label class="form-label">
              Alt Text
              <span class="form-label-optional">optional</span>
            </label>
            <input type="text" class="tile-alt" placeholder="Brief image description">
          </div>

          <div class="form-group">
            <label class="form-label">
              Destination URL
              <a class="test-url-link hidden" href="#" target="_blank" rel="noopener">Test URL ↗</a>
            </label>
            <input type="url" class="tile-url" placeholder="https://www.etsy.com/listing/...">
          </div>

          <div class="form-group">
            <label class="form-label">Image</label>
            <div class="mode-tabs">
              <button class="mode-tab active" data-mode="local">Upload</button>
              <button class="mode-tab"        data-mode="remote">URL</button>
            </div>
          </div>

          <!-- Local upload section -->
          <div class="image-section image-section-local">
            <div class="upload-zone" tabindex="0" role="button" aria-label="Upload image">
              <div class="upload-icon">⬆</div>
              <div class="upload-text">Click or drag an image here</div>
              <div class="upload-hint">JPG, PNG, WebP — recommended 800×800px</div>
            </div>
            <input type="file" class="file-input" accept="image/*" style="display:none">
            <div class="local-preview">
              <img class="local-preview-thumb" src="" alt="">
              <div class="local-preview-info">
                <div class="local-preview-name"></div>
                <div class="local-preview-path"></div>
              </div>
              <button class="clear-local-btn" type="button">Remove</button>
            </div>
          </div>

          <!-- Remote URL section -->
          <div class="image-section image-section-remote hidden">
            <div class="form-group">
              <input type="url" class="tile-remote-image" placeholder="https://i.etsystatic.com/...">
            </div>
          </div>

        </div><!-- /tile-form -->

        <!-- Preview -->
        <div class="tile-preview">
          <div class="preview-label">Live Preview</div>
          <div class="preview-card">
            <div class="preview-img-wrap">
              <div class="preview-img-placeholder"></div>
            </div>
            <div class="preview-body">
              <div class="preview-title empty">No title yet</div>
              <div class="preview-price hidden"></div>
              <div class="preview-btn">View Details</div>
            </div>
          </div>
          <div class="preview-disabled-note">Tile is inactive — will not appear on homepage</div>
        </div>

      </div><!-- /tile-body -->
    `;
    return div;
  }

  // ===========================================================
  // Bind events for one tile
  // ===========================================================
  function bindTileEvents(id) {
    const tile   = getTile(id);
    const editor = getEditor(id);

    // Text inputs — sync state + save + update preview
    const onText = () => { syncDOMToState(id); saveDraft(); updatePreview(id); };

    editor.querySelector('.tile-title').addEventListener('input', onText);
    editor.querySelector('.tile-price').addEventListener('input', onText);
    editor.querySelector('.tile-alt').addEventListener('input', onText);
    editor.querySelector('.tile-remote-image').addEventListener('input', onText);

    // URL field — also show/hide "Test URL" link
    editor.querySelector('.tile-url').addEventListener('input', () => {
      syncDOMToState(id);
      updateTestUrlLink(id);
      saveDraft();
      updatePreview(id);
    });

    // Enabled toggle
    editor.querySelector('.tile-enabled').addEventListener('change', (e) => {
      tile.enabled = e.target.checked;
      getEditor(id).classList.toggle('is-disabled', !tile.enabled);
      saveDraft();
      updatePreview(id);
    });

    // Mode tabs
    editor.querySelectorAll('.mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        tile.imageMode = btn.dataset.mode;
        editor.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b === btn));
        editor.querySelector('.image-section-local').classList.toggle('hidden', tile.imageMode !== 'local');
        editor.querySelector('.image-section-remote').classList.toggle('hidden', tile.imageMode !== 'remote');
        saveDraft();
        updatePreview(id);
      });
    });

    // Upload zone
    const zone      = editor.querySelector('.upload-zone');
    const fileInput = editor.querySelector('.file-input');

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) handleFileUpload(id, file);
    });

    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) handleFileUpload(id, file);
    });

    // Clear local image
    editor.querySelector('.clear-local-btn').addEventListener('click', () => {
      tile._file    = null;
      tile._preview = null;
      tile._localExt = 'jpg';
      tile.localImage = `${IMAGE_DIR}/${id}.jpg`;
      editor.querySelector('.local-preview').classList.remove('show');
      editor.querySelector('.file-input').value = '';
      saveDraft();
      updatePreview(id);
    });
  }

  // ===========================================================
  // File upload handler
  // ===========================================================
  function handleFileUpload(id, file) {
    const tile   = getTile(id);
    const editor = getEditor(id);
    const ext    = file.name.split('.').pop().toLowerCase() || 'jpg';

    tile._file    = file;
    tile._localExt = ext;
    tile.localImage = `${IMAGE_DIR}/${id}.${ext}`;

    const reader = new FileReader();
    reader.onload = e => {
      tile._preview = e.target.result;

      // Show local preview strip
      const preview = editor.querySelector('.local-preview');
      editor.querySelector('.local-preview-thumb').src = tile._preview;
      editor.querySelector('.local-preview-name').textContent = file.name;
      editor.querySelector('.local-preview-path').textContent = tile.localImage;
      preview.classList.add('show');

      saveDraft();
      updatePreview(id);
    };
    reader.readAsDataURL(file);
  }

  // ===========================================================
  // Sync DOM → tile state (text fields only)
  // ===========================================================
  function syncDOMToState(id) {
    const tile   = getTile(id);
    const editor = getEditor(id);
    tile.title       = editor.querySelector('.tile-title').value.trim();
    tile.price       = editor.querySelector('.tile-price').value.trim();
    tile.alt         = editor.querySelector('.tile-alt').value.trim();
    tile.url         = editor.querySelector('.tile-url').value.trim();
    tile.remoteImage = editor.querySelector('.tile-remote-image').value.trim();
  }

  // ===========================================================
  // Update "Test URL" link visibility
  // ===========================================================
  function updateTestUrlLink(id) {
    const tile   = getTile(id);
    const link   = getEditor(id).querySelector('.test-url-link');
    if (tile.url) {
      link.href = tile.url;
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  }

  // ===========================================================
  // Update live preview card
  // ===========================================================
  function updatePreview(id) {
    const tile   = getTile(id);
    const editor = getEditor(id);
    const card   = editor.querySelector('.preview-card');
    const wrap   = editor.querySelector('.preview-img-wrap');
    const note   = editor.querySelector('.preview-disabled-note');

    // Disabled state
    card.classList.toggle('is-disabled', !tile.enabled);
    note.classList.toggle('show', !tile.enabled);

    // Image
    const existing = wrap.querySelector('img.preview-live-img');
    let imgSrc = null;

    if (tile.imageMode === 'local' && tile._preview) {
      imgSrc = tile._preview;
    } else if (tile.imageMode === 'remote' && tile.remoteImage) {
      imgSrc = tile.remoteImage;
    }

    if (imgSrc) {
      if (existing) {
        existing.src = imgSrc;
      } else {
        // Remove placeholder, insert real img
        const placeholder = wrap.querySelector('.preview-img-placeholder');
        if (placeholder) placeholder.remove();
        const img = document.createElement('img');
        img.className = 'preview-live-img';
        img.alt = tile.alt || '';
        img.onerror = () => {
          img.remove();
          if (!wrap.querySelector('.preview-img-placeholder')) {
            const ph = document.createElement('div');
            ph.className = 'preview-img-placeholder';
            wrap.appendChild(ph);
          }
        };
        img.src = imgSrc;
        wrap.appendChild(img);
      }
    } else {
      // Remove img if present, ensure placeholder exists
      if (existing) existing.remove();
      if (!wrap.querySelector('.preview-img-placeholder')) {
        const ph = document.createElement('div');
        ph.className = 'preview-img-placeholder';
        wrap.appendChild(ph);
      }
    }

    // Title
    const titleEl = editor.querySelector('.preview-title');
    if (tile.title) {
      titleEl.textContent = tile.title;
      titleEl.classList.remove('empty');
    } else {
      titleEl.textContent = 'No title yet';
      titleEl.classList.add('empty');
    }

    // Price
    const priceEl = editor.querySelector('.preview-price');
    if (tile.price) {
      priceEl.textContent = tile.price;
      priceEl.classList.remove('hidden');
    } else {
      priceEl.classList.add('hidden');
    }
  }

  // ===========================================================
  // Apply data from JSON (import / reset) — tolerant of partial data
  // ===========================================================
  function applyData(data) {
    if (!data || !Array.isArray(data.tiles)) return;

    data.tiles.forEach(src => {
      const tile = getTile(src.id);
      if (!tile) return;

      tile.enabled     = src.enabled    ?? true;
      tile.title       = src.title      ?? '';
      tile.price       = src.price      ?? '';
      tile.alt         = src.alt        ?? '';
      tile.url         = src.url        ?? '';
      tile.imageMode   = src.imageMode  ?? 'local';
      tile.localImage  = src.localImage ?? `${IMAGE_DIR}/${tile.id}.jpg`;
      tile.remoteImage = src.remoteImage ?? '';
      // _file and _preview not restored from JSON (only from draft localStorage)

      refreshEditorDOM(tile.id);
    });
  }

  // ===========================================================
  // Refresh editor DOM from tile state (after import / reset / draft load)
  // ===========================================================
  function refreshEditorDOM(id) {
    const tile   = getTile(id);
    const editor = getEditor(id);

    editor.querySelector('.tile-enabled').checked   = tile.enabled;
    editor.querySelector('.tile-title').value        = tile.title;
    editor.querySelector('.tile-price').value        = tile.price;
    editor.querySelector('.tile-alt').value          = tile.alt;
    editor.querySelector('.tile-url').value          = tile.url;
    editor.querySelector('.tile-remote-image').value = tile.remoteImage;

    editor.classList.toggle('is-disabled', !tile.enabled);

    // Mode tabs
    editor.querySelectorAll('.mode-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === tile.imageMode);
    });
    editor.querySelector('.image-section-local').classList.toggle('hidden',  tile.imageMode !== 'local');
    editor.querySelector('.image-section-remote').classList.toggle('hidden', tile.imageMode !== 'remote');

    updateTestUrlLink(id);

    // Restore preview thumb if _preview is available (from draft)
    if (tile._preview) {
      const preview = editor.querySelector('.local-preview');
      editor.querySelector('.local-preview-thumb').src = tile._preview;
      editor.querySelector('.local-preview-name').textContent  = tile._file ? tile._file.name : `${id}.${tile._localExt}`;
      editor.querySelector('.local-preview-path').textContent  = tile.localImage;
      preview.classList.add('show');
    } else {
      editor.querySelector('.local-preview').classList.remove('show');
    }

    updatePreview(id);
  }

  // ===========================================================
  // LocalStorage
  // ===========================================================
  function saveDraft() {
    const draft = {
      savedAt: new Date().toISOString(),
      tiles: tiles.map(t => ({
        id:          t.id,
        enabled:     t.enabled,
        title:       t.title,
        price:       t.price,
        alt:         t.alt,
        url:         t.url,
        imageMode:   t.imageMode,
        localImage:  t.localImage,
        remoteImage: t.remoteImage,
        _localExt:   t._localExt,
        _preview:    t._preview,  // base64 thumbnail
      }))
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch (e) {
      // Storage full — skip silently (base64 images can be large)
    }
  }

  function loadDraft() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      showStatus('Ready. Import featured-creations.json or start editing.', 'info');
      return;
    }

    try {
      const draft = JSON.parse(saved);
      draft.tiles.forEach(src => {
        const tile = getTile(src.id);
        if (!tile) return;
        Object.assign(tile, src);
        // _file cannot be persisted; clear it on load
        tile._file = null;
        refreshEditorDOM(tile.id);
      });
      const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'unknown time';
      showStatus(`Draft restored from ${when}.`, 'info');
    } catch (e) {
      showStatus('Could not restore draft — starting fresh.', 'error');
    }
  }

  // ===========================================================
  // Toolbar
  // ===========================================================
  function bindToolbar() {
    document.getElementById('importBtn').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) handleImport(file);
      e.target.value = ''; // allow re-import of same file
    });
    document.getElementById('resetBtn').addEventListener('click', resetToImported);
    document.getElementById('clearBtn').addEventListener('click', clearDraft);
    document.getElementById('exportBtn').addEventListener('click', exportData);
  }

  function handleImport(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        importedData = data;
        applyData(data);
        saveDraft();
        showStatus('Imported successfully.', 'success');
      } catch (err) {
        showStatus('Could not parse JSON: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  function resetToImported() {
    if (!importedData) {
      showStatus('Nothing to reset to — import a JSON file first.', 'error');
      return;
    }
    applyData(importedData);
    saveDraft();
    showStatus('Reset to imported data.', 'success');
  }

  function clearDraft() {
    if (!confirm('Clear all draft data? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_KEY);
    importedData = null;

    tiles.forEach((tile, i) => {
      const fresh = defaultTile(i + 1);
      Object.assign(tile, fresh);
      refreshEditorDOM(tile.id);
    });

    showStatus('Draft cleared.', 'success');
  }

  // ===========================================================
  // Export
  // ===========================================================
  async function exportData() {
    // Build clean JSON (no runtime fields)
    const payload = {
      updatedAt: new Date().toISOString(),
      tiles: tiles.map(t => ({
        id:          t.id,
        enabled:     t.enabled,
        title:       t.title,
        price:       t.price,
        alt:         t.alt,
        url:         t.url,
        imageMode:   t.imageMode,
        localImage:  t.localImage,
        remoteImage: t.remoteImage,
      }))
    };

    // Download JSON
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      'featured-creations.json'
    );

    // If any tile has a freshly-uploaded local file, also export image ZIP
    const tilesWithFiles = tiles.filter(t => t.imageMode === 'local' && t._file);
    if (tilesWithFiles.length > 0) {
      try {
        await exportImageZip(tilesWithFiles);
        showStatus(
          `Exported featured-creations.json + ZIP with ${tilesWithFiles.length} image(s).`,
          'success'
        );
      } catch (err) {
        showStatus('JSON exported. ZIP failed: ' + err.message, 'error');
      }
    } else {
      showStatus('Exported featured-creations.json. (No new local images to zip.)', 'success');
    }
  }

  async function exportImageZip(tilesWithFiles) {
    const zip    = new JSZip();
    const folder = zip.folder('featured-creations');

    for (const tile of tilesWithFiles) {
      const ext      = tile._localExt || 'jpg';
      const filename = `${tile.id}.${ext}`;  // normalized to tile ID
      folder.file(filename, tile._file);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'featured-creations-images.zip');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ===========================================================
  // Status bar
  // ===========================================================
  let statusTimer = null;
  function showStatus(msg, type = 'info') {
    const bar = document.getElementById('statusBar');
    bar.textContent = msg;
    bar.className   = `status-bar show ${type}`;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => bar.classList.remove('show'), 5000);
  }

  // ===========================================================
  // Helpers
  // ===========================================================
  function getTile(id)   { return tiles.find(t => t.id === id); }
  function getEditor(id) { return document.querySelector(`[data-tile-id="${id}"]`); }

  // ===========================================================
  // Boot
  // ===========================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
