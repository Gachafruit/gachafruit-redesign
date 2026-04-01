/* ============================================================
   explore-page.js — Dedicated Explore All page renderer
   Depends on: js/components/card-builder.js (GachafruitCards)

   Modes (controlled by data/featured-creations.json):
     mode: "manual"            — renders ALL enabled manualTiles (no count cap)
     mode: "api-with-fallback" — tries apiUrl first; falls back to manualTiles
       on any failure. Shows the FULL API result set — no homepageVisibleCount cap.
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

    var tiles = await resolveTiles(section);
    if (tiles.length === 0) return;

    // No count cap — this page shows everything
    grid.innerHTML = '';
    tiles.forEach(function (tile) {
      grid.appendChild(GachafruitCards.buildCard(tile, { variant: 'sm', btnText: 'View' }));
    });
  }

  /**
   * Returns the full tile array for this render, based on mode.
   *
   * "manual"            → ALL enabled manualTiles (no slice)
   * "api-with-fallback" → tries apiUrl, falls back to manualTiles on failure
   *                       Returns ALL tiles — no homepageVisibleCount cap.
   *
   * Contrast with explore.js which slices the result to homepageVisibleCount
   * after calling this same pattern — this page never slices.
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

    // Manual (default) — all enabled tiles, preserve configured order
    if (!Array.isArray(section.manualTiles)) return [];
    return section.manualTiles.filter(function (t) { return t.enabled === true; });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
