/* 연습 기록: list of practiced videos, opened from the "nn 세트 연습 완료" box.
   Uses data already in the browser, so opening it makes no network requests. */
const KWHistory = (function () {
  const KEY = 'kw-completed-at'; // { "videoId:setIndex": ISO date of first completion }
  function dates() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
  function mark(setKey) {
    const map = dates();
    if (map[setKey]) return;
    map[setKey] = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch {}
  }
  function fmt(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const label = (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    return d.getFullYear() === new Date().getFullYear() ? label : d.getFullYear() + '년 ' + label;
  }
  function rows() {
    const map = dates();
    return LESSONS.map(function (l, i) {
      const keys = l.sets.map(function (_, s) { return l.id + ':' + s; }).filter(function (k) { return completed.has(k); });
      const last = keys.map(function (k) { return map[k]; }).filter(Boolean).sort().pop() || '';
      return { lesson: l, index: i, done: keys.length, total: l.sets.length, last: last };
    }).filter(function (r) { return r.done > 0; }).sort(function (a, b) {
      return b.last.localeCompare(a.last) || a.index - b.index; // newest first; undated last
    });
  }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function open() {
    if (!window.__kwAppLoaded) return; // lesson data is still loading
    let dlg = document.getElementById('historyDialog');
    if (dlg && dlg.open) return;
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'historyDialog'; dlg.className = 'login-dialog history-dialog';
      dlg.innerHTML = '<form class="login-card"><button type="button" class="login-close" aria-label="닫기">×</button>' +
        '<h2>연습한 영상</h2><p id="historySummary"></p><div id="historyList" class="history-list"></div></form>';
      document.body.appendChild(dlg);
      dlg.querySelector('.login-close').onclick = function () { dlg.close(); };
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
      dlg.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); });
    }
    const list = rows();
    const totalSets = list.reduce(function (n, r) { return n + r.done; }, 0);
    dlg.querySelector('#historySummary').textContent = list.length ? '영상 ' + list.length + '개, ' + totalSets + '세트를 연습했어요.' : '';
    const box = dlg.querySelector('#historyList');
    box.replaceChildren();
    if (!list.length) box.append(el('p', 'history-empty', '아직 연습을 마친 세트가 없어요. 첫 세트를 끝내면 여기에 기록돼요.'));
    list.forEach(function (r) {
      const b = el('button', 'history-row'); b.type = 'button';
      const img = el('img', 'history-thumb'); img.alt = ''; img.loading = 'lazy';
      img.src = 'https://i.ytimg.com/vi/' + r.lesson.id + '/mqdefault.jpg';
      const info = el('span', 'history-info');
      info.append(el('strong', null, r.lesson.title), el('small', null, r.lesson.theme || ''));
      const meta = el('span', 'history-meta');
      meta.append(el('span', 'history-sets' + (r.done === r.total ? ' complete' : ''), r.done + '/' + r.total + '세트' + (r.done === r.total ? ' ✓' : '')),
        el('small', null, r.last ? fmt(r.last) : '날짜 기록 없음'));
      b.append(img, info, meta);
      b.onclick = function () {
        dlg.close();
        selectLesson(r.index);
        const t = document.getElementById('lessonTitle');
        if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      box.append(b);
    });
    dlg.showModal();
  }
  // bound here, not in app.js, so a cached app.js can never leave the button dead
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#historyOpen')) open();
  });
  return { open: open, mark: mark, KEY: KEY };
})();
window.KWHistory = KWHistory;
