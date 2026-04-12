/* ============================================================
   Originals Manager — Gachafruit Studio
   Manages: Current Project, Etsy Section Settings, Free Models.
   Exports to /data/originals-content.json format.
   Self-contained IIFE. Depends on JSZip (CDN).
   ============================================================ */

(function () {
  'use strict';

  // ---- Config -----------------------------------------------
  const STORAGE_KEY       = 'gachafruit_originals_draft';
  const FREE_MODEL_IMG_DIR = 'assets/images/originals/free-models';
  const PROJECT_IMG_DIR    = 'assets/images/originals/projects';

  // ---- State ------------------------------------------------
  let currentProject = defaultProject();
  let etsySettings   = defaultEtsySettings();
  let freeModelTiles = [];
  let importedData   = null;

  // ===========================================================
  // Default factories
  // ===========================================================
  function defaultProject() {
    return {
      id:      'project-001',
      title:   '',
      subtitle:'',
      date:    '',
      body:    '',
      images:  [],
      enabled: false,
    };
  }

  function defaultEtsySettings() {
    return {
      eyebrow:      'GACHAFRUIT ON ETSY',
      sectionTitle: 'Shop Our Originals',
      itemCount:    6,
      seeAllUrl:    '/explore-all/',
    };
  }

  function defaultFreeModelTile(n) {
    const id = `FM${n}`;
    return {
      id,
      enabled:     true,
      title:       '',
      alt:         '',
      url:         '',
      buttonText:  'Download',
      imageMode:   'local',
      localImage:  `${FREE_MODEL_IMG_DIR}/${id}.jpg`,
      remoteImage: '',
      _file:       null,
      _preview:    null,
      _localExt:   'jpg',
      _imageDir:   FREE_MODEL_IMG_DIR,
    };
  }

  function defaultProjectImage(n) {
    return {
      id:          `img-${n}`,
      imageMode:   'local',
      localImage:  '',
      remoteImage: '',
      alt:         '',
      _file:       null,
      _preview:    null,
      _localExt:   'jpg',
    };
  }

  function nextFreeModelIdNum() {
    if (freeModelTiles.length === 0) return 1;
    const nums = freeModelTiles.map(t => parseInt(t.id.slice(2)) || 0);
    return Math.max(...nums) + 1;
  }

  function nextImageIdNum() {
    const imgs = currentProject.images;
    if (imgs.length === 0) return 1;
    const nums = imgs.map(i => parseInt(i.id.replace('img-', '')) || 0);
    return Math.max(...nums) + 1;
  }

  // ===========================================================
  // Init
  // ===========================================================
  function init() {
    buildProjectEditor();
    buildEtsySettings();
    buildFreeModelsGrid();
    bindToolbar();
    loadDraft();
  }

  // ===========================================================
  // SECTION 1: Current Project editor
  // ===========================================================
  function buildProjectEditor() {
    const wrap = document.getElementById('projectEditorWrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="project-editor">

        <!-- Enabled toggle -->
        <div class="project-enabled-row">
          <label class="toggle-label">
            <input type="checkbox" class="toggle-checkbox" id="projectEnabled"${currentProject.enabled ? ' checked' : ''}>
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
            <span class="toggle-text">Published — visible on /originals/</span>
          </label>
        </div>

        <div class="project-editor__body">

          <!-- Title + Subtitle -->
          <div class="project-editor__row">
            <div class="form-group">
              <label class="form-label" for="projectTitle">Title</label>
              <input type="text" id="projectTitle" placeholder="e.g., Wax Seal Experiment No.4" value="${esc(currentProject.title)}">
            </div>
            <div class="form-group">
              <label class="form-label" for="projectSubtitle">
                Subtitle / Label <span class="form-label-optional">optional</span>
              </label>
              <input type="text" id="projectSubtitle" placeholder="e.g., In Progress" value="${esc(currentProject.subtitle)}">
            </div>
          </div>

          <!-- Date -->
          <div class="form-group" style="max-width: 200px;">
            <label class="form-label" for="projectDate">
              Date <span class="form-label-optional">optional</span>
            </label>
            <input type="text" id="projectDate" placeholder="e.g., April 2026" value="${esc(currentProject.date)}">
          </div>

          <!-- Body -->
          <div class="form-group">
            <label class="form-label" for="projectBody">Body Text</label>
            <textarea id="projectBody" rows="7" placeholder="Write about this project — materials, process, inspiration. Separate paragraphs with a blank line.">${esc(currentProject.body)}</textarea>
          </div>

          <!-- Image gallery -->
          <div class="form-group">
            <div class="form-label">Images <span class="form-label-optional">drag to reorder</span></div>
            <div class="gallery-editor" id="galleryEditor">
              <div class="gallery-editor__header">
                <span>Project Gallery</span>
                <button class="btn btn-secondary btn-sm" id="addGalleryImageBtn" type="button">
                  <span class="btn-icon">+</span> Add Image
                </button>
              </div>
              <div class="gallery-editor__list" id="galleryList">
                <!-- populated by renderGalleryList() -->
              </div>
            </div>
          </div>

        </div><!-- /project-editor__body -->

        <!-- Archive action -->
        <div class="archive-block">
          <p class="archive-block__desc">
            <strong>Archive this project.</strong>
            The current project is moved to the archive and the editor is cleared for a new project.
          </p>
          <button class="btn btn-secondary" id="archiveProjectBtn" type="button">
            Archive Project →
          </button>
        </div>

      </div><!-- /project-editor -->
    `;

    renderGalleryList();
    bindProjectEditorEvents();
  }

  function renderGalleryList() {
    const list = document.getElementById('galleryList');
    if (!list) return;

    if (currentProject.images.length === 0) {
      list.innerHTML = '<div class="gallery-empty">No images yet — click "Add Image" to upload.</div>';
      return;
    }

    list.innerHTML = '';
    currentProject.images.forEach((img, i) => {
      list.appendChild(buildGalleryItem(img, i));
    });
  }

  function buildGalleryItem(img, index) {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.dataset.imgId = img.id;

    const src = img._preview || (img.imageMode === 'remote' ? img.remoteImage : img.localImage) || '';
    const thumbHtml = src
      ? `<img class="gallery-item__thumb" src="${esc(src)}" alt="${esc(img.alt || '')}">`
      : `<div class="gallery-item__thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--border);">+</div>`;

    const isFirst = index === 0;
    const isLast  = index === currentProject.images.length - 1;

    div.innerHTML = `
      ${thumbHtml}
      <div class="gallery-item__info">
        <div class="gallery-item__name">${esc(img.localImage ? img.localImage.split('/').pop() : (img.remoteImage ? 'Remote image' : 'No image'))}</div>
        <input class="gallery-item__alt" type="text" placeholder="Alt text (optional)" value="${esc(img.alt || '')}">
      </div>
      <div class="gallery-item__controls">
        <button class="move-btn" data-dir="up"   title="Move up"   ${isFirst ? 'disabled' : ''}>↑</button>
        <button class="move-btn" data-dir="down"  title="Move down" ${isLast  ? 'disabled' : ''}>↓</button>
        <button class="move-btn" data-dir="remove" title="Remove">×</button>
      </div>
    `;

    // Alt text input
    div.querySelector('.gallery-item__alt').addEventListener('input', e => {
      img.alt = e.target.value;
      saveDraft();
    });

    // Move / remove controls
    div.querySelectorAll('.move-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir;
        const imgs = currentProject.images;
        const idx  = imgs.findIndex(i => i.id === img.id);
        if (dir === 'up' && idx > 0) {
          [imgs[idx], imgs[idx - 1]] = [imgs[idx - 1], imgs[idx]];
        } else if (dir === 'down' && idx < imgs.length - 1) {
          [imgs[idx], imgs[idx + 1]] = [imgs[idx + 1], imgs[idx]];
        } else if (dir === 'remove') {
          imgs.splice(idx, 1);
        }
        saveDraft();
        renderGalleryList();
      });
    });

    return div;
  }

  function bindProjectEditorEvents() {
    const $ = id => document.getElementById(id);

    $('projectEnabled').addEventListener('change', e => {
      currentProject.enabled = e.target.checked;
      saveDraft();
    });

    ['projectTitle', 'projectSubtitle', 'projectDate'].forEach(id => {
      $(id).addEventListener('input', () => {
        currentProject.title    = $('projectTitle').value.trim();
        currentProject.subtitle = $('projectSubtitle').value.trim();
        currentProject.date     = $('projectDate').value.trim();
        saveDraft();
      });
    });

    $('projectBody').addEventListener('input', () => {
      currentProject.body = $('projectBody').value;
      saveDraft();
    });

    $('addGalleryImageBtn').addEventListener('click', () => {
      // Create a hidden file input and trigger it
      const fileInput = document.createElement('input');
      fileInput.type    = 'file';
      fileInput.accept  = 'image/*';
      fileInput.multiple = true;
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', () => {
        Array.from(fileInput.files).forEach(file => {
          if (!file.type.startsWith('image/')) return;
          const imgObj = defaultProjectImage(nextImageIdNum());
          imgObj._file = file;
          const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
          imgObj._localExt = ext;
          imgObj.localImage = `${PROJECT_IMG_DIR}/${currentProject.id}/${imgObj.id}.${ext}`;
          imgObj.imageMode  = 'local';

          const reader = new FileReader();
          reader.onload = ev => {
            imgObj._preview = ev.target.result;
            currentProject.images.push(imgObj);
            saveDraft();
            renderGalleryList();
          };
          reader.readAsDataURL(file);
        });
        document.body.removeChild(fileInput);
      });

      fileInput.click();
    });

    $('archiveProjectBtn').addEventListener('click', () => {
      if (!currentProject.title && !currentProject.body && currentProject.images.length === 0) {
        showStatus('Nothing to archive — the current project is empty.', 'info');
        return;
      }
      const confirmed = confirm(
        `Archive "${currentProject.title || 'this project'}"?\n\n` +
        'It will be moved to the Project Archive and the editor will be cleared.'
      );
      if (!confirmed) return;

      // Stamp archive date and move to archive (stored in export)
      const archived = Object.assign({}, currentProject, {
        archivedAt: new Date().toISOString(),
        _archivePending: true,
      });

      // We store the pending archive in a helper on the state
      // so it gets picked up at export time.
      if (!window._pendingArchive) window._pendingArchive = [];
      window._pendingArchive.push(archived);

      currentProject = defaultProject();
      saveDraft();
      buildProjectEditor();
      showStatus('Project archived. Export JSON to save the archive entry.', 'success');
    });
  }

  // ===========================================================
  // SECTION 2: Etsy Section Settings
  // ===========================================================
  function buildEtsySettings() {
    const wrap = document.getElementById('etsySettingsWrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="settings-panel">

        <div class="settings-group settings-group-wide">
          <div class="settings-label">Eyebrow Text</div>
          <input type="text" id="etsyEyebrow" class="settings-input" value="${esc(etsySettings.eyebrow)}" placeholder="GACHAFRUIT ON ETSY">
        </div>

        <div class="settings-group settings-group-wide">
          <div class="settings-label">Section Title</div>
          <input type="text" id="etsySectionTitle" class="settings-input" value="${esc(etsySettings.sectionTitle)}" placeholder="Shop Our Originals">
        </div>

        <div class="settings-group">
          <div class="settings-label">Items to show</div>
          <input type="number" id="etsyItemCount" class="settings-input" value="${etsySettings.itemCount}" min="1" max="20">
        </div>

        <div class="settings-group settings-group-wide">
          <div class="settings-label">"See All" URL</div>
          <input type="url" id="etsySeeAllUrl" class="settings-input" value="${esc(etsySettings.seeAllUrl)}" placeholder="/explore-all/">
        </div>

      </div>
    `;

    bindEtsySettingsEvents();
  }

  function bindEtsySettingsEvents() {
    const syncEtsy = () => {
      etsySettings.eyebrow      = document.getElementById('etsyEyebrow').value.trim();
      etsySettings.sectionTitle = document.getElementById('etsySectionTitle').value.trim();
      etsySettings.itemCount    = parseInt(document.getElementById('etsyItemCount').value, 10) || 6;
      etsySettings.seeAllUrl    = document.getElementById('etsySeeAllUrl').value.trim();
      saveDraft();
    };

    ['etsyEyebrow', 'etsySectionTitle', 'etsyItemCount', 'etsySeeAllUrl'].forEach(id => {
      document.getElementById(id).addEventListener('input', syncEtsy);
    });
  }

  // ===========================================================
  // SECTION 3: Free Models tiles
  // ===========================================================
  function buildFreeModelsGrid() {
    const grid = document.getElementById('freeModelsTilesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    freeModelTiles.forEach(tile => {
      const card = buildFreeModelTileCard(tile);
      grid.appendChild(card);
      bindFreeModelTileEvents(tile);
    });
  }

  function buildFreeModelTileCard(tile) {
    const div = document.createElement('div');
    div.className = 'tile-card' + (tile.enabled ? '' : ' is-disabled');
    div.dataset.tileId = tile.id;

    div.innerHTML = `
      <div class="tile-header">
        <div class="tile-id-group">
          <span class="tile-id">${tile.id}</span>
          <div class="move-controls">
            <button class="move-btn" data-dir="up"   title="Move up">↑</button>
            <button class="move-btn" data-dir="down"  title="Move down">↓</button>
          </div>
        </div>
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
            <input type="text" class="tile-title" placeholder="e.g., Sigil Ring V2" value="${esc(tile.title)}">
          </div>

          <div class="form-group">
            <label class="form-label">Button Text <span class="form-label-optional">default: Download</span></label>
            <input type="text" class="tile-button-text" placeholder="Download" value="${esc(tile.buttonText || 'Download')}">
          </div>

          <div class="form-group">
            <label class="form-label">
              Alt Text <span class="form-label-optional">optional</span>
            </label>
            <input type="text" class="tile-alt" placeholder="Brief image description" value="${esc(tile.alt)}">
          </div>

          <div class="form-group">
            <label class="form-label">Destination URL</label>
            <input type="url" class="tile-url" placeholder="https://www.printables.com/model/..." value="${esc(tile.url)}">
          </div>

          <div class="form-group">
            <label class="form-label">Image</label>
            <div class="mode-tabs">
              <button class="mode-tab${tile.imageMode === 'local'  ? ' active' : ''}" data-mode="local">Upload</button>
              <button class="mode-tab${tile.imageMode === 'remote' ? ' active' : ''}" data-mode="remote">URL</button>
            </div>
          </div>

          <div class="image-section image-section-local${tile.imageMode !== 'local' ? ' hidden' : ''}">
            <div class="upload-zone" tabindex="0" role="button" aria-label="Upload image">
              <div class="upload-icon">⬆</div>
              <div class="upload-text">Click or drag an image here</div>
              <div class="upload-hint">JPG, PNG, WebP — recommended 800×800px</div>
            </div>
            <input type="file" class="file-input" accept="image/*" style="display:none">
            <div class="local-preview${tile._preview ? ' show' : ''}">
              <img class="local-preview-thumb" src="${tile._preview || ''}" alt="">
              <div class="local-preview-info">
                <div class="local-preview-name">${tile._preview ? tile.localImage.split('/').pop() : ''}</div>
                <div class="local-preview-path">${tile.localImage || ''}</div>
              </div>
              <button class="clear-local-btn" type="button">Remove</button>
            </div>
          </div>

          <div class="image-section image-section-remote${tile.imageMode !== 'remote' ? ' hidden' : ''}">
            <div class="form-group">
              <input type="url" class="tile-remote-image" placeholder="https://..." value="${esc(tile.remoteImage)}">
            </div>
          </div>

        </div><!-- /tile-form -->

        <div class="tile-preview">
          <div class="preview-label">Preview</div>
          <div class="preview-card${tile.enabled ? '' : ' is-disabled'}">
            <div class="preview-img-wrap">
              <div class="preview-img-placeholder"></div>
            </div>
            <div class="preview-body">
              <div class="preview-title${tile.title ? '' : ' empty'}">${tile.title ? esc(tile.title) : 'No title yet'}</div>
              <div class="preview-btn">${esc(tile.buttonText || 'Download')}</div>
            </div>
          </div>
          <div class="preview-disabled-note${tile.enabled ? '' : ' show'}">Tile is inactive — will not appear on page</div>
        </div>

      </div><!-- /tile-body -->
    `;

    updateFreeModelPreview(div, tile);
    return div;
  }

  function getEditor(id) {
    return document.querySelector(`[data-tile-id="${id}"]`);
  }

  function updateFreeModelPreview(editor, tile) {
    if (!editor) return;
    const src = tile._preview
      || (tile.imageMode === 'remote' ? tile.remoteImage : '')
      || '';

    const imgWrap = editor.querySelector('.preview-img-wrap');
    if (!imgWrap) return;

    if (src) {
      let img = imgWrap.querySelector('img');
      if (!img) {
        imgWrap.innerHTML = '';
        img = document.createElement('img');
        imgWrap.appendChild(img);
      }
      img.src = src;
      img.alt = tile.alt || '';
    } else {
      imgWrap.innerHTML = '<div class="preview-img-placeholder"></div>';
    }

    const titleEl = editor.querySelector('.preview-title');
    if (titleEl) {
      titleEl.textContent = tile.title || 'No title yet';
      titleEl.classList.toggle('empty', !tile.title);
    }

    const btnEl = editor.querySelector('.preview-btn');
    if (btnEl) btnEl.textContent = tile.buttonText || 'Download';

    const card = editor.querySelector('.preview-card');
    if (card) card.classList.toggle('is-disabled', !tile.enabled);

    const note = editor.querySelector('.preview-disabled-note');
    if (note) note.classList.toggle('show', !tile.enabled);
  }

  function bindFreeModelTileEvents(tile) {
    const editor = getEditor(tile.id);
    if (!editor) return;

    const onText = () => {
      tile.title      = editor.querySelector('.tile-title').value.trim();
      tile.buttonText = editor.querySelector('.tile-button-text').value.trim();
      tile.alt        = editor.querySelector('.tile-alt').value.trim();
      tile.url        = editor.querySelector('.tile-url').value.trim();
      tile.remoteImage = editor.querySelector('.tile-remote-image').value.trim();
      saveDraft();
      updateFreeModelPreview(editor, tile);
    };

    editor.querySelectorAll('.tile-title, .tile-button-text, .tile-alt, .tile-url, .tile-remote-image')
      .forEach(el => el.addEventListener('input', onText));

    editor.querySelector('.tile-enabled').addEventListener('change', e => {
      tile.enabled = e.target.checked;
      editor.classList.toggle('is-disabled', !tile.enabled);
      saveDraft();
      updateFreeModelPreview(editor, tile);
    });

    // Image mode tabs
    editor.querySelectorAll('.mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        tile.imageMode = btn.dataset.mode;
        editor.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b === btn));
        editor.querySelector('.image-section-local').classList.toggle('hidden',  tile.imageMode !== 'local');
        editor.querySelector('.image-section-remote').classList.toggle('hidden', tile.imageMode !== 'remote');
        saveDraft();
        updateFreeModelPreview(editor, tile);
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
      if (file && file.type.startsWith('image/')) handleFreeModelFileUpload(tile.id, file);
    });
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) handleFreeModelFileUpload(tile.id, file);
    });

    editor.querySelector('.clear-local-btn').addEventListener('click', () => {
      tile._file     = null;
      tile._preview  = null;
      tile._localExt = 'jpg';
      tile.localImage = `${tile._imageDir}/${tile.id}.jpg`;
      editor.querySelector('.local-preview').classList.remove('show');
      editor.querySelector('.file-input').value = '';
      saveDraft();
      updateFreeModelPreview(editor, tile);
    });

    // Move controls
    editor.querySelectorAll('.move-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir;
        const idx  = freeModelTiles.findIndex(t => t.id === tile.id);
        if (dir === 'up' && idx > 0) {
          [freeModelTiles[idx], freeModelTiles[idx - 1]] = [freeModelTiles[idx - 1], freeModelTiles[idx]];
          buildFreeModelsGrid();
        } else if (dir === 'down' && idx < freeModelTiles.length - 1) {
          [freeModelTiles[idx], freeModelTiles[idx + 1]] = [freeModelTiles[idx + 1], freeModelTiles[idx]];
          buildFreeModelsGrid();
        }
        saveDraft();
      });
    });
  }

  function handleFreeModelFileUpload(tileId, file) {
    const tile   = freeModelTiles.find(t => t.id === tileId);
    if (!tile) return;
    const editor = getEditor(tileId);

    tile._file   = file;
    const ext    = file.name.split('.').pop().toLowerCase() || 'jpg';
    tile._localExt = ext;
    tile.localImage = `${tile._imageDir}/${tileId}.${ext}`;

    const reader = new FileReader();
    reader.onload = ev => {
      tile._preview = ev.target.result;

      const preview = editor.querySelector('.local-preview');
      const thumb   = editor.querySelector('.local-preview-thumb');
      const name    = editor.querySelector('.local-preview-name');
      const path    = editor.querySelector('.local-preview-path');

      if (thumb) thumb.src = ev.target.result;
      if (name)  name.textContent  = file.name;
      if (path)  path.textContent  = tile.localImage;
      if (preview) preview.classList.add('show');

      saveDraft();
      updateFreeModelPreview(editor, tile);
    };
    reader.readAsDataURL(file);
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
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          applyImportedData(data);
          importedData = data;
          showStatus('Import successful.', 'success');
        } catch (_) {
          showStatus('Could not parse JSON file.', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
      if (importedData) {
        applyImportedData(importedData);
        showStatus('Reset to last imported data.', 'info');
      } else {
        showStatus('No imported data to reset to.', 'info');
      }
    });

    document.getElementById('clearBtn').addEventListener('click', () => {
      if (!confirm('Clear all draft data and reset to defaults?')) return;
      localStorage.removeItem(STORAGE_KEY);
      window._pendingArchive = [];
      currentProject = defaultProject();
      etsySettings   = defaultEtsySettings();
      freeModelTiles = [];
      buildProjectEditor();
      buildEtsySettings();
      buildFreeModelsGrid();
      showStatus('Draft cleared.', 'info');
    });

    document.getElementById('exportBtn').addEventListener('click', exportJSON);

    document.getElementById('addFreeModelBtn').addEventListener('click', () => {
      const tile = defaultFreeModelTile(nextFreeModelIdNum());
      freeModelTiles.push(tile);
      buildFreeModelsGrid();
      saveDraft();
      showStatus(`Added tile ${tile.id}.`, 'success');
    });
  }

  // ===========================================================
  // Import / Apply
  // ===========================================================
  function applyImportedData(data) {
    // Current project
    if (data.currentProject) {
      currentProject = Object.assign(defaultProject(), data.currentProject);
      if (!Array.isArray(currentProject.images)) currentProject.images = [];
    }

    // Etsy settings
    if (data.etsySettings) {
      etsySettings = Object.assign(defaultEtsySettings(), data.etsySettings);
    }

    // Free models
    if (Array.isArray(data.freeModels)) {
      freeModelTiles = data.freeModels.map(m => Object.assign(
        defaultFreeModelTile(0),
        m,
        { _file: null, _preview: null, _imageDir: FREE_MODEL_IMG_DIR }
      ));
    } else {
      freeModelTiles = [];
    }

    buildProjectEditor();
    buildEtsySettings();
    buildFreeModelsGrid();
  }

  // ===========================================================
  // Export
  // ===========================================================
  function exportJSON() {
    // Collect pending archives
    const pendingArchives = (window._pendingArchive || []).map(a => {
      const clean = Object.assign({}, a);
      delete clean._archivePending;
      delete clean._file;
      delete clean._preview;
      if (clean.images) {
        clean.images = clean.images.map(img => stripImageRuntime(img));
      }
      return clean;
    });

    // We can't know what's already in the JSON — the user imports it first.
    // We'll merge pending archives with any existing archive from importedData.
    const existingArchive = (importedData && Array.isArray(importedData.projectArchive))
      ? importedData.projectArchive
      : [];
    const mergedArchive = [...existingArchive, ...pendingArchives];

    const projectClean = Object.assign({}, currentProject);
    delete projectClean._file;
    delete projectClean._preview;
    projectClean.images = (projectClean.images || []).map(img => stripImageRuntime(img));

    const freeModelsClean = freeModelTiles.map(tile => {
      const t = Object.assign({}, tile);
      delete t._file;
      delete t._preview;
      delete t._imageDir;
      delete t._localExt;
      return t;
    });

    const output = {
      updatedAt:      new Date().toISOString(),
      currentProject: projectClean,
      projectArchive: mergedArchive,
      etsySettings:   Object.assign({}, etsySettings),
      freeModels:     freeModelsClean,
    };

    const json = JSON.stringify(output, null, 2);
    downloadFile('originals-content.json', json, 'application/json');

    // Clear pending archive queue after successful export
    window._pendingArchive = [];
    showStatus('Exported originals-content.json. Place it in /data/ on your server.', 'success');
  }

  function stripImageRuntime(img) {
    const clean = Object.assign({}, img);
    delete clean._file;
    delete clean._preview;
    delete clean._localExt;
    return clean;
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ===========================================================
  // Draft persistence (localStorage)
  // ===========================================================
  function saveDraft() {
    const draft = {
      currentProject: (function () {
        const p = Object.assign({}, currentProject);
        p.images = (p.images || []).map(img => {
          const i = Object.assign({}, img);
          delete i._file;
          // Keep _preview (base64) in draft for UI restore
          return i;
        });
        delete p._file;
        return p;
      })(),
      etsySettings: Object.assign({}, etsySettings),
      freeModels:   freeModelTiles.map(t => {
        const c = Object.assign({}, t);
        delete c._file;
        delete c._imageDir;
        delete c._localExt;
        return c;
      }),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch (_) {}
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);

      if (draft.currentProject) {
        currentProject = Object.assign(defaultProject(), draft.currentProject);
        if (!Array.isArray(currentProject.images)) currentProject.images = [];
      }
      if (draft.etsySettings) {
        etsySettings = Object.assign(defaultEtsySettings(), draft.etsySettings);
      }
      if (Array.isArray(draft.freeModels)) {
        freeModelTiles = draft.freeModels.map(m => Object.assign(
          defaultFreeModelTile(0),
          m,
          { _file: null, _imageDir: FREE_MODEL_IMG_DIR }
        ));
      }

      buildProjectEditor();
      buildEtsySettings();
      buildFreeModelsGrid();
    } catch (_) {}
  }

  // ===========================================================
  // Status bar
  // ===========================================================
  let statusTimer = null;

  function showStatus(msg, type) {
    const bar = document.getElementById('statusBar');
    if (!bar) return;
    bar.textContent = msg;
    bar.className   = `status-bar show ${type}`;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      bar.className = 'status-bar';
    }, 4000);
  }

  // ===========================================================
  // Helpers
  // ===========================================================
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  // ===========================================================
  // Boot
  // ===========================================================
  document.addEventListener('DOMContentLoaded', init);

})();
