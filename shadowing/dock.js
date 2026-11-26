/* 휴대폰 하단 고정 버튼 줄: ▶ 듣기 · ● 녹음 · 🔁 문장 루프.
   Each button just clicks the real control, so all logic stays in app.js / sentence-loop.js.
   Shown only on narrow screens while the practice area is on screen. */
(function () {
  const MQ = window.matchMedia('(max-width: 650px)');
  let dock = null, visible = true;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function proxy(id, cls) {
    const b = el('button', 'dock-btn ' + cls); b.type = 'button';
    b.onclick = function () { const t = document.getElementById(id); if (t && !t.disabled) t.click(); };
    return b;
  }
  function sync() {
    if (!dock) return;
    const play = document.getElementById('play'), rec = document.getElementById('record'), loop = document.getElementById('sentenceLoop');
    const [bp, br, bl] = dock.children;
    bp.textContent = play ? play.textContent : '▶ 듣기';
    br.textContent = rec ? (rec.classList.contains('recording') ? '■ 녹음 끝' : '● 녹음') : '● 녹음';
    br.classList.toggle('on', !!(rec && rec.classList.contains('recording')));
    br.disabled = !!(rec && rec.disabled);
    bl.hidden = !loop;
    if (loop) { const on = loop.getAttribute('aria-pressed') === 'true'; bl.textContent = on ? '■ 루프 멈춤' : '🔁 문장 루프'; bl.classList.toggle('on', on); }
    // only while the practice area is on screen (checked on each sync; cheap and reliable)
    const practice = document.querySelector('.practice');
    if (practice) { const r = practice.getBoundingClientRect(); visible = r.bottom > 120 && r.top < window.innerHeight - 80; }
    dock.hidden = !(MQ.matches && visible);
    document.body.classList.toggle('has-dock', !dock.hidden);
  }
  function mount() {
    if (dock) return;
    dock = el('div', 'dock'); dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', '연습 버튼');
    dock.append(proxy('play', 'dock-play'), proxy('record', 'dock-rec'), proxy('sentenceLoop', 'dock-loop'));
    document.body.appendChild(dock);
    // the real buttons change their own labels; mirror them
    setInterval(sync, 250);
    window.addEventListener('scroll', sync, { passive: true });
    MQ.addEventListener ? MQ.addEventListener('change', sync) : MQ.addListener(sync);
    sync();
  }
  (function css() {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'dock.css?v=20261126';
    document.head.appendChild(l);
  })();
  if (window.__kwAppLoaded) mount(); else document.addEventListener('kw:ready', mount);
})();
