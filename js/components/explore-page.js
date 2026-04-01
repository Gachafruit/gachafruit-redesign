/* ============================================================
   explore-page.js — Dedicated Explore All page renderer
   Depends on: js/components/card-builder.js (GachafruitCards)

   Renders ALL enabled manualTiles — no homepageVisibleCount cap.
   Structured for future API mode: the getActiveTiles() function
   is the integration point. When section.mode becomes
   'api-with-fallback', replace or augment it to fetch from the
   API first, then fall back to manualTiles on failure.
   ============================================================ */

(function () {
  'use strict';

  var DATA_PATH = '/data/featured-creations.json';

  async function init() {
    var grid = document.getElementById('explore-page-grid');
    if (!grid) return;

    var data;
    try {
      var res = await fetch(DATA_PATH);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (_) {
      return;
    }

    var section = data.exploreAll;
    if (!section) return;

    // Integration point: swap getActiveTiles() when API mode is added.
    var tiles = getActiveTiles(section);
    if (tiles.length === 0) return;

    grid.innerHTML = '';
    tiles.forEach(function (tile) {
      grid.appendChild(GachafruitCards.buildCard(tile, { variant: 'sm', btnText: 'View' }));
    });
  }

  // Returns all enabled tiles from manualTiles, preserving configured order.
  // When 'api-with-fallback' mode is supported, this function will be extended
  // to accept API-sourced tiles and use manualTiles only as a fallback.
  function getActiveTiles(section) {
    if (!Array.isArray(section.manualTiles)) return [];
    return section.manualTiles.filter(function (t) { return t.enabled === true; });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
