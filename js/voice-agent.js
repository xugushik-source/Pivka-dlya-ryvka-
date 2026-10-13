/* Voice seller — OpenAI Realtime session over WebRTC.
   1. Ask our Supabase function `voice-session` for a short-lived client secret (the API key never reaches the browser).
   2. Open an RTCPeerConnection: microphone up, seller's voice down, data channel «oai-events» for events and tools.
   3. Tool calls from the model are executed by PivkaVoiceTools (existing store logic) and answered back.
   One session at a time; it is closed on «Закончить», when the sheet closes, after a silent stretch and at the
   server's max length. A dropped connection is resumed once with the talk so far. Without a microphone the same
   session works by text.

   The UI state is derived from facts, never set by guess:
   speaking — the seller's audio is playing; listening — the customer is talking or it is their turn;
   thinking — we wait for an answer (a response is being generated, a tool is running, or the customer just stopped);
   reconnecting — the line dropped and is being restored. */
(function () {
  'use strict';
  const FN = () => (window.PIVKA_CONFIG && PIVKA_CONFIG.supabaseUrl ? PIVKA_CONFIG.supabaseUrl.replace(/\/$/, '') : '') + '/functions/v1/voice-session';
  const CALLS = 'https://api.openai.com/v1/realtime/calls';
  const IDLE_MS = 45e3;          // the customer is silent on their turn → the seller says goodbye
  const NO_PROGRESS_MS = 150e3;  // talk without ever looking at the shop → goodbye (anti-chatter; discovery questions take time)
  const WARN_BEFORE_MS = 30e3;   // «давай закругляться» before the hard cap
  const NO_ANSWER_MS = 5e3;      // the customer stopped talking but no answer started → back to listening
  const DROP_GRACE_MS = 7e3;     // «disconnected» on mobile often heals by itself
  const MAX_RESUMES = 2;
  const PROGRESS = new Set(['get_store_context', 'get_catalog', 'get_product', 'get_available_bundles', 'recommend_cart', 'apply_recommendation', 'add_to_cart',
    'remove_from_cart', 'set_cart_quantity', 'add_bundle_to_cart', 'get_cart', 'get_gift_progress', 'get_delivery_quote', 'prepare_checkout']);
  // What the seller is asked to say before she hangs up (in her own words, in the talk's language).
  const BYE = {
    idle: '[SYSTEM: клиент молчит. Попрощайся одной смешной фразой в духе «Алё? Ты там уснул? Ладно, отключаюсь — жми, когда что». Больше ничего не говори.]',
    no_progress: '[SYSTEM: разговор не по делу. Попрощайся одной смешной фразой в духе «Как будешь готов — скажи, а я пойду немножко посплю». Больше ничего не говори.]',
    warn: '[SYSTEM: осталось 30 секунд разговора. Одной фразой с юмором предложи закругляться, в духе «Болтун — находка для шпиона! Давай закругляться: жми „Оформить“». По-грузински и по-армянски — местный аналог этой шутки, не дословный перевод.]',
    max_time: '[SYSTEM: время разговора вышло. Попрощайся одной смешной фразой в духе «Всё, конспирация: болтун — находка для шпиона. Корзина сохранена, оформляй кнопкой». По-грузински и по-армянски — местный аналог, не дословно.]',
  };
  const DEBUG = (() => { try { return new URLSearchParams(location.search).get('vdebug') === '1' } catch (e) { return false } })();

  let s = null; // the one active session
  let lastDiag = [];
  let lastBroken = null; // { at, ctx } after a session ended by a connection error
  const h = { state() {}, user() {}, seller() {}, error() {}, lang() {} };

  function sessionId() { try { return localStorage.getItem('pivka_session') || '' } catch (e) { return '' } }
  function track(event, metadata) { try { window.PIVKA_DB && PIVKA_DB.trackEvent(event, { metadata: metadata || {} }) } catch (e) {} }

  // Diagnostics: event names, timings and codes only — never transcripts, phones or secrets.
  function log(me, ev, data) {
    if (!me) return;
    const row = { t: Date.now() - me.t0, ev, ...(data || {}) };
    me.diag.push(row);
    if (me.diag.length > 400) me.diag.shift();
    if (ev === 'session_error') me.errors++;
    if (DEBUG) console.debug('[voice]', row);
  }

  // Script of a phrase → language (only for analytics / the UI label; the model decides the conversation language).
  function scriptLang(t) {
    const ka = (t.match(/[Ⴀ-ჿ]/g) || []).length, hy = (t.match(/[԰-֏]/g) || []).length, ru = (t.match(/[Ѐ-ӿ]/g) || []).length;
    const m = Math.max(ka, hy, ru);
    if (m < 6) return null; // a name or a single word is not a language switch
    return m === ka ? 'ka' : m === hy ? 'hy' : 'ru';
  }

  // ---- State: derived from what is really happening.
  function derive(me) {
    if (me.reconnecting) return 'reconnecting';
    if (!me.ready) return 'connecting';
    if (me.playing) return 'speaking';
    if (me.userSpeaking) return 'listening';
    if (me.tool || me.respActive || me.wantResp || me.awaiting) return 'thinking';
    return me.mic ? 'listening' : 'ready_text';
  }
  function refresh(me) {
    if (s !== me) return;
    const x = derive(me);
    if (x === me.state) return;
    me.state = x;
    log(me, 'state', { to: x });
    h.state(x);
    if (x === 'listening' || x === 'ready_text') idle(me);
  }

  async function start({ lang, wantMic = true, resume = null }) {
    if (s) return s;
    // The customer presses the mic again soon after a broken line: carry the talk over instead of starting from zero.
    if (!resume && lastBroken && Date.now() - lastBroken.at < 300e3) resume = { ...lastBroken.ctx, resumes: 0 };
    lastBroken = null;
    const t0 = Date.now();
    const me = s = {
      pc: null, dc: null, mic: null, audio: null, state: null, lang, timers: [], handled: new Set(),
      sellerText: '', t0, started: resume ? resume.started : t0, diag: resume ? resume.diag : [], errors: 0,
      history: resume ? resume.history : [], resumes: resume ? resume.resumes : 0, progress: resume ? resume.progress : false,
      ready: false, reconnecting: !!resume, playing: false, userSpeaking: false, awaiting: false, respActive: false, wantResp: false, tool: false,
    };
    refresh(me);
    log(me, 'session_started', { lang, resume: !!resume, mic_wanted: wantMic });
    if (!resume || !resume.resumes) track('voice_session_started', { lang, resumed: !!resume });
    let secret;
    try {
      const r = await fetch(FN(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: PIVKA_CONFIG.supabaseAnonKey },
        body: JSON.stringify({ lang, session: sessionId(), resume: !!resume, voice: new URLSearchParams(location.search).get('vv') || undefined }),
      });
      secret = await r.json().catch(() => ({}));
      if (!r.ok || !secret.value) throw Object.assign(new Error(secret.error || 'session'), { code: secret.error || 'session' });
    } catch (e) {
      log(me, 'session_error', { where: 'secret', code: e.code || 'network' });
      return fail(me, e.code || 'network');
    }
    if (s !== me) return null; // closed while waiting
    try {
      const pc = me.pc = new RTCPeerConnection();
      me.audio = document.createElement('audio');
      me.audio.autoplay = true;
      me.audio.setAttribute('playsinline', '');
      pc.ontrack = (ev) => {
        me.audio.srcObject = ev.streams[0];
        me.audio.play().then(() => log(me, 'audio_element_playing')).catch((x) => log(me, 'session_error', { where: 'audio_play', code: x && x.name }));
      };
      if (wantMic) {
        try {
          me.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          me.mic.getTracks().forEach((t) => pc.addTrack(t, me.mic));
          const st = me.mic.getAudioTracks()[0] && me.mic.getAudioTracks()[0].getSettings ? me.mic.getAudioTracks()[0].getSettings() : {};
          log(me, 'microphone_started', { aec: st.echoCancellation, ns: st.noiseSuppression });
          me.mic.getAudioTracks().forEach((t) => { t.onended = () => log(me, 'session_error', { where: 'mic_ended' }) });
        } catch (e) {
          me.mic = null;
          log(me, 'session_error', { where: 'mic', code: e && e.name });
          h.error('mic_denied');
          track('voice_error', { code: 'mic_denied' });
        }
      }
      if (!me.mic) pc.addTransceiver('audio', { direction: 'recvonly' });
      const dc = me.dc = pc.createDataChannel('oai-events');
      dc.onmessage = (ev) => { try { onEvent(me, JSON.parse(ev.data)) } catch (e) { console.warn(e) } };
      dc.onopen = () => {
        me.ready = true;
        log(me, 'channel_open');
        refresh(me);
        idle(me);
        // Hard cap from the server (cost control), counted from the very first start: a warning 30 s before, then a goodbye.
        const capMs = Math.min(Number(secret.max_seconds) || 180, 600) * 1000;
        const left = Math.max(capMs - (Date.now() - me.started), 60e3);
        if (left > WARN_BEFORE_MS + 5e3) me.timers.push(setTimeout(() => say(me, BYE.warn), left - WARN_BEFORE_MS));
        me.timers.push(setTimeout(() => farewell(me, 'max_time'), left));
        // No shopping at all for a long while → goodbye.
        const np = Math.max(NO_PROGRESS_MS - (Date.now() - me.started), 30e3);
        me.timers.push(setTimeout(() => { if (s === me && !me.progress) farewell(me, 'no_progress') }, np));
        if (resume) resumeContext(me, resume);
      };
      dc.onclose = () => { if (s === me && !me.closing) { log(me, 'session_error', { where: 'channel_closed' }); drop(me, 'channel_closed') } };
      pc.onconnectionstatechange = () => {
        const cs = pc.connectionState;
        log(me, 'connection', { to: cs });
        if (s !== me) return;
        if (cs === 'connected') { clearTimeout(me.dropT); me.dropT = 0; return }
        if (cs === 'disconnected' && !me.dropT) me.dropT = setTimeout(() => { if (s === me && pc.connectionState !== 'connected') drop(me, 'disconnected') }, DROP_GRACE_MS);
        if (cs === 'failed') drop(me, 'failed');
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const ans = await fetch(CALLS, { method: 'POST', body: offer.sdp, headers: { Authorization: 'Bearer ' + secret.value, 'Content-Type': 'application/sdp' } });
      if (!ans.ok) throw Object.assign(new Error('sdp'), { code: ans.status === 429 ? 'openai_quota' : 'openai' });
      await pc.setRemoteDescription({ type: 'answer', sdp: await ans.text() });
      return me;
    } catch (e) {
      log(me, 'session_error', { where: 'connect', code: e.code || 'connection' });
      return fail(me, e.code || 'connection');
    }
  }

  function fail(me, code) {
    if (me.ready && me.history.length) lastBroken = { at: Date.now(), ctx: { started: Date.now(), diag: me.diag, history: me.history.slice(-10), progress: me.progress } };
    h.error(code);
    track('voice_error', { code });
    stop('error', true);
    return null;
  }

  // The line dropped: start a new session that knows the talk so far (once or twice per conversation).
  async function drop(me, why) {
    if (s !== me || me.closing || me.reconnecting) return;
    if (me.resumes >= MAX_RESUMES) { log(me, 'session_error', { where: 'drop', code: why, resumes: me.resumes }); fail(me, 'connection'); return }
    me.reconnecting = true;
    refresh(me);
    log(me, 'reconnect_attempt', { why, n: me.resumes + 1 });
    track('voice_reconnect', { why, n: me.resumes + 1 });
    const ctx = { started: me.started, diag: me.diag, history: me.history.slice(-10), resumes: me.resumes + 1, progress: me.progress };
    const wantMic = !!me.mic, lang = me.lang;
    teardown(me);
    s = null;
    const next = await start({ lang, wantMic, resume: ctx });
    if (next) log(next, 'reconnected');
  }

  // Tell the new session what was already said and chosen, so it continues instead of starting over.
  function resumeContext(me, ctx) {
    let cart = '';
    try {
      const c = window.PivkaVoiceTools && PivkaVoiceTools.cartView();
      if (c && c.items && c.items.length) cart = 'Корзина: ' + c.items.map((i) => `${i.name} × ${i.quantity}`).join(', ') + `, итого ${c.total}.`;
      const r = window.PivkaVoiceTools && PivkaVoiceTools.lastReco && PivkaVoiceTools.lastReco();
      if (r) cart += ` Последний подбор: ${r.people} чел., бюджет ${r.budget || 'не назван'}, стол ${r.scenario || '—'}, напитки ${r.alcohol}, итог ${r.total}.`;
    } catch (e) {}
    const talk = ctx.history.map((x) => (x.who === 'user' ? 'Клиент: ' : 'Ты: ') + x.text).join('\n');
    const text = `[SYSTEM: связь на секунду пропала и восстановилась. Не здоровайся заново и не начинай подбор сначала. ${cart}\nРазговор до обрыва:\n${talk}\nПродолжи с того же места одной короткой фразой («Я тут, продолжаем…») и ответь на последний вопрос клиента, если он остался без ответа.]`;
    send(me, { type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
    requestResponse(me);
    me.reconnecting = false;
    refresh(me);
  }

  function idle(me) {
    clearTimeout(me.idleT);
    me.idleT = setTimeout(() => {
      if (s !== me) return;
      if (['listening', 'ready_text'].includes(derive(me)) && !me.userSpeaking) farewell(me, 'idle'); else idle(me);
    }, IDLE_MS);
  }

  // Responses never overlap: a second response.create while one is active is rejected by the server
  // («conversation_already_has_active_response») and the seller goes silent. Queue it instead.
  function requestResponse(me) {
    if (s !== me) return;
    if (me.respActive || me.tool) { me.wantResp = true; log(me, 'response_queued'); refresh(me); return }
    me.wantResp = false;
    me.respActive = true; // until response.done (or an error) — the server answers response.created right away
    me.reqAt = Date.now();
    send(me, { type: 'response.create' });
    refresh(me);
  }

  // A service instruction to the seller (spoken in her style).
  function say(me, text) {
    if (s !== me || me.closing) return;
    send(me, { type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
    requestResponse(me);
  }
  // The seller says goodbye, then the line is closed (when her audio ends, at most in 8 s).
  function farewell(me, reason) {
    if (s !== me || me.closing) return;
    log(me, 'farewell', { reason });
    if (BYE[reason]) {
      if (me.respActive) { send(me, { type: 'response.cancel' }); me.respActive = false }
      say(me, BYE[reason]);
    }
    me.closing = reason;
    me.closeT = setTimeout(() => { if (s === me) stop(reason) }, BYE[reason] ? 8e3 : 4e3);
  }

  function send(me, obj) { if (me && me.dc && me.dc.readyState === 'open') me.dc.send(JSON.stringify(obj)) }

  function remember(me, who, text) {
    me.history.push({ who, text: String(text).slice(0, 300) });
    if (me.history.length > 20) me.history.shift();
  }

  async function onEvent(me, e) {
    if (s !== me) return;
    const t = e.type || '';
    if (t === 'input_audio_buffer.speech_started') {
      me.userSpeaking = true; me.awaiting = false; clearTimeout(me.noAnsT);
      me.speechAt = Date.now();
      log(me, 'speech_started', me.playing ? { during_playback_ms: Date.now() - me.playAt } : null);
      refresh(me); idle(me); return;
    }
    if (t === 'input_audio_buffer.speech_stopped') {
      me.userSpeaking = false; me.awaiting = true; me.stopAt = Date.now();
      log(me, 'speech_ended', { ms: me.speechAt ? Date.now() - me.speechAt : null });
      clearTimeout(me.noAnsT);
      // Semantic VAD may decide the phrase is not over, or the noise was not speech: do not hang in «thinking».
      me.noAnsT = setTimeout(() => { if (s === me && me.awaiting) { me.awaiting = false; log(me, 'no_answer_after_speech'); refresh(me) } }, NO_ANSWER_MS);
      refresh(me); return;
    }
    if (t === 'input_audio_buffer.committed') { log(me, 'audio_committed'); return }
    // User's words (transcription) — names differ between API versions, accept both.
    if (/input_audio_transcription\.(completed|done)$/.test(t) && (e.transcript || e.text)) {
      const text = e.transcript || e.text;
      log(me, 'transcription_completed', { chars: text.length });
      remember(me, 'user', text);
      h.user(text);
      track('voice_request', { lang: scriptLang(text) || me.lang, chars: text.length });
      const l = scriptLang(text);
      if (l && l !== me.lang) { me.lang = l; h.lang(l); track('voice_language', { lang: l }) }
      return;
    }
    if (/input_audio_transcription\.failed$/.test(t)) { log(me, 'session_error', { where: 'transcription', code: e.error && e.error.code }); return }
    if (t === 'response.created') {
      me.respActive = true; me.awaiting = false; clearTimeout(me.noAnsT);
      me.sellerText = '';
      log(me, 'response_started', { after_speech_ms: me.stopAt ? Date.now() - me.stopAt : null });
      refresh(me); return;
    }
    if (/^response\.(output_audio_transcript|audio_transcript|output_text)\.delta$/.test(t)) {
      me.sellerText += e.delta || '';
      h.seller(me.sellerText, false);
      return;
    }
    if (/^response\.(output_audio_transcript|audio_transcript|output_text)\.done$/.test(t)) {
      me.sellerText = e.transcript || e.text || me.sellerText;
      remember(me, 'seller', me.sellerText);
      h.seller(me.sellerText, true);
      return;
    }
    if (t === 'output_audio_buffer.started') {
      me.playing = true; me.playAt = Date.now();
      log(me, 'audio_playback_started', { after_speech_ms: me.stopAt ? Date.now() - me.stopAt : null });
      me.stopAt = 0;
      refresh(me); return;
    }
    if (t === 'output_audio_buffer.stopped' || t === 'output_audio_buffer.cleared') {
      me.playing = false;
      log(me, 'audio_playback_completed', { ms: me.playAt ? Date.now() - me.playAt : null, cleared: t === 'output_audio_buffer.cleared' });
      if (me.closing) { setTimeout(() => { if (s === me) stop(me.closing) }, 600); return }
      refresh(me); return;
    }
    if (t === 'response.done') {
      const resp = e.response || {};
      const calls = (resp.output || []).filter((o) => o.type === 'function_call');
      me.respActive = false;
      log(me, 'response_completed', { status: resp.status, reason: resp.status_details && (resp.status_details.reason || (resp.status_details.error && resp.status_details.error.code)), tools: calls.map((c) => c.name).join(',') || undefined });
      if (resp.status === 'failed') track('voice_error', { code: 'response_failed' });
      if (calls.length) {
        me.tool = true; refresh(me);
        let ending = null;
        for (const c of calls) {
          if (me.handled.has(c.call_id)) continue;
          me.handled.add(c.call_id);
          if (c.name === 'end_conversation') {
            let why = 'done';
            try { why = JSON.parse(c.arguments || '{}').reason || 'done' } catch (x) {}
            ending = why === 'off_topic' ? 'off_topic' : 'done';
            send(me, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: '{"ok":true}' } });
            continue;
          }
          if (PROGRESS.has(c.name)) me.progress = true;
          const t1 = Date.now();
          const result = await PivkaVoiceTools.run(c.name, c.arguments);
          log(me, 'tool_done', { name: c.name, ok: result && result.ok !== false, ms: Date.now() - t1 });
          if (s !== me) return;
          send(me, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(result) } });
        }
        me.tool = false;
        // She already said goodbye before calling end_conversation: hang up when her voice ends.
        if (ending) { farewell(me, ending); return }
        me.wantResp = false;
        requestResponse(me);
      } else if (me.wantResp) requestResponse(me);
      refresh(me);
      return;
    }
    if (t === 'error') {
      const err = e.error || {};
      const code = err.code || err.type || 'error';
      log(me, 'session_error', { where: 'server', code });
      if (code === 'conversation_already_has_active_response') { me.wantResp = true; me.respActive = true; refresh(me); return }
      if (code === 'response_cancel_not_active') return;
      if (/expired|invalid_api_key|authentication/i.test(code + ' ' + (err.message || ''))) fail(me, 'openai');
    }
  }

  // Typed text goes into the same conversation (same tools, same rules).
  function sendText(text) {
    const me = s;
    text = String(text || '').trim().slice(0, 500);
    if (!me || !text) return false;
    if (!me.dc || me.dc.readyState !== 'open') return false;
    if (me.respActive) { send(me, { type: 'response.cancel' }); me.respActive = false }
    if (me.playing) send(me, { type: 'output_audio_buffer.clear' });
    send(me, { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    remember(me, 'user', text);
    log(me, 'text_sent', { chars: text.length });
    requestResponse(me);
    h.user(text);
    track('voice_request', { lang: scriptLang(text) || me.lang, chars: text.length, typed: true });
    return true;
  }

  // Interrupt the seller (the server VAD also does this when the customer starts talking).
  function interrupt() {
    const me = s;
    if (!me) return;
    log(me, 'interrupt_button');
    if (me.respActive) send(me, { type: 'response.cancel' });
    send(me, { type: 'output_audio_buffer.clear' });
  }

  function teardown(me) {
    me.timers.forEach(clearTimeout);
    clearTimeout(me.idleT); clearTimeout(me.closeT); clearTimeout(me.noAnsT); clearTimeout(me.dropT);
    try { me.dc && (me.dc.onclose = null, me.dc.close()) } catch (e) {}
    try { me.pc && (me.pc.onconnectionstatechange = null, me.pc.getSenders().forEach((x) => x.track && x.track.stop())) } catch (e) {}
    try { me.mic && me.mic.getTracks().forEach((t) => t.stop()) } catch (e) {}
    try { me.pc && me.pc.close() } catch (e) {}
    try { if (me.audio) { me.audio.pause(); me.audio.srcObject = null } } catch (e) {}
  }

  function stop(reason, silent) {
    const me = s;
    if (!me) return;
    s = null;
    log(me, 'session_end', { reason: reason || 'user' });
    teardown(me);
    lastDiag = me.diag;
    const seconds = Math.round((Date.now() - me.started) / 1000);
    track('voice_session_end', { reason: reason || 'user', seconds, resumes: me.resumes, errors: me.errors });
    // A compact timeline for sessions that did not end normally (names and timings only).
    if (DEBUG || me.errors || me.resumes || ['error', 'idle', 'no_progress', 'max_time'].includes(reason)) {
      track('voice_diag', { reason: reason || 'user', seconds, events: me.diag.filter((x) => x.ev !== 'state').slice(-120).map((x) => [Math.round(x.t / 100) / 10, x.ev, x.code || x.status || x.reason || x.name || x.to || x.after_speech_ms || x.during_playback_ms || ''].join(':')).join(' ') });
    }
    if (!silent) h.state('closed');
  }

  // Leaving the page / hiding it for a while ends the session (iOS keeps WebRTC alive in background otherwise).
  let hiddenT = 0;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenT);
    if (s) log(s, 'visibility', { to: document.visibilityState });
    if (document.visibilityState === 'hidden' && s) hiddenT = setTimeout(() => stop('background'), 30e3);
  });
  addEventListener('pagehide', () => stop('pagehide'));

  window.PivkaVoiceAgent = {
    start, stop, sendText, interrupt,
    on: (k, f) => { if (k in h && typeof f === 'function') h[k] = f },
    active: () => !!s,
    state: () => (s ? s.state : 'closed'),
    diag: () => (s ? s.diag : lastDiag).slice(),
    debug: DEBUG,
    // test hooks: feed a server event as if it came from the data channel; simulate a dropped line
    _event: (e) => s && onEvent(s, e),
    _drop: (why) => s && drop(s, why || 'test'),
    _scriptLang: scriptLang,
  };
})();
