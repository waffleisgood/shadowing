/* 문장 단위 연습: a set's parts (sentence boundaries from caption word timings, see data/scripts/parts.py).
   app.js plays range(): the selected part, or the whole set when none is selected. */
const KWParts = (function () {
  let idx = null;      // selected part index, null = 전체
  let setKey = null;   // set the selection belongs to

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function parts() { const s = set(); return Array.isArray(s.parts) && s.parts.length > 1 ? s.parts : null; }
  function range() {
    const p = parts();
    if (idx == null || !p || setKey !== key()) return null;
    return p[idx] || null;
  }

  function choose(i, play) {
    if (recordBusy) return status('녹음을 먼저 완료해주세요.', true);
    const p = parts(); if (!p) return;
    idx = i; setKey = key();
    pause();
    render();
    if (!ready) return;
    if (play) playSegment();
    else { player.seekTo(range() ? range().start : set().start, true); player.pauseVideo(); }
    const r = range();
    if (r) status('문장 ' + (i + 1) + ' / ' + p.length + (looping ? ' · 반복 중이에요. 따라 말해보세요.' : ' · 반복을 켜면 이 문장만 되풀이해요.'));
    else status('전체 구간으로 돌아왔어요. 문장을 이어서 말해보세요.');
  }

  function bar(p) {
    const wrap = el('div', 'parts-bar');
    wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', '문장별 연습');
    wrap.append(el('span', 'parts-label', '문장별'));
    p.forEach(function (_, i) {
      const b = el('button', 'part-chip', String(i + 1)); b.type = 'button';
      b.setAttribute('aria-pressed', String(idx === i));
      b.title = '문장 ' + (i + 1) + ' 듣기';
      b.onclick = function () { choose(i, true); };
      wrap.append(b);
    });
    const all = el('button', 'part-chip all', '전체'); all.type = 'button';
    all.setAttribute('aria-pressed', String(idx == null));
    all.onclick = function () { choose(null, true); };
    wrap.append(all);
    if (idx != null && idx < p.length - 1) {
      const next = el('button', 'part-next', '다음 문장 →'); next.type = 'button';
      next.onclick = function () { choose(idx + 1, true); };
      wrap.append(next);
    } else if (idx === p.length - 1) {
      const next = el('button', 'part-next', '전체 이어서 →'); next.type = 'button';
      next.onclick = function () { choose(null, true); };
      wrap.append(next);
    }
    return wrap;
  }

  // called by app.js at the end of renderSet()
  function render() {
    if (setKey !== key()) { idx = null; setKey = key(); }
    const old = document.getElementById('partsBar'); if (old) old.remove();
    const p = parts();
    if (!p) return;
    const b = bar(p); b.id = 'partsBar';
    const top = document.querySelector('.transcript-top');
    if (top) top.after(b);
    // transcript as sentences: the selected one is highlighted, each is clickable
    const tr = document.getElementById('transcript');
    if (tr && !hidden) {
      tr.replaceChildren();
      p.forEach(function (x, i) {
        const s = el('span', 'part-text' + (idx === i ? ' on' : '') + (idx != null && idx !== i ? ' dim' : ''), x.text);
        s.onclick = function () { choose(i, true); };
        tr.append(s, document.createTextNode(' '));
      });
    }
  }

  function css() {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'parts.css?v=20261126';
    document.head.appendChild(l);
  }
  css();
  return { range: range, render: render, choose: choose };
})();
window.KWParts = KWParts;
