/* 표현 주머니: saved expressions, stored in this browser (localStorage). Shared by index.html and pouch.html. */
const Pouch = (function () {
  const KEY = 'kw-pouch-v1';
  const listeners = [];
  function read() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  function write(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
    listeners.forEach(function (fn) { try { fn(items); } catch {} });
  }
  function keyOf(videoId, setIndex, phrase) { return videoId + ':' + setIndex + ':' + phrase; }
  function has(key) { return read().some(function (x) { return x.key === key; }); }
  function add(item) {
    const items = read().filter(function (x) { return x.key !== item.key; });
    item.savedAt = item.savedAt || new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    item.learned = !!item.learned;
    items.push(item); write(items);
  }
  function remove(key) { write(read().filter(function (x) { return x.key !== key; })); }
  function toggle(item) { if (has(item.key)) { remove(item.key); return false; } add(item); return true; }
  function update(key, patch) {
    const now = new Date().toISOString();
    write(read().map(function (x) { return x.key === key ? Object.assign({}, x, patch, { updatedAt: now }) : x; }));
  }
  function onChange(fn) { listeners.push(fn); }
  // used by sync.js to apply server state without echoing it back
  function replaceAll(items) { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }
  // hand-drawn drawstring pouch
  function icon(cls) {
    return '<svg class="pouch-icon ' + (cls || '') + '" viewBox="0 0 40 40" aria-hidden="true">' +
      '<path d="M12 13c-6 6-8 13-5 18 3 5 23 5 26 0 3-5 1-12-5-18" class="bag"/>' +
      '<path d="M11 13c3 1.5 15 1.5 18 0" />' +
      '<path d="M13 9c2 2 12 2 14 0" />' +
      '<path d="M15 13l-1-4M25 13l1-4" />' +
      '<path d="M20 14c-1 3-4 4-6 5M20 14c1 3 4 4 6 5" class="string"/>' +
      '<path d="M17 25c1-2 2-2 3 0 1-2 2-2 3 0-1 2-2 3-3 4-1-1-2-2-3-4z" class="heart"/>' +
      '</svg>';
  }
  return { all: read, has: has, add: add, remove: remove, toggle: toggle, update: update, keyOf: keyOf, onChange: onChange, replaceAll: replaceAll, icon: icon, KEY: KEY };
})();
