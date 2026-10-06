// «РЫВОК» championship server. The browser never sends a score that is trusted:
//   start  → checks the order and its 3 attempts, picks the seed itself, returns a run token;
//   finish → replays seed + jump ticks with the same simulation the browser runs (ryvok-sim.js, a byte copy of
//            js/game/ryvok-sim.js) and stores the server's score — or rejects the run with a reason;
//   state  → attempts left, own best, season (prize from config) and the board (name, place, score only).
// Guards: allowed origins; one result per run; a run cannot be played faster than real time or last longer than
// MAX_RUN_MINUTES; 30 starts an hour per network (in SQL); impossible inputs are rejected by replay().
// Deployed with verify_jwt = false (called with the public anon key only).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import "./ryvok-sim.js";

// deno-lint-ignore no-explicit-any
const Sim = (globalThis as any).RyvokSim;
const MAX_RUN_MINUTES = 30;
const ALLOWED = [
  /^https:\/\/(www\.)?pivkadlaryvka\.ge$/,
  /^https:\/\/xugushik-source\.github\.io$/,
  /^https:\/\/raw\.githack\.com$/,
  /^https:\/\/rawcdn\.githack\.com$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (origin: string, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

async function ipHash(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
  if (!ip) return null;
  const salt = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").slice(-16);
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ip));
  return Array.from(new Uint8Array(d).slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(fn + ": " + error.message);
  return data;
}

async function state(order: string | null) {
  const [mine, board] = await Promise.all([
    order ? rpc("game_order_state", { p_game: Sim.GAME_ID, p_order: order }) : Promise.resolve(null),
    rpc("game_leaderboard", { p_game: Sim.GAME_ID, p_order: order, p_limit: 10 }),
  ]);
  return { gameId: Sim.GAME_ID, version: Sim.VERSION, mine, ...board };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED.some((r) => r.test(origin))) return json("", { error: "origin" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json(origin, { error: "method" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json() } catch { return json(origin, { error: "body" }, 400) }
  const action = String(body.action || "");
  const order = typeof body.order === "string" && UUID.test(body.order) ? body.order : null;

  try {
    if (action === "state") return json(origin, await state(order));

    if (action === "start") {
      if (!order) return json(origin, { error: "order" }, 400);
      if (Number(body.version) !== Sim.VERSION) return json(origin, { error: "version" }, 409);
      const nickname = typeof body.nickname === "string" ? body.nickname.slice(0, 32) : null;
      const r = await rpc("game_start_run", { p_game: Sim.GAME_ID, p_version: Sim.VERSION, p_order: order, p_nickname: nickname, p_ip_hash: await ipHash(req) });
      return json(origin, r, r.error ? 409 : 200);
    }

    if (action === "finish") {
      const run = typeof body.run === "string" && UUID.test(body.run) ? body.run : null;
      if (!run) return json(origin, { error: "run" }, 400);
      const r = await rpc("game_get_run", { p_run: run });
      if (!r) return json(origin, { error: "run" }, 404);
      if (r.status !== "started") return json(origin, { error: "state" }, 409);
      const jumps = Array.isArray(body.jumps) ? body.jumps : [];
      const clientScore = Number.isInteger(body.score) ? Number(body.score) : -1;
      const pauses = Math.max(0, Math.min(1000, Number(body.pauses) || 0));
      const elapsed = (Date.parse(r.now) - Date.parse(r.started_at)) / 1000;

      let ok = true, reason: string | null = null;
      // never replay more ticks than real time allows (+2 s for network)
      const maxTicks = Math.min(Sim.TPS * 60 * MAX_RUN_MINUTES, Math.ceil((elapsed + 2) * Sim.TPS));
      const rp = r.version === Sim.VERSION ? Sim.replay(Number(r.seed), jumps, { maxTicks }) : { ok: false, error: "version" };
      if (!rp.ok) { ok = false; reason = rp.error || "replay" }
      else if (!rp.over) { ok = false; reason = elapsed > MAX_RUN_MINUTES * 60 ? "expired" : "too_fast" } // the claimed crash is not reachable in the real time that passed
      else if (rp.score !== clientScore) { ok = false; reason = "mismatch" }
      else if (elapsed + 2 < rp.seconds) { ok = false; reason = "too_fast" }

      const saved = await rpc("game_finish_run", {
        p_run: run, p_ok: ok, p_score: ok ? rp.score : null, p_client_score: clientScore,
        p_ticks: rp.ticks ?? null, p_jumps: Array.isArray(jumps) ? jumps.length : 0, p_pauses: pauses, p_reason: reason,
      });
      if (saved.error) return json(origin, saved, 409);
      return json(origin, { ok, score: ok ? rp.score : null, reason, ...(await state(saved.order_id)) });
    }

    return json(origin, { error: "action" }, 400);
  } catch (e) {
    console.error(e);
    return json(origin, { error: "server" }, 500);
  }
});
