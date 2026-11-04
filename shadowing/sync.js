/* Login + cloud sync (Supabase). Without config it does nothing and the site stays local-only.
   Synced: 표현 주머니 (kw-pouch-v1) and set completion (scene-loop-completed).
   Strategy: localStorage is the working copy; on login we merge local ⇄ server, then push changes as they happen. */
const KWSync = (function () {
  const cfg = window.KW_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const PROGRESS_KEY = 'scene-loop-completed';
  const KNOWN_KEY = 'kw-sync-known-pouch'; // pouch keys last seen on server (to detect removals)
  let client = null, user = null, pushTimer = null, progressTimer = null;

  function ls(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  function emit() { window.dispatchEvent(new CustomEvent('kw-sync', { detail: { user: user } })); }
  function loadLib() {
    return new Promise(function (res, rej) {
      if (window.supabase && window.supabase.createClient) return res();
      const s = document.createElement('script'); s.src = LIB; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function toast(msg) {
    let t = document.getElementById('kwToast');
    if (!t) { t = document.createElement('div'); t.id = 'kwToast'; t.className = 'kw-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  // ---------------------------------------------------------------- merge
  async function pullMerge() {
    if (!client || !user) return;
    // pouch
    const { data: rows, error } = await client.from('pouch_items').select('key,data,learned,deleted,saved_at,updated_at');
    if (error) { console.warn(error); return; }
    const local = (typeof Pouch !== 'undefined') ? Pouch.all() : ls('kw-pouch-v1', []);
    const map = new Map(local.map(function (x) { return [x.key, x]; }));
    const toPush = [];
    const serverKeys = new Set();
    rows.forEach(function (r) {
      serverKeys.add(r.key);
      const l = map.get(r.key);
      const lTime = l && l.updatedAt ? Date.parse(l.updatedAt) : 0;
      const sTime = Date.parse(r.updated_at);
      if (r.deleted) { if (l && lTime > sTime) toPush.push(l); else map.delete(r.key); return; }
      if (!l || sTime >= lTime) map.set(r.key, Object.assign({}, r.data, { key: r.key, learned: r.learned, savedAt: r.saved_at, updatedAt: r.updated_at }));
      else toPush.push(l);
    });
    map.forEach(function (x, k) { if (!serverKeys.has(k)) toPush.push(x); });
    const merged = Array.from(map.values());
    if (typeof Pouch !== 'undefined') Pouch.replaceAll(merged); else lsSet('kw-pouch-v1', merged);
    lsSet(KNOWN_KEY, merged.map(function (x) { return x.key; }));
    if (toPush.length) await upsertPouch(toPush);

    // progress (union)
    const { data: prog, error: e2 } = await client.from('progress').select('set_key');
    if (e2) { console.warn(e2); return; }
    const localDone = new Set(ls(PROGRESS_KEY, []));
    const serverDone = new Set(prog.map(function (r) { return r.set_key; }));
    const missing = Array.from(localDone).filter(function (k) { return !serverDone.has(k); });
    serverDone.forEach(function (k) { localDone.add(k); });
    lsSet(PROGRESS_KEY, Array.from(localDone));
    if (missing.length) await client.from('progress').upsert(missing.map(function (k) { return { set_key: k }; }), { onConflict: 'user_id,set_key', ignoreDuplicates: true });
  }

  function rowOf(x) {
    const data = Object.assign({}, x); delete data.learned; delete data.savedAt; delete data.updatedAt;
    return { key: x.key, data: data, learned: !!x.learned, deleted: false, saved_at: x.savedAt || new Date().toISOString(), updated_at: x.updatedAt || new Date().toISOString() };
  }
  async function upsertPouch(items) {
    const { error } = await client.from('pouch_items').upsert(items.map(rowOf), { onConflict: 'user_id,key' });
    if (error) console.warn(error);
  }

  // ---------------------------------------------------------------- push on change
  function pouchChanged(items) {
    if (!client || !user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async function () {
      const keys = new Set(items.map(function (x) { return x.key; }));
      const known = ls(KNOWN_KEY, []);
      const removed = known.filter(function (k) { return !keys.has(k); });
      if (items.length) await upsertPouch(items);
      if (removed.length) {
        const { error } = await client.from('pouch_items').update({ deleted: true, updated_at: new Date().toISOString() }).in('key', removed);
        if (error) console.warn(error);
      }
      lsSet(KNOWN_KEY, Array.from(keys));
    }, 700);
  }
  function progressChanged() {
    if (!client || !user) return;
    clearTimeout(progressTimer);
    progressTimer = setTimeout(async function () {
      const done = ls(PROGRESS_KEY, []);
      if (!done.length) return;
      const { error } = await client.from('progress').upsert(done.map(function (k) { return { set_key: k }; }), { onConflict: 'user_id,set_key', ignoreDuplicates: true });
      if (error) console.warn(error);
    }, 700);
  }

  // ---------------------------------------------------------------- account UI
  function renderAccount() {
    const box = document.getElementById('account');
    if (!box) return;
    box.replaceChildren();
    if (!enabled) { box.hidden = true; return; }
    box.hidden = false;
    const fb = document.createElement('button'); fb.type = 'button'; fb.className = 'account-btn feedback-btn'; fb.textContent = '피드백';
    fb.onclick = openFeedback;
    box.append(fb);
    if (user) {
      const who = document.createElement('span'); who.className = 'account-who';
      who.textContent = '☺ ' + (user.email || '').split('@')[0];
      who.title = (user.email || '') + ' · 주머니와 진도가 모든 기기에 동기화돼요';
      const out = document.createElement('button'); out.type = 'button'; out.className = 'account-btn'; out.textContent = '로그아웃';
      out.onclick = signOut;
      box.append(who, out);
    } else {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'account-btn primary-soft'; b.textContent = '로그인 ✎';
      b.onclick = function () { if (!client) { toast('로그인을 준비하고 있어요. 잠시 후 다시 눌러주세요.'); return; } openLogin(); };
      box.append(b);
    }
  }

  // closing never depends on form validation: ×, 닫기, click outside, Esc (native)
  function wireDialog(dlg, sendSelector) {
    dlg.querySelectorAll('.login-close, .dialog-cancel').forEach(function (b) { b.onclick = function () { dlg.close(); }; });
    let downOnBackdrop = false;
    dlg.addEventListener('pointerdown', function (e) { downOnBackdrop = e.target === dlg; });
    dlg.addEventListener('click', function (e) { if (e.target === dlg && downOnBackdrop) dlg.close(); downOnBackdrop = false; });
    dlg.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (e.target.querySelector(sendSelector)) e.target.querySelector(sendSelector).click();
    });
  }

  function openLogin() {
    let dlg = document.getElementById('loginDialog');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'loginDialog'; dlg.className = 'login-dialog';
      dlg.innerHTML =
        '<form class="login-card">' +
        '<button type="button" class="login-close" aria-label="닫기">×</button>' +
        '<h2>로그인</h2>' +
        '<p>로그인하면 <strong>표현 주머니</strong>와 <strong>연습 기록</strong>이 휴대폰과 PC에 함께 저장돼요. 지금 이 브라우저에 있는 기록도 그대로 옮겨져요.</p>' +
        '<label for="loginEmail">이메일</label>' +
        '<input id="loginEmail" type="email" autocomplete="email" placeholder="you@example.com">' +
        '<button type="button" id="loginSend" class="primary">로그인 링크 받기</button>' +
        ((cfg.enableGoogle || cfg.enableApple) ? '<div class="login-or">또는</div>' : '') +
        (cfg.enableGoogle ? '<button type="button" class="oauth-btn" data-provider="google"><span class="oauth-mark">G</span>Google로 계속하기</button>' : '') +
        (cfg.enableApple ? '<button type="button" class="oauth-btn" data-provider="apple"><span class="oauth-mark"></span>Apple로 계속하기</button>' : '') +
        '<p id="loginMsg" class="login-msg" role="status"></p>' +
        '<p class="login-note">비밀번호 없이 메일로 받은 링크를 누르면 로그인돼요.</p>' +
        '</form>';
      document.body.appendChild(dlg);
      wireDialog(dlg, '#loginSend');
      dlg.querySelector('#loginSend').onclick = async function () {
        const email = dlg.querySelector('#loginEmail').value.trim();
        const msg = dlg.querySelector('#loginMsg');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = '이메일 주소를 확인해 주세요.'; return; }
        this.disabled = true; msg.textContent = '보내는 중…';
        const redirect = location.origin + location.pathname;
        const { error } = await client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirect } });
        this.disabled = false;
        msg.textContent = error ? ('보내지 못했어요: ' + error.message) : '메일함을 확인해 주세요! 링크를 누르면 이 페이지로 돌아와 로그인돼요.';
      };
      dlg.querySelectorAll('.oauth-btn').forEach(function (b) {
        b.onclick = async function () {
          if (!client) return;
          const { error } = await client.auth.signInWithOAuth({ provider: b.dataset.provider, options: { redirectTo: location.origin + location.pathname } });
          if (error) dlg.querySelector('#loginMsg').textContent = '로그인하지 못했어요: ' + error.message;
        };
      });
    }
    dlg.querySelector('#loginMsg').textContent = '';
    dlg.showModal();
  }

  // ---------------------------------------------------------------- feedback
  const FEEDBACK_LAST = 'kw-feedback-last';
  const FEEDBACK_COOLDOWN = 30000;
  function feedbackPage() {
    const title = document.getElementById('lessonTitle');
    const set = document.getElementById('setTitle');
    return [location.pathname + location.hash, title && title.textContent, set && set.textContent].filter(Boolean).join(' | ').slice(0, 300);
  }
  function openFeedback() {
    if (!client) { toast('잠시 후 다시 눌러주세요.'); return; }
    let dlg = document.getElementById('feedbackDialog');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'feedbackDialog'; dlg.className = 'login-dialog';
      dlg.innerHTML =
        '<form class="login-card feedback-card">' +
        '<button type="button" class="login-close" aria-label="닫기">×</button>' +
        '<h2>피드백 남기기</h2>' +
        '<p>불편했던 점이나 바라는 점을 편하게 적어주세요. 틀린 표현을 찾으셨다면 어느 부분인지 알려주세요.</p>' +
        '<label for="feedbackCategory">종류</label>' +
        '<select id="feedbackCategory"><option value="idea">제안</option><option value="bug">오류 신고</option><option value="content">표현·콘텐츠</option><option value="etc">기타</option></select>' +
        '<label for="feedbackBody">내용</label>' +
        '<textarea id="feedbackBody" rows="5" maxlength="2000"></textarea>' +
        '<div id="feedbackContactWrap"><label for="feedbackContact">답장받을 이메일 (선택)</label>' +
        '<input id="feedbackContact" type="email" maxlength="200" autocomplete="email" placeholder="you@example.com"></div>' +
        '<div class="feedback-trap" aria-hidden="true"><label>Website<input id="feedbackWebsite" tabindex="-1" autocomplete="off"></label></div>' +
        '<div class="feedback-actions"><button type="button" class="dialog-cancel">닫기</button><button type="button" id="feedbackSend" class="primary">보내기</button></div>' +
        '<p id="feedbackMsg" class="login-msg" role="status"></p>' +
        '<p class="login-note">보내주신 내용은 운영자만 볼 수 있어요. 어느 페이지에서 보냈는지도 함께 기록돼요.</p>' +
        '</form>';
      document.body.appendChild(dlg);
      wireDialog(dlg, '#feedbackSend');
      dlg.querySelector('#feedbackSend').onclick = async function () {
        const msg = dlg.querySelector('#feedbackMsg');
        const body = dlg.querySelector('#feedbackBody').value.trim();
        const contact = dlg.querySelector('#feedbackContact').value.trim();
        if (dlg.querySelector('#feedbackWebsite').value) { dlg.close(); return; } // honeypot: bots fill this
        if (!body) { msg.textContent = '내용을 적어주세요.'; return; }
        if (contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) { msg.textContent = '이메일 주소를 확인해 주세요.'; return; }
        let last = 0; try { last = Number(localStorage.getItem(FEEDBACK_LAST)) || 0; } catch {}
        if (Date.now() - last < FEEDBACK_COOLDOWN) { msg.textContent = '잠시 후에 다시 보내주세요.'; return; }
        this.disabled = true; msg.textContent = '보내는 중…';
        // no .select(): senders have no read permission
        const { error } = await client.from('feedback').insert({
          category: dlg.querySelector('#feedbackCategory').value, body: body, contact: user ? null : (contact || null), page: feedbackPage()
        });
        this.disabled = false;
        if (error) { console.warn(error); msg.textContent = '보내지 못했어요. 잠시 후 다시 시도해 주세요.'; return; }
        try { localStorage.setItem(FEEDBACK_LAST, String(Date.now())); } catch {}
        dlg.querySelector('#feedbackBody').value = '';
        dlg.close();
        toast('피드백을 보냈어요. 고마워요 ☺');
      };
    }
    dlg.querySelector('#feedbackMsg').textContent = '';
    dlg.querySelector('#feedbackContactWrap').hidden = !!user;
    dlg.showModal();
    dlg.querySelector('#feedbackBody').focus();
  }

  async function signOut() {
    if (!confirm('로그아웃할까요? 이 기기에 남아 있는 주머니와 기록은 지워지고, 다시 로그인하면 돌아와요.')) return;
    await client.auth.signOut();
    try { localStorage.removeItem('kw-pouch-v1'); localStorage.removeItem(PROGRESS_KEY); localStorage.removeItem(KNOWN_KEY); } catch {}
    location.reload();
  }

  // ---------------------------------------------------------------- init
  let readyPromise = null;
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async function () {
      renderAccount(); // show the login button right away; session check continues in background
      if (!enabled) return;
      try {
        await loadLib();
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
        const { data } = await client.auth.getSession();
        user = data.session ? data.session.user : null;
        if (user) await pullMerge();
        renderAccount();
        if (typeof Pouch !== 'undefined') Pouch.onChange(pouchChanged);
        client.auth.onAuthStateChange(function (event, session) {
          const next = session ? session.user : null;
          const changed = (next && next.id) !== (user && user.id);
          user = next; renderAccount();
          if (changed && user) {
            pullMerge().then(function () { toast('로그인했어요. 기록을 동기화했어요 ☺'); if (window.__kwAppLoaded) location.reload(); else emit(); });
          }
        });
        if (/access_token=|error_description=/.test(location.hash)) history.replaceState(null, '', location.pathname);
      } catch (e) {
        console.warn('sync disabled:', e); renderAccount();
      }
      emit();
    })();
    // never block the page for long
    return Promise.race([readyPromise, new Promise(function (r) { setTimeout(r, 4000); })]);
  }

  return { enabled: enabled, ready: ready, progressChanged: progressChanged, openFeedback: openFeedback, get user() { return user; } };
})();
window.KWSync = KWSync;
