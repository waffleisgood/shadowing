/* 원음 → 내 녹음 → 원음 이어 듣기.
   Reuses app.js globals (playSegment, pause, boundary, ready, looping, recordings, key, status). */
(function () {
  const GAP = 600; // ms of silence between steps, so the ear can reset
  let run = null; // { step, timer, poll, wasLooping }

  function css() {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'compare.css?v=20261126';
    document.head.appendChild(l);
  }
  function btn() { return document.getElementById('compareBtn'); }
  function audio() { return document.getElementById('recordingAudio'); }
  function label(on) {
    const b = btn(); if (!b) return;
    b.textContent = on ? '■ 비교 멈추기' : '⇄ 원음 → 내 녹음 → 원음';
    b.setAttribute('aria-pressed', String(!!on));
  }
  function steps(active) {
    const box = document.getElementById('compareSteps'); if (!box) return;
    box.hidden = active < 0;
    box.querySelectorAll('span').forEach(function (s, i) {
      s.classList.toggle('on', i === active);
      s.classList.toggle('past', i < active);
    });
  }

  function stop(msg) {
    if (!run) return;
    clearTimeout(run.timer); clearInterval(run.poll);
    const a = audio(); a.removeEventListener('ended', run.onEnded); a.removeEventListener('pause', run.onPause);
    looping = run.wasLooping;
    run = null;
    label(false); steps(-1);
    if (msg) status(msg);
  }

  function playOriginal(msg, next) {
    run.poll && clearInterval(run.poll);
    playSegment();
    if (!ready) return stop();
    status(msg); // after playSegment, which writes its own status
    // finishSegment() sets `boundary` when the segment reaches its end
    run.poll = setInterval(function () {
      if (!run) return;
      if (boundary) { clearInterval(run.poll); run.poll = null; run.timer = setTimeout(next, GAP); }
    }, 80);
  }
  function playMine(next) {
    const a = audio();
    run.onEnded = function () { a.removeEventListener('ended', run.onEnded); a.removeEventListener('pause', run.onPause); run.timer = setTimeout(next, GAP); };
    run.onPause = function () { if (!a.ended) stop('비교를 멈췄어요.'); };
    a.addEventListener('ended', run.onEnded);
    a.currentTime = 0;
    // add the pause listener after play starts, so the reset above cannot trigger it
    a.play().then(function () { if (run) a.addEventListener('pause', run.onPause); })
      .catch(function () { stop('녹음을 재생하지 못했어요. 아래 플레이어로 직접 들어보세요.'); });
  }

  function start() {
    if (run) return stop('비교를 멈췄어요.');
    if (recordBusy) return status('녹음을 먼저 완료해주세요.', true);
    if (!recordings.get(key())) return status('먼저 녹음해 주세요.', true);
    if (!ready) return status('YouTube가 아직 준비되지 않았어요. 잠시 후 다시 눌러주세요.', true);
    run = { wasLooping: looping };
    looping = false; // one pass per step; the loop setting comes back afterwards
    label(true);
    steps(0);
    playOriginal('① 원음을 들어보세요.', function () {
      if (!run) return;
      steps(1); status('② 내 녹음이에요. 강세와 끊는 위치를 비교해 보세요.');
      playMine(function () {
        if (!run) return;
        steps(2);
        playOriginal('③ 다시 원음. 달랐던 곳에 귀를 기울여 보세요.', function () { stop('비교 끝! 다르게 들린 부분만 다시 녹음해 보세요.'); });
      });
    });
  }

  function mount() {
    const box = document.getElementById('recordingResult');
    if (!box || btn()) return;
    const row = document.createElement('div');
    row.className = 'compare-row';
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'compareBtn'; b.className = 'compare-btn';
    b.onclick = start;
    const s = document.createElement('div');
    s.id = 'compareSteps'; s.className = 'compare-steps'; s.hidden = true;
    ['원음', '내 녹음', '원음'].forEach(function (t, i) {
      if (i) s.append(document.createTextNode('→'));
      const x = document.createElement('span'); x.textContent = t; s.append(x);
    });
    row.append(b, s);
    box.insertBefore(row, box.firstChild);
    label(false);
    // stop when the learner moves to another set or video, or starts something else
    ['setTabs', 'videoList', 'play', 'record', 'complete', 'nextVideo'].forEach(function (id) {
      const n = document.getElementById(id);
      if (n) n.addEventListener('click', function (e) { if (run && !e.target.closest('#compareBtn')) stop(); }, true);
    });
  }

  css();
  if (window.__kwAppLoaded) mount(); else document.addEventListener('kw:ready', mount);
})();
