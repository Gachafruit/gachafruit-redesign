/* ============================================================
   originals-page.js — Public Originals page renderer
   Depends on: js/components/card-builder.js (GachafruitCards)

   Data sources:
     /data/originals-content.json  — current project, etsy settings, free models
     /data/featured-creations.json — etsy API URL (shared with explore-all)
   ============================================================ */

(function () {
  'use strict';

  var ORIGINALS_DATA = '/data/originals-content.json';
  var FEATURED_DATA  = '/data/featured-creations.json';

  // ===========================================================
  // Init
  // ===========================================================
  async function init() {
    var originalsData = null;
    var featuredData  = null;

    try {
      var results = await Promise.all([
        fetch(ORIGINALS_DATA),
        fetch(FEATURED_DATA)
      ]);
      if (results[0].ok) originalsData = await results[0].json();
      if (results[1].ok) featuredData  = await results[1].json();
    } catch (_) {}

    if (!originalsData) return;

    renderCurrentProject(originalsData.currentProject || {});
    await renderEtsyPreview(originalsData.etsySettings || {}, featuredData);
    renderFreeModels(originalsData.freeModels || []);
  }

  // ===========================================================
  // Section 1: Current Project
  // ===========================================================
  function renderCurrentProject(project) {
    var container = document.getElementById('current-project');
    if (!container) return;

    if (!project || !project.enabled || !project.title) {
      container.innerHTML =
        '<div class="project-placeholder">'
        + '<p>No current project — check back soon.</p>'
        + '<div class="project-placeholder-footer">'
        + '<a href="/originals/archive/" class="archive-link">View Archive</a>'
        + '</div>'
        + '</div>';
      return;
    }

    var images     = Array.isArray(project.images) ? project.images : [];
    var galleryHtml = buildGalleryHtml(images);
    var bodyHtml    = formatBody(project.body || '');

    var subtitleHtml = project.subtitle
      ? '<span class="project-content__subtitle">' + esc(project.subtitle) + '</span>'
      : '';

    var dateHtml = project.date
      ? '<p class="project-content__date">' + esc(project.date) + '</p>'
      : '';

    container.innerHTML =
      '<div class="current-project-layout">'
      + '<div class="project-gallery">' + galleryHtml + '</div>'
      + '<div class="project-content">'
      +   subtitleHtml
      +   '<h1 class="project-content__title">' + esc(project.title) + '</h1>'
      +   dateHtml
      +   '<div class="project-content__body">' + bodyHtml + '</div>'
      +   '<a href="/originals/archive/" class="archive-link">View Archive</a>'
      + '</div>'
      + '</div>';

    // Bind thumbnail gallery interaction
    if (images.length > 1) {
      var mainImg = container.querySelector('.project-gallery__main');
      container.querySelectorAll('.project-gallery__thumb').forEach(function (thumb) {
        thumb.addEventListener('click', function () {
          if (mainImg) mainImg.src = thumb.dataset.src;
          container.querySelectorAll('.project-gallery__thumb').forEach(function (t) {
            t.classList.toggle('project-gallery__thumb--active', t === thumb);
          });
        });
      });
    }
  }

  function buildGalleryHtml(images) {
    if (!images || images.length === 0) {
      return '<div class="project-gallery__main img-placeholder" role="img" aria-label="Project image"></div>';
    }

    var first   = images[0];
    var mainSrc = resolveImageSrc(first);

    var mainHtml = mainSrc
      ? '<img class="project-gallery__main" src="' + esc(mainSrc) + '" alt="' + esc(first.alt || '') + '" id="gallery-main" loading="lazy">'
      : '<div class="project-gallery__main img-placeholder" role="img" aria-label="Project image"></div>';

    if (images.length <= 1) return mainHtml;

    var thumbsHtml = images.map(function (img, i) {
      var src = resolveImageSrc(img);
      if (!src) return '';
      return '<img class="project-gallery__thumb'
        + (i === 0 ? ' project-gallery__thumb--active' : '')
        + '" src="' + esc(src) + '" alt="' + esc(img.alt || 'Project image ' + (i + 1)) + '"'
        + ' data-src="' + esc(src) + '" tabindex="0" role="button"'
        + ' aria-label="View image ' + (i + 1) + '">';
    }).join('');

    return mainHtml + '<div class="project-gallery__thumbs">' + thumbsHtml + '</div>';
  }

  function formatBody(text) {
    if (!text) return '';
    // Split on double newlines for paragraphs; single newlines become <br>
    return text.split(/\n\n+/).map(function (para) {
      return '<p>' + esc(para.trim()).replace(/\n/g, '<br>') + '</p>';
    }).filter(function (p) { return p !== '<p></p>'; }).join('');
  }

  // ===========================================================
  // Section 2: Etsy Preview
  // ===========================================================
  async function renderEtsyPreview(settings, featuredData) {
    var track = document.getElementById('etsy-scroll-track');
    if (!track) return;

    // Apply any custom text from settings
    if (settings.eyebrow) {
      var eyebrow = document.getElementById('etsy-eyebrow');
      if (eyebrow) eyebrow.textContent = settings.eyebrow;
    }
    if (settings.sectionTitle) {
      var heading = document.getElementById('etsy-heading');
      if (heading) heading.textContent = settings.sectionTitle;
    }
    if (settings.seeAllUrl) {
      var seeAll = document.getElementById('etsy-see-all');
      if (seeAll) seeAll.href = settings.seeAllUrl;
    }

    var count = (settings.itemCount && settings.itemCount > 0) ? settings.itemCount : 6;
    var tiles = await resolveEtsyTiles(featuredData, count);

    if (tiles.length === 0) {
      track.innerHTML = '<p class="rail-empty-state">Listings coming soon — visit our <a href="https://www.etsy.com/shop/Gachafruit">Etsy shop</a> in the meantime.</p>';
      return;
    }

    track.innerHTML = '';
    tiles.forEach(function (tile) {
      track.appendChild(GachafruitCards.buildCard(tile, { variant: 'sm', btnText: 'View' }));
    });

    initRailCarousel(document.getElementById('originals-etsy'), track, 4);
  }

  async function resolveEtsyTiles(featuredData, count) {
    if (!featuredData || !featuredData.exploreAll) return [];

    var section = featuredData.exploreAll;

    if (section.mode === 'api-with-fallback' && section.apiUrl) {
      try {
        var res = await fetch(section.apiUrl);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var payload = await res.json();
        if (Array.isArray(payload.tiles) && payload.tiles.length > 0) {
          return payload.tiles.slice(0, count);
        }
      } catch (_) {
        // Fall through to manual tiles
      }
    }

    if (!Array.isArray(section.manualTiles)) return [];
    return section.manualTiles
      .filter(function (t) { return t.enabled === true; })
      .slice(0, count);
  }

  // ===========================================================
  // Section 3: Free Models
  // ===========================================================
  function renderFreeModels(models) {
    var grid = document.getElementById('free-models-grid');
    if (!grid) return;

    var enabled = models.filter(function (m) { return m.enabled !== false; });

    if (enabled.length === 0) {
      grid.innerHTML = '<p class="rail-empty-state">Free downloadable models coming soon.</p>';
      return;
    }

    grid.innerHTML = '';
    enabled.forEach(function (model) {
      var tile = {
        imageMode:   model.imageMode   || 'local',
        remoteImage: model.remoteImage || '',
        localImage:  model.localImage  || '',
        alt:         model.alt         || '',
        title:       model.title       || '',
        price:       '',
        url:         model.url         || '#'
      };
      grid.appendChild(GachafruitCards.buildCard(tile, {
        variant: 'sm',
        btnText: model.buttonText || 'Download'
      }));
    });

    initRailCarousel(document.getElementById('free-models'), grid, 4);
  }

  // ===========================================================
  // Rail carousel (desktop only)
  // ===========================================================

  // On desktop, clamp each rail to `tilesPerPage` visible cards and inject
  // prev/next arrow controls so extra tiles don't push the left column wider.
  // On mobile the existing overflow-x scroll is preserved (function is a no-op).
  function initRailCarousel(sectionEl, trackEl, tilesPerPage) {
    if (!sectionEl || !trackEl) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;

    // Only count actual product cards, not empty-state paragraphs
    var items = Array.from(trackEl.children).filter(function (el) {
      return el.classList.contains('product-card');
    });

    if (items.length <= tilesPerPage) return; // fits on one page — no controls needed

    var page       = 0;
    var totalPages = Math.ceil(items.length / tilesPerPage);

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'rail-nav__btn';
    prevBtn.setAttribute('aria-label', 'Previous');
    prevBtn.textContent = '←';

    var indicator = document.createElement('span');
    indicator.className = 'rail-nav__indicator';

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'rail-nav__btn';
    nextBtn.setAttribute('aria-label', 'Next');
    nextBtn.textContent = '→';

    var nav = document.createElement('div');
    nav.className = 'rail-nav';
    nav.appendChild(prevBtn);
    nav.appendChild(indicator);
    nav.appendChild(nextBtn);

    // Insert between the section header and the content wrapper
    var header = sectionEl.querySelector('.rail-section__header');
    if (header && header.nextSibling) {
      sectionEl.insertBefore(nav, header.nextSibling);
    } else {
      sectionEl.appendChild(nav);
    }

    function showPage() {
      items.forEach(function (item, i) {
        item.hidden = i < page * tilesPerPage || i >= (page + 1) * tilesPerPage;
      });
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page >= totalPages - 1;
      indicator.textContent = (page + 1) + ' / ' + totalPages;
    }

    prevBtn.addEventListener('click', function () { if (page > 0) { page--; showPage(); } });
    nextBtn.addEventListener('click', function () { if (page < totalPages - 1) { page++; showPage(); } });

    showPage();
  }

  // ===========================================================
  // Helpers
  // ===========================================================
  function resolveImageSrc(img) {
    if (!img) return '';
    if (img.imageMode === 'remote') return img.remoteImage || '';
    var local = img.localImage || '';
    // Ensure local paths are root-relative so they resolve correctly
    // regardless of what subdirectory the page is served from.
    if (local && local.charAt(0) !== '/') local = '/' + local;
    return local;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);

})();
