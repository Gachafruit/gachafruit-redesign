/* ============================================================
   explore.js — Explore All section (homepage)
   Depends on: js/components/card-builder.js (GachafruitCards)

   Modes (controlled by data/featured-creations.json):
     mode: "manual"            — renders from manualTiles (current default)
     mode: "api-with-fallback" — tries apiUrl first; falls back to manualTiles
       on any failure. Homepage always caps at homepageVisibleCount tiles.
   ============================================================ */

(function () {
  'use strict';

  var DATA_PATH = 'data/featured-creations.json';

  async function init() {
    var grid = document.getElementById('explore-grid');
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

    var visibleCount = section.homepageVisibleCount > 0 ? section.homepageVisibleCount : 8;
    var tiles = await resolveTiles(section);

    if (tiles.length === 0) return;

    // Homepage always shows only the first visibleCount tiles
    var visible = tiles.slice(0, visibleCount);

    grid.innerHTML = '';
    visible.forEach(function (tile) {
      grid.appendChild(GachafruitCards.buildCard(tile, { variant: 'sm', btnText: 'View' }));
    });

    if (section.viewAllUrl) {
      var cta = document.createElement('div');
      cta.className = 'explore-view-all';
      cta.innerHTML =
        '<a href="' + GachafruitCards.esc(section.viewAllUrl) + '" class="btn btn--outline explore-view-all__link">'
        + 'View All'
        + '</a>';
      grid.parentElement.appendChild(cta);
    }
  }

  /**
   * Returns the tile array for this render, based on mode.
   *
   * "manual"            → manualTiles filtered to enabled
   * "api-with-fallback" → tries apiUrl, falls back to manualTiles on failure
   *
   * Adding future modes: extend this function. The callers are unaware of
   * how tiles are sourced — they just receive a flat array.
   */
  async function resolveTiles(section) {
    if (section.mode === 'api-with-fallback' && section.apiUrl) {
      try {
        var apiRes = await fetch(section.apiUrl);
        if (!apiRes.ok) throw new Error('HTTP ' + apiRes.status);
        var payload = await apiRes.json();
        if (Array.isArray(payload.tiles) && payload.tiles.length > 0) {
          return payload.tiles;
        }
        // Fall through to manual if API returned empty
      } catch (_) {
        // Fall through to manual
      }
    }

    // Manual (default) — filter enabled tiles, preserve configured order
    if (!Array.isArray(section.manualTiles)) return [];
    return section.manualTiles.filter(function (t) { return t.enabled === true; });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
