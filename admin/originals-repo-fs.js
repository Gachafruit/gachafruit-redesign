/* ============================================================
   originals-repo-fs.js — Local repository publishing helper
   Gachafruit Studio admin tools

   Wraps the File System Access API so the Originals admin tools can
   write generated files straight into the working copy of the repo.

   - Optional enhanced publishing path for Chromium-based browsers.
   - The directory handle is persisted in IndexedDB so the connection
     survives page reloads (the browser still gates re-use behind a
     one-click permission prompt).
   - Everything degrades gracefully: when unsupported/!connected the
     admin tools fall back to repository-ready ZIP export.

   Exposes: window.RepoFS
   ============================================================ */

(function () {
  'use strict';

  var DB_NAME    = 'gachafruit-admin';
  var DB_STORE   = 'handles';
  var HANDLE_KEY = 'repoRoot';

  // Files/dirs expected at the repo root — used to sanity-check that the
  // user actually picked the Gachafruit repository and not some random folder.
  var ROOT_SENTINEL_FILES = ['CLAUDE.md'];
  var ROOT_SENTINEL_DIRS  = ['data', 'assets'];

  var rootHandle = null;   // FileSystemDirectoryHandle | null
  var listeners  = [];

  var supported = (typeof window !== 'undefined')
    && ('showDirectoryPicker' in window)
    && (typeof indexedDB !== 'undefined');

  // ---------------------------------------------------------
  // Tiny IndexedDB helpers (no external library)
  // ---------------------------------------------------------
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx  = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror   = function () { reject(req.error); };
      });
    });
  }

  function idbDel(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  // ---------------------------------------------------------
  // Permission helpers
  // ---------------------------------------------------------
  function verifyPermission(handle, withPrompt) {
    var opts = { mode: 'readwrite' };
    return handle.queryPermission(opts).then(function (state) {
      if (state === 'granted') return true;
      if (!withPrompt) return false;
      return handle.requestPermission(opts).then(function (s) {
        return s === 'granted';
      });
    });
  }

  // ---------------------------------------------------------
  // Root validation
  // ---------------------------------------------------------
  async function looksLikeRepoRoot(handle) {
    try {
      for (var i = 0; i < ROOT_SENTINEL_DIRS.length; i++) {
        await handle.getDirectoryHandle(ROOT_SENTINEL_DIRS[i]);
      }
      for (var j = 0; j < ROOT_SENTINEL_FILES.length; j++) {
        await handle.getFileHandle(ROOT_SENTINEL_FILES[j]);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------
  // Path walking
  // ---------------------------------------------------------
  function splitPath(path) {
    return String(path).replace(/^\/+/, '').split('/').filter(Boolean);
  }

  async function getDirForPath(segments, create) {
    var dir = rootHandle;
    for (var i = 0; i < segments.length; i++) {
      dir = await dir.getDirectoryHandle(segments[i], { create: !!create });
    }
    return dir;
  }

  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------
  function isConnected() { return !!rootHandle; }

  function onChange(fn) { listeners.push(fn); }
  function emit() {
    var info = status();
    listeners.forEach(function (fn) { try { fn(info); } catch (_) {} });
  }

  function status() {
    return {
      supported:  supported,
      connected:  !!rootHandle,
      name:       rootHandle ? rootHandle.name : null,
    };
  }

  async function connect() {
    if (!supported) throw new Error('File System Access API is not supported in this browser.');
    var handle = await window.showDirectoryPicker({ id: 'gachafruit-repo', mode: 'readwrite' });

    var granted = await verifyPermission(handle, true);
    if (!granted) throw new Error('Write permission was not granted.');

    var valid = await looksLikeRepoRoot(handle);
    if (!valid) {
      throw new Error('That folder does not look like the Gachafruit repository root (expected data/, assets/ and CLAUDE.md).');
    }

    rootHandle = handle;
    try { await idbSet(HANDLE_KEY, handle); } catch (_) {}
    emit();
    return status();
  }

  // Attempt to silently restore a previously-authorised handle.
  // Returns { connected, needsPermission }.
  async function restore() {
    if (!supported) return { connected: false, needsPermission: false };
    var handle;
    try { handle = await idbGet(HANDLE_KEY); } catch (_) { handle = null; }
    if (!handle) return { connected: false, needsPermission: false };

    var state;
    try { state = await handle.queryPermission({ mode: 'readwrite' }); }
    catch (_) { state = 'denied'; }

    if (state === 'granted') {
      rootHandle = handle;
      emit();
      return { connected: true, needsPermission: false };
    }
    if (state === 'prompt') {
      // Keep the handle around; UI can offer a "Reconnect" button that
      // calls reconnect() from within a user gesture.
      pendingHandle = handle;
      return { connected: false, needsPermission: true };
    }
    return { connected: false, needsPermission: false };
  }

  var pendingHandle = null;

  async function reconnect() {
    var handle = pendingHandle || (await idbGet(HANDLE_KEY).catch(function () { return null; }));
    if (!handle) return connect();
    var granted = await verifyPermission(handle, true);
    if (!granted) throw new Error('Write permission was not granted.');
    rootHandle = handle;
    pendingHandle = null;
    emit();
    return status();
  }

  async function disconnect() {
    rootHandle = null;
    pendingHandle = null;
    try { await idbDel(HANDLE_KEY); } catch (_) {}
    emit();
  }

  async function writeFile(path, data) {
    if (!rootHandle) throw new Error('No repository folder connected.');
    var segs = splitPath(path);
    var name = segs.pop();
    var dir  = await getDirForPath(segs, true);
    var fileHandle = await dir.getFileHandle(name, { create: true });
    var writable   = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
    return true;
  }

  async function readText(path) {
    if (!rootHandle) throw new Error('No repository folder connected.');
    var segs = splitPath(path);
    var name = segs.pop();
    try {
      var dir  = await getDirForPath(segs, false);
      var fh   = await dir.getFileHandle(name);
      var file = await fh.getFile();
      return await file.text();
    } catch (_) {
      return null;
    }
  }

  async function deleteFile(path) {
    if (!rootHandle) throw new Error('No repository folder connected.');
    var segs = splitPath(path);
    var name = segs.pop();
    try {
      var dir = await getDirForPath(segs, false);
      await dir.removeEntry(name);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function listDir(path) {
    if (!rootHandle) throw new Error('No repository folder connected.');
    var segs = splitPath(path);
    var out = [];
    try {
      var dir = await getDirForPath(segs, false);
      for await (var entry of dir.values()) {
        out.push({ name: entry.name, kind: entry.kind });
      }
    } catch (_) {}
    return out;
  }

  window.RepoFS = {
    supported:         supported,
    status:            status,
    isConnected:       isConnected,
    onChange:          onChange,
    connect:           connect,
    restore:           restore,
    reconnect:         reconnect,
    disconnect:        disconnect,
    writeFile:         writeFile,
    readText:          readText,
    deleteFile:        deleteFile,
    listDir:           listDir,
  };

})();
