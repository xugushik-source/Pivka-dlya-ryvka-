/* «💬 Написать нам» — the chat on the site instead of WhatsApp and the owner's phone number.
   The customer writes here; the message goes to the shop's Telegram (a separate group for chats, one topic per
   customer — never mixed with the orders), the answer comes back into this chat.
   The conversation key is a random id kept only in this browser (like the order page link). Text and photos
   (e.g. a transfer screenshot). Swearing is blocked by the server: warning + the chat closes for a while.
   Self-contained: any failure here never touches the shop, the cart or the order. */
(() => {
  'use strict';
  const CFG = window.PIVKA_CONFIG || {};
  const KEY = 'pivka_chat_thread', SEEN = 'pivka_chat_seen';
  const get = (k) => { try { return localStorage.getItem(k) } catch (e) { return null } };
  const set = (k, v) => { try { localStorage.setItem(k, v) } catch (e) {} };
  const client = () => window.__pivkaSupabase || (window.supabase && CFG.supabaseUrl
    ? (window.__pivkaSupabase = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey)) : null);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tbilisi' });

  let thread = get(KEY), lastId = 0, msgs = [], open = false, timer = 0, blockedUntil = null, sending = false;

  const css = `
.pchatBtn{position:fixed;z-index:30;right:14px;bottom:calc(84px + env(safe-area-inset-bottom));width:54px;height:54px;border-radius:50%;border:0;background:#ffb51b;color:#171000;font-size:24px;box-shadow:0 6px 20px #0008;cursor:pointer}
.pchatBtn i{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;border-radius:10px;background:#e5484d;color:#fff;font:800 12px/20px system-ui;font-style:normal;padding:0 5px}
.pchat{position:fixed;z-index:60;inset:0;display:none;background:#0b0e10;color:#fff;flex-direction:column;font:15px system-ui,-apple-system,sans-serif}
.pchat.on{display:flex}
@media(min-width:700px){.pchat{inset:auto 18px 18px auto;width:380px;height:min(620px,calc(100vh - 36px));border:1px solid #2a3033;border-radius:18px;box-shadow:0 20px 60px #000c;overflow:hidden}}
.pchatHead{display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;border-bottom:1px solid #22282b;background:#111517}
.pchatHead b{flex:1;font-size:16px}.pchatHead button{background:none;border:0;color:#cfd3d6;font-size:26px;line-height:1;cursor:pointer;padding:4px 8px}
.pchatList{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}
.pchatHint{color:#a9afb3;font-size:13px;text-align:center;margin:auto 10px;line-height:1.45}
.pm{max-width:82%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.35}
.pm time{display:block;font-size:11px;opacity:.6;margin-top:3px}
.pm.in{align-self:flex-end;background:#ffb51b;color:#171000;border-bottom-right-radius:4px}
.pm.out{align-self:flex-start;background:#1c2225;border-bottom-left-radius:4px}
.pm.sys{align-self:center;background:#3a1416;color:#ffb4b4;font-size:13px;text-align:center}
.pm.pending{opacity:.6}
.pchatBlock{margin:0 14px 8px;padding:9px 12px;border-radius:12px;background:#3a1416;color:#ffb4b4;font-size:13px}
.pchatForm{display:flex;gap:8px;align-items:flex-end;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #22282b;background:#111517}
.pchatForm textarea{flex:1;resize:none;max-height:120px;min-height:42px;background:#0b0e10;border:1px solid #2f3639;color:#fff;border-radius:12px;padding:10px 12px;font:16px system-ui}
.pchatForm button{height:42px;min-width:42px;border-radius:12px;border:0;font-size:18px;cursor:pointer}
.pchatSend{background:#ffb51b;color:#171000;font-weight:900}.pchatPhoto{background:#1c2225;color:#fff;font-size:14px!important;font-weight:800;padding:0 10px;white-space:nowrap}
.pchatForm button[disabled]{opacity:.5}`;

  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'pchatBtn'; btn.id = 'pchatBtn'; btn.setAttribute('aria-label', 'Написать нам');
    btn.innerHTML = '💬<i hidden></i>';
    btn.onclick = () => openChat();
    const box = document.createElement('section');
    box.className = 'pchat'; box.id = 'pchat'; box.setAttribute('aria-label', 'Чат');
    box.innerHTML = '<div class="pchatHead"><b>Чат с «Пивка для рывка»</b><button type="button" aria-label="Закрыть">×</button></div>' +
      '<div class="pchatList"><p class="pchatHint"><span>Напишите вопрос — ответим здесь, в чате. Можно закрыть страницу: ответ сохранится.</span><br><br><span>Оплатили переводом? Нажмите «📷 Скриншот» и отправьте снимок перевода.</span></p></div>' +
      '<div class="pchatBlock" hidden></div>' +
      '<form class="pchatForm"><input type="file" accept="image/*" hidden><button type="button" class="pchatPhoto" aria-label="Отправить скриншот перевода">📷 <span>Скриншот</span></button>' +
      '<textarea rows="1" maxlength="1000" placeholder="Сообщение…"></textarea><button type="submit" class="pchatSend" aria-label="Отправить">➤</button></form>';
    document.body.append(btn, box);
    box.querySelector('.pchatHead button').onclick = closeChat;
    const form = box.querySelector('form'), ta = form.querySelector('textarea'), file = form.querySelector('input');
    form.onsubmit = (e) => { e.preventDefault(); send(ta.value, null) };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(min-width:700px)').matches) { e.preventDefault(); send(ta.value, null) } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px' });
    form.querySelector('.pchatPhoto').onclick = () => file.click();
    file.onchange = () => { const f = file.files && file.files[0]; file.value = ''; if (f) send(ta.value, f) };
    // any link/button with data-chat opens the chat (checkout help, order page, footer…)
    document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('[data-chat]'); if (a) { e.preventDefault(); openChat() } });
  }

  const $ = (s) => document.querySelector(s);
  function render() {
    const list = $('.pchatList'); if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.innerHTML = msgs.length ? '' : '<p class="pchatHint"><span>Напишите вопрос — ответим здесь, в чате. Можно закрыть страницу: ответ сохранится.</span><br><br><span>Оплатили переводом? Нажмите «📷 Скриншот» и отправьте снимок перевода.</span></p>';
    for (const m of msgs) {
      const d = document.createElement('div');
      if (m.dir === 'SYS') {
        d.className = 'pm sys';
        d.innerHTML = '<span>⛔ Сообщение не отправлено: в чате нельзя материться. Чат временно закрыт.</span>';
      } else {
        d.className = 'pm ' + (m.dir === 'IN' ? 'in' : 'out') + (m.pending ? ' pending' : '');
        d.innerHTML = (m.image ? '<span>📷 Скриншот</span>' + (m.body ? '<br>' : '') : '') + esc(m.body || '') + '<time>' + (m.at ? hm(m.at) : '…') + '</time>';
      }
      list.appendChild(d);
    }
    if (atBottom || open) list.scrollTop = list.scrollHeight;
    const bl = $('.pchatBlock');
    if (blockedUntil && new Date(blockedUntil) > new Date()) {
      bl.hidden = false; bl.innerHTML = '<span>⛔ Чат временно закрыт. Откроется в</span> ' + hm(blockedUntil) + '. <span>Без грубостей, пожалуйста.</span>';
    } else bl.hidden = true;
    const unread = msgs.filter((m) => m.dir === 'OUT' && m.id > Number(get(SEEN) || 0)).length;
    const badge = $('#pchatBtn i'); if (badge) { badge.hidden = open || !unread; badge.textContent = unread }
  }

  async function poll() {
    clearTimeout(timer);
    if (thread && client()) {
      try {
        const r = await client().rpc('support_fetch', { p_thread: thread, p_after: lastId });
        if (!r.error && r.data) {
          blockedUntil = r.data.blocked_until;
          const fresh = (r.data.messages || []);
          if (fresh.length) {
            msgs = msgs.filter((m) => !m.pending).concat(fresh);
            lastId = fresh[fresh.length - 1].id;
          }
          if (open && lastId) set(SEEN, String(lastId));
          render();
        }
      } catch (e) {}
    }
    if (thread || open) timer = setTimeout(poll, open ? 4000 : (document.visibilityState === 'visible' ? 30000 : 120000));
  }

  function openChat() {
    if (!$('#pchat')) return;
    open = true; $('#pchat').classList.add('on'); document.documentElement.style.overflow = 'hidden';
    if (lastId) set(SEEN, String(lastId));
    render(); poll();
    setTimeout(() => { const ta = $('.pchatForm textarea'); if (ta && matchMedia('(min-width:700px)').matches) ta.focus() }, 50);
  }
  function closeChat() {
    open = false; $('#pchat').classList.remove('on'); document.documentElement.style.overflow = '';
    render(); poll();
  }

  // big phone photos → ≤1600 px JPEG, so a transfer screenshot always fits the 5 MB limit
  async function shrink(f) {
    if (f.size < 1.5e6 && /jpe?g|png|webp/.test(f.type)) return f;
    try {
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return await new Promise((ok) => cv.toBlob((b) => ok(b || f), 'image/jpeg', 0.85));
    } catch (e) { return f }
  }

  async function send(text, file) {
    const body = String(text || '').trim();
    if ((!body && !file) || sending) return;
    if (blockedUntil && new Date(blockedUntil) > new Date()) { render(); return }
    const c = client(); if (!c) return;
    sending = true;
    const ta = $('.pchatForm textarea'), sendBtn = $('.pchatSend');
    sendBtn.disabled = true;
    if (!thread) { thread = (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (x) => (x ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> x / 4).toString(16))); set(KEY, thread) }
    const temp = { id: Infinity, dir: 'IN', body, image: !!file, pending: true };
    msgs.push(temp); ta.value = ''; ta.style.height = ''; render();
    let image = null, r;
    try {
      if (file) {
        const blob = await shrink(file);
        image = thread + '/' + Date.now() + '.' + ((blob.type || '').includes('png') ? 'png' : 'jpg');
        const up = await c.storage.from('support-chat').upload(image, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
      }
      let order = null, name = null;
      try { order = JSON.parse(get('pivka_last_order') || 'null')?.id || null } catch (e) {}
      try { name = JSON.parse(get('pivka_profile') || 'null')?.name || null } catch (e) {}
      r = await c.rpc('support_send', { p_thread: thread, p_body: body || null, p_image: image, p_order: order, p_name: name, p_lang: document.documentElement.lang || 'ru' });
      if (r.error) throw r.error;
    } catch (e) { r = { data: { error: 'net' } } }
    sending = false; sendBtn.disabled = false;
    const res = r.data || {};
    msgs = msgs.filter((m) => m !== temp);
    if (res.error === 'rude' || res.error === 'blocked') { blockedUntil = res.until }
    else if (res.error) {
      if (!ta.value) ta.value = body;
      const n = document.createElement('div'); n.className = 'pm sys';
      n.textContent = res.error === 'rate' ? 'Слишком много сообщений подряд — подождите немного.' : 'Не отправилось — нет связи. Попробуйте ещё раз.';
      render(); $('.pchatList').appendChild(n); return;
    }
    await poll();
  }

  function start() {
    if (!document.body || document.getElementById('pchat')) return;
    build(); render();
    if (thread) poll();
    if (/[?&#]chat=1/.test(location.href)) openChat();
  }
  window.PivkaChat = { open: () => openChat() };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
