/* ============================================================
   admin-common.js — Shared helpers for the Gachafruit content
   admin tools (Content Admin: Featured Creations / Explore All /
   Heritage Gallery).

   Reuses window.RepoFS (admin/originals-repo-fs.js) for the
   File System Access publishing path — one repository connection
   is shared across every Gachafruit admin tool.

   Exposes: window.AdminCommon
   Depends on: originals-repo-fs.js, JSZip (CDN, optional)
   ============================================================ */

(function () {
  'use strict';

  // admin pages live in /admin/ — repo-relative paths resolve one level up.
  var HTTP_BASE = '../';

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------
  // Status bar controller
  // ---------------------------------------------------------
  function statusController(barEl) {
    var timer = null;
    return {
      show: function (msg, type) {
        if (!barEl) return;
        barEl.textContent = msg;
        barEl.className = 'status-bar show ' + (type || 'info');
        clearTimeout(timer);
        timer = setTimeout(function () { barEl.className = 'status-bar'; }, 6000);
      },
      clear: function () { if (barEl) barEl.className = 'status-bar'; },
    };
  }

  // ---------------------------------------------------------
  // Read a repo JSON file — via the connected handle if available,
  // otherwise over HTTP from the served copy of the repo.
  // ---------------------------------------------------------
  async function readRepoJSON(path) {
    var rel = String(path).replace(/^\/+/, '');
    if (window.RepoFS && RepoFS.isConnected()) {
      try {
        var t = await RepoFS.readText(rel);
        return t ? JSON.parse(t) : null;
      } catch (_) { return null; }
    }
    try {
      var r = await fetch(HTTP_BASE + rel, { cache: 'no-cache' });
      return r.ok ? await r.json() : null;
    } catch (_) { return null; }
  }

  // ---------------------------------------------------------
  // Commit a set of files.
  //   files: [{ path, content } | { path, blob }]
  //   opts:  { zipName, status, verb }
  // Returns { mode: 'repo' | 'zip' | 'json' }
  // ---------------------------------------------------------
  async function commit(files, opts) {
    opts = opts || {};
    var status = opts.status;
    var verb = opts.verb || 'Saved';

    if (window.RepoFS && RepoFS.isConnected()) {
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        await RepoFS.writeFile(f.path, f.content != null ? f.content : f.blob);
      }
      if (status) status.show(verb + ' — ' + files.length + ' file(s) written to the repository. Commit with git.', 'success');
      return { mode: 'repo' };
    }

    var hasBlob = files.some(function (f) { return f.blob != null; });
    if ((files.length > 1 || hasBlob) && typeof JSZip !== 'undefined') {
      var zip = new JSZip();
      files.forEach(function (f) { zip.file(f.path, f.content != null ? f.content : f.blob); });
      var blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, opts.zipName || 'gachafruit-content-export.zip');
      if (status) status.show(verb + ' locally — no repo folder connected, so a repository-ready ZIP was downloaded. Extract at the repo root, then commit.', 'info');
      return { mode: 'zip' };
    }

    // Single JSON file, no ZIP available/needed
    var only = files[0];
    downloadBlob(new Blob([only.content], { type: 'application/json' }), only.path.split('/').pop());
    if (status) status.show(verb + ' locally — downloaded ' + only.path.split('/').pop() + '. Place it at /' + only.path.replace(/[^/]+$/, '') + ', then commit.', 'info');
    return { mode: 'json' };
  }

  // ---------------------------------------------------------
  // Repository connection bar.
  //   opts: { onConnected, hintDefault }
  // Expects these element ids to exist:
  //   repoBar, repoStatusText, repoPath, repoHint,
  //   repoConnectBtn, repoReconnectBtn, repoDisconnectBtn
  // ---------------------------------------------------------
  function initRepoBar(opts) {
    opts = opts || {};
    var bar = document.getElementById('repoBar');
    var connectBtn    = document.getElementById('repoConnectBtn');
    var reconnectBtn  = document.getElementById('repoReconnectBtn');
    var disconnectBtn = document.getElementById('repoDisconnectBtn');
    var statusText    = document.getElementById('repoStatusText');
    var pathEl        = document.getElementById('repoPath');
    var hintEl        = document.getElementById('repoHint');
    var hintDefault   = opts.hintDefault ||
      'Connect the local Gachafruit repository folder to load & publish directly. ' +
      'Without it, the tool reads the served copy and exports a repository-ready ZIP.';

    if (!window.RepoFS || !RepoFS.supported) {
      if (statusText) statusText.textContent = 'Direct publishing not supported in this browser';
      if (hintEl) hintEl.innerHTML =
        'This browser has no File System Access API. The tool still loads current data from the served repo; ' +
        'use <strong>Save</strong> to download a repository-ready ZIP. (Chrome / Edge support direct publishing.)';
      if (connectBtn) connectBtn.disabled = true;
      return;
    }

    function paint(info) {
      if (bar) {
        bar.classList.toggle('is-connected', info.connected);
        bar.classList.toggle('needs-attention', !info.connected && !!info.needsPermission);
      }
      if (connectBtn)    connectBtn.style.display    = (info.connected || info.needsPermission) ? 'none' : '';
      if (reconnectBtn)  reconnectBtn.style.display  = (!info.connected && info.needsPermission) ? '' : 'none';
      if (disconnectBtn) disconnectBtn.style.display = info.connected ? '' : 'none';

      if (info.connected) {
        if (statusText) statusText.textContent = 'Connected — reads & writes go straight to the repo';
        if (pathEl) pathEl.textContent = info.name ? '(' + info.name + '/)' : '';
        if (hintEl) hintEl.textContent = 'Save writes files into this folder. Commit them with git afterwards.';
      } else if (info.needsPermission) {
        if (statusText) statusText.textContent = 'Repository folder remembered — permission needed';
        if (pathEl) pathEl.textContent = '';
        if (hintEl) hintEl.textContent = 'Click Reconnect to re-grant write access to the folder you used before.';
      } else {
        if (statusText) statusText.textContent = 'Repository folder not connected';
        if (pathEl) pathEl.textContent = '';
        if (hintEl) hintEl.innerHTML = hintDefault;
      }
    }

    RepoFS.onChange(paint);

    if (connectBtn) connectBtn.addEventListener('click', async function () {
      try { await RepoFS.connect(); if (opts.onConnected) opts.onConnected(); }
      catch (err) { if (opts.onError) opts.onError(err); else alert(err.message); }
    });
    if (reconnectBtn) reconnectBtn.addEventListener('click', async function () {
      try { await RepoFS.reconnect(); if (opts.onConnected) opts.onConnected(); }
      catch (err) { if (opts.onError) opts.onError(err); else alert(err.message); }
    });
    if (disconnectBtn) disconnectBtn.addEventListener('click', async function () {
      await RepoFS.disconnect();
      if (opts.onDisconnected) opts.onDisconnected();
    });

    RepoFS.restore().then(function (res) {
      var st = RepoFS.status();
      paint(st.connected ? st : { connected: false, needsPermission: res.needsPermission });
      if (res.connected && opts.onConnected) opts.onConnected();
    });
    paint(RepoFS.status());
  }

  // ---------------------------------------------------------
  // Editor state strip (loaded / draft / unsaved / saved)
  //   el:    container element
  //   info:  { state: 'repo'|'draft'|'saved', dirty: bool, detail: string }
  // ---------------------------------------------------------
  function renderStateStrip(el, info) {
    if (!el) return;
    var map = {
      repo:  ['saved',     'Loaded from repository'],
      saved: ['published', 'Saved to repository'],
      draft: ['draft',     'Local draft'],
    };
    var m = map[info.state] || map.draft;
    var label = m[1];
    if (info.dirty) { m = ['draft', label]; label += ' • unsaved edits'; }
    el.innerHTML =
      '<span class="state-badge state-badge--' + m[0] + '">' + esc(label) + '</span>' +
      (info.detail ? '<span class="pm-identity__id">' + esc(info.detail) + '</span>' : '');
  }

  window.AdminCommon = {
    HTTP_BASE:        HTTP_BASE,
    esc:              esc,
    downloadBlob:     downloadBlob,
    statusController: statusController,
    readRepoJSON:     readRepoJSON,
    commit:           commit,
    initRepoBar:      initRepoBar,
    renderStateStrip: renderStateStrip,
  };

})();
