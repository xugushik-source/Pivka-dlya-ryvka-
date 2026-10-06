// Order status steps, shared by the store's status card and order.html.
// Получен → Принят → Собран (courier «📦 Собран») → Едет (courier «🛵 Еду») → Доставлен / Отменён;
// pickup: … → Готов — можно забирать → Забран.
function trackTime(v) {
  return v ? new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tbilisi' }) : ''
}

// Server time now, estimated from the poll answer (the phone clock may be off).
function trackNow(o) {
  return new Date(o.now).getTime() + (Date.now() - o._at)
}

function trackSteps(o) {
  const pickup = o.fulfillment === 'pickup';
  const doneAt = o.delivered_at ? new Date(o.delivered_at).getTime() : null;
  // «Едет» = the courier pressed «Еду» (departed_at). Orders from before that button have no departed_at:
  // for them «Едет» came 30 s after «Собран», at the latest on delivery.
  const legacy = !o.departed_at && o.ready_at && o.ready_at < '2026-10-06T09:45' && o.status !== 'PREPARING';
  const goAt = o.departed_at ? new Date(o.departed_at).getTime()
    : legacy ? Math.min(new Date(o.ready_at).getTime() + 30e3, doneAt || Infinity) : null;
  const going = goAt && (doneAt || (o.cancelled_at ? new Date(o.cancelled_at).getTime() : trackNow(o)) >= goAt);
  const steps = pickup ?
    [['Получен', o.created_at], ['Принят', o.confirmed_at], ['Готов — можно забирать', o.ready_at], ['Забран', o.delivered_at]] :
    [['Получен', o.created_at], ['Принят', o.confirmed_at], ['Собран', o.ready_at], ['Едет', going ? goAt : null], ['Доставлен', o.delivered_at]];
  if (o.status === 'CANCELLED' || o.status === 'REFUNDED') {
    return steps.filter(s => s[1]).map(s => [s[0], s[1], 'done']).concat([['Отменён', o.cancelled_at, 'cancel']])
  }
  const cur = {
    NEW: 0,
    CONFIRMED: 1,
    PREPARING: 2,
    OUT_FOR_DELIVERY: !pickup && going ? 3 : 2,
    DELIVERED: steps.length - 1
  } [o.status] ?? 0;
  const done = o.status === 'DELIVERED';
  return steps.map((s, i) => [s[0], i <= cur ? s[1] : null, i < cur || done ? 'done' : i === cur ? 'now' : ''])
}

// «Рывок» game in the order card: only once the courier has left («Еду») and while the order still has attempts.
// Any failure (network, no season) just hides the block — the order card and the shop never depend on it.
const RYVOK_GAME = 'ryvok-runner-01';
const ryvokCache = {};
function ryvokEligible(o) {
  return !!o && ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(o.status);
}
async function ryvokState(orderId, maxAgeMs = 30e3) {
  const c = ryvokCache[orderId];
  if (c && Date.now() - c.at < maxAgeMs) return c.v;
  let v = null;
  try {
    const cfg = window.PIVKA_CONFIG || {};
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(cfg.supabaseUrl + '/functions/v1/game-run', { method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey || '' }, body: JSON.stringify({ action: 'state', order: orderId }) });
    clearTimeout(to);
    const j = await r.json();
    if (j && j.mine && !j.mine.error && j.season) v = { left: j.mine.left, best: j.mine.best, season: j.season };
  } catch (e) {}
  ryvokCache[orderId] = { at: Date.now(), v };
  return v;
}
function ryvokBlock(orderId, g, lang) {
  if (!g || !(g.left > 0)) return '';
  const p = g.season.prizeTitle || {};
  const prize = p[lang] || p.ru || '';
  const esc2 = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return '<div class="ryvokCard"><b>🎮 Пока везём — сделай рывок!</b>' +
    (prize ? '<div><span>Приз месяца:</span> <span class="ryvokPrize" translate="no">' + esc2(prize) + '</span></div>' : '') +
    '<div><span>Осталось попыток:</span> <b>' + Number(g.left) + '</b></div>' +
    '<a class="ryvokPlay" href="./game/ryvok/?o=' + encodeURIComponent(orderId) + '">Играть →</a></div>';
}
