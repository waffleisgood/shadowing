/* 문장 루프: one sentence, hands-free.
   ① 원음 → ② 자동 녹음 (문장 길이 + 1.5초) → ③ 내 녹음 → ④ 원음, then 다시 / 다음 문장.
   Builds on app.js (playSegment, boundary, recorder, stopRecording, recordings, recKey) and parts.js (KWParts). */
(function () {
  const TAIL = 1.5;      // extra seconds to finish speaking
  const GAP = 500;       // ms between steps
  const STEPS = ['원음', '따라 말하기', '내 소리', '원음'];
  let run = null;        // { timer, poll, wasLooping, audio handlers }
  let panel = null;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function audio() { return document.getElementById('recordingAudio'); }
  function part() { return window.KWParts && KWParts.range(); }

  // ---------------------------------------------------------------- panel
  function ensurePanel() {
    if (panel) return panel;
    panel = el('div', 'sl-panel'); panel.hidden = true;
    const steps = el('div', 'sl-steps');
    STEPS.forEach(function (t, i) {
      if (i) steps.append(el('i', 'sl-arrow', '→'));
      steps.append(el('span', 'sl-step', t));
    });
    const meter = el('div', 'sl-meter'); meter.append(el('i'));
    const msg = el('p', 'sl-msg');
    const actions = el('div', 'sl-actions');
    panel.append(steps, meter, msg, actions);
    return panel;
  }
  function show(step, text) {
    const p = ensurePanel();
    p.hidden = false;
    p.querySelectorAll('.sl-step').forEach(function (s, i) { s.classList.toggle('on', i === step); s.classList.toggle('past', i < step); });
    p.querySelector('.sl-msg').textContent = text || '';
    p.querySelector('.sl-meter').hidden = step !== 1;
    p.querySelector('.sl-actions').replaceChildren();
  }
  function meter(frac) { const i = ensurePanel().querySelector('.sl-meter i'); i.style.width = Math.min(100, frac * 100) + '%'; }
  function actions(list) {
    const box = ensurePanel().querySelector('.sl-actions');
    box.replaceChildren();
    list.forEach(function (a) {
      const b = el('button', a.cls || '', a.label); b.type = 'button'; b.onclick = a.go; box.append(b);
    });
  }

  // ---------------------------------------------------------------- flow
  function clear() {
    if (!run) return;
    clearTimeout(run.timer); clearInterval(run.poll);
    const a = audio();
    if (run.onEnded) a.removeEventListener('ended', run.onEnded);
  }
  function stop(msg) {
    if (!run) return;
    clear();
    if (recorder && recorder.state === 'recording') stopRecording();
    looping = run.wasLooping;
    run = null;
    paintButton();
    if (panel) panel.hidden = true;
    if (msg) status(msg);
  }
  function wait(fn, ms) { run.timer = setTimeout(function () { if (run) fn(); }, ms); }

  function original(step, text, next) {
    show(step, text);
    playSegment();
    if (!ready) return stop();
    status(text);
    run.poll = setInterval(function () {
      if (run && boundary) { clearInterval(run.poll); wait(next, GAP); }
    }, 80);
  }
  function speak(next) {
    const r = part();
    const dur = ((r.end - r.start) / Number(document.getElementById('speed').value || 1) + TAIL) * 1000;
    const before = (recordings.get(recKey()) || {}).url;
    show(1, '마이크를 켜는 중이에요…');
    meter(0);
    run.selfClick = true;
    document.getElementById('record').click(); // app.js asks for the mic and starts recording
    run.selfClick = false;
    let started = 0;
    const t0 = Date.now();
    run.poll = setInterval(function () {
      if (!run) return;
      if (!started) {
        if (recorder && recorder.state === 'recording') { started = Date.now(); show(1, '● 지금 따라 말해보세요!'); }
        // wait as long as app.js is still asking for the mic (the permission prompt can take a while)
        else if (!recordBusy && Date.now() - t0 > 300) { clearInterval(run.poll); return stop('마이크를 쓸 수 없어서 문장 루프를 멈췄어요.'); }
        return;
      }
      const f = (Date.now() - started) / dur;
      meter(f);
      if (f >= 1 && recorder.state === 'recording') stopRecording();
      // app.js stores the clip in onstop; move on once it is there
      const now = (recordings.get(recKey()) || {}).url;
      if (f >= 1 && now && now !== before) { clearInterval(run.poll); wait(next, GAP); }
      else if (f >= 1 && Date.now() - started > dur + 5000) { clearInterval(run.poll); stop('녹음을 저장하지 못했어요. 다시 시도해 주세요.'); }
    }, 60);
  }
  function mine(next) {
    show(2, '내 소리예요. 원음과 어디가 다른지 들어보세요.');
    status('내 소리예요. 원음과 어디가 다른지 들어보세요.');
    const a = audio();
    run.onEnded = function () { a.removeEventListener('ended', run.onEnded); run.onEnded = null; wait(next, GAP); };
    a.addEventListener('ended', run.onEnded);
    a.currentTime = 0;
    a.play().catch(function () { stop('녹음을 재생하지 못했어요. 아래 플레이어로 직접 들어보세요.'); });
  }
  function finish() {
    const p = KWParts.parts(), i = KWParts.partIndex();
    clear();
    looping = run.wasLooping;
    const last = i >= p.length - 1;
    show(4, '어땠나요? 다르게 들린 곳이 있으면 한 번 더 해보세요.');
    ensurePanel().querySelectorAll('.sl-step').forEach(function (s) { s.classList.remove('on'); s.classList.add('past'); });
    status('문장 ' + (i + 1) + ' / ' + p.length + ' 루프 끝');
    actions([
      { label: '↻ 한 번 더', go: function () { start(); } },
      last ? { label: '전체 이어서 →', cls: 'primary', go: function () { stop(); KWParts.choose(null, true); } }
           : { label: '다음 문장 →', cls: 'primary', go: function () { KWParts.choose(i + 1, false); start(); } },
      { label: '그만', cls: 'sl-quit', go: function () { stop(); } },
    ]);
    run.done = true;
  }

  function start() {
    if (run && !run.done) return stop('문장 루프를 멈췄어요.');
    if (run) { clear(); run = null; }
    if (recordBusy) return status('녹음을 먼저 완료해주세요.', true);
    if (!ready) return status('YouTube가 아직 준비되지 않았어요. 잠시 후 다시 눌러주세요.', true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return status('이 브라우저에서는 녹음을 지원하지 않아요. Safari 또는 Chrome에서 열어주세요.', true);
    if (!part()) KWParts.choose(0, false); // start from the first sentence
    if (!part()) return;
    run = { wasLooping: looping };
    looping = false;
    paintButton();
    original(0, '① 원음을 들어보세요.', function () {
      speak(function () {
        mine(function () {
          original(3, '④ 다시 원음. 차이에 귀 기울여 보세요.', finish);
        });
      });
    });
  }

  // ---------------------------------------------------------------- mount
  function paintButton() {
    const b = document.getElementById('sentenceLoop');
    if (!b) return;
    const on = run && !run.done;
    b.textContent = on ? '■ 루프 멈추기' : '🔁 문장 루프';
    b.setAttribute('aria-pressed', String(!!on));
  }
  document.addEventListener('kw:parts-render', function () {
    const bar = document.getElementById('partsBar'); if (!bar) return;
    const b = el('button', 'sl-btn'); b.type = 'button'; b.id = 'sentenceLoop';
    b.title = '원음 → 따라 말하기(자동 녹음) → 내 소리 → 원음';
    b.onclick = start;
    bar.append(b);
    paintButton();
    bar.after(ensurePanel());
  });
  // stop when the learner does something else
  document.addEventListener('click', function (e) {
    if (!run || run.selfClick || !e.target.closest) return;
    if (e.target.closest('#sentenceLoop, .sl-panel')) return;
    if (e.target.closest('#play, #record, #complete, #setTabs, #videoList, #compareBtn, .part-chip, .part-text, .part-next, #nextVideo')) stop(run.done ? '' : '문장 루프를 멈췄어요.');
  }, true);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });

  (function css() {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'sentence-loop.css?v=20261126';
    document.head.appendChild(l);
  })();
})();
