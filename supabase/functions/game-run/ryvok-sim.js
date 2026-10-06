/* «РЫВОК» — deterministic runner simulation (gameId: ryvok-runner-01).
   Own implementation; Dino Dash (emjay045/browser-games, no license) was used only as a gameplay reference.

   Pure logic, no DOM: the same file runs in the browser and on the server, so an official score is never taken from
   the browser — the server replays the run from the seed and the list of jump ticks and computes the score itself.

   World is normalized (640 × 400 units, ground at y = 330) and does not depend on the screen: a wide desktop sees
   exactly as far ahead as a phone. Physics runs in fixed 1/120 s ticks, so 60/120/144 Hz screens play the same game. */
(function (root) {
  'use strict';
  const GAME_ID = 'ryvok-runner-01';
  const VERSION = 1;
  const TPS = 120;                 // ticks per second (fixed step)
  const DT = 1 / TPS;
  const W = 640, H = 400, GROUND = 330;
  const HERO = { x: 92, w: 34, h: 58 };
  const GRAVITY = 2500;            // units / s²
  const JUMP_V = 880;              // units / s  → apex ≈ 155, air time ≈ 0.70 s
  const SPEED0 = 260, SPEED_MAX = 640, ACCEL = 6;   // units / s, + ACCEL every second
  const BUFFER = Math.round(0.12 * TPS);  // a tap up to 0.12 s before landing still jumps
  const SCORE_DIV = 8;             // score = distance / 8  (≈ 32 points a second at the start)

  // Obstacles: size of the hit box (units) and the second from which they may appear.
  const KINDS = {
    mugS:   { w: 26, h: 30, from: 0 },     // small beer mug
    botS:   { w: 17, h: 44, from: 0 },     // small bottle
    mugL:   { w: 38, h: 46, from: 9 },     // big mug
    botT:   { w: 19, h: 68, from: 18 },    // tall bottle
    multi:  { w: 52, h: 56, from: 30 },    // two or three bottles
    combo:  { w: 62, h: 62, from: 45 },    // mug + bottle
  };

  // mulberry32; the state lives in `box.a` so a whole run state can be copied (testing bot, server replays)
  function rng(seed, box) {
    box = box || { a: seed >>> 0 };
    return function () {
      box.a = (box.a + 0x6D2B79F5) >>> 0;
      let t = box.a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(seed, from) {
    const s = from ? JSON.parse(JSON.stringify(from)) : {
      rs: { a: seed >>> 0 },
      tick: 0, t: 0, speed: SPEED0, dist: 0, score: 0,
      y: 0, vy: 0, grounded: true, landedAt: 0, buffer: -1,
      obstacles: [], nextGap: 380, over: false, hit: null, jumps: 0,
    };
    const rand = rng(seed, s.rs);
    function pickKind() {
      const ok = Object.entries(KINDS).filter(([, k]) => s.t >= k.from);
      // later kinds get more weight as the run goes on
      const weights = ok.map(([n, k]) => 1 + Math.max(0, (s.t - k.from) / 25));
      let r = rand() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < ok.length; i++) { r -= weights[i]; if (r <= 0) return ok[i][0] }
      return ok[ok.length - 1][0];
    }
    function spawn() {
      const kind = pickKind();
      const k = KINDS[kind];
      const variant = Math.floor(rand() * 3);
      s.obstacles.push({ kind, x: W + 20, w: k.w, h: k.h, variant, id: s.tick });
      // Gap to the next one: always enough to land and jump again at this speed (never impossible).
      const air = (2 * JUMP_V) / GRAVITY;          // seconds in the air
      const minGap = s.speed * air * 1.15 + 130 + k.w;
      const extra = s.speed * (0.25 + rand() * (s.t < 10 ? 1.4 : s.t < 40 ? 1.0 : 0.75));
      s.nextGap = minGap + extra;
    }
    function jumpNow() { s.vy = JUMP_V; s.grounded = false; s.jumps++; s.buffer = -1 }

    // One fixed step. `press` = the jump button went down during this tick.
    function step(press) {
      if (s.over) return s;
      s.tick++; s.t = s.tick * DT;
      if (press) {
        if (s.grounded) jumpNow();
        else s.buffer = s.tick;
      }
      // physics
      if (!s.grounded) {
        s.vy -= GRAVITY * DT;
        s.y += s.vy * DT;
        if (s.y <= 0) {
          s.y = 0; s.vy = 0; s.grounded = true; s.landedAt = s.tick;
          if (s.buffer >= 0 && s.tick - s.buffer <= BUFFER) jumpNow();
          s.buffer = -1;
        }
      }
      s.speed = Math.min(SPEED_MAX, SPEED0 + ACCEL * s.t);
      const dx = s.speed * DT;
      s.dist += dx;
      s.score = Math.floor(s.dist / SCORE_DIV);
      for (const o of s.obstacles) o.x -= dx;
      while (s.obstacles.length && s.obstacles[0].x + s.obstacles[0].w < -40) s.obstacles.shift();
      const last = s.obstacles[s.obstacles.length - 1];
      if (!last || last.x < W + 20 - s.nextGap) spawn();
      // collision: slightly forgiving boxes
      const hx1 = HERO.x + 6, hx2 = HERO.x + HERO.w - 6, hb = s.y + 3;
      for (const o of s.obstacles) {
        if (o.x + 3 < hx2 && o.x + o.w - 3 > hx1 && hb < o.h - 3) { s.over = true; s.hit = o; break }
      }
      return s;
    }
    return { state: s, step, fork: () => create(seed, s) };
  }

  // Server-side check: replay a run from the seed and the jump ticks. Returns the true score and end tick,
  // or an error if the inputs are impossible (out of order, after the end, more than the run allows…).
  function replay(seed, jumps, opts) {
    const maxTicks = (opts && opts.maxTicks) || TPS * 60 * 15; // 15 minutes hard cap
    const list = Array.isArray(jumps) ? jumps : [];
    if (list.length > 20000) return { ok: false, error: 'too_many_inputs' };
    for (let i = 0; i < list.length; i++) {
      if (!Number.isInteger(list[i]) || list[i] < 1 || (i && list[i] <= list[i - 1])) return { ok: false, error: 'bad_inputs' };
    }
    const g = create(seed);
    let j = 0;
    while (!g.state.over && g.state.tick < maxTicks) {
      const next = g.state.tick + 1;
      let press = false;
      while (j < list.length && list[j] === next) { press = true; j++ }
      g.step(press);
    }
    if (j < list.length) return { ok: false, error: 'inputs_after_end', score: g.state.score, ticks: g.state.tick };
    return { ok: true, score: g.state.score, ticks: g.state.tick, seconds: g.state.tick / TPS, over: g.state.over, jumps: g.state.jumps };
  }

  root.RyvokSim = { GAME_ID, VERSION, TPS, DT, W, H, GROUND, HERO, KINDS, create, replay, rng };
})(typeof globalThis !== 'undefined' ? globalThis : this);
