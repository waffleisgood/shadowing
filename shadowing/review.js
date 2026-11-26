/* 표현 주머니 간격 복습: 담은 표현을 1·3·7·14·30일 간격으로 다시 보여준다.
   State lives on each pouch item (srsStage, srsDue, srsLog), so it syncs with the pouch for signed-in users.
   Loaded on index.html (calendar badge) and pouch.html (review cards). */
const KWReview = (function () {
  const INTERVALS = [1, 3, 7, 14, 30]; // days until the next review after passing stage i
  const LOG_MAX = 40;

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return iso(new Date()); }
  function addDays(s, n) { const p = s.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2] + n); return iso(d); }
  function localDate(isoTime) { const d = new Date(isoTime); return isNaN(d) ? today() : iso(d); }
  function md(s) { const p = s.split('-').map(Number); return p[1] + '/' + p[2]; }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function stage(x) { return Number.isInteger(x.srsStage) ? x.srsStage : 0; }
  // first review is the day after saving
  function due(x) { return x.srsDue || addDays(localDate(x.savedAt), 1); }
  function items() { return typeof Pouch === 'undefined' ? [] : Pouch.all().filter(function (x) { return !x.learned; }); }
  function dueItems(day) { const t = day || today(); return items().filter(function (x) { return due(x) <= t; }); }
  function upcoming() { // { date: count } for future reviews
    const t = today(), m = {};
    items().forEach(function (x) { const d = due(x); if (d > t) m[d] = (m[d] || 0) + 1; });
    return m;
  }
  function days() { // Map date -> number of reviews done that day
    const m = new Map();
    (typeof Pouch === 'undefined' ? [] : Pouch.all()).forEach(function (x) {
      (x.srsLog || []).forEach(function (d) { m.set(d, (m.get(d) || 0) + 1); });
    });
    return m;
  }
  function grade(key, remembered) {
    const x = Pouch.all().find(function (i) { return i.key === key; });
    if (!x) return;
    const t = today();
    const log = (x.srsLog || []).concat(t).slice(-LOG_MAX);
    let patch;
    if (!remembered) patch = { srsStage: 0, srsDue: addDays(t, 1), srsLog: log };
    else if (stage(x) + 1 >= INTERVALS.length) patch = { srsStage: INTERVALS.length, srsDue: null, srsLog: log, learned: true, reviewedAt: new Date().toISOString() };
    else patch = { srsStage: stage(x) + 1, srsDue: addDays(t, INTERVALS[stage(x)]), srsLog: log };
    Pouch.update(key, patch);
    window.dispatchEvent(new Event('kw-review'));
    return patch;
  }

  // ---------------------------------------------------------------- review cards (pouch.html)
  function cardDialog() {
    let dlg = document.getElementById('reviewDialog');
    if (dlg) return dlg;
    dlg = document.createElement('dialog'); dlg.id = 'reviewDialog'; dlg.className = 'login-dialog review-dialog';
    dlg.innerHTML = '<form class="login-card"><button type="button" class="login-close" aria-label="닫기">×</button>' +
      '<div class="rv-top"><span class="eyebrow">TODAY\'S REVIEW</span><span id="rvCount" class="rv-count"></span></div>' +
      '<div class="rv-bar"><i id="rvFill"></i></div><div id="rvBody" class="rv-body"></div></form>';
    document.body.appendChild(dlg);
    dlg.querySelector('.login-close').onclick = function () { dlg.close(); };
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); });
    return dlg;
  }
  function startReview() {
    const queue = dueItems().map(function (x) { return x.key; });
    if (!queue.length) return;
    const dlg = cardDialog();
    let i = 0, ok = 0;
    const total = queue.length;
    function show() {
      dlg.querySelector('#rvCount').textContent = Math.min(i + 1, total) + ' / ' + total;
      dlg.querySelector('#rvFill').style.width = (i / total * 100) + '%';
      const body = dlg.querySelector('#rvBody');
      body.replaceChildren();
      if (i >= total) {
        body.append(el('p', 'rv-done-mark', '✓'), el('h2', null, '오늘 복습 끝!'),
          el('p', 'rv-sub', total + '개 중 ' + ok + '개를 기억했어요. 헷갈린 표현은 내일 다시 나와요.'));
        const close = el('button', 'primary', '닫기'); close.type = 'button'; close.onclick = function () { dlg.close(); };
        body.append(close);
        return;
      }
      const x = Pouch.all().find(function (it) { return it.key === queue[i]; });
      if (!x) { i++; return show(); }
      const front = el('div', 'rv-front');
      front.append(el('span', 'rv-stage', '복습 ' + (stage(x) + 1) + '단계'), el('h2', 'rv-phrase', x.phrase));
      if (x.surface && x.surface !== x.phrase) front.append(el('p', 'rv-surface', '“' + x.surface + '”'));
      front.append(el('p', 'rv-sub', '뜻과 쓰는 상황을 먼저 떠올려 보세요.'));
      const reveal = el('button', 'primary rv-reveal', '뜻 확인하기'); reveal.type = 'button';
      const back = el('div', 'rv-back'); back.hidden = true;
      back.append(el('p', 'rv-meaning', x.meaning_ko));
      if (x.work_example_en) back.append(el('p', 'rv-ex', x.work_example_en), el('p', 'rv-ex-ko', x.work_example_ko || ''));
      const row = el('div', 'rv-grade');
      const no = el('button', 'rv-no', '헷갈려요 · 내일 다시'); no.type = 'button';
      const yes = el('button', 'rv-yes', '기억났어요 · ' + (stage(x) + 1 >= INTERVALS.length ? '외운 표현으로' : INTERVALS[stage(x)] + '일 뒤')); yes.type = 'button';
      no.onclick = function () { grade(x.key, false); i++; show(); };
      yes.onclick = function () { grade(x.key, true); ok++; i++; show(); };
      row.append(no, yes); back.append(row);
      reveal.onclick = function () { reveal.hidden = true; back.hidden = false; yes.focus(); };
      body.append(front, reveal, back);
      reveal.focus();
    }
    show();
    if (!dlg.open) dlg.showModal();
  }
  function panel() {
    const tools = document.querySelector('.notebook-tools');
    if (!tools) return;
    let box = document.getElementById('reviewPanel');
    if (!box) {
      box = el('div', 'review-panel'); box.id = 'reviewPanel';
      tools.parentNode.insertBefore(box, tools);
    }
    const n = dueItems().length, up = upcoming();
    const next = Object.keys(up).sort()[0];
    box.replaceChildren();
    const txt = el('div', 'rp-text');
    txt.append(el('strong', null, n ? '오늘 복습할 표현 ' + n + '개' : '오늘 복습 완료 ✓'));
    txt.append(el('small', null, next ? '다음 복습 ' + md(next) + ' · ' + up[next] + '개' : (items().length ? '' : '표현을 담으면 다음 날부터 복습이 시작돼요.')));
    box.append(el('span', 'rp-icon', '↻'), txt);
    if (n) { const b = el('button', 'primary', '복습 시작'); b.type = 'button'; b.onclick = startReview; box.append(b); }
  }
  // "다음 복습" tag on each note card, added after pouch-page.js renders
  function tagNotes() {
    const t = today();
    document.querySelectorAll('#notes .note[data-key]').forEach(function (art) {
      if (art.querySelector('.srs-tag')) return;
      const x = Pouch.all().find(function (i) { return i.key === art.dataset.key; });
      if (!x || x.learned) return;
      const d = due(x);
      const tag = el('span', 'srs-tag' + (d <= t ? ' due' : ''), d <= t ? '↻ 오늘 복습' : '↻ ' + md(d));
      tag.title = '복습 ' + (stage(x) + 1) + '단계';
      const head = art.querySelector('.note-head');
      (head || art).append(tag);
    });
  }
  function mountPouchPage() {
    panel(); tagNotes();
    const notes = document.getElementById('notes');
    if (notes) new MutationObserver(tagNotes).observe(notes, { childList: true });
    // pouch-page.js re-renders on kw-sync; review changes go through the same path
    window.addEventListener('kw-review', function () { panel(); window.dispatchEvent(new Event('kw-sync')); });
    window.addEventListener('kw-sync', panel);
    if (window.KWSync) KWSync.ready().then(panel);
    if (/review/.test(location.hash)) setTimeout(startReview, 300);
  }

  function css() {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'review.css?v=20261126';
    document.head.appendChild(l);
  }
  css();
  if (document.body.classList.contains('pouch-page')) mountPouchPage();

  return { dueItems: dueItems, upcoming: upcoming, days: days, grade: grade, start: startReview, INTERVALS: INTERVALS };
})();
window.KWReview = KWReview;
