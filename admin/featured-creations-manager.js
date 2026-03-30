/* ============================================================
   Homepage Content Manager — Gachafruit Studio
   Manages Featured Creations (4 tiles) and Explore All (variable).
   Self-contained IIFE. Depends on JSZip (CDN).
   ============================================================ */

(function () {
  'use strict';

  // ---- Config -----------------------------------------------
  const FEATURED_COUNT    = 4;
  const EXPLORE_DEFAULT   = 12;
  const EXPLORE_MAX       = 100;
  const STORAGE_KEY       = 'gachafruit_featured_draft';
  const FEATURED_IMG_DIR  = 'assets/images/featured-creations';
  const EXPLORE_IMG_DIR   = 'assets/images/explore-all';

  // ---- State ------------------------------------------------
  let featuredTiles  = [];
  let exploreTiles   = [];
  let importedData   = null;

  const exploreSettings = {
    mode:                 'manual',
    homepageVisibleCount: 8,
    viewAllUrl:           '',
    slotCount:            EXPLORE_DEFAULT,
  };

  // ===========================================================
  // Default tile factories
  // ===========================================================
  function defaultFeaturedTile(n) {
    const id = `F${n}`;
    return {
      id,
      enabled:     true,
      title:       '',
      price:       '',
      alt:         '',
      url:         '',
      imageMode:   'local',
      localImage:  `${FEATURED_IMG_DIR}/${id}.jpg`,
      remoteImage: '',
      // runtime only — not in exported JSON
      _file:       null,
      _preview:    null,
      _localExt:   'jpg',
      _imageDir:   FEATURED_IMG_DIR,
    };
  }

  function defaultExploreTile(idNum) {
    const id = `E${idNum}`;
    return {
      id,
      enabled:     true,
      title:       '',
      price:       '',
      alt:         '',
      url:         '',
      imageMode:   'local',
      localImage:  `${EXPLORE_IMG_DIR}/${id}.jpg`,
      remoteImage: '',
      // runtime only
      _file:       null,
      _preview:    null,
      _localExt:   'jpg',
      _imageDir:   EXPLORE_IMG_DIR,
    };
  }

  // Compute the next explore ID from existing tiles
  function nextExploreIdNum() {
    if (exploreTiles.length === 0) return 1;
    const nums = exploreTiles.map(t => parseInt(t.id.slice(1)) || 0);
    return Math.max(...nums) + 1;
  }

  // ===========================================================
  // Init
  // ===========================================================
  function init() {
    // Build initial state
    for (let i = 1; i <= FEATURED_COUNT; i++) {
      featuredTiles.push(defaultFeaturedTile(i));
    }
    for (let i = 1; i <= exploreSettings.slotCount; i++) {
      exploreTiles.push(defaultExploreTile(i));
    }

    // Render
    buildFeaturedGrid();
    buildExploreGrid();
    refreshExploreSettingsDOM();
    bindExploreSettings();
    bindToolbar();
    loadDraft();
  }

  // ===========================================================
  // SHARED — build one tile card
  // ===========================================================
  function buildTileCard(tile, showMoveControls) {
    const div = document.createElement('div');
    div.className = 'tile-card';
    div.dataset.tileId = tile.id;

    const headerLeft = showMoveControls
      ? `<div class="tile-id-group">
           <span class="tile-id">${tile.id}</span>
           <div class="move-controls">
             <button class="move-btn" data-dir="up"   title="Move up">↑</button>
             <button class="move-btn" data-dir="down" title="Move down">↓</button>
           </div>
         </div>`
      : `<span class="tile-id">${tile.id}</span>`;

    div.innerHTML = `
      <div class="tile-header">
        ${headerLeft}
        <label class="toggle-label">
          <input type="checkbox" class="toggle-checkbox tile-enabled"${tile.enabled ? ' checked' : ''}>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">Enabled</span>
        </label>
      </div>

      <div class="tile-body">

        <div class="tile-form">

          <div class="form-group">
            <label class="form-label">Title</label>
            <input type="text" class="tile-title" placeholder="e.g., Torii Gate Cable Organizer">
          </div>

          <div class="form-group">
            <label class="form-label">
              Price <span class="form-label-optional">optional</span>
            </label>
            <input type="text" class="tile-price" placeholder="e.g., $35.00">
          </div>

          <div class="form-group">
            <label class="form-label">
              Alt Text <span class="form-label-optional">optional</span>
            </label>
            <input type="text" class="tile-alt" placeholder="Brief image description">
          </div>

          <div class="form-group">
            <label class="form-label">
              Destination URL
              <a class="test-url-link hidden" href="#" target="_blank" rel="noopener">Test ↗</a>
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

          <div class="image-section image-section-remote hidden">
            <div class="form-group">
              <input type="url" class="tile-remote-image" placeholder="https://i.etsystatic.com/...">
            </div>
          </div>

        </div><!-- /tile-form -->

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
  // SHARED — bind all events for one tile
  // ===========================================================
  function bindTileEvents(tile, onMove) {
    const id     = tile.id;
    const editor = getEditor(id);

    const onText = () => { syncDOMToState(id); saveDraft(); updatePreview(id); };

    editor.querySelector('.tile-title').addEventListener('input', onText);
    editor.querySelector('.tile-price').addEventListener('input', onText);
    editor.querySelector('.tile-alt').addEventListener('input', onText);
    editor.querySelector('.tile-remote-image').addEventListener('input', onText);

    editor.querySelector('.tile-url').addEventListener('input', () => {
      syncDOMToState(id); updateTestUrlLink(id); saveDraft(); updatePreview(id);
    });

    editor.querySelector('.tile-enabled').addEventListener('change', e => {
      tile.enabled = e.target.checked;
      editor.classList.toggle('is-disabled', !tile.enabled);
      saveDraft();
      updatePreview(id);
    });

    // Image mode tabs
    editor.querySelectorAll('.mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        tile.imageMode = btn.dataset.mode;
        editor.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b === btn));
        editor.querySelector('.image-section-local').classList.toggle('hidden',  tile.imageMode !== 'local');
        editor.querySelector('.image-section-remote').classList.toggle('hidden', tile.imageMode !== 'remote');
        saveDraft();
        updatePreview(id);
      });
    });

    // Upload zone
    const zone      = editor.querySelector('.upload-zone');
    const fileInput = editor.querySelector('.file-input');

    zone.addEventListener('click',   ()  => fileInput.click());
    zone.addEventListener('keydown', e   => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
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
      tile.localImage = `${tile._imageDir}/${id}.jpg`;
      editor.querySelector('.local-preview').classList.remove('show');
      editor.querySelector('.file-input').value = '';
      saveDraft();
      updatePreview(id);
    });

    // Move controls (Explore All only)
    if (onMove) {
      editor.querySelectorAll('.move-btn').forEach(btn => {
        btn.addEventListener('click', () => onMove(id, btn.dataset.dir));
      });
    }
  }

  // ===========================================================
  // SHARED — sync DOM fields into tile state
  // ===========================================================
  function syncDOMToState(id) {
    const tile   = findTile(id);
    const editor = getEditor(id);
    tile.title       = editor.querySelector('.tile-title').value.trim();
    tile.price       = editor.querySelector('.tile-price').value.trim();
    tile.alt         = editor.querySelector('.tile-alt').value.trim();
    tile.url         = editor.querySelector('.tile-url').value.trim();
    tile.remoteImage = editor.querySelector('.tile-remote-image').value.trim();
  }

  // ===========================================================
  // SHARED — update "Test URL" link
  // ===========================================================
  function updateTestUrlLink(id) {
    const tile = findTile(id);
    const link = getEditor(id).querySelector('.test-url-link');
    if (tile.url) {
      link.href = tile.url;
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  }

  // ===========================================================
  // SHARED — file upload handler
  // ===========================================================
  function handleFileUpload(id, file) {
    const tile   = findTile(id);
    const editor = getEditor(id);
    const ext    = file.name.split('.').pop().toLowerCase() || 'jpg';

    tile._file     = file;
    tile._localExt = ext;
    tile.localImage = `${tile._imageDir}/${id}.${ext}`;

    const reader = new FileReader();
    reader.onload = e => {
      tile._preview = e.target.result;
      editor.querySelector('.local-preview-thumb').src = tile._preview;
      editor.querySelector('.local-preview-name').textContent = file.name;
      editor.querySelector('.local-preview-path').textContent = tile.localImage;
      editor.querySelector('.local-preview').classList.add('show');
      saveDraft();
      updatePreview(id);
    };
    reader.readAsDataURL(file);
  }

  // ===========================================================
  // SHARED — live preview update
  // ===========================================================
  function updatePreview(id) {
    const tile   = findTile(id);
    const editor = getEditor(id);
    const card   = editor.querySelector('.preview-card');
    const wrap   = editor.querySelector('.preview-img-wrap');
    const note   = editor.querySelector('.preview-disabled-note');

    card.classList.toggle('is-disabled', !tile.enabled);
    note.classList.toggle('show', !tile.enabled);

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
        existing.alt = tile.alt || '';
      } else {
        const ph = wrap.querySelector('.preview-img-placeholder');
        if (ph) ph.remove();
        const img = document.createElement('img');
        img.className = 'preview-live-img';
        img.alt = tile.alt || '';
        img.onerror = () => {
          img.remove();
          if (!wrap.querySelector('.preview-img-placeholder')) {
            const p = document.createElement('div');
            p.className = 'preview-img-placeholder';
            wrap.appendChild(p);
          }
        };
        img.src = imgSrc;
        wrap.appendChild(img);
      }
    } else {
      if (existing) existing.remove();
      if (!wrap.querySelector('.preview-img-placeholder')) {
        const p = document.createElement('div');
        p.className = 'preview-img-placeholder';
        wrap.appendChild(p);
      }
    }

    const titleEl = editor.querySelector('.preview-title');
    if (tile.title) {
      titleEl.textContent = tile.title;
      titleEl.classList.remove('empty');
    } else {
      titleEl.textContent = 'No title yet';
      titleEl.classList.add('empty');
    }

    const priceEl = editor.querySelector('.preview-price');
    if (tile.price) {
      priceEl.textContent = tile.price;
      priceEl.classList.remove('hidden');
    } else {
      priceEl.classList.add('hidden');
    }
  }

  // ===========================================================
  // SHARED — push tile state into editor DOM
  // ===========================================================
  function refreshEditorDOM(id) {
    const tile   = findTile(id);
    const editor = getEditor(id);
    if (!editor) return;

    editor.querySelector('.tile-enabled').checked      = tile.enabled;
    editor.querySelector('.tile-title').value           = tile.title;
    editor.querySelector('.tile-price').value           = tile.price;
    editor.querySelector('.tile-alt').value             = tile.alt;
    editor.querySelector('.tile-url').value             = tile.url;
    editor.querySelector('.tile-remote-image').value    = tile.remoteImage;

    editor.classList.toggle('is-disabled', !tile.enabled);

    editor.querySelectorAll('.mode-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === tile.imageMode);
    });
    editor.querySelector('.image-section-local').classList.toggle('hidden',  tile.imageMode !== 'local');
    editor.querySelector('.image-section-remote').classList.toggle('hidden', tile.imageMode !== 'remote');

    updateTestUrlLink(id);

    if (tile._preview) {
      editor.querySelector('.local-preview-thumb').src            = tile._preview;
      editor.querySelector('.local-preview-name').textContent     = tile._file ? tile._file.name : `${id}.${tile._localExt}`;
      editor.querySelector('.local-preview-path').textContent     = tile.localImage;
      editor.querySelector('.local-preview').classList.add('show');
    } else {
      editor.querySelector('.local-preview').classList.remove('show');
    }

    updatePreview(id);
  }

  // ===========================================================
  // SHARED — apply raw JSON data onto a tile object
  // ===========================================================
  function applyTileData(tile, src) {
    tile.enabled     = src.enabled     ?? true;
    tile.title       = src.title       ?? '';
    tile.price       = src.price       ?? '';
    tile.alt         = src.alt         ?? '';
    tile.url         = src.url         ?? '';
    tile.imageMode   = src.imageMode   ?? 'local';
    tile.localImage  = src.localImage  ?? `${tile._imageDir}/${tile.id}.jpg`;
    tile.remoteImage = src.remoteImage ?? '';
    // _file / _preview / _localExt stay as-is (runtime only, not in JSON)
  }

  // ===========================================================
  // Featured Creations — build grid
  // ===========================================================
  function buildFeaturedGrid() {
    const grid = document.getElementById('tilesGrid');
    featuredTiles.forEach(tile => {
      grid.appendChild(buildTileCard(tile, false));
      bindTileEvents(tile, null);
    });
  }

  // ===========================================================
  // Explore All — build / rebuild grid
  // ===========================================================
  function buildExploreGrid() {
    const grid = document.getElementById('exploreTilesGrid');
    grid.innerHTML = '';
    exploreTiles.forEach(tile => {
      grid.appendChild(buildTileCard(tile, true));
      bindTileEvents(tile, moveExploreTile);
      refreshEditorDOM(tile.id);
    });
    updateMoveBtnState();
  }

  // Rebuild after reorder or slot count change
  function rebuildExploreGrid() {
    buildExploreGrid();
  }

  // Disable first tile's ↑ and last tile's ↓
  function updateMoveBtnState() {
    exploreTiles.forEach((tile, idx) => {
      const editor = getEditor(tile.id);
      if (!editor) return;
      const [upBtn, downBtn] = editor.querySelectorAll('.move-btn');
      if (upBtn)   upBtn.disabled   = (idx === 0);
      if (downBtn) downBtn.disabled = (idx === exploreTiles.length - 1);
    });
  }

  // ===========================================================
  // Explore All — move tile up or down
  // ===========================================================
  function moveExploreTile(id, direction) {
    const idx = exploreTiles.findIndex(t => t.id === id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= exploreTiles.length) return;

    // Swap
    [exploreTiles[idx], exploreTiles[targetIdx]] = [exploreTiles[targetIdx], exploreTiles[idx]];

    rebuildExploreGrid();
    saveDraft();
  }

  // ===========================================================
  // Explore All — settings panel
  // ===========================================================
  function bindExploreSettings() {
    // Source mode tabs
    document.querySelectorAll('.source-mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        exploreSettings.mode = btn.dataset.mode;
        refreshExploreSettingsDOM();
        saveDraft();
      });
    });

    // Homepage visible count
    document.getElementById('homepageVisibleCount').addEventListener('input', e => {
      const v = parseInt(e.target.value);
      if (!isNaN(v) && v >= 1) {
        exploreSettings.homepageVisibleCount = v;
        document.getElementById('visibleCountDisplay').textContent = v;
        saveDraft();
      }
    });

    // View All URL
    document.getElementById('viewAllUrl').addEventListener('input', e => {
      exploreSettings.viewAllUrl = e.target.value.trim();
      saveDraft();
    });

    // Slot count apply button
    document.getElementById('applySlotCount').addEventListener('click', () => {
      const v = parseInt(document.getElementById('slotCount').value);
      if (!isNaN(v)) applySlotCount(v);
    });
  }

  function refreshExploreSettingsDOM() {
    document.querySelectorAll('.source-mode-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === exploreSettings.mode);
    });
    document.getElementById('homepageVisibleCount').value = exploreSettings.homepageVisibleCount;
    document.getElementById('visibleCountDisplay').textContent = exploreSettings.homepageVisibleCount;
    document.getElementById('viewAllUrl').value = exploreSettings.viewAllUrl;
    document.getElementById('slotCount').value  = exploreSettings.slotCount;
    document.getElementById('apiModeNote').classList.toggle('hidden', exploreSettings.mode !== 'api-with-fallback');
  }

  // ===========================================================
  // Explore All — change slot count
  // ===========================================================
  function applySlotCount(newCount) {
    const n       = Math.max(1, Math.min(EXPLORE_MAX, parseInt(newCount) || EXPLORE_DEFAULT));
    const current = exploreTiles.length;

    if (n > current) {
      let next = nextExploreIdNum();
      for (let i = current; i < n; i++) {
        exploreTiles.push(defaultExploreTile(next++));
      }
    } else if (n < current) {
      const toRemove = exploreTiles.slice(n);
      const hasContent = toRemove.some(t => t.title || t.url || t._preview);
      if (hasContent && !confirm(`${current - n} slot(s) at the end have data and will be removed. Continue?`)) {
        document.getElementById('slotCount').value = current;
        return;
      }
      exploreTiles.splice(n);
    }

    exploreSettings.slotCount = n;
    document.getElementById('slotCount').value = n;
    rebuildExploreGrid();
    saveDraft();
    showStatus(`Updated to ${n} Explore All slots.`, 'success');
  }

  // ===========================================================
  // Apply JSON data → state (both sections, tolerant of partial data)
  // ===========================================================
  function applyData(data) {
    if (!data) return;

    // Support both new format { featuredCreations, exploreAll }
    // and old flat format { tiles }
    const fcData = data.featuredCreations || (data.tiles ? { tiles: data.tiles } : null);
    const eaData = data.exploreAll || null;

    if (fcData && Array.isArray(fcData.tiles)) {
      fcData.tiles.forEach(src => {
        const tile = featuredTiles.find(t => t.id === src.id);
        if (!tile) return;
        applyTileData(tile, src);
        refreshEditorDOM(tile.id);
      });
    }

    if (eaData) {
      if (eaData.mode                 != null) exploreSettings.mode                 = eaData.mode;
      if (eaData.homepageVisibleCount != null) exploreSettings.homepageVisibleCount = eaData.homepageVisibleCount;
      if (eaData.viewAllUrl           != null) exploreSettings.viewAllUrl           = eaData.viewAllUrl;

      if (eaData.slotCount != null && eaData.slotCount !== exploreSettings.slotCount) {
        // Resize array to match imported slot count before applying tile data
        const targetCount = Math.max(1, Math.min(EXPLORE_MAX, eaData.slotCount));
        while (exploreTiles.length < targetCount) {
          exploreTiles.push(defaultExploreTile(nextExploreIdNum()));
        }
        exploreTiles.splice(targetCount);
        exploreSettings.slotCount = targetCount;
      }

      if (Array.isArray(eaData.manualTiles)) {
        eaData.manualTiles.forEach((src, idx) => {
          // Grow array if the import has more tiles than current slots
          while (exploreTiles.length <= idx) {
            exploreTiles.push(defaultExploreTile(nextExploreIdNum()));
          }
          const tile = exploreTiles[idx];
          // Preserve tile._imageDir; only override id if src.id is present
          if (src.id) tile.id = src.id;
          applyTileData(tile, src);
        });
      }

      refreshExploreSettingsDOM();
      rebuildExploreGrid();
    }
  }

  // ===========================================================
  // Serialize a tile for draft storage (includes runtime preview)
  // ===========================================================
  function serializeTile(t) {
    return {
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
      _preview:    t._preview,
      _imageDir:   t._imageDir,
    };
  }

  // Serialize a tile for JSON export (clean, no runtime fields)
  function exportTile(t) {
    return {
      id:          t.id,
      enabled:     t.enabled,
      title:       t.title,
      price:       t.price,
      alt:         t.alt,
      url:         t.url,
      imageMode:   t.imageMode,
      localImage:  t.localImage,
      remoteImage: t.remoteImage,
    };
  }

  // ===========================================================
  // LocalStorage — save draft
  // ===========================================================
  function saveDraft() {
    const draft = {
      savedAt: new Date().toISOString(),
      featured: {
        tiles: featuredTiles.map(serializeTile),
      },
      explore: {
        settings: { ...exploreSettings },
        tiles:    exploreTiles.map(serializeTile),
      },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch (_) {
      // Storage full (large base64 images) — skip silently
    }
  }

  // ===========================================================
  // LocalStorage — load draft
  // ===========================================================
  function loadDraft() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      showStatus('Ready. Import featured-creations.json or start editing.', 'info');
      return;
    }

    try {
      const draft = JSON.parse(saved);

      // Handle old draft format (draft.tiles) and new (draft.featured.tiles)
      const fcTiles = draft.featured?.tiles || draft.tiles || [];
      fcTiles.forEach(src => {
        const tile = featuredTiles.find(t => t.id === src.id);
        if (!tile) return;
        Object.assign(tile, src);
        tile._file = null; // File objects can't be persisted
        refreshEditorDOM(tile.id);
      });

      if (draft.explore) {
        if (draft.explore.settings) {
          Object.assign(exploreSettings, draft.explore.settings);
        }
        if (Array.isArray(draft.explore.tiles)) {
          // Resize explore array to match saved slot count
          const targetCount = exploreSettings.slotCount;
          exploreTiles.length = 0;

          draft.explore.tiles.forEach((src, idx) => {
            if (idx >= targetCount) return;
            const tile = defaultExploreTile(idx + 1); // placeholder
            Object.assign(tile, src);
            tile._file     = null;
            tile._imageDir = src._imageDir || EXPLORE_IMG_DIR;
            exploreTiles.push(tile);
          });

          // Fill remaining slots if draft had fewer than slotCount
          let next = nextExploreIdNum();
          while (exploreTiles.length < targetCount) {
            exploreTiles.push(defaultExploreTile(next++));
          }
        }

        refreshExploreSettingsDOM();
        rebuildExploreGrid();
      }

      const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'unknown';
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
      e.target.value = '';
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
    if (!confirm('Clear all draft data for both sections? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_KEY);
    importedData = null;

    featuredTiles.forEach((tile, i) => {
      Object.assign(tile, defaultFeaturedTile(i + 1));
      refreshEditorDOM(tile.id);
    });

    Object.assign(exploreSettings, {
      mode: 'manual', homepageVisibleCount: 8, viewAllUrl: '', slotCount: EXPLORE_DEFAULT,
    });
    exploreTiles.length = 0;
    for (let i = 1; i <= EXPLORE_DEFAULT; i++) {
      exploreTiles.push(defaultExploreTile(i));
    }
    refreshExploreSettingsDOM();
    rebuildExploreGrid();
    showStatus('Draft cleared.', 'success');
  }

  // ===========================================================
  // Export
  // ===========================================================
  async function exportData() {
    const payload = {
      updatedAt: new Date().toISOString(),
      featuredCreations: {
        tiles: featuredTiles.map(exportTile),
      },
      exploreAll: {
        mode:                 exploreSettings.mode,
        homepageVisibleCount: exploreSettings.homepageVisibleCount,
        viewAllUrl:           exploreSettings.viewAllUrl,
        slotCount:            exploreSettings.slotCount,
        manualTiles:          exploreTiles.map(exportTile),
      },
    };

    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      'featured-creations.json'
    );

    // Collect tiles with freshly-uploaded local files (both sections)
    const withFiles = [
      ...featuredTiles.filter(t => t.imageMode === 'local' && t._file)
                      .map(t => ({ tile: t, folder: 'featured-creations' })),
      ...exploreTiles.filter(t => t.imageMode === 'local' && t._file)
                     .map(t => ({ tile: t, folder: 'explore-all' })),
    ];

    if (withFiles.length > 0) {
      try {
        await exportImageZip(withFiles);
        showStatus(`Exported JSON + ZIP with ${withFiles.length} image(s).`, 'success');
      } catch (err) {
        showStatus('JSON exported. ZIP failed: ' + err.message, 'error');
      }
    } else {
      showStatus('Exported featured-creations.json. (No new local images to zip.)', 'success');
    }
  }

  async function exportImageZip(entries) {
    const zip = new JSZip();
    for (const { tile, folder } of entries) {
      const ext      = tile._localExt || 'jpg';
      const filename = `${tile.id}.${ext}`;
      zip.folder(folder).file(filename, tile._file);
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
  function findTile(id) {
    return featuredTiles.find(t => t.id === id) || exploreTiles.find(t => t.id === id);
  }

  function getEditor(id) {
    return document.querySelector(`[data-tile-id="${id}"]`);
  }

  // ===========================================================
  // Boot
  // ===========================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
