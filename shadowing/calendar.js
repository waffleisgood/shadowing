/* 진도 달력: 내 Day 1 = 첫 세트를 완료한 날. Day N의 내 학습일 = max(Day 1 + (N-1)일, Day N 공개일).
   Uses data already in the browser (content index, completed sets, completion dates); no extra requests. */
const KWCalendar = (function () {
  const DATES_KEY = 'kw-completed-at';
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  let view = null; // { y, m } month shown in the dialog

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function md(s) { const d = parse(s); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function dates() { try { return JSON.parse(localStorage.getItem(DATES_KEY) || '{}') || {}; } catch { return {}; } }
  function done() { return typeof completed !== 'undefined' ? completed : new Set(); }

  function model() {
    const today = iso(new Date());
    const index = (window.KW_INDEX || []).slice().sort(function (a, b) { return a.day - b.day; });
    const lessons = window.LESSONS || [];
    const byDay = new Map(lessons.map(function (l, i) { return [l.day, { lesson: l, index: i }]; }));
    const map = dates(), set = done();

    // local dates on which at least one set was completed
    const studied = new Map();
    Object.keys(map).forEach(function (k) {
      if (!set.has(k)) return;
      const t = new Date(map[k]);
      if (isNaN(t)) return;
      const d = iso(t);
      studied.set(d, (studied.get(d) || 0) + 1);
    });
    const firstStudy = Array.from(studied.keys()).sort()[0] || null;
    const start = firstStudy || today; // before the first set, preview a plan that starts today

    let prevDue = null;
    const days = index.map(function (x) {
      let due = addDays(start, x.day - 1);
      if (x.publish_date > due) due = x.publish_date;
      if (prevDue && due <= prevDue) due = addDays(prevDue, 1); // one Day per date
      prevDue = due;
      const hit = byDay.get(x.day);
      const total = hit ? hit.lesson.sets.length : 0;
      const doneSets = hit ? hit.lesson.sets.filter(function (_, i) { return set.has(hit.lesson.id + ':' + i); }).length : 0;
      const published = x.publish_date <= today;
      let status;
      if (hit && doneSets === total) status = 'done';
      else if (!published) status = 'unreleased';
      else if (!hit) status = due < today ? 'locked-late' : 'locked';
      else if (due < today) status = 'late';
      else if (due === today) status = 'today';
      else status = 'later';
      return { day: x.day, title: x.title, publish: x.publish_date, due: due, hit: hit, done: doneSets, total: total, status: status };
    });
    const released = days.filter(function (d) { return d.publish <= today; });
    return {
      today: today, start: start, started: !!firstStudy, studied: studied, days: days,
      lastReleased: released.length ? released[released.length - 1].day : 0,
      nextRelease: days.find(function (d) { return d.publish > today; }) || null,
      late: days.filter(function (d) { return d.status === 'late' || d.status === 'locked-late'; }),
      todayDay: days.find(function (d) { return d.due === today; }) || null,
      doneCount: days.filter(function (d) { return d.status === 'done'; }).length,
      // 표현 주머니 간격 복습 (review.js)
      reviewDue: window.KWReview ? KWReview.dueItems().length : 0,
      reviewed: window.KWReview ? KWReview.days() : new Map()
    };
  }

  function go(d, dlg) {
    if (!d.hit) { if (window.KWSync && KWSync.login) KWSync.login(); return; }
    if (dlg) dlg.close();
    selectLesson(d.hit.index);
    const t = document.getElementById('lessonTitle');
    if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function dayButton(d, dlg, cls) {
    const b = el('button', 'cal-chip ' + (cls || '') + ' is-' + d.status);
    b.type = 'button';
    b.textContent = 'Day ' + pad(d.day) + (d.hit ? '' : ' 🔒') + (d.done && d.done < d.total ? ' · ' + d.done + '/' + d.total : '');
    b.title = d.title + (d.hit ? '' : ' (로그인하면 열려요)');
    b.onclick = function () { go(d, dlg); };
    return b;
  }

  // header button: today's Day + overdue count
  function refresh() {
    const btn = document.getElementById('calendarOpen');
    if (!btn || !window.__kwAppLoaded) return;
    const m = model();
    const big = btn.querySelector('span'), small = btn.querySelector('small'), badge = btn.querySelector('.cal-badge');
    if (m.todayDay && m.todayDay.status !== 'done') { big.textContent = 'D' + pad(m.todayDay.day); small.textContent = '오늘 할 차례'; }
    else if (m.reviewDue) { big.textContent = '↻' + m.reviewDue; small.textContent = '복습할 차례'; }
    else if (m.todayDay) { big.textContent = '✓'; small.textContent = '오늘 분량 완료'; }
    else { big.textContent = '📅'; small.textContent = '내 진도 달력'; }
    badge.hidden = !m.late.length;
    badge.textContent = '밀림 ' + m.late.length;
    const dlg = document.getElementById('calendarDialog');
    if (dlg && dlg.open) render(dlg);
  }

  function track(m) {
    const n = m.days.length;
    const wrap = el('div', 'cal-track');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Day ' + m.lastReleased + '까지 공개' + (m.nextRelease ? ', 다음 Day ' + m.nextRelease.day + '는 ' + md(m.nextRelease.publish) + ' 공개' : '') + ', 완료 ' + m.doneCount + '개');
    const bar = el('div', 'cal-bar');
    m.days.forEach(function (d) {
      const seg = el('i', d.status === 'done' ? 'done' : d.publish <= m.today ? 'open' : 'soon');
      seg.title = 'Day ' + pad(d.day) + ' · ' + (d.status === 'done' ? '완료' : d.publish <= m.today ? '공개됨' : md(d.publish) + ' 공개');
      bar.append(seg);
    });
    const marks = el('div', 'cal-marks');
    const at = function (k) { return (k / n * 100) + '%'; };
    if (m.lastReleased) { const a = el('span', 'cal-mark end', 'D' + pad(m.lastReleased)); a.style.left = at(m.lastReleased); marks.append(a); }
    if (m.nextRelease) {
      const d = parse(m.nextRelease.publish);
      const b = el('span', 'cal-mark next', (d.getMonth() + 1) + '/' + d.getDate());
      b.style.left = at(m.nextRelease.day - 1); marks.append(b);
    }
    wrap.append(bar, marks);
    return wrap;
  }

  function summary(m, dlg) {
    const box = el('div', 'cal-summary');
    // 1) release status: one segment per Day (filled = 공개, green = 완료, dashed = 공개 전)
    const rel = track(m);
    // 2) my progress
    const me = el('p', 'cal-line');
    if (m.started) {
      const nth = Math.round((parse(m.today) - parse(m.start)) / 864e5) + 1;
      me.append(el('b', null, '완료 ' + m.doneCount + '개'), document.createTextNode(' · ' + md(m.start) + '에 Day 1을 시작해서 오늘이 ' + nth + '일째예요'));
    } else {
      me.textContent = '첫 세트를 완료하는 날이 내 Day 1이 돼요. 아래는 오늘 시작했을 때의 일정이에요.';
    }
    box.append(rel, me);
    // 3) today
    const t = el('div', 'cal-today');
    t.append(el('strong', null, '오늘'));
    if (m.todayDay && m.todayDay.status === 'done') t.append(el('span', null, 'Day ' + pad(m.todayDay.day) + ' 완료! 🎉'));
    else if (m.todayDay) t.append(dayButton(m.todayDay, dlg, 'big'), el('span', 'cal-sub', m.todayDay.title.replace(/^Day \d+ · /, '')));
    else if (m.nextRelease) t.append(el('span', null, '오늘 열릴 Day가 없어요. Day ' + pad(m.nextRelease.day) + '는 ' + md(m.nextRelease.publish) + '에 열려요.'));
    else t.append(el('span', null, '오늘 열릴 Day가 없어요.'));
    box.append(t);
    if (m.reviewDue) {
      const r = el('div', 'cal-today cal-review');
      const a = el('a', null, '↻ 표현 복습 ' + m.reviewDue + '개');
      a.href = 'pouch.html#review';
      r.append(el('strong', null, '복습'), a);
      box.append(r);
    }
    // 4) overdue
    if (m.late.length) {
      const l = el('div', 'cal-late');
      l.append(el('strong', null, '밀린 Day ' + m.late.length + '개'));
      const chips = el('div', 'cal-chips');
      m.late.forEach(function (d) { chips.append(dayButton(d, dlg)); });
      l.append(chips);
      box.append(l);
    }
    return box;
  }

  function month(m, dlg) {
    const wrap = el('div', 'cal-month');
    const head = el('div', 'cal-head');
    const prev = el('button', 'cal-nav', '‹'), next = el('button', 'cal-nav', '›');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', '이전 달'); next.setAttribute('aria-label', '다음 달');
    const first = parse(m.start), lastDue = m.days.length ? parse(m.days[m.days.length - 1].due) : parse(m.today);
    const min = first.getFullYear() * 12 + first.getMonth();
    const max = Math.max(lastDue.getFullYear() * 12 + lastDue.getMonth(), new Date().getFullYear() * 12 + new Date().getMonth());
    const cur = view.y * 12 + view.m;
    prev.disabled = cur <= min; next.disabled = cur >= max;
    prev.onclick = function () { shift(-1, dlg); }; next.onclick = function () { shift(1, dlg); };
    head.append(prev, el('h3', null, view.y + '년 ' + (view.m + 1) + '월'), next);
    wrap.append(head);

    const grid = el('div', 'cal-grid');
    WEEK.forEach(function (w) { grid.append(el('span', 'cal-wd', w)); });
    const byDue = new Map(m.days.map(function (d) { return [d.due, d]; }));
    const lead = new Date(view.y, view.m, 1).getDay();
    for (let i = 0; i < lead; i++) grid.append(el('span', 'cal-cell empty'));
    const n = new Date(view.y, view.m + 1, 0).getDate();
    for (let day = 1; day <= n; day++) {
      const ds = view.y + '-' + pad(view.m + 1) + '-' + pad(day);
      const d = byDue.get(ds);
      const studiedSets = m.studied.get(ds) || 0;
      const reviews = m.reviewed.get(ds) || 0;
      const cell = el(d ? 'button' : 'span', 'cal-cell' + (ds === m.today ? ' is-now' : '') + (studiedSets || reviews ? ' studied' : '') + (d ? ' has-day is-' + d.status : '') + (ds < m.start ? ' before' : ''));
      cell.append(el('span', 'cal-date', String(day)));
      if (d) {
        cell.type = 'button';
        cell.append(el('span', 'cal-dlabel', 'D' + pad(d.day) + (d.status === 'done' ? '✓' : '')));
        cell.title = d.title + ' · ' + label(d) + (studiedSets ? ' · 이날 ' + studiedSets + '세트 연습' : '');
        if (d.status !== 'unreleased') cell.onclick = function () { go(d, dlg); };
        else cell.disabled = true;
      } else if (studiedSets) cell.title = '이날 ' + studiedSets + '세트 연습';
      if (studiedSets) cell.append(el('span', 'cal-stamp', '✎' + studiedSets));
      if (reviews) { cell.append(el('span', 'cal-stamp rv', '↻' + reviews)); cell.title = (cell.title ? cell.title + ' · ' : '') + '표현 ' + reviews + '개 복습'; }
      grid.append(cell);
    }
    wrap.append(grid);
    const legend = el('div', 'cal-legend');
    [['is-done', '완료'], ['is-today', '오늘 할 Day'], ['is-late', '밀림'], ['is-later', '예정'], ['is-unreleased', '공개 전']].forEach(function (x) {
      const s = el('span'); s.append(el('i', x[0]), document.createTextNode(x[1])); legend.append(s);
    });
    const st = el('span'); st.append(el('b', 'cal-stamp', '✎'), document.createTextNode('연습한 날 (세트 수)')); legend.append(st);
    const rv = el('span'); rv.append(el('b', 'cal-stamp', '↻'), document.createTextNode('복습한 표현 수')); legend.append(rv);
    wrap.append(legend);
    return wrap;
  }
  function label(d) {
    return { done: '완료', today: '오늘 할 Day', late: '밀림', later: '예정', unreleased: md(d.publish) + ' 공개', locked: '로그인 필요', 'locked-late': '밀림 · 로그인 필요' }[d.status];
  }
  function shift(k, dlg) { const d = new Date(view.y, view.m + k, 1); view = { y: d.getFullYear(), m: d.getMonth() }; render(dlg); }

  function render(dlg) {
    const m = model();
    const body = dlg.querySelector('#calendarBody');
    body.replaceChildren(summary(m, dlg), month(m, dlg));
  }

  function open() {
    if (!window.__kwAppLoaded) return; // lesson data is still loading
    let dlg = document.getElementById('calendarDialog');
    if (dlg && dlg.open) return;
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'calendarDialog'; dlg.className = 'login-dialog history-dialog calendar-dialog';
      dlg.innerHTML = '<form class="login-card"><button type="button" class="login-close" aria-label="닫기">×</button>' +
        '<h2>내 진도 달력</h2><div id="calendarBody" class="cal-body"></div></form>';
      document.body.appendChild(dlg);
      dlg.querySelector('.login-close').onclick = function () { dlg.close(); };
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
      dlg.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); });
    }
    const now = new Date();
    view = { y: now.getFullYear(), m: now.getMonth() };
    render(dlg);
    dlg.showModal();
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('#calendarOpen')) open();
    // app.js records a set on #complete before this bubbles up, so the badge sees the new state
    else if (e.target.closest('#complete')) setTimeout(refresh, 0);
  });
  return { open: open, refresh: refresh, model: model };
})();
window.KWCalendar = KWCalendar;
