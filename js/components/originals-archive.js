/* ============================================================
   originals-archive.js — Project Archive page renderer
   Fetches /data/originals-content.json and renders projectArchive[]
   in reverse-chronological order.
   ============================================================ */

(function () {
  'use strict';

  var DATA_PATH = '/data/originals-content.json';

  async function init() {
    var list = document.getElementById('archive-list');
    if (!list) return;

    var data;
    try {
      var res = await fetch(DATA_PATH);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (_) {
      list.innerHTML = '<div class="empty-state"><p>Could not load archive data.</p></div>';
      return;
    }

    var archive = Array.isArray(data.projectArchive) ? data.projectArchive : [];

    if (archive.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No archived projects yet.</p></div>';
      return;
    }

    // Display newest first
    var sorted = archive.slice().reverse();

    list.innerHTML = '';
    sorted.forEach(function (entry) {
      list.appendChild(buildArchiveEntry(entry));
    });
  }

  function buildArchiveEntry(entry) {
    var images   = Array.isArray(entry.images) ? entry.images : [];
    var firstImg = images[0] || null;
    var imgSrc   = firstImg
      ? (firstImg.imageMode === 'remote' ? firstImg.remoteImage : firstImg.localImage)
      : '';
    var imgAlt   = firstImg ? (firstImg.alt || entry.title || '') : '';

    // Excerpt: first ~140 chars of body
    var body    = entry.body || '';
    var excerpt = body.length > 140 ? body.slice(0, 137).trimEnd() + '…' : body;

    var article = document.createElement('article');
    article.className = 'archive-entry';

    var imgHtml = imgSrc
      ? '<div class="archive-entry__img-wrap"><img src="' + esc(imgSrc) + '" alt="' + esc(imgAlt) + '" loading="lazy" class="archive-entry__img"></div>'
      : '<div class="archive-entry__img-wrap"><div class="img-placeholder archive-entry__img-placeholder"></div></div>';

    var metaHtml = '';
    if (entry.date)       metaHtml += '<span class="archive-entry__date">'     + esc(entry.date)     + '</span>';
    if (entry.subtitle)   metaHtml += '<span class="archive-entry__subtitle">' + esc(entry.subtitle) + '</span>';
    if (entry.archivedAt) metaHtml += '<span class="archive-entry__archived">Archived ' + esc(formatDate(entry.archivedAt)) + '</span>';

    article.innerHTML =
      imgHtml
      + '<div class="archive-entry__content">'
      +   (metaHtml ? '<div class="archive-entry__meta">' + metaHtml + '</div>' : '')
      +   '<h2 class="archive-entry__title">' + esc(entry.title || 'Untitled Project') + '</h2>'
      +   (excerpt ? '<p class="archive-entry__excerpt">' + esc(excerpt) + '</p>' : '')
      + '</div>';

    return article;
  }

  function formatDate(isoString) {
    if (!isoString) return '';
    try {
      var d = new Date(isoString);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) {
      return isoString;
    }
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
