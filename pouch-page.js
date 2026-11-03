/* 표현 주머니 review page */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const REG = { work_ok: '회사 OK', neutral: '무난', casual: '친한 사이' };
  let filter = 'all';
  let masked = false;
  let shuffled = null; // array of keys when in shuffle mode

  try { masked = localStorage.getItem('kw-pouch-mask') === '1'; } catch {}

  $('titleIcon').innerHTML = Pouch.icon('big');
  $('emptyIcon').innerHTML = Pouch.icon('huge');

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // source sentence with the saved surface underlined (case-insensitive, first match; "…" splits pieces)
  function sourceLine(text, surface) {
    const p = el('p', 'src');
    if (!text) return p;
    const pieces = (surface || '').split(/\s*(?:…|\.\.\.)\s*/).filter(Boolean);
    const lower = text.toLowerCase();
    const marks = [];
    let pos = 0;
    pieces.forEach(function (pc) {
      const i = lower.indexOf(pc.toLowerCase(), pos);
      if (i >= 0) { marks.push([i, i + pc.length]); pos = i + pc.length; }
    });
    let cur = 0;
    p.append(el('span', 'src-label', '원문 '));
    p.append('“');
    marks.forEach(function (m) {
      if (m[0] > cur) p.append(text.slice(cur, m[0]));
      p.append(el('u', null, text.slice(m[0], m[1])));
      cur = m[1];
    });
    p.append(text.slice(cur));
    p.append('”');
    return p;
  }

  function maskable(node) {
    node.classList.add('maskable');
    node.addEventListener('click', function () { node.classList.add('revealed'); });
    return node;
  }

  function entry(x) {
    const art = el('article', 'note' + (x.learned ? ' learned' : ''));
    art.dataset.key = x.key;

    const head = el('div', 'note-head');
    const check = el('button', 'note-check');
    check.type = 'button';
    check.setAttribute('aria-pressed', String(!!x.learned));
    check.title = x.learned ? '복습할 것으로 되돌리기' : '외웠어요';
    check.textContent = x.learned ? '☑' : '☐';
    check.onclick = function () { Pouch.update(x.key, { learned: !x.learned, reviewedAt: new Date().toISOString() }); render(); };
    const ph = el('h3', 'note-phrase', x.phrase);
    const tag = el('span', 'reg reg-' + (x.register || 'neutral'), REG[x.register] || '');
    head.append(check, ph, tag);

    const meaning = maskable(el('p', 'note-meaning', x.meaning_ko));
    const nuance = maskable(el('p', 'note-nuance', x.nuance_ko));
    const exEn = el('p', 'note-ex', x.work_example_en);
    const exKo = maskable(el('p', 'note-exk', x.work_example_ko));

    const foot = el('div', 'note-foot');
    const where = el('span', 'note-where', (x.day ? 'Day ' + String(x.day).padStart(2, '0') + ' · ' : '') + '세트 ' + (Number(x.setIndex) + 1) + (x.setTitle ? ' · ' + x.setTitle : ''));
    const listen = el('a', 'note-listen', '다시 듣기 →');
    listen.href = './#day=' + (x.day || '') + '&set=' + (Number(x.setIndex) + 1);
    const out = el('button', 'note-remove', '주머니에서 빼기');
    out.type = 'button';
    out.onclick = function () {
      if (confirm('“' + x.phrase + '”를 주머니에서 뺄까요?')) { Pouch.remove(x.key); render(); }
    };
    const learnedBtn = el('button', 'note-learned', x.learned ? '다시 복습할래요' : '외웠어요 ✓');
    learnedBtn.type = 'button';
    learnedBtn.onclick = check.onclick;
    foot.append(where, listen, learnedBtn, out);

    art.append(head, meaning, nuance, exEn, exKo, sourceLine(x.text, x.surface), foot);
    return art;
  }

  function render() {
    const all = Pouch.all();
    const todo = all.filter(function (x) { return !x.learned; });
    const done = all.filter(function (x) { return x.learned; });
    $('pouchTotal').textContent = all.length;
    $('cntAll').textContent = all.length;
    $('cntTodo').textContent = todo.length;
    $('cntDone').textContent = done.length;
    document.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); });
    $('maskToggle').setAttribute('aria-pressed', String(masked));
    $('maskToggle').textContent = masked ? '뜻 보이기' : '뜻 가리기';
    $('maskHint').hidden = !masked;
    document.body.classList.toggle('masked', masked);

    let items = filter === 'todo' ? todo : filter === 'done' ? done : all;
    const notes = $('notes');
    notes.replaceChildren();
    $('empty').hidden = all.length > 0;
    if (!all.length) return;
    if (!items.length) {
      notes.append(el('p', 'notes-empty', filter === 'done' ? '아직 “외웠어요”로 체크한 표현이 없어요.' : '복습할 표현을 모두 외웠어요! 🎉'));
      return;
    }

    if (shuffled) {
      const order = new Map(shuffled.map(function (k, i) { return [k, i]; }));
      items = items.slice().sort(function (a, b) { return (order.has(a.key) ? order.get(a.key) : 1e9) - (order.has(b.key) ? order.get(b.key) : 1e9); });
      const sec = el('section', 'day-group');
      sec.append(el('h2', 'day-title', '섞어서 복습 · ' + items.length + '개'));
      items.forEach(function (x) { sec.append(entry(x)); });
      notes.append(sec);
      return;
    }

    // group by Day (newest saved Day first within list order by day number)
    const groups = new Map();
    items.slice().sort(function (a, b) { return (a.day || 999) - (b.day || 999) || String(a.savedAt).localeCompare(String(b.savedAt)); })
      .forEach(function (x) {
        const k = x.day ? 'Day ' + String(x.day).padStart(2, '0') : '기타';
        if (!groups.has(k)) groups.set(k, { title: x.lessonTitle || k, channel: x.channel, list: [] });
        groups.get(k).list.push(x);
      });
    groups.forEach(function (g) {
      const sec = el('section', 'day-group');
      const h = el('h2', 'day-title', g.title);
      if (g.channel) h.append(el('small', null, g.channel));
      sec.append(h);
      g.list.forEach(function (x) { sec.append(entry(x)); });
      notes.append(sec);
    });
  }

  document.querySelectorAll('[data-filter]').forEach(function (b) {
    b.onclick = function () { filter = b.dataset.filter; render(); };
  });
  $('maskToggle').onclick = function () {
    masked = !masked;
    try { localStorage.setItem('kw-pouch-mask', masked ? '1' : '0'); } catch {}
    render();
  };
  $('shuffle').onclick = function () {
    if (shuffled) { shuffled = null; $('shuffle').textContent = '섞어서 복습'; render(); return; }
    const keys = Pouch.all().map(function (x) { return x.key; });
    for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = keys[i]; keys[i] = keys[j]; keys[j] = t; }
    shuffled = keys;
    $('shuffle').textContent = 'Day별로 보기';
    if (!masked) { masked = true; }
    render();
  };
  window.addEventListener('storage', function (e) { if (e.key === 'kw-pouch-v1') render(); });
  render();
})();
