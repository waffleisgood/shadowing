/* Loads published Days (serial release) and then boots the app.
   content/index.json -> days whose publish_date <= viewer's local date -> window.LESSONS -> app.js -> YouTube API */
(function () {
  function localISODate() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('load failed: ' + src)); };
      document.body.appendChild(s);
    });
  }
  function showError(msg) {
    const el = document.getElementById('playerStatus');
    if (el) { el.textContent = msg; el.classList.add('error'); }
  }
  function nextReleaseNote(upcoming) {
    const note = document.querySelector('.aside-note');
    if (!note || !upcoming) return;
    const [y, m, d] = upcoming.publish_date.split('-').map(Number);
    note.textContent = '✎ 새 Day는 하루에 하나씩 열려요. 다음 Day ' + upcoming.day + ' · ' + m + '월 ' + d + '일 공개';
  }
  // deep link from 표현 주머니: index.html#day=3&set=2
  function openFromHash(locked) {
    const m = /day=(\d+)(?:&set=(\d+))?/.exec(location.hash || '');
    if (!m || typeof selectLesson !== 'function') return;
    const i = window.LESSONS.findIndex(function (l) { return l.day === Number(m[1]); });
    if (i < 0) {
      if (locked.some(function (x) { return x.day === Number(m[1]); })) KWSync.login();
      return;
    }
    try { selectLesson(i); if (m[2]) selectSet(Math.max(0, Number(m[2]) - 1)); } catch (e) { console.warn(e); }
  }
  // login gate: visitors see Day 1..freeDays; the app calls KWGate.onCompletion when nothing is left to study
  function dd(n) { return String(n).padStart(2, '0'); }
  function loginButton(id, label) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = 'primary'; b.textContent = label;
    b.onclick = function () { KWSync.login(); };
    return b;
  }
  function installGate(locked, freeDays) {
    window.__kwGated = locked.length > 0;
    if (!locked.length) return;
    window.KWGate = {
      onCompletion: function (finishedAll) {
        const box = document.getElementById('lessonComplete');
        const msg = document.getElementById('nextVideoMessage');
        if (!box || !msg) return;
        let btn = document.getElementById('gateLogin');
        if (!btn) { btn = loginButton('gateLogin', '로그인하고 이어가기'); box.appendChild(btn); }
        btn.hidden = !finishedAll;
        if (finishedAll) msg.textContent = 'Day ' + dd(freeDays) + '까지 모두 마쳤어요! 로그인하면 Day ' + dd(freeDays + 1) + '부터 이어갈 수 있어요.';
      }
    };
  }
  function showLockedNote(locked) {
    const aside = document.querySelector('aside');
    if (!aside || !locked.length) return;
    const box = document.createElement('div');
    box.className = 'locked-cta';
    const title = document.createElement('strong');
    title.textContent = '🔒 더 공부하기';
    const p = document.createElement('p');
    p.textContent = '로그인하면 매일 매일 연습할 수 있어요. 지금까지의 기록도 그대로 옮겨져요.';
    box.append(title, p, loginButton('asideLogin', '로그인하고 계속하기'));
    const pouch = aside.querySelector('.pouch-link');
    if (pouch) aside.insertBefore(box, pouch); else aside.appendChild(box);
  }
  const today = localISODate();
  fetch('content/index.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
    .then(function (index) {
      const all = (index.days || []).slice().sort(function (a, b) { return a.day - b.day; });
      const published = all.filter(function (x) { return x.publish_date <= today; });
      const upcoming = all.find(function (x) { return x.publish_date > today; });
      // wait for the session first: it decides which Days this visitor can open
      const syncReady = (window.KWSync ? KWSync.ready() : Promise.resolve()).catch(function () {});
      return syncReady.then(function () {
        const freeDays = Number((window.KW_CONFIG || {}).freeDays) || 0;
        const gated = !!(window.KWSync && KWSync.enabled && !KWSync.user && freeDays > 0);
        const visible = gated ? published.filter(function (x) { return x.day <= freeDays; }) : published;
        const locked = gated ? published.filter(function (x) { return x.day > freeDays; }) : [];
        const staticDays = visible.filter(function (x) { return x.file; });
        const remoteDays = visible.filter(function (x) { return !x.file; }).map(function (x) { return x.day; });
        return Promise.all([
          Promise.all(staticDays.map(function (x) {
            return fetch('content/' + x.file).then(function (r) { if (!r.ok) throw new Error(x.file + ' ' + r.status); return r.json(); });
          })),
          remoteDays.length && window.KWSync ? KWSync.fetchDays(remoteDays) : Promise.resolve([])
        ]).then(function (parts) {
          const lessons = parts[0].concat(parts[1]).sort(function (a, b) { return a.day - b.day; });
          if (parts[1].length < remoteDays.length && window.KWSync) KWSync.toast('일부 Day를 불러오지 못했어요. 잠시 후 새로고침해 주세요.');
          return { lessons: lessons, upcoming: upcoming, locked: locked, freeDays: freeDays };
        });
      });
    })
    .then(function (res) {
      if (!res.lessons.length) throw new Error('no published days');
      window.LESSONS = res.lessons;
      installGate(res.locked, res.freeDays);
      return loadScript('app.js?v=20261105').then(function () {
        window.__kwAppLoaded = true;
        nextReleaseNote(res.upcoming);
        showLockedNote(res.locked);
        openFromHash(res.locked);
        if (typeof updatePouchCount === 'function') updatePouchCount();
        return loadScript('https://www.youtube.com/iframe_api');
      });
    })
    .catch(function (e) {
      console.error(e);
      showError('학습 데이터를 불러오지 못했어요. 새로고침해 주세요.');
    });
})();
