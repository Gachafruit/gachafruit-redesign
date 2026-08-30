/* ============================================================
   originals-archive.js — Project Archive page renderer

   v2 data model:
     /data/originals/projects-index.json   — manifest (current + all entries)
     /data/originals/projects/<id>.json    — one file per project

   Renders every project whose status is "archived", newest first
   (by sortDate). Falls back to the legacy projectArchive[] array in
   /data/originals-content.json when the v2 index is unavailable.
   ============================================================ */

(function () {
  'use strict';

  var PROJECTS_INDEX   = '/data/originals/projects-index.json';
  var PROJECT_DIR      = '/data/originals/projects/';
  var PROJECT_IMG_BASE = '/assets/images/originals/projects/';
  var LEGACY_DATA      = '/data/originals-content.json';

  async function init() {
    var list = document.getElementById('archive-list');
    if (!list) return;

    var entries = await loadArchiveEntries();

    if (entries === null) {
      list.innerHTML = '<div class="empty-state"><p>Could not load archive data.</p></div>';
      return;
    }

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No archived projects yet.</p></div>';
      return;
    }

    list.innerHTML = '';
    entries.forEach(function (entry) {
      list.appendChild(buildArchiveEntry(entry));
    });
  }

  // ===========================================================
  // Loaders
  // ===========================================================
  async function loadArchiveEntries() {
    // --- v2: index + per-project files ---
    try {
      var idxRes = await fetch(PROJECTS_INDEX, { cache: 'no-cache' });
      if (idxRes.ok) {
        var index = await idxRes.json();
        var refs = (Array.isArray(index.projects) ? index.projects : [])
          .filter(function (p) {
            return p && p.status === 'archived' && p.id !== index.current;
          });

        var files = await Promise.all(refs.map(function (ref) {
          return fetch(PROJECT_DIR + encodeURIComponent(ref.id) + '.json', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
        }));

        var projects = files
          .map(function (full, i) { return full || refs[i]; })
          .filter(Boolean);

        projects.sort(function (a, b) {
          return sortKey(b).localeCompare(sortKey(a));
        });

        return projects;
      }
    } catch (_) {}

    // --- legacy fallback: projectArchive[] ---
    try {
      var res = await fetch(LEGACY_DATA);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var archive = Array.isArray(data.projectArchive) ? data.projectArchive : [];
      return archive.slice().reverse();
    } catch (_) {
      return null;
    }
  }

  function sortKey(p) {
    return String(p.sortDate || p.archivedAt || p.createdAt || p.date || '');
  }

  // ===========================================================
  // Rendering
  // ===========================================================
  function buildArchiveEntry(entry) {
    var images   = Array.isArray(entry.images) ? entry.images : [];
    var firstImg = images[0] || null;
    var imgSrc   = firstImg ? resolveImageSrc(firstImg, entry.id) : (entry.image || '');
    var imgAlt   = firstImg ? (firstImg.alt || entry.title || '') : (entry.title || '');

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

  function resolveImageSrc(img, projectId) {
    if (!img) return '';
    if (typeof img === 'string') img = { src: img };
    if (img.imageMode === 'remote') return img.remoteImage || '';
    if (img.localImage) {
      return img.localImage.charAt(0) === '/' ? img.localImage : '/' + img.localImage;
    }
    var s = img.src || img.remote || img.remoteImage || '';
    if (!s) return '';
    if (/^https?:\/\//i.test(s) || s.charAt(0) === '/') return s;
    if (!projectId) return '/' + s.replace(/^\/+/, '');
    return PROJECT_IMG_BASE + projectId + '/' + s.replace(/^\/+/, '');
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
