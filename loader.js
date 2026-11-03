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
  const today = localISODate();
  fetch('content/index.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
    .then(function (index) {
      const all = (index.days || []).slice().sort(function (a, b) { return a.day - b.day; });
      const published = all.filter(function (x) { return x.publish_date <= today; });
      const upcoming = all.find(function (x) { return x.publish_date > today; });
      return Promise.all(published.map(function (x) {
        return fetch('content/' + x.file).then(function (r) { if (!r.ok) throw new Error(x.file + ' ' + r.status); return r.json(); });
      })).then(function (lessons) { return { lessons: lessons, upcoming: upcoming }; });
    })
    .then(function (res) {
      if (!res.lessons.length) throw new Error('no published days');
      window.LESSONS = res.lessons;
      return loadScript('app.js').then(function () {
        nextReleaseNote(res.upcoming);
        return loadScript('https://www.youtube.com/iframe_api');
      });
    })
    .catch(function (e) {
      console.error(e);
      showError('학습 데이터를 불러오지 못했어요. 새로고침해 주세요.');
    });
})();
