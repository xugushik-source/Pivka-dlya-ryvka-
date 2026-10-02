// Order status steps, shared by the store's status card and order.html.
// Получен → Принят → Собран → (30 s) Едет → Доставлен / Отменён; pickup: … → Готов — можно забирать → Забран.
function trackTime(v) {
  return v ? new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tbilisi' }) : ''
}

// Server time now, estimated from the poll answer (the phone clock may be off).
function trackNow(o) {
  return new Date(o.now).getTime() + (Date.now() - o._at)
}

function trackSteps(o) {
  const pickup = o.fulfillment === 'pickup';
  const goAt = o.ready_at ? new Date(o.ready_at).getTime() + 30e3 : null; // «Едет» comes 30 s after «Собран»
  const going = goAt && trackNow(o) >= goAt;
  const steps = pickup ?
    [['Получен', o.created_at], ['Принят', o.confirmed_at], ['Готов — можно забирать', o.ready_at], ['Забран', o.delivered_at]] :
    [['Получен', o.created_at], ['Принят', o.confirmed_at], ['Собран', o.ready_at], ['Едет', going ? goAt : null], ['Доставлен', o.delivered_at]];
  if (o.status === 'CANCELLED' || o.status === 'REFUNDED') {
    return steps.filter(s => s[1]).map(s => [s[0], s[1], 'done']).concat([['Отменён', o.cancelled_at, 'cancel']])
  }
  const cur = {
    NEW: 0,
    CONFIRMED: 1,
    PREPARING: 1,
    OUT_FOR_DELIVERY: !pickup && going ? 3 : 2,
    DELIVERED: steps.length - 1
  } [o.status] ?? 0;
  const done = o.status === 'DELIVERED';
  return steps.map((s, i) => [s[0], i <= cur ? s[1] : null, i < cur || done ? 'done' : i === cur ? 'now' : ''])
}
