/* Voice seller — the button on the home screen and the voice sheet.
   Progressive enhancement: if this file or the AI fails, nothing else on the page changes. The sheet reuses the
   site's .overlay/.sheet styles; texts are in RU/KA/HY (follow the site language). */
(function () {
  'use strict';
  const L = () => (document.documentElement.lang || 'ru');
  const TXT = {
    ru: {
      cta: 'Скажи, что хочешь', ctaSub: 'Я соберу рывок', title: '🎙 Продавец «Пивка для рывка»',
      ready: 'Нажми и говори', connecting: 'Подключаю продавца…', listening: 'Слушаю…', thinking: 'Подбираю…', speaking: 'Отвечаю…',
      ready_text: 'Напиши, что нужно', closed: 'Нажми и говори', local: 'Голосовой продавец сейчас недоступен — пиши, соберу по тексту',
      you: 'Ты', seller: 'Продавец', add: 'Добавить', change: 'Изменить', cart: 'Открыть корзину', end: 'Закончить разговор',
      write: 'Или напиши', send: 'Отправить', total: 'Итого', tryAgain: 'Ещё раз',
      hint: 'Например: «Нас шестеро, бюджет 150 лари, пиво и закуска»', changeHint: 'Скажи или напиши, что поменять: «без рыбы», «пива побольше», «бюджет 100»',
      err: {
        mic_denied: 'Микрофон не разрешён — можно писать.', not_configured: 'Голосовой продавец ещё не включён — пиши, соберу по тексту.',
        daily_limit: 'Голосовой продавец на сегодня отдыхает — пиши или собери сам.', rate_limit: 'Слишком часто — подожди немного или пиши.',
        openai_quota: 'Голосовой продавец сейчас недоступен — пиши или собери сам.', network: 'Нет связи с продавцом — пиши или собери сам.',
        connection: 'Связь оборвалась. Нажми ещё раз.', default: 'Не получилось подключиться — пиши или собери обычным способом.', no_webrtc: 'Этот браузер не поддерживает голос — пиши.',
      },
      fallback: 'Продолжить обычным способом',
    },
    ka: {
      cta: 'თქვი, რა გინდა', ctaSub: 'ნაკრებს შეგირჩევ', title: '🎙 გამყიდველი „ლუდი გაქანებისთვის“',
      ready: 'დააჭირე და ილაპარაკე', connecting: 'გამყიდველს ვუკავშირდები…', listening: 'გისმენ…', thinking: 'ვარჩევ…', speaking: 'გპასუხობ…',
      ready_text: 'დაწერე, რა გჭირდება', closed: 'დააჭირე და ილაპარაკე', local: 'ხმოვანი გამყიდველი ახლა მიუწვდომელია — დაწერე, ტექსტით შეგირჩევ',
      you: 'შენ', seller: 'გამყიდველი', add: 'დამატება', change: 'შეცვლა', cart: 'კალათის გახსნა', end: 'საუბრის დასრულება',
      write: 'ან დაწერე', send: 'გაგზავნა', total: 'ჯამი', tryAgain: 'კიდევ ერთხელ',
      hint: 'მაგალითად: „ექვსნი ვართ, ბიუჯეტი 150 ლარია, ლუდი და მისაყოლებელი“', changeHint: 'თქვი ან დაწერე, რა შევცვალო: „თევზის გარეშე“, „მეტი ლუდი“, „ბიუჯეტი 100“',
      err: {
        mic_denied: 'მიკროფონი არ არის ნებადართული — შეგიძლია დაწერო.', not_configured: 'ხმოვანი გამყიდველი ჯერ არ არის ჩართული — დაწერე, ტექსტით შეგირჩევ.',
        daily_limit: 'ხმოვანი გამყიდველი დღეს ისვენებს — დაწერე ან თავად ააწყე.', rate_limit: 'ძალიან ხშირად — ცოტა მოიცადე ან დაწერე.',
        openai_quota: 'ხმოვანი გამყიდველი ახლა მიუწვდომელია — დაწერე ან თავად ააწყე.', network: 'გამყიდველთან კავშირი არ არის — დაწერე ან თავად ააწყე.',
        connection: 'კავშირი გაწყდა. კიდევ დააჭირე.', default: 'დაკავშირება ვერ მოხერხდა — დაწერე ან ჩვეულებრივად ააწყე.', no_webrtc: 'ეს ბრაუზერი ხმას არ უჭერს მხარს — დაწერე.',
      },
      fallback: 'ჩვეულებრივად გაგრძელება',
    },
    hy: {
      cta: 'Ասա՝ ինչ ես ուզում', ctaSub: 'Ես կհավաքեմ հավաքածուն', title: '🎙 Վաճառող «Գարեջուր լավ երեկոյի համար»',
      ready: 'Սեղմիր և խոսիր', connecting: 'Միացնում եմ վաճառողին…', listening: 'Լսում եմ…', thinking: 'Ընտրում եմ…', speaking: 'Պատասխանում եմ…',
      ready_text: 'Գրիր՝ ինչ է պետք', closed: 'Սեղմիր և խոսիր', local: 'Ձայնային վաճառողը հիմա հասանելի չէ — գրիր, կհավաքեմ տեքստով',
      you: 'Դու', seller: 'Վաճառող', add: 'Ավելացնել', change: 'Փոխել', cart: 'Բացել զամբյուղը', end: 'Ավարտել զրույցը',
      write: 'Կամ գրիր', send: 'Ուղարկել', total: 'Ընդամենը', tryAgain: 'Կրկին',
      hint: 'Օրինակ՝ «Վեց հոգի ենք, բյուջեն 150 լարի է, գարեջուր և խորտիկ»', changeHint: 'Ասա կամ գրիր՝ ինչ փոխել. «առանց ձկան», «ավելի շատ գարեջուր», «բյուջե 100»',
      err: {
        mic_denied: 'Խոսափողը թույլատրված չէ — կարող ես գրել։', not_configured: 'Ձայնային վաճառողը դեռ միացված չէ — գրիր, կհավաքեմ տեքստով։',
        daily_limit: 'Ձայնային վաճառողն այսօր հանգստանում է — գրիր կամ ինքդ հավաքիր։', rate_limit: 'Չափազանց հաճախ է — մի քիչ սպասիր կամ գրիր։',
        openai_quota: 'Ձայնային վաճառողը հիմա հասանելի չէ — գրիր կամ ինքդ հավաքիր։', network: 'Վաճառողի հետ կապ չկա — գրիր կամ ինքդ հավաքիր։',
        connection: 'Կապը կտրվեց։ Կրկին սեղմիր։', default: 'Չհաջողվեց միանալ — գրիր կամ հավաքիր սովորական ձևով։', no_webrtc: 'Այս դիտարկիչը ձայն չի աջակցում — գրիր։',
      },
      fallback: 'Շարունակել սովորական ձևով',
    },
  };
  const t = () => TXT[L()] || TXT.ru;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n).toFixed(2).replace('.00', '') + ' ₾';
  let mode = 'ai'; // 'ai' | 'local' (no AI: the text field is understood by PivkaVoiceLocal)
  let state = 'closed', errCode = null;
  const $ = (id) => document.getElementById(id);

  function css() {
    const st = document.createElement('style');
    st.textContent = `
.voiceCta{display:flex;align-items:center;gap:12px;width:100%;margin-top:10px;padding:12px 14px;border-radius:18px;border:2px solid #ffb51b;background:linear-gradient(135deg,#221a06,#15191b);color:#fff;text-align:left;cursor:pointer}
.voiceCta .vmic{flex:0 0 46px;height:46px;border-radius:50%;display:grid;place-items:center;background:#ffb51b;color:#171000;font-size:22px;box-shadow:0 0 0 0 #ffb51b88;animation:vpulse 2.4s infinite}
.voiceCta b{display:block;font-size:16px;font-weight:1000}.voiceCta small{display:block;color:#cfd3d6;font-size:13px;margin-top:2px}
@keyframes vpulse{0%{box-shadow:0 0 0 0 #ffb51b77}70%{box-shadow:0 0 0 12px #ffb51b00}100%{box-shadow:0 0 0 0 #ffb51b00}}
@media(prefers-reduced-motion:reduce){.voiceCta .vmic,.vbig.on{animation:none}}
#voiceOverlay .sheet{max-height:92vh;overflow:auto}
.vtop{display:flex;align-items:center;justify-content:space-between;gap:10px}.vtop h2{font-size:18px;margin:0}
.vstage{display:flex;flex-direction:column;align-items:center;gap:8px;margin:14px 0 8px}
.vbig{width:86px;height:86px;border-radius:50%;border:0;background:#ffb51b;color:#171000;font-size:36px;cursor:pointer}
.vbig.on{background:#22a447;color:#fff;animation:vpulse 1.4s infinite}.vbig.wait{background:#3a4145;color:#fff}.vbig[disabled]{opacity:.5}
.vstatus{font-weight:900;color:#ffcf6b;text-align:center;min-height:20px}.vhint{color:#a9afb3;font-size:13px;text-align:center}
.vmsg{background:#14181a;border:1px solid #272d30;border-radius:14px;padding:10px 12px;margin:8px 0;font-size:14px;line-height:1.4}
.vmsg small{display:block;color:#8b9296;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
.vreco{background:#14181a;border:1px solid #ffb51b66;border-radius:14px;padding:10px 12px;margin:8px 0}
.vreco .line{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid #23292c;font-size:14px}.vreco .line:first-child{border-top:0}
.vreco .sum{display:flex;justify-content:space-between;font-weight:1000;margin-top:6px}
.vbtns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.vbtns button{border-radius:12px;padding:11px;font-weight:900;border:1px solid #3a4145;background:#1b2022;color:#fff}
.vbtns .yes{background:#ffb51b;color:#171000;border-color:#ffb51b}.vbtns .end{grid-column:1/-1;background:transparent;color:#a9afb3}
.vtext{display:flex;gap:8px;margin-top:6px}.vtext input{flex:1;min-width:0}.vtext button{border-radius:12px;padding:0 14px;font-weight:900;background:#ffb51b;color:#171000;border:0}
.verr{color:#ffb4b4;font-size:13px;text-align:center;margin:4px 0}.vfall{display:block;width:100%;margin-top:6px;background:transparent;border:1px dashed #3a4145;color:#ffcf6b;border-radius:12px;padding:10px;font-weight:800}`;
    document.head.appendChild(st);
  }

  function build() {
    const today = $('todaySection');
    const anchor = today && today.querySelector('.twoCta');
    if (!anchor) return false;
    const cta = document.createElement('button');
    cta.type = 'button'; cta.className = 'voiceCta'; cta.id = 'voiceCta';
    cta.innerHTML = '<span class="vmic" aria-hidden="true">🎙</span><span><b id="vCtaT"></b><small id="vCtaS"></small></span>';
    cta.onclick = open;
    anchor.insertAdjacentElement('afterend', cta);
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'voiceOverlay';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="sheet"><div class="vtop"><h2 id="vTitle"></h2><button type="button" class="close" aria-label="×" id="vClose">×</button></div>
<div class="vstage"><button type="button" class="vbig" id="vMic" aria-label="mic">🎙</button><div class="vstatus" id="vStatus" aria-live="polite"></div><div class="vhint" id="vHint"></div></div>
<div class="verr" id="vErr" hidden></div>
<div class="vmsg" id="vUser" hidden><small id="vUserL"></small><span></span></div>
<div class="vmsg" id="vSeller" hidden><small id="vSellerL"></small><span></span></div>
<div class="vreco" id="vReco" hidden></div>
<div class="vbtns"><button type="button" class="yes" id="vAdd" hidden></button><button type="button" id="vChange" hidden></button><button type="button" id="vCart"></button><button type="button" class="end" id="vEnd"></button></div>
<form class="vtext" id="vForm" autocomplete="off"><input id="vInput" maxlength="300" enterkeyhint="send"><button type="submit" id="vSend"></button></form>
<button type="button" class="vfall" id="vFall" hidden></button></div>`;
    document.body.appendChild(ov);
    $('vClose').onclick = close; $('vEnd').onclick = close;
    $('vMic').onclick = micPress;
    $('vCart').onclick = () => { close(); if (typeof openCart === 'function') openCart() };
    $('vAdd').onclick = addPressed;
    $('vChange').onclick = () => { $('vHint').textContent = t().changeHint; $('vInput').focus() };
    $('vFall').onclick = () => { close(); if (typeof goBuild === 'function') goBuild() };
    $('vForm').onsubmit = (e) => { e.preventDefault(); textSend() };
    ov.addEventListener('click', (e) => { if (e.target === ov) close() });
    // Any other way the sheet gets closed (store.js closeSheet, Escape…) also ends the session.
    new MutationObserver(() => { if (!ov.classList.contains('on') && PivkaVoiceAgent.active()) PivkaVoiceAgent.stop('sheet_closed') }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    return true;
  }

  function texts() {
    const x = t();
    if (!$('voiceCta')) return;
    $('vCtaT').textContent = x.cta; $('vCtaS').textContent = x.ctaSub;
    $('vTitle').textContent = x.title; $('vUserL').textContent = x.you; $('vSellerL').textContent = x.seller;
    $('vAdd').textContent = x.add; $('vChange').textContent = x.change; $('vCart').textContent = x.cart; $('vEnd').textContent = x.end;
    $('vInput').placeholder = x.write; $('vSend').textContent = x.send; $('vFall').textContent = x.fallback;
    if (!$('vHint').dataset.custom) $('vHint').textContent = x.hint;
    paint();
    if (lastReco) renderReco(lastReco);
  }

  function paint() {
    const x = t();
    const s = mode === 'local' ? (errCode ? 'ready_text' : 'local') : state;
    $('vStatus').textContent = x[s] || x.ready;
    const mic = $('vMic');
    mic.classList.toggle('on', state === 'listening');
    mic.classList.toggle('wait', state === 'connecting' || state === 'thinking');
    mic.textContent = state === 'speaking' ? '✋' : state === 'connecting' || state === 'thinking' ? '…' : '🎙';
    mic.disabled = mode === 'local' || state === 'connecting';
    if (errCode) { $('vErr').hidden = false; $('vErr').textContent = x.err[errCode] || x.err.default } else $('vErr').hidden = true;
    $('vFall').hidden = !(mode === 'local' || errCode);
  }

  function open() {
    errCode = null;
    try { window.PIVKA_DB && PIVKA_DB.trackEvent('voice_open', { metadata: { lang: L() } }) } catch (e) {}
    if (typeof openSheet === 'function') openSheet('voiceOverlay'); else $('voiceOverlay').classList.add('on');
    paint();
    if (!window.RTCPeerConnection || !navigator.mediaDevices) { goLocal('no_webrtc'); return }
    if (mode === 'ai' && !PivkaVoiceAgent.active()) startAI(true);
  }
  function close() {
    PivkaVoiceAgent.stop('user');
    if (typeof closeSheet === 'function') closeSheet('voiceOverlay'); else $('voiceOverlay').classList.remove('on');
  }
  async function startAI(withMic) {
    errCode = null;
    const ses = await PivkaVoiceAgent.start({ lang: L(), wantMic: withMic });
    if (!ses && ['not_configured', 'daily_limit', 'openai_quota', 'network', 'openai', 'unavailable', 'session'].includes(errCode)) goLocal(errCode);
  }
  function goLocal(code) {
    mode = 'local';
    if (code) errCode = code;
    state = 'ready_text';
    paint();
  }
  function micPress() {
    if (state === 'speaking') { PivkaVoiceAgent.interrupt(); return }
    if (!PivkaVoiceAgent.active()) startAI(true);
  }
  async function textSend() {
    const v = $('vInput').value.trim();
    if (!v) return;
    $('vInput').value = '';
    if (mode === 'ai' && PivkaVoiceAgent.active() && PivkaVoiceAgent.sendText(v)) return;
    // No AI session: understand it locally with the same tools.
    showUser(v);
    try { window.PIVKA_DB && PIVKA_DB.trackEvent('voice_request', { metadata: { typed: true, local: true, lang: L() } }) } catch (e) {}
    state = 'thinking'; paint();
    const answer = await PivkaVoiceLocal.handle(v, L());
    state = mode === 'local' ? 'ready_text' : 'closed';
    showSeller(answer); paint();
  }
  function addPressed() {
    if (mode === 'ai' && PivkaVoiceAgent.active()) {
      PivkaVoiceAgent.sendText({ ru: 'Да, добавь это в корзину', ka: 'კი, დაამატე კალათაში', hy: 'Այո, ավելացրու զամբյուղ' }[L()] || 'Да, добавь это в корзину');
      return;
    }
    PivkaVoiceTools.run('apply_recommendation', { replace: true }).then((r) => { if (r.ok) showSeller({ ru: 'Добавил. В корзине ', ka: 'დავამატე. კალათაში ', hy: 'Ավելացրի։ Զամբյուղում ' }[L()] + money(r.cart.total)) });
  }
  function showUser(v) { const b = $('vUser'); b.hidden = false; b.querySelector('span').textContent = v }
  function showSeller(v) { const b = $('vSeller'); b.hidden = !v; b.querySelector('span').textContent = v || '' }

  let lastReco = null;
  function renderReco(r) {
    lastReco = r;
    const box = $('vReco');
    if (!r || !r.items || !r.items.length) { box.hidden = true; $('vAdd').hidden = true; $('vChange').hidden = true; return }
    const nm = (i) => (i.name_i18n && i.name_i18n[L()]) || i.name;
    box.innerHTML = r.items.map((i) => `<div class="line"><span>${esc(nm(i))} × ${i.quantity}${i.unit === 'liter' ? (L() === 'ka' ? ' ლ' : L() === 'hy' ? ' լ' : ' л') : ''}</span><b>${money(i.sum)}</b></div>`).join('') +
      `<div class="sum"><span>${esc(t().total)}</span><span>${money(r.total)}</span></div>`;
    box.hidden = false; $('vAdd').hidden = false; $('vChange').hidden = false;
  }

  function init() {
    if (!window.PivkaVoiceAgent || !window.PivkaVoiceTools || !build()) return;
    css();
    PivkaVoiceAgent.on('state', (s) => { state = s; if (s === 'closed' && mode !== 'local') state = 'closed'; paint() });
    PivkaVoiceAgent.on('user', showUser);
    PivkaVoiceAgent.on('seller', (txt) => showSeller(txt));
    PivkaVoiceAgent.on('error', (code) => { errCode = code; paint() });
    PivkaVoiceTools.onChange((ev) => {
      if (ev.type === 'recommendation') renderReco(ev.reco);
      if (ev.type === 'cart' && ev.kind === 'voice_add_to_cart' && lastReco) { $('vAdd').hidden = true }
      if (ev.type === 'checkout') { PivkaVoiceAgent.stop('checkout'); if (typeof closeSheet === 'function') closeSheet('voiceOverlay') }
    });
    texts();
    // follow the site language switch
    new MutationObserver(texts).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PivkaVoiceUI = { open, close, _state: () => ({ mode, state, errCode }) };
})();
