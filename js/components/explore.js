/* ============================================================
   explore.js — Explore All section
   Fetches /data/featured-creations.json and renders enabled
   manual tiles into #explore-grid using the product-card--sm
   variant. Fails silently if the JSON is missing or malformed.
   ============================================================ */

(function () {
  'use strict';

  const DATA_PATH = 'data/featured-creations.json';

  async function init() {
    const grid = document.getElementById('explore-grid');
    if (!grid) return;

    let data;
    try {
      const res = await fetch(DATA_PATH);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (_) {
      return;
    }

    const section = data.exploreAll;
    if (!section || !Array.isArray(section.manualTiles)) return;

    const visibleCount = section.homepageVisibleCount > 0 ? section.homepageVisibleCount : 8;
    const enabled = section.manualTiles
      .filter(t => t.enabled === true)
      .slice(0, visibleCount);

    if (enabled.length === 0) return;

    grid.innerHTML = '';
    enabled.forEach(tile => grid.appendChild(buildCard(tile)));
  }

  function buildCard(tile) {
    const imageSrc = tile.imageMode === 'remote'
      ? (tile.remoteImage || '')
      : (tile.localImage  || '');

    const imgHtml = imageSrc
      ? `<img src="${esc(imageSrc)}" alt="${esc(tile.alt || '')}" loading="lazy">`
      : `<div class="img-placeholder"></div>`;

    const metaHtml = tile.price
      ? `<div class="product-card__meta">
           <span class="product-card__price">${esc(tile.price)}</span>
         </div>`
      : '';

    const href     = tile.url || '#';
    const external = tile.url ? ' target="_blank" rel="noopener noreferrer"' : '';
    const ariaLabel = tile.title ? `View details for ${esc(tile.title)}` : 'View details';

    const article = document.createElement('article');
    article.className = 'product-card product-card--sm';
    article.innerHTML = `
      <div class="product-card__img">${imgHtml}</div>
      <div class="product-card__body">
        <h3 class="product-card__title">${esc(tile.title)}</h3>
        ${metaHtml}
        <div class="product-card__cta">
          <a href="${esc(href)}" class="btn btn--outline"${external} aria-label="${ariaLabel}">View</a>
        </div>
      </div>`;

    const img = article.querySelector('.product-card__img img');
    if (img) {
      img.onerror = function () {
        const placeholder = document.createElement('div');
        placeholder.className = 'img-placeholder';
        img.parentNode.replaceChild(placeholder, img);
      };
    }

    return article;
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);

})();
