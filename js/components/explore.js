/* ============================================================
   explore.js — Explore All section (homepage)
   Depends on: js/components/card-builder.js (GachafruitCards)
   Fetches /data/featured-creations.json and renders the first
   homepageVisibleCount enabled tiles into #explore-grid.
   Appends a View All link below the grid if viewAllUrl is set.
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
    if (!section || !Array.isArray(section.manualTiles)) return;

    var visibleCount = section.homepageVisibleCount > 0 ? section.homepageVisibleCount : 8;
    var enabled = section.manualTiles
      .filter(function (t) { return t.enabled === true; })
      .slice(0, visibleCount);

    if (enabled.length === 0) return;

    grid.innerHTML = '';
    enabled.forEach(function (tile) {
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

  document.addEventListener('DOMContentLoaded', init);

})();
