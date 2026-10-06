/* «РЫВОК» — canvas renderer and controls on top of RyvokSim (js/game/ryvok-sim.js).
   Own graphics drawn in code (no images, no third-party sprites). The simulation decides everything; this file only
   draws it, feeds taps/keys into the next simulation tick, records the jump ticks, pauses when the page is hidden
   and plays the crash scene. RyvokGame.mount(el, { seed, onEnd, onState }) → controller. */
(function () {
  'use strict';
  const S = window.RyvokSim;
  const { W, H, GROUND, HERO, DT } = S;
  const YELLOW = '#ffb51b', SKIN = '#f1c39c', SKIN_D = '#d99f78', HAIR = '#3a2417', INK = '#141414';

  // ---------- drawing helpers
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath() }
  function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2) }

  // The hero. (x, footY) = middle of the feet on the ground. phase = run cycle 0..1. mode: run | jump | tumble | down
  function drawHero(c, x, footY, phase, mode, t) {
    c.save();
    c.translate(x, footY);
    c.lineJoin = 'round'; c.lineCap = 'round';
    const run = mode === 'run', jump = mode === 'jump', down = mode === 'down';
    const sw = run ? Math.sin(phase * Math.PI * 2) : 0;
    // legs (short)
    c.strokeStyle = '#2b3442'; c.lineWidth = 7;
    const legA = run ? sw * 7 : jump ? -5 : 2, legB = run ? -sw * 7 : jump ? 6 : -2;
    c.beginPath(); c.moveTo(-5, -16); c.lineTo(-5 + legA, -3); c.stroke();
    c.beginPath(); c.moveTo(5, -16); c.lineTo(5 + legB, -3); c.stroke();
    // sneakers
    c.fillStyle = '#f4f4f4';
    rr(c, -11 + legA, -5, 12, 6, 3); c.fill();
    rr(c, -1 + legB, -5, 12, 6, 3); c.fill();
    c.fillStyle = '#e04a3b'; c.fillRect(-11 + legA, -1, 12, 1.6); c.fillRect(-1 + legB, -1, 12, 1.6);
    // body: round belly in the brand t-shirt
    c.fillStyle = YELLOW;
    ell(c, 0, -27, 15, 14); c.fill();
    c.fillStyle = '#e99a06'; ell(c, 3, -24, 9, 8); c.globalAlpha = .35; c.fill(); c.globalAlpha = 1;
    c.fillStyle = INK; c.font = '900 9px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText('П', 1, -24);
    // arms
    c.strokeStyle = SKIN_D; c.lineWidth = 5;
    const armA = run ? -sw * 8 : jump ? -12 : 0;
    c.beginPath(); c.moveTo(-12, -33); c.lineTo(-17 + armA * .4, -24 + Math.abs(armA) * .2); c.stroke();
    c.beginPath(); c.moveTo(12, -33); c.lineTo(17 - armA * .4, jump ? -42 : -24); c.stroke();
    // head (big)
    const hx = 2, hy = -55;
    c.fillStyle = SKIN; ell(c, hx, hy, 17, 18); c.fill();
    c.fillStyle = SKIN_D; ell(c, hx - 17, hy + 2, 3.5, 5); c.fill(); // ear
    // hair: neat quiff, messy when down
    c.fillStyle = HAIR;
    c.beginPath();
    if (down) {
      for (let i = 0; i < 7; i++) { const a = Math.PI * (1.05 + i * 0.13); c.moveTo(hx + Math.cos(a) * 15, hy + Math.sin(a) * 15); c.lineTo(hx + Math.cos(a + .05) * 25, hy + Math.sin(a + .05) * 25 - (i % 2) * 3); c.lineTo(hx + Math.cos(a + .14) * 15, hy + Math.sin(a + .14) * 15) }
      c.fill(); c.beginPath(); c.ellipse(hx, hy - 9, 16, 9, 0, Math.PI, 0); c.fill();
    } else {
      c.ellipse(hx, hy - 9, 16.5, 10, 0, Math.PI, 0); c.fill();
      c.beginPath(); c.moveTo(hx - 4, hy - 17); c.quadraticCurveTo(hx + 10, hy - 30, hx + 18, hy - 15); c.quadraticCurveTo(hx + 8, hy - 19, hx - 4, hy - 13); c.fill();
    }
    // eyebrows: confident (one raised) / shocked (both high)
    c.strokeStyle = HAIR; c.lineWidth = 2.6;
    if (down) { c.beginPath(); c.moveTo(hx - 10, hy - 11); c.lineTo(hx - 3, hy - 13); c.moveTo(hx + 4, hy - 13); c.lineTo(hx + 11, hy - 11); c.stroke() }
    else { c.beginPath(); c.moveTo(hx - 10, hy - 7); c.lineTo(hx - 3, hy - 9); c.moveTo(hx + 4, hy - 11); c.lineTo(hx + 11, hy - 8); c.stroke() }
    // eyes
    if (down) {
      // black eye on the left one
      c.fillStyle = '#6b3fa0'; c.globalAlpha = .75; ell(c, hx - 6, hy - 3, 6.5, 6); c.fill(); c.globalAlpha = 1;
      c.fillStyle = '#fff'; ell(c, hx - 6, hy - 3, 3.6, 4); c.fill(); ell(c, hx + 7, hy - 4, 4, 4.6); c.fill();
      c.fillStyle = INK; ell(c, hx - 5, hy - 2, 1.4, 1.4); c.fill(); ell(c, hx + 8, hy - 4, 1.6, 1.6); c.fill();
    } else {
      c.fillStyle = '#fff'; ell(c, hx - 6, hy - 3, 3.2, 3.4); c.fill(); ell(c, hx + 7, hy - 4, 3.2, 3.4); c.fill();
      c.fillStyle = INK; ell(c, hx - 5, hy - 3, 1.6, 1.8); c.fill(); ell(c, hx + 8, hy - 4, 1.6, 1.8); c.fill();
    }
    // nose + moustache
    c.fillStyle = '#e5a27c'; ell(c, hx + 3, hy + 3, 4.5, 3.6); c.fill();
    c.fillStyle = HAIR; c.beginPath(); c.moveTo(hx - 9, hy + 9); c.quadraticCurveTo(hx + 2, hy + 3, hx + 13, hy + 8); c.quadraticCurveTo(hx + 2, hy + 7, hx - 9, hy + 9); c.fill();
    // mouth: smirk / shocked «o»
    c.strokeStyle = '#7a3b2b'; c.lineWidth = 2;
    if (down) { c.fillStyle = '#5a2418'; ell(c, hx + 2, hy + 13, 3, 3.6); c.fill() }
    else { c.beginPath(); c.moveTo(hx - 3, hy + 13); c.quadraticCurveTo(hx + 4, hy + 15, hx + 9, hy + 11); c.stroke() }
    // stars over the head when down
    if (down) {
      for (let i = 0; i < 3; i++) {
        const a = t * 3 + i * 2.1, sx = hx + Math.cos(a) * 20, sy = hy - 26 + Math.sin(a) * 5;
        star(c, sx, sy, 4.5, '#ffd84d');
      }
    }
    c.restore();
  }
  function star(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * .45 : r; c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q) } c.closePath(); c.fill() }

  // ---------- obstacles (neutral, no brands)
  function mug(c, x, y, w, h) {
    c.save(); c.translate(x, y);
    c.fillStyle = 'rgba(255,190,60,.92)'; rr(c, 0, -h + 6, w - 7, h - 6, 3); c.fill();
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(3, -h + 9, 3, h - 13);
    c.strokeStyle = 'rgba(230,240,255,.85)'; c.lineWidth = 2; rr(c, 0, -h + 6, w - 7, h - 6, 3); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.arc(w - 7, -h / 2 + 2, h * .22, -Math.PI / 2, Math.PI / 2); c.stroke();
    c.fillStyle = '#fffaf0'; for (let i = 0; i < 4; i++) { ell(c, 3 + i * (w - 10) / 3, -h + 6, (w - 7) / 5.5, 4.2); c.fill() }
    c.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 3; i++) { ell(c, 6 + i * 6, -8 - i * 7, 1.2, 1.2); c.fill() }
    c.restore();
  }
  function bottle(c, x, y, w, h, col) {
    c.save(); c.translate(x, y);
    const neck = Math.max(5, w * .38), sh = h * .38;
    c.fillStyle = col;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -h + sh); c.quadraticCurveTo(0, -h + sh * .55, (w - neck) / 2, -h + sh * .35); c.lineTo((w - neck) / 2, -h + 3); c.lineTo((w + neck) / 2, -h + 3); c.lineTo((w + neck) / 2, -h + sh * .35); c.quadraticCurveTo(w, -h + sh * .55, w, -h + sh); c.lineTo(w, 0); c.closePath(); c.fill();
    c.fillStyle = '#c9a227'; c.fillRect((w - neck) / 2 - .5, -h, neck + 1, 4);
    c.fillStyle = '#efe6cf'; c.fillRect(1.5, -h * .52, w - 3, h * .24);
    c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(2.5, -h + sh, 2.5, h - sh - 4);
    c.restore();
  }
  const BOTTLE_COLS = ['#2f6b3a', '#6b3f1d', '#3d5d2a'];
  function drawObstacle(c, o, x, y, rot) {
    c.save(); c.translate(x + o.w / 2, y); if (rot) c.rotate(rot); c.translate(-o.w / 2, 0);
    if (o.kind === 'mugS' || o.kind === 'mugL') mug(c, 0, 0, o.w, o.h);
    else if (o.kind === 'botS' || o.kind === 'botT') bottle(c, 0, 0, o.w, o.h, BOTTLE_COLS[o.variant % 3]);
    else if (o.kind === 'multi') { const n = o.variant === 2 ? 3 : 2, bw = o.w / n; for (let i = 0; i < n; i++) bottle(c, i * bw + 1, 0, bw - 2, o.h - (i % 2) * 10, BOTTLE_COLS[(o.variant + i) % 3]) }
    else if (o.kind === 'combo') { mug(c, 0, 0, 34, 40); bottle(c, 36, 0, 24, o.h, BOTTLE_COLS[o.variant % 3]) }
    c.restore();
  }

  // ---------- background: night street outside a bar, simple parallax
  function background(c, dist, t) {
    const g = c.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#0b0f14'); g.addColorStop(1, '#1d1609');
    c.fillStyle = g; c.fillRect(0, 0, W, GROUND);
    c.fillStyle = '#ffe9a8'; ell(c, 470, 92, 16, 16); c.globalAlpha = .9; c.fill(); c.globalAlpha = 1;
    // far houses
    c.fillStyle = '#141b22';
    const off1 = (dist * .15) % 160;
    for (let i = -1; i < 6; i++) { const x = i * 160 - off1, hh = 90 + ((i * 37 + 1000) % 5) * 14; c.fillRect(x, GROUND - hh, 130, hh) }
    c.fillStyle = '#ffcf6b';
    for (let i = -1; i < 6; i++) { const x = i * 160 - off1; for (let k = 0; k < 3; k++) if ((i + k) % 2 === 0) c.fillRect(x + 18 + k * 34, GROUND - 70, 12, 14) }
    // string lights
    const off2 = (dist * .45) % 48;
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 40); c.quadraticCurveTo(W / 2, 70, W, 40); c.stroke();
    for (let i = -1; i < 15; i++) { const x = i * 48 - off2; const y = 40 + 30 * (1 - Math.pow((x - W / 2) / (W / 2), 2)) * .95; c.fillStyle = i % 3 ? 'rgba(255,181,27,.9)' : 'rgba(255,240,200,.9)'; ell(c, x, y + 4, 2.6, 2.6); c.fill() }
    // ground
    c.fillStyle = '#121619'; c.fillRect(0, GROUND, W, H - GROUND);
    c.fillStyle = '#272d30'; c.fillRect(0, GROUND, W, 3);
    c.fillStyle = 'rgba(255,181,27,.55)'; const off3 = dist % 46;
    for (let x = -off3; x < W; x += 46) c.fillRect(x, GROUND + 22, 24, 3);
  }

  // ---------- the game
  function mount(el, opts) {
    opts = opts || {};
    const cv = document.createElement('canvas');
    cv.className = 'ryvokCanvas';
    cv.setAttribute('aria-label', 'РЫВОК');
    el.appendChild(cv);
    const c = cv.getContext('2d');
    let scale = 1, dpr = 1;
    function fit() {
      const r = el.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(200, r.width), h = w * H / W;
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      scale = w / W;
      draw();
    }
    let sim = null, seed = 0, jumps = [], pending = false, raf = 0, last = 0, acc = 0;
    let phase = 'ready'; // ready | play | paused | countdown | crash | over
    let countdownT = 0, crashT = 0, crashFrom = null, runPhase = 0, best = 0, pauses = 0;
    const emit = (p) => { phase = p; if (opts.onState) opts.onState(p) };

    function start(newSeed) {
      seed = (newSeed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
      sim = S.create(seed); jumps = []; pending = false; acc = 0; pauses = 0; crashT = 0; crashFrom = null;
      emit('play'); last = performance.now(); loop(last);
    }
    function press() {
      if (phase === 'play') pending = true;
    }
    function pause() {
      if (phase !== 'play' && phase !== 'countdown') return;
      pauses++; cancelAnimationFrame(raf); raf = 0; emit('paused'); draw();
    }
    function resume() {
      if (phase !== 'paused') return;
      countdownT = 3; emit('countdown'); last = performance.now(); loop(last);
    }
    function loop(now) {
      raf = 0;
      const fdt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
      if (phase === 'countdown') {
        countdownT -= fdt;
        if (countdownT <= 0) { emit('play'); acc = 0 }
      } else if (phase === 'play') {
        acc += fdt;
        while (acc >= DT && !sim.state.over) {
          const p = pending; pending = false;
          if (p) jumps.push(sim.state.tick + 1);
          sim.step(p);
          acc -= DT;
        }
        runPhase = (runPhase + fdt * (sim.state.speed / 95)) % 1;
        if (sim.state.over) {
          crashFrom = { x: HERO.x + HERO.w / 2, y: sim.state.y, hit: sim.state.hit, hx: sim.state.hit.x };
          if (navigator.vibrate) try { navigator.vibrate(60) } catch (e) {}
          emit('crash'); crashT = 0;
        }
      } else if (phase === 'crash') {
        crashT += fdt;
        if (crashT >= 1.35) {
          const sc = sim.state.score; const isBest = sc > best; best = Math.max(best, sc);
          emit('over');
          if (opts.onEnd) opts.onEnd({ gameId: S.GAME_ID, version: S.VERSION, seed, jumps: jumps.slice(), score: sc, ticks: sim.state.tick, seconds: sim.state.tick * DT, pauses, best, isBest });
        }
      }
      draw();
      if (phase === 'play' || phase === 'countdown' || phase === 'crash' || phase === 'over' && crashT < 4) { crashT += phase === 'over' ? fdt : 0; raf = requestAnimationFrame(loop) }
    }

    function draw() {
      c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      const st = sim ? sim.state : null;
      const dist = st ? st.dist : 0;
      background(c, dist, performance.now() / 1000);
      if (!st) { drawHero(c, HERO.x + HERO.w / 2, GROUND, 0, 'run', 0); return }
      // obstacles (the one we hit flies away during the crash)
      for (const o of st.obstacles) {
        if (crashFrom && o === st.hit) {
          const k = Math.min(1, crashT / 0.9);
          drawObstacle(c, o, o.x + k * 160, GROUND - k * 120 + k * k * 140, k * 7);
        } else drawObstacle(c, o, o.x, GROUND, 0);
      }
      // hero
      const hx = HERO.x + HERO.w / 2;
      if (phase === 'crash' || phase === 'over') {
        const k = Math.min(1, crashT / 0.75);
        if (k < 1) { // tumble: forward roll over the obstacle
          c.save(); const px = hx + k * 70, py = GROUND - st.y - Math.sin(k * Math.PI) * 55;
          c.translate(px, py - 30); c.rotate(k * Math.PI * 2.2); c.translate(-px, -(py - 30));
          drawHero(c, px, py, 0, 'jump', 0); c.restore();
        } else { // on the ground, sitting up dazed with a black eye
          drawHero(c, hx + 70, GROUND, 0, 'down', performance.now() / 1000);
        }
      } else {
        drawHero(c, hx, GROUND - st.y, runPhase, st.grounded ? 'run' : 'jump', 0);
      }
      // score (digits only — no language)
      c.fillStyle = '#fff'; c.font = '900 26px ui-monospace,Menlo,Consolas,monospace'; c.textAlign = 'right';
      c.fillText(String(st.score).padStart(5, '0'), W - 18, 38);
      if (best) { c.fillStyle = 'rgba(255,255,255,.45)'; c.font = '800 13px ui-monospace,Menlo,Consolas,monospace'; c.fillText('HI ' + String(best).padStart(5, '0'), W - 18, 58) }
      if (phase === 'countdown') {
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, W, H);
        c.fillStyle = YELLOW; c.font = '1000 96px system-ui,sans-serif'; c.textAlign = 'center';
        c.fillText(String(Math.ceil(countdownT)), W / 2, H / 2 + 30);
      }
    }

    // controls: tap anywhere on the game, Space / ↑
    const tap = (e) => { if (e.target.closest && e.target.closest('button,a,input')) return; if (phase === 'play') { e.preventDefault(); press() } };
    el.addEventListener('pointerdown', tap, { passive: false });
    const key = (e) => {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp') {
        if (phase === 'play' || phase === 'countdown' || phase === 'paused') e.preventDefault();
        if (!e.repeat) press();
      }
    };
    window.addEventListener('keydown', key);
    // A call, Telegram, another app, another tab: the run stops; it never goes on unseen.
    const vis = () => { if (document.visibilityState === 'hidden') pause() };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', pause);
    window.addEventListener('pagehide', pause);
    const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', fit);
    fit();

    return {
      start, pause, resume, press,
      get phase() { return phase }, get state() { return sim && sim.state }, get jumps() { return jumps.slice() },
      setBest(b) { best = Math.max(0, Number(b) || 0); draw() },
      destroy() { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', vis); window.removeEventListener('blur', pause); window.removeEventListener('pagehide', pause); if (ro) ro.disconnect(); cv.remove() },
    };
  }

  window.RyvokGame = { mount, drawHero };
})();
