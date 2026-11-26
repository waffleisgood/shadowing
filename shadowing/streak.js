/* 연속 학습일 + 매일 알림.
   A study day = a day with at least one completed set or one expression review.
   Reminders go into the learner's own calendar app (Google Calendar link or an .ics file), so no server is needed. */
const KWStreak = (function () {
  const TIME_KEY = 'kw-reminder-time';
  const SITE = 'https://koreanwaffle.com/shadowing/';

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shift(s, n) { const p = s.split('-').map(Number); return iso(new Date(p[0], p[1] - 1, p[2] + n)); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function studyDays() {
    const days = new Set();
    try {
      const map = JSON.parse(localStorage.getItem('kw-completed-at') || '{}') || {};
      Object.keys(map).forEach(function (k) { const d = new Date(map[k]); if (!isNaN(d)) days.add(iso(d)); });
    } catch {}
    if (window.KWReview) KWReview.days().forEach(function (_, d) { days.add(d); });
    return days;
  }
  function stats() {
    const days = studyDays(), today = iso(new Date());
    const doneToday = days.has(today);
    let cur = 0, d = doneToday ? today : shift(today, -1);
    while (days.has(d)) { cur++; d = shift(d, -1); }
    let best = 0, run = 0, prev = null;
    Array.from(days).sort().forEach(function (x) { run = prev && shift(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; });
    return { current: cur, best: best, doneToday: doneToday, total: days.size };
  }

  // ---------------------------------------------------------------- reminder
  function savedTime() { try { return localStorage.getItem(TIME_KEY) || '20:00'; } catch { return '20:00'; } }
  function firstStart(hhmm) { // today if the time is still ahead, otherwise tomorrow
    const p = hhmm.split(':').map(Number), d = new Date();
    d.setHours(p[0], p[1], 0, 0);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
    return d;
  }
  function stamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00'; }
  const TITLE = '오늘의 셰도잉 ✎';
  const DETAILS = '오늘 할 Day와 복습할 표현을 확인해요. ' + SITE;
  function googleUrl(hhmm) {
    const s = firstStart(hhmm), e = new Date(s.getTime() + 15 * 60000);
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(TITLE) + '&details=' + encodeURIComponent(DETAILS) +
      '&dates=' + stamp(s) + '/' + stamp(e) + '&recur=' + encodeURIComponent('RRULE:FREQ=DAILY') +
      (tz ? '&ctz=' + encodeURIComponent(tz) : '');
  }
  function icsText(hhmm) {
    const now = new Date();
    const utc = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Korean Waffle//Shadowing//KO', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:kw-shadowing-daily-' + utc + '@koreanwaffle.com', 'DTSTAMP:' + utc,
      'DTSTART:' + stamp(firstStart(hhmm)), 'DURATION:PT15M', 'RRULE:FREQ=DAILY',
      'SUMMARY:' + TITLE, 'DESCRIPTION:' + DETAILS, 'URL:' + SITE,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + TITLE, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  }
  function downloadIcs(hhmm) {
    const url = URL.createObjectURL(new Blob([icsText(hhmm)], { type: 'text/calendar;charset=utf-8' }));
    const a = el('a'); a.href = url; a.download = 'korean-waffle-shadowing.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function reminderBox() {
    const box = el('div', 'rm-box'); box.hidden = true;
    const row = el('div', 'rm-row');
    const lab = el('label', null, '매일 ');
    const time = el('input'); time.type = 'time'; time.value = savedTime(); time.step = 300;
    time.onchange = function () { try { localStorage.setItem(TIME_KEY, time.value || '20:00'); } catch {} g.href = googleUrl(time.value || '20:00'); };
    lab.append(time, document.createTextNode(' 에 알려주세요'));
    row.append(lab);
    const g = el('a', 'rm-btn', 'Google 캘린더에 추가'); g.target = '_blank'; g.rel = 'noopener'; g.href = googleUrl(time.value);
    const i = el('button', 'rm-btn', '내 캘린더에 추가 (.ics)'); i.type = 'button';
    i.onclick = function () { downloadIcs(time.value || '20:00'); };
    const btns = el('div', 'rm-btns'); btns.append(g, i);
    box.append(row, btns, el('p', 'rm-note', '휴대폰 캘린더에 매일 반복 일정이 생겨서 그 시간에 알림이 와요. 끄려면 캘린더에서 일정을 지우면 돼요. 아이폰은 .ics를, 안드로이드는 Google 캘린더를 추천해요.'));
    return box;
  }

  // ---------------------------------------------------------------- UI
  function row() {
    const s = stats();
    const wrap = el('div', 'streak-row');
    const fire = el('span', 'streak-fire' + (s.current ? '' : ' off'), '🔥');
    const txt = el('span', 'streak-txt');
    if (s.current) {
      txt.append(el('b', null, s.current + '일 연속'));
      txt.append(document.createTextNode(s.doneToday ? ' · 오늘도 했어요!' : ' · 오늘 하면 ' + (s.current + 1) + '일째'));
    } else {
      txt.append(el('b', null, '오늘부터 1일째'));
      txt.append(document.createTextNode(s.total ? ' · 다시 시작해요' : ''));
    }
    if (s.best > 1) txt.append(el('small', null, ' 최고 ' + s.best + '일'));
    const bell = el('button', 'streak-bell', '🔔 매일 알림'); bell.type = 'button';
    bell.setAttribute('aria-expanded', 'false');
    const box = reminderBox();
    bell.onclick = function () { box.hidden = !box.hidden; bell.setAttribute('aria-expanded', String(!box.hidden)); };
    const line = el('div', 'streak-line'); line.append(fire, txt, bell);
    wrap.append(line, box);
    return wrap;
  }
  document.addEventListener('kw:calendar-render', function (e) {
    const body = e.detail.body, sum = body.querySelector('.cal-summary');
    const r = row();
    if (sum) sum.insertBefore(r, sum.children[1] || null); else body.prepend(r);
  });
  document.addEventListener('kw:calendar-refresh', function (e) {
    const btn = e.detail.button; if (!btn) return;
    let b = btn.querySelector('.streak-badge');
    if (!b) { b = el('b', 'streak-badge'); btn.appendChild(b); }
    const s = stats();
    b.hidden = s.current < 2;
    b.textContent = '🔥' + s.current;
    b.title = s.current + '일 연속 학습';
  });

  (function css() {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'streak.css?v=20261126';
    document.head.appendChild(l);
  })();
  return { stats: stats, icsText: icsText, googleUrl: googleUrl };
})();
window.KWStreak = KWStreak;
