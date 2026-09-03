/* ============================================================
   admin-tiles.js — Shared "product tile" editor card for the
   Gachafruit content admin tools (Featured Creations + Explore All).

   A product tile = enabled + title + price + alt + url + image
   (local upload or remote URL) + a live preview.

   Ported from the shared tile logic of the old combined
   Featured Creations Manager. Heritage's simpler card is built
   inline by heritage-manager.js.

   Exposes: window.AdminTiles
   Depends on: admin-common.js (window.AdminCommon)
   ============================================================ */

(function () {
  'use strict';

  var esc = function (s) { return window.AdminCommon.esc(s); };

  function getEditor(id) {
    return document.querySelector('[data-tile-id="' + CSS.escape(id) + '"]');
  }

  // ---------------------------------------------------------
  // Build one tile card element
  //   opts: { showMove: bool }
  // ---------------------------------------------------------
  function buildCard(tile, opts) {
    opts = opts || {};
    var div = document.createElement('div');
    div.className = 'tile-card' + (tile.enabled ? '' : ' is-disabled');
    div.dataset.tileId = tile.id;

    var headerLeft = opts.showMove
      ? '<div class="tile-id-group">' +
          '<span class="tile-id">' + esc(tile.id) + '</span>' +
          '<div class="move-controls">' +
            '<button class="move-btn" data-dir="up" title="Move up">↑</button>' +
            '<button class="move-btn" data-dir="down" title="Move down">↓</button>' +
          '</div>' +
        '</div>'
      : '<span class="tile-id">' + esc(tile.id) + '</span>';

    div.innerHTML =
      '<div class="tile-header">' +
        headerLeft +
        '<label class="toggle-label">' +
          '<input type="checkbox" class="toggle-checkbox tile-enabled"' + (tile.enabled ? ' checked' : '') + '>' +
          '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
          '<span class="toggle-text">Enabled</span>' +
        '</label>' +
      '</div>' +

      '<div class="tile-body">' +
        '<div class="tile-form">' +

          '<div class="form-group">' +
            '<label class="form-label">Title</label>' +
            '<input type="text" class="tile-title" placeholder="e.g., Torii Gate Cable Organizer" value="' + esc(tile.title) + '">' +
          '</div>' +

          '<div class="form-group">' +
            '<label class="form-label">Price <span class="form-label-optional">optional</span></label>' +
            '<input type="text" class="tile-price" placeholder="e.g., $35.00" value="' + esc(tile.price) + '">' +
          '</div>' +

          '<div class="form-group">' +
            '<label class="form-label">Alt Text <span class="form-label-optional">optional</span></label>' +
            '<input type="text" class="tile-alt" placeholder="Brief image description" value="' + esc(tile.alt) + '">' +
          '</div>' +

          '<div class="form-group">' +
            '<label class="form-label">Destination URL ' +
              '<a class="test-url-link' + (tile.url ? '' : ' hidden') + '" href="' + esc(tile.url || '#') + '" target="_blank" rel="noopener">Test ↗</a>' +
            '</label>' +
            '<input type="url" class="tile-url" placeholder="https://www.etsy.com/listing/..." value="' + esc(tile.url) + '">' +
          '</div>' +

          '<div class="form-group">' +
            '<label class="form-label">Image</label>' +
            '<div class="mode-tabs">' +
              '<button class="mode-tab' + (tile.imageMode !== 'remote' ? ' active' : '') + '" data-mode="local">Upload</button>' +
              '<button class="mode-tab' + (tile.imageMode === 'remote' ? ' active' : '') + '" data-mode="remote">URL</button>' +
            '</div>' +
          '</div>' +

          '<div class="image-section image-section-local' + (tile.imageMode === 'remote' ? ' hidden' : '') + '">' +
            '<div class="upload-zone" tabindex="0" role="button" aria-label="Upload image">' +
              '<div class="upload-icon">⬆</div>' +
              '<div class="upload-text">Click or drag an image here</div>' +
              '<div class="upload-hint">JPG, PNG, WebP — recommended 800×800px</div>' +
            '</div>' +
            '<input type="file" class="file-input" accept="image/*" style="display:none">' +
            '<div class="local-preview' + (tile._preview ? ' show' : '') + '">' +
              '<img class="local-preview-thumb" src="' + (tile._preview || '') + '" alt="">' +
              '<div class="local-preview-info">' +
                '<div class="local-preview-name">' + (tile._preview ? esc(String(tile.localImage).split('/').pop()) : '') + '</div>' +
                '<div class="local-preview-path">' + esc(tile.localImage || '') + '</div>' +
              '</div>' +
              '<button class="clear-local-btn" type="button">Remove</button>' +
            '</div>' +
          '</div>' +

          '<div class="image-section image-section-remote' + (tile.imageMode === 'remote' ? '' : ' hidden') + '">' +
            '<div class="form-group">' +
              '<input type="url" class="tile-remote-image" placeholder="https://i.etsystatic.com/..." value="' + esc(tile.remoteImage) + '">' +
            '</div>' +
          '</div>' +

        '</div>' +

        '<div class="tile-preview">' +
          '<div class="preview-label">Live Preview</div>' +
          '<div class="preview-card' + (tile.enabled ? '' : ' is-disabled') + '">' +
            '<div class="preview-img-wrap"><div class="preview-img-placeholder"></div></div>' +
            '<div class="preview-body">' +
              '<div class="preview-title' + (tile.title ? '' : ' empty') + '">' + (tile.title ? esc(tile.title) : 'No title yet') + '</div>' +
              '<div class="preview-price' + (tile.price ? '' : ' hidden') + '">' + esc(tile.price) + '</div>' +
              '<div class="preview-btn">View Details</div>' +
            '</div>' +
          '</div>' +
          '<div class="preview-disabled-note' + (tile.enabled ? '' : ' show') + '">Tile is inactive — will not appear on the site</div>' +
        '</div>' +

      '</div>';

    return div;
  }

  // ---------------------------------------------------------
  // Live preview refresh
  // ---------------------------------------------------------
  function updatePreview(tile, editor) {
    editor = editor || getEditor(tile.id);
    if (!editor) return;

    var card = editor.querySelector('.preview-card');
    var wrap = editor.querySelector('.preview-img-wrap');
    var note = editor.querySelector('.preview-disabled-note');

    card.classList.toggle('is-disabled', !tile.enabled);
    note.classList.toggle('show', !tile.enabled);

    var existing = wrap.querySelector('img.preview-live-img');
    var imgSrc = null;
    if (tile.imageMode !== 'remote' && tile._preview) imgSrc = tile._preview;
    else if (tile.imageMode === 'remote' && tile.remoteImage) imgSrc = tile.remoteImage;

    if (imgSrc) {
      if (existing) {
        existing.src = imgSrc;
        existing.alt = tile.alt || '';
      } else {
        var ph = wrap.querySelector('.preview-img-placeholder');
        if (ph) ph.remove();
        var img = document.createElement('img');
        img.className = 'preview-live-img';
        img.alt = tile.alt || '';
        img.onerror = function () {
          img.remove();
          if (!wrap.querySelector('.preview-img-placeholder')) {
            var p = document.createElement('div');
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
        var p2 = document.createElement('div');
        p2.className = 'preview-img-placeholder';
        wrap.appendChild(p2);
      }
    }

    var titleEl = editor.querySelector('.preview-title');
    if (titleEl) {
      titleEl.textContent = tile.title || 'No title yet';
      titleEl.classList.toggle('empty', !tile.title);
    }
    var priceEl = editor.querySelector('.preview-price');
    if (priceEl) {
      priceEl.textContent = tile.price || '';
      priceEl.classList.toggle('hidden', !tile.price);
    }
  }

  function updateTestUrlLink(tile, editor) {
    var link = editor.querySelector('.test-url-link');
    if (!link) return;
    if (tile.url) { link.href = tile.url; link.classList.remove('hidden'); }
    else { link.classList.add('hidden'); }
  }

  // ---------------------------------------------------------
  // Bind events for one card
  //   ctx: { onChange(tile), onMove(tile, dir) }
  // ---------------------------------------------------------
  function bindCard(tile, ctx) {
    ctx = ctx || {};
    var editor = getEditor(tile.id);
    if (!editor) return;
    var change = function () { if (ctx.onChange) ctx.onChange(tile); };

    var syncText = function () {
      tile.title       = editor.querySelector('.tile-title').value.trim();
      tile.price       = editor.querySelector('.tile-price').value.trim();
      tile.alt         = editor.querySelector('.tile-alt').value.trim();
      tile.url         = editor.querySelector('.tile-url').value.trim();
      tile.remoteImage = editor.querySelector('.tile-remote-image').value.trim();
    };

    editor.querySelectorAll('.tile-title, .tile-price, .tile-alt, .tile-remote-image')
      .forEach(function (el) {
        el.addEventListener('input', function () { syncText(); updatePreview(tile, editor); change(); });
      });

    editor.querySelector('.tile-url').addEventListener('input', function () {
      syncText(); updateTestUrlLink(tile, editor); updatePreview(tile, editor); change();
    });

    editor.querySelector('.tile-enabled').addEventListener('change', function (e) {
      tile.enabled = e.target.checked;
      editor.classList.toggle('is-disabled', !tile.enabled);
      updatePreview(tile, editor);
      change();
    });

    editor.querySelectorAll('.mode-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        tile.imageMode = btn.dataset.mode;
        editor.querySelectorAll('.mode-tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
        editor.querySelector('.image-section-local').classList.toggle('hidden', tile.imageMode === 'remote');
        editor.querySelector('.image-section-remote').classList.toggle('hidden', tile.imageMode !== 'remote');
        updatePreview(tile, editor);
        change();
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
      if (file && file.type.startsWith('image/')) handleUpload(tile, file, editor, change);
    });
    fileInput.addEventListener('change', function (e) {
      if (e.target.files[0]) handleUpload(tile, e.target.files[0], editor, change);
    });

    editor.querySelector('.clear-local-btn').addEventListener('click', function () {
      tile._file = null; tile._preview = null; tile._localExt = 'jpg';
      tile.localImage = tile._imageDir + '/' + tile.id + '.jpg';
      editor.querySelector('.local-preview').classList.remove('show');
      editor.querySelector('.file-input').value = '';
      updatePreview(tile, editor);
      change();
    });

    if (ctx.onMove) {
      editor.querySelectorAll('.move-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { ctx.onMove(tile, btn.dataset.dir); });
      });
    }
  }

  function handleUpload(tile, file, editor, change) {
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    tile._file = file;
    tile._localExt = ext;
    tile.localImage = tile._imageDir + '/' + tile.id + '.' + ext;

    var reader = new FileReader();
    reader.onload = function (e) {
      tile._preview = e.target.result;
      editor.querySelector('.local-preview-thumb').src = tile._preview;
      editor.querySelector('.local-preview-name').textContent = file.name;
      editor.querySelector('.local-preview-path').textContent = tile.localImage;
      editor.querySelector('.local-preview').classList.add('show');
      updatePreview(tile, editor);
      if (change) change();
    };
    reader.readAsDataURL(file);
  }

  // Push tile state into an existing card's DOM (after import / reorder)
  function refreshCard(tile, editor) {
    editor = editor || getEditor(tile.id);
    if (!editor) return;
    editor.querySelector('.tile-enabled').checked = tile.enabled;
    editor.querySelector('.tile-title').value = tile.title || '';
    editor.querySelector('.tile-price').value = tile.price || '';
    editor.querySelector('.tile-alt').value = tile.alt || '';
    editor.querySelector('.tile-url').value = tile.url || '';
    editor.querySelector('.tile-remote-image').value = tile.remoteImage || '';
    editor.classList.toggle('is-disabled', !tile.enabled);
    editor.querySelectorAll('.mode-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === (tile.imageMode === 'remote' ? 'remote' : 'local'));
    });
    editor.querySelector('.image-section-local').classList.toggle('hidden', tile.imageMode === 'remote');
    editor.querySelector('.image-section-remote').classList.toggle('hidden', tile.imageMode !== 'remote');
    updateTestUrlLink(tile, editor);

    if (tile._preview) {
      editor.querySelector('.local-preview-thumb').src = tile._preview;
      editor.querySelector('.local-preview-name').textContent =
        tile._file ? tile._file.name : (tile.id + '.' + (tile._localExt || 'jpg'));
      editor.querySelector('.local-preview-path').textContent = tile.localImage;
      editor.querySelector('.local-preview').classList.add('show');
    } else {
      editor.querySelector('.local-preview').classList.remove('show');
    }
    updatePreview(tile, editor);
  }

  window.AdminTiles = {
    getEditor:     getEditor,
    buildCard:     buildCard,
    bindCard:      bindCard,
    refreshCard:   refreshCard,
    updatePreview: updatePreview,
  };

})();
