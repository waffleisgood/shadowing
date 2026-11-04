/* Login + cloud sync (Supabase). Without config it does nothing and the site stays local-only.
   Synced: 표현 주머니 (kw-pouch-v1) and set completion (scene-loop-completed).
   Strategy: localStorage is the working copy; on login we merge local ⇄ server, then push changes as they happen. */
const KWSync = (function () {
  const cfg = window.KW_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const PROGRESS_KEY = 'scene-loop-completed';
  const DATES_KEY = 'kw-completed-at'; // set completion dates, shown in 연습한 영상
  const KNOWN_KEY = 'kw-sync-known-pouch'; // pouch keys last seen on server (to detect removals)
  const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
  let client = null, user = null, profile = null, pushTimer = null, progressTimer = null;

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
    const { data: prog, error: e2 } = await client.from('progress').select('set_key,completed_at');
    if (e2) { console.warn(e2); return; }
    const dates = ls(DATES_KEY, {});
    prog.forEach(function (r) { dates[r.set_key] = r.completed_at; });
    lsSet(DATES_KEY, dates);
    const localDone = new Set(ls(PROGRESS_KEY, []));
    const serverDone = new Set(prog.map(function (r) { return r.set_key; }));
    const missing = Array.from(localDone).filter(function (k) { return !serverDone.has(k); });
    serverDone.forEach(function (k) { localDone.add(k); });
    lsSet(PROGRESS_KEY, Array.from(localDone));
    if (missing.length) await client.from('progress').upsert(missing.map(progressRow), { onConflict: 'user_id,set_key', ignoreDuplicates: true });
  }

  function progressRow(k) { return { set_key: k, completed_at: ls(DATES_KEY, {})[k] || new Date().toISOString() }; }
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
      const { error } = await client.from('progress').upsert(done.map(progressRow), { onConflict: 'user_id,set_key', ignoreDuplicates: true });
      if (error) console.warn(error);
    }, 700);
  }

  // ---------------------------------------------------------------- account UI
  // gated Days (no static file) come from Supabase; RLS allows signed-in users and released Days only
  async function fetchDays(days) {
    if (!client || !user || !days.length) return [];
    const { data, error } = await client.from('day_content').select('day,lesson').in('day', days);
    if (error) { console.warn(error); return []; }
    return data.map(function (r) { return r.lesson; });
  }
  function login() {
    if (!client) { toast('로그인을 준비하고 있어요. 잠시 후 다시 눌러주세요.'); return; }
    openLogin();
  }
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
      who.textContent = '☺ ' + ((profile && (profile.username || profile.display_name)) || (user.email || '').split('@')[0]);
      who.title = (user.email || '') + ' · 주머니와 진도가 모든 기기에 동기화돼요';
      const out = document.createElement('button'); out.type = 'button'; out.className = 'account-btn'; out.textContent = '로그아웃';
      out.onclick = signOut;
      box.append(who, out);
    } else {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'account-btn primary-soft'; b.textContent = '로그인 ✎';
      b.onclick = login;
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

  const AUTH_MODES = {
    login: { title: '로그인', send: '로그인', intro: '로그인하면 표현 주머니와 연습 기록이 휴대폰과 PC에 함께 저장돼요.' },
    signup: { title: '회원가입', send: '가입하고 인증 메일 받기', intro: '가입 후 메일의 인증 링크를 누르면 바로 시작할 수 있어요. 지금 이 브라우저의 기록도 그대로 옮겨져요.' },
    reset: { title: '비밀번호 찾기', send: '재설정 메일 받기', intro: '가입한 이메일로 비밀번호 재설정 링크를 보내드려요.' }
  };
  function redirectUrl() { return location.origin + location.pathname; }
  function validEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }
  function authMessage(error) {
    const m = (error && error.message) || '';
    if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요.';
    if (/email not confirmed/i.test(m)) return '아직 이메일 인증을 하지 않으셨어요. 메일함을 확인해 주세요.';
    if (/already registered/i.test(m)) return '이미 가입된 이메일이에요. 로그인하거나 비밀번호를 찾아주세요.';
    if (/rate limit|security purposes|too many/i.test(m)) return '요청이 많아요. 잠시 후 다시 시도해 주세요.';
    if (/password/i.test(m)) return '비밀번호를 8자 이상으로 더 어렵게 만들어 주세요.';
    return '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  function openLogin(mode) {
    let dlg = document.getElementById('loginDialog');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'loginDialog'; dlg.className = 'login-dialog';
      dlg.innerHTML =
        '<form class="login-card auth-card" novalidate>' +
        '<button type="button" class="login-close" aria-label="닫기">×</button>' +
        '<h2 id="authTitle"></h2>' +
        '<div class="auth-tabs" role="group" aria-label="로그인 또는 회원가입"><button type="button" data-mode="login">로그인</button><button type="button" data-mode="signup">회원가입</button></div>' +
        '<p id="authIntro"></p>' +
        '<div data-modes="login signup reset"><label for="authEmail">이메일</label><input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
        '<div data-modes="signup"><label for="authName">이름</label><input id="authName" type="text" maxlength="40" autocomplete="name"></div>' +
        '<div data-modes="signup"><label for="authUsername">아이디 <small>영문 소문자, 숫자, _ 4~20자</small></label><input id="authUsername" type="text" maxlength="20" autocomplete="username" autocapitalize="none" spellcheck="false"></div>' +
        '<div data-modes="login signup"><label for="authPassword">비밀번호 <small data-modes="signup">8자 이상</small></label><input id="authPassword" type="password" autocomplete="current-password"></div>' +
        '<div data-modes="signup"><label for="authPassword2">비밀번호 확인</label><input id="authPassword2" type="password" autocomplete="new-password"></div>' +
        '<button type="button" id="loginSend" class="primary"></button>' +
        '<p id="loginMsg" class="login-msg" role="status"></p>' +
        '<button type="button" id="authResend" class="auth-link" hidden>인증 메일 다시 받기</button>' +
        '<div data-modes="login"><button type="button" class="auth-link" data-mode="reset">비밀번호를 잊으셨나요?</button></div>' +
        '<div data-modes="reset"><button type="button" class="auth-link" data-mode="login">← 로그인으로 돌아가기</button></div>' +
        '<div data-modes="login signup">' +
        ((cfg.enableGoogle || cfg.enableApple) ? '<div class="login-or">또는</div>' : '') +
        (cfg.enableGoogle ? '<button type="button" class="oauth-btn" data-provider="google"><span class="oauth-mark">G</span>Google로 계속하기</button>' : '') +
        (cfg.enableApple ? '<button type="button" class="oauth-btn" data-provider="apple"><span class="oauth-mark"></span>Apple로 계속하기</button>' : '') +
        '</div>' +
        '<p class="login-note" data-modes="login">전에 이메일 링크로 가입하셨다면 “비밀번호를 잊으셨나요?”로 비밀번호를 만들어 주세요.</p>' +
        '</form>';
      document.body.appendChild(dlg);
      wireDialog(dlg, '#loginSend');
      const $f = function (id) { return dlg.querySelector('#' + id); };
      dlg.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { setAuthMode(dlg, b.dataset.mode); }; });
      $f('authResend').onclick = async function () {
        const email = $f('authEmail').value.trim();
        const msg = $f('loginMsg');
        if (!validEmail(email)) { msg.textContent = '이메일 주소를 확인해 주세요.'; return; }
        const { error } = await client.auth.resend({ type: 'signup', email: email, options: { emailRedirectTo: redirectUrl() } });
        msg.textContent = error ? authMessage(error) : '인증 메일을 다시 보냈어요. 메일함을 확인해 주세요.';
      };
      $f('loginSend').onclick = async function () {
        const mode = dlg.dataset.mode, btn = this, msg = $f('loginMsg');
        const email = $f('authEmail').value.trim(), password = $f('authPassword').value;
        const say = function (t) { msg.textContent = t; };
        $f('authResend').hidden = true;
        if (!validEmail(email)) return say('이메일 주소를 확인해 주세요.');
        btn.disabled = true; say('처리하는 중…');
        try {
          if (mode === 'login') {
            if (!password) return say('비밀번호를 입력해 주세요.');
            const { error } = await client.auth.signInWithPassword({ email: email, password: password });
            if (error) { say(authMessage(error)); $f('authResend').hidden = !/email not confirmed/i.test(error.message || ''); return; }
            $f('authPassword').value = ''; dlg.close();
          } else if (mode === 'signup') {
            const name = $f('authName').value.trim();
            const username = $f('authUsername').value.trim().toLowerCase();
            if (!name) return say('이름을 입력해 주세요.');
            if (!USERNAME_RE.test(username)) return say('아이디는 영문 소문자, 숫자, _ 로 4~20자여야 해요.');
            if (password.length < 8) return say('비밀번호는 8자 이상이어야 해요.');
            if (password !== $f('authPassword2').value) return say('비밀번호가 서로 달라요.');
            const check = await client.rpc('username_available', { candidate: username });
            if (check.data === false) return say('이미 쓰고 있는 아이디예요.');
            const { data, error } = await client.auth.signUp({
              email: email, password: password,
              options: { emailRedirectTo: redirectUrl(), data: { username: username, display_name: name } }
            });
            if (error) return say(authMessage(error));
            // with email confirmation on, an existing address comes back without identities
            if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) return say('이미 가입된 이메일이에요. 로그인하거나 비밀번호를 찾아주세요.');
            $f('authPassword').value = ''; $f('authPassword2').value = '';
            say(email + '로 인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요.');
            $f('authResend').hidden = false;
          } else {
            const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
            say(error && /rate limit|security purposes/i.test(error.message || '') ? authMessage(error) : '가입된 이메일이라면 재설정 메일이 도착해요. 메일함을 확인해 주세요.');
          }
        } finally { btn.disabled = false; }
      };
      dlg.querySelectorAll('.oauth-btn').forEach(function (b) {
        b.onclick = async function () {
          const { error } = await client.auth.signInWithOAuth({ provider: b.dataset.provider, options: { redirectTo: redirectUrl() } });
          if (error) $f('loginMsg').textContent = authMessage(error);
        };
      });
    }
    setAuthMode(dlg, mode || 'login');
    dlg.showModal();
  }
  function setAuthMode(dlg, mode) {
    const t = AUTH_MODES[mode];
    dlg.dataset.mode = mode;
    dlg.querySelector('#authTitle').textContent = t.title;
    dlg.querySelector('#authIntro').textContent = t.intro;
    dlg.querySelector('#loginSend').textContent = t.send;
    dlg.querySelector('#loginMsg').textContent = '';
    dlg.querySelector('#authResend').hidden = true;
    dlg.querySelector('#authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    dlg.querySelector('.auth-tabs').hidden = mode === 'reset';
    dlg.querySelectorAll('.auth-tabs [data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    dlg.querySelectorAll('[data-modes]').forEach(function (el) { el.hidden = el.dataset.modes.split(' ').indexOf(mode) < 0; });
  }

  // new password after clicking the reset mail
  function openNewPassword() {
    let dlg = document.getElementById('newPasswordDialog');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'newPasswordDialog'; dlg.className = 'login-dialog';
      dlg.innerHTML =
        '<form class="login-card auth-card" novalidate>' +
        '<button type="button" class="login-close" aria-label="닫기">×</button>' +
        '<h2>새 비밀번호 만들기</h2>' +
        '<label for="newPassword">새 비밀번호 <small>8자 이상</small></label><input id="newPassword" type="password" autocomplete="new-password">' +
        '<label for="newPassword2">새 비밀번호 확인</label><input id="newPassword2" type="password" autocomplete="new-password">' +
        '<button type="button" id="newPasswordSend" class="primary">비밀번호 저장</button>' +
        '<p id="newPasswordMsg" class="login-msg" role="status"></p></form>';
      document.body.appendChild(dlg);
      wireDialog(dlg, '#newPasswordSend');
      dlg.querySelector('#newPasswordSend').onclick = async function () {
        const a = dlg.querySelector('#newPassword').value, b = dlg.querySelector('#newPassword2').value;
        const msg = dlg.querySelector('#newPasswordMsg');
        if (a.length < 8) { msg.textContent = '비밀번호는 8자 이상이어야 해요.'; return; }
        if (a !== b) { msg.textContent = '비밀번호가 서로 달라요.'; return; }
        this.disabled = true;
        const { error } = await client.auth.updateUser({ password: a });
        this.disabled = false;
        if (error) { msg.textContent = authMessage(error); return; }
        dlg.close(); toast('비밀번호를 저장했어요 ☺');
      };
    }
    dlg.showModal();
  }

  // members without a username (Google, earlier email-link sign-ups)
  async function loadProfile() {
    if (!client || !user) return;
    const { data, error } = await client.from('profiles').select('username,display_name').eq('id', user.id).maybeSingle();
    if (error || !data) return;
    profile = data; renderAccount();
    let asked = false; try { asked = sessionStorage.getItem('kw-profile-asked') === '1'; } catch {}
    if (!data.username && !asked && !document.querySelector('dialog[open]')) {
      try { sessionStorage.setItem('kw-profile-asked', '1'); } catch {}
      openProfilePrompt();
    }
  }
  function openProfilePrompt() {
    let dlg = document.getElementById('profileDialog');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'profileDialog'; dlg.className = 'login-dialog';
      dlg.innerHTML =
        '<form class="login-card auth-card" novalidate>' +
        '<button type="button" class="login-close" aria-label="닫기">×</button>' +
        '<h2>프로필 만들기</h2><p>이름과 아이디만 정하면 끝이에요.</p>' +
        '<label for="profileName">이름</label><input id="profileName" type="text" maxlength="40" autocomplete="name">' +
        '<label for="profileUsername">아이디 <small>영문 소문자, 숫자, _ 4~20자</small></label><input id="profileUsername" type="text" maxlength="20" autocapitalize="none" spellcheck="false">' +
        '<button type="button" id="profileSend" class="primary">저장</button>' +
        '<p id="profileMsg" class="login-msg" role="status"></p></form>';
      document.body.appendChild(dlg);
      wireDialog(dlg, '#profileSend');
      dlg.querySelector('#profileSend').onclick = async function () {
        const name = dlg.querySelector('#profileName').value.trim();
        const username = dlg.querySelector('#profileUsername').value.trim().toLowerCase();
        const msg = dlg.querySelector('#profileMsg');
        if (!name) { msg.textContent = '이름을 입력해 주세요.'; return; }
        if (!USERNAME_RE.test(username)) { msg.textContent = '아이디는 영문 소문자, 숫자, _ 로 4~20자여야 해요.'; return; }
        this.disabled = true;
        const { error } = await client.from('profiles').update({ username: username, display_name: name }).eq('id', user.id);
        this.disabled = false;
        if (error) { msg.textContent = error.code === '23505' ? '이미 쓰고 있는 아이디예요.' : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'; return; }
        profile = { username: username, display_name: name };
        renderAccount(); dlg.close(); toast('프로필을 저장했어요 ☺');
      };
    }
    dlg.querySelector('#profileName').value = (profile && profile.display_name) || '';
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
    try { localStorage.removeItem('kw-pouch-v1'); localStorage.removeItem(PROGRESS_KEY); localStorage.removeItem(KNOWN_KEY); localStorage.removeItem(DATES_KEY); } catch {}
    try { sessionStorage.removeItem('kw-profile-asked'); } catch {}
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
        // the reset mail lands here with a token in the URL; remember it across the gate reload
        if (/type=recovery/.test(location.hash)) { try { sessionStorage.setItem('kw-recovery', '1'); } catch {} }
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
        const { data } = await client.auth.getSession();
        user = data.session ? data.session.user : null;
        if (user) await pullMerge();
        // session arrived after the page already applied the login gate
        if (user && window.__kwGated) { location.reload(); return; }
        renderAccount();
        let recovering = false; try { recovering = sessionStorage.getItem('kw-recovery') === '1'; } catch {}
        if (user && recovering) { try { sessionStorage.removeItem('kw-recovery'); } catch {} openNewPassword(); }
        else if (user) loadProfile();
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

  return { enabled: enabled, ready: ready, progressChanged: progressChanged, openFeedback: openFeedback, login: login, fetchDays: fetchDays, toast: toast, get user() { return user; } };
})();
window.KWSync = KWSync;
