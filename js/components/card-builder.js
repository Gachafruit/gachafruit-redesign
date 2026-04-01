/* ============================================================
   card-builder.js — Shared product card builder
   Exposes window.GachafruitCards = { buildCard, esc }

   Options object for buildCard:
     variant  — 'sm' (default) | 'full'  → adds product-card--sm class
     btnText  — button label (default: 'View')
   ============================================================ */

(function () {
  'use strict';

  function buildCard(tile, options) {
    var variant = (options && options.variant) ? options.variant : 'sm';
    var btnText = (options && options.btnText)  ? options.btnText  : 'View';

    var imageSrc = tile.imageMode === 'remote'
      ? (tile.remoteImage || '')
      : (tile.localImage  || '');

    var imgHtml = imageSrc
      ? '<img src="' + esc(imageSrc) + '" alt="' + esc(tile.alt || '') + '" loading="lazy">'
      : '<div class="img-placeholder"></div>';

    var metaHtml = tile.price
      ? '<div class="product-card__meta">'
        + '<span class="product-card__price">' + esc(tile.price) + '</span>'
        + '</div>'
      : '';

    var href      = tile.url || '#';
    var external  = tile.url ? ' target="_blank" rel="noopener noreferrer"' : '';
    var ariaLabel = tile.title
      ? 'View details for ' + esc(tile.title)
      : 'View details';

    var cardClass = variant === 'sm'
      ? 'product-card product-card--sm'
      : 'product-card';

    var article = document.createElement('article');
    article.className = cardClass;
    article.innerHTML =
      '<div class="product-card__img">' + imgHtml + '</div>'
      + '<div class="product-card__body">'
      +   '<h3 class="product-card__title">' + esc(tile.title) + '</h3>'
      +   metaHtml
      +   '<div class="product-card__cta">'
      +     '<a href="' + esc(href) + '" class="btn btn--outline"'
      +       external + ' aria-label="' + ariaLabel + '">' + esc(btnText) + '</a>'
      +   '</div>'
      + '</div>';

    var img = article.querySelector('.product-card__img img');
    if (img) {
      img.onerror = function () {
        var placeholder = document.createElement('div');
        placeholder.className = 'img-placeholder';
        img.parentNode.replaceChild(placeholder, img);
      };
    }

    return article;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.GachafruitCards = { buildCard: buildCard, esc: esc };

})();
