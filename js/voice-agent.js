/* Voice seller — OpenAI Realtime session over WebRTC.
   1. Ask our Supabase function `voice-session` for a short-lived client secret (the API key never reaches the browser).
   2. Open an RTCPeerConnection: microphone up, seller's voice down, data channel «oai-events» for events and tools.
   3. Tool calls from the model are executed by PivkaVoiceTools (existing store logic) and answered back.
   One session at a time; it is closed on «Закончить», when the sheet closes, after an idle minute and at the
   server's max length. Without a microphone the same session works by text. */
(function () {
  'use strict';
  const FN = () => (window.PIVKA_CONFIG && PIVKA_CONFIG.supabaseUrl ? PIVKA_CONFIG.supabaseUrl.replace(/\/$/, '') : '') + '/functions/v1/voice-session';
  const CALLS = 'https://api.openai.com/v1/realtime/calls';
  const IDLE_MS = 90e3;

  let s = null; // the one active session
  const h = { state() {}, user() {}, seller() {}, error() {}, lang() {} };

  function sessionId() { try { return localStorage.getItem('pivka_session') || '' } catch (e) { return '' } }
  function setState(x) { if (s) s.state = x; h.state(x) }
  function track(event, metadata) { try { window.PIVKA_DB && PIVKA_DB.trackEvent(event, { metadata: metadata || {} }) } catch (e) {} }

  // Script of a phrase → language (only for analytics / the UI label; the model decides the conversation language).
  function scriptLang(t) {
    const ka = (t.match(/[Ⴀ-ჿ]/g) || []).length, hy = (t.match(/[԰-֏]/g) || []).length, ru = (t.match(/[Ѐ-ӿ]/g) || []).length;
    const m = Math.max(ka, hy, ru);
    if (m < 6) return null; // a name or a single word is not a language switch
    return m === ka ? 'ka' : m === hy ? 'hy' : 'ru';
  }

  async function start({ lang, wantMic = true }) {
    if (s) return s;
    const me = s = { pc: null, dc: null, mic: null, audio: null, state: 'connecting', lang, timers: [], handled: new Set(), userText: '', sellerText: '', started: Date.now() };
    setState('connecting');
    track('voice_session_started', { lang });
    let secret;
    try {
      const r = await fetch(FN(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: PIVKA_CONFIG.supabaseAnonKey },
        body: JSON.stringify({ lang, session: sessionId() }),
      });
      secret = await r.json().catch(() => ({}));
      if (!r.ok || !secret.value) throw Object.assign(new Error(secret.error || 'session'), { code: secret.error || 'session' });
    } catch (e) {
      return fail(me, e.code || 'network');
    }
    if (s !== me) return null; // closed while waiting
    try {
      const pc = me.pc = new RTCPeerConnection();
      me.audio = document.createElement('audio');
      me.audio.autoplay = true;
      me.audio.setAttribute('playsinline', '');
      pc.ontrack = (ev) => { me.audio.srcObject = ev.streams[0]; me.audio.play().catch(() => {}) };
      if (wantMic) {
        try {
          me.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          me.mic.getTracks().forEach((t) => pc.addTrack(t, me.mic));
        } catch (e) {
          me.mic = null;
          h.error('mic_denied');
          track('voice_error', { code: 'mic_denied' });
        }
      }
      if (!me.mic) pc.addTransceiver('audio', { direction: 'recvonly' });
      const dc = me.dc = pc.createDataChannel('oai-events');
      dc.onmessage = (ev) => { try { onEvent(me, JSON.parse(ev.data)) } catch (e) { console.warn(e) } };
      dc.onopen = () => {
        setState(me.mic ? 'listening' : 'ready_text');
        idle(me);
        // Hard cap from the server (cost control).
        me.timers.push(setTimeout(() => stop('max_time'), Math.min(Number(secret.max_seconds) || 600, 1800) * 1000));
      };
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState) && s === me) fail(me, 'connection') };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const ans = await fetch(CALLS, { method: 'POST', body: offer.sdp, headers: { Authorization: 'Bearer ' + secret.value, 'Content-Type': 'application/sdp' } });
      if (!ans.ok) throw Object.assign(new Error('sdp'), { code: ans.status === 429 ? 'openai_quota' : 'openai' });
      await pc.setRemoteDescription({ type: 'answer', sdp: await ans.text() });
      return me;
    } catch (e) {
      return fail(me, e.code || 'connection');
    }
  }

  function fail(me, code) {
    h.error(code);
    track('voice_error', { code });
    stop('error', true);
    return null;
  }

  function idle(me) {
    clearTimeout(me.idleT);
    me.idleT = setTimeout(() => { if (s === me && me.state !== 'speaking' && me.state !== 'thinking') stop('idle') }, IDLE_MS);
  }

  function send(me, obj) { if (me && me.dc && me.dc.readyState === 'open') me.dc.send(JSON.stringify(obj)) }

  async function onEvent(me, e) {
    if (s !== me) return;
    const t = e.type || '';
    if (t === 'input_audio_buffer.speech_started') { setState('listening'); idle(me); return }
    if (t === 'input_audio_buffer.speech_stopped' || t === 'input_audio_buffer.committed') { setState('thinking'); return }
    // User's words (transcription) — names differ between API versions, accept both.
    if (/input_audio_transcription\.(completed|done)$/.test(t) && (e.transcript || e.text)) {
      const text = e.transcript || e.text;
      h.user(text);
      track('voice_request', { lang: scriptLang(text) || me.lang, chars: text.length });
      const l = scriptLang(text);
      if (l && l !== me.lang) { me.lang = l; h.lang(l); track('voice_language', { lang: l }) }
      return;
    }
    if (t === 'response.created') { me.sellerText = ''; setState('thinking'); return }
    if (/^response\.(output_audio_transcript|audio_transcript|output_text)\.delta$/.test(t)) {
      me.sellerText += e.delta || '';
      setState('speaking');
      h.seller(me.sellerText, false);
      return;
    }
    if (/^response\.(output_audio_transcript|audio_transcript|output_text)\.done$/.test(t)) {
      me.sellerText = e.transcript || e.text || me.sellerText;
      h.seller(me.sellerText, true);
      return;
    }
    if (t === 'output_audio_buffer.started' || t === 'response.output_audio.started') { setState('speaking'); return }
    if (t === 'output_audio_buffer.stopped' || t === 'response.output_audio.stopped') { setState(me.mic ? 'listening' : 'ready_text'); idle(me); return }
    if (t === 'response.done') {
      const calls = ((e.response && e.response.output) || []).filter((o) => o.type === 'function_call');
      if (calls.length) {
        setState('thinking');
        for (const c of calls) {
          if (me.handled.has(c.call_id)) continue;
          me.handled.add(c.call_id);
          const result = await PivkaVoiceTools.run(c.name, c.arguments);
          send(me, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(result) } });
        }
        send(me, { type: 'response.create' });
      } else if (me.state !== 'speaking') setState(me.mic ? 'listening' : 'ready_text');
      idle(me);
      return;
    }
    if (t === 'error') { console.warn('realtime error', e.error); if (e.error && /expired|invalid_api_key|authentication/i.test(e.error.code || e.error.message || '')) fail(me, 'openai') }
  }

  // Typed text goes into the same conversation (same tools, same rules).
  function sendText(text) {
    const me = s;
    text = String(text || '').trim().slice(0, 500);
    if (!me || !text) return false;
    if (!me.dc || me.dc.readyState !== 'open') return false;
    send(me, { type: 'response.cancel' });
    send(me, { type: 'output_audio_buffer.clear' });
    send(me, { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    send(me, { type: 'response.create' });
    h.user(text);
    track('voice_request', { lang: scriptLang(text) || me.lang, chars: text.length, typed: true });
    setState('thinking');
    idle(me);
    return true;
  }

  // Interrupt the seller (the server VAD also does this when the customer starts talking).
  function interrupt() { if (s) { send(s, { type: 'response.cancel' }); send(s, { type: 'output_audio_buffer.clear' }) } }

  function stop(reason, silent) {
    const me = s;
    if (!me) return;
    s = null;
    me.timers.forEach(clearTimeout);
    clearTimeout(me.idleT);
    try { me.dc && me.dc.close() } catch (e) {}
    try { me.pc && me.pc.getSenders().forEach((x) => x.track && x.track.stop()) } catch (e) {}
    try { me.mic && me.mic.getTracks().forEach((t) => t.stop()) } catch (e) {}
    try { me.pc && me.pc.close() } catch (e) {}
    try { if (me.audio) { me.audio.pause(); me.audio.srcObject = null } } catch (e) {}
    track('voice_session_end', { reason: reason || 'user', seconds: Math.round((Date.now() - me.started) / 1000) });
    if (!silent) h.state('closed');
  }

  // Leaving the page / hiding it for a while ends the session (iOS keeps WebRTC alive in background otherwise).
  let hiddenT = 0;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenT);
    if (document.visibilityState === 'hidden' && s) hiddenT = setTimeout(() => stop('background'), 30e3);
  });
  addEventListener('pagehide', () => stop('pagehide'));

  window.PivkaVoiceAgent = {
    start, stop, sendText, interrupt,
    on: (k, f) => { if (k in h && typeof f === 'function') h[k] = f },
    active: () => !!s,
    state: () => (s ? s.state : 'closed'),
    // test hook: feed a server event as if it came from the data channel
    _event: (e) => s && onEvent(s, e),
    _scriptLang: scriptLang,
  };
})();
