// Telegram bot for «Пивка для рывка».
// Three kinds of callers, each with its own check (the function is deployed with verify_jwt = false):
//   1. Telegram webhook      — header X-Telegram-Bot-Api-Secret-Token = vault tg_webhook_secret
//   2. The database (pg_net) — header x-internal-secret                = vault tg_internal_secret
//   3. Admin panel           — Authorization: Bearer <staff JWT>, OWNER/ADMIN only
//   4. Order edit page opened from the bot — Telegram Mini App initData, signed with the bot token
// Couriers press buttons; every action goes through the database function tg_courier, which identifies the
// courier by his Telegram chat and checks the order state — the message text is never trusted.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SELF_URL = "https://uphnuzgaildmjrttmbaq.supabase.co/functions/v1/telegram";
const SITE_URL = "https://xugushik-source.github.io/Pivka-dlya-ryvka-/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Cfg = { token: string | null; internal: string; webhook: string };
async function config(): Promise<Cfg> {
  const { data, error } = await db.rpc("tg_config");
  if (error) throw error;
  return data as Cfg;
}

async function tg(cfg: Cfg, method: string, payload: Record<string, unknown>) {
  if (!cfg.token) throw new Error("Токен бота не задан");
  const r = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.ok) {
    if (String(j.description || "").includes("message is not modified")) return null;
    throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  }
  return j.result;
}
const quiet = async (p: Promise<unknown>) => { try { await p; } catch (e) { console.error(e); } };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const money = (n: unknown) => Number(n || 0).toFixed(2).replace(/\.00$/, "") + " ₾";
const qty = (q: unknown, unit: string) => unit === "liter" ? `${Number(q)} л` : `${Number(q)} шт`;
const time = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Tbilisi", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit" }) : "";
const PAY: Record<string, string> = { CASH: "💵 наличные", CARD: "💳 безнал", TRANSFER: "📲 перевод" };

// ---------- Order data

async function loadOrder(orderId: string) {
  const { data: o, error } = await db.from("orders")
    .select("id,order_number,status,fulfillment_type,address_snapshot,payment_method,discount_total,delivery_fee,total,comment," +
      "created_at,confirmed_at,ready_at,delivered_at,cancellation_reason,city_id,from_stock," +
      "customers(full_name,phone),service_cities(name),delivery_zones(name)," +
      "order_items(name_snapshot,quantity,unit_snapshot,unit_price_snapshot,line_total,is_gift,supplier_id,supplier_cost_snapshot,products(prep_minutes,prep_batch))," +
      "delivery_assignments(driver_id,drivers(name)),order_collections(method,created_at)," +
      "supplier_order_groups(supplier_id,status,ready_at,missing_note,suppliers(name))")
    .eq("id", orderId).single();
  if (error) throw error;
  const a: any = Array.isArray((o as any).delivery_assignments) ? (o as any).delivery_assignments[0] : (o as any).delivery_assignments;
  const cols: any[] = ((o as any).order_collections || []).sort((x: any, y: any) => String(y.created_at).localeCompare(String(x.created_at)));
  return { ...(o as any), driverId: a?.driver_id || null, driverName: a?.drivers?.name || null, paidWith: cols[0]?.method || null };
}

function orderBody(o: any) {
  const items = (o.order_items || []) as any[];
  const delivery = o.fulfillment_type === "delivery";
  const c = o.customers || {};
  return [
    `📍 ${esc(o.service_cities?.name || "")} · ${delivery ? "🚗 Доставка" : "🏪 Самовывоз"}`,
    `👤 ${esc(c.full_name || "Без имени")} · ${esc(c.phone || "")}`,
    delivery ? `🏠 ${esc(o.address_snapshot || "—")}${o.delivery_zones?.name ? " · " + esc(o.delivery_zones.name) : ""}` : null,
    "",
    ...items.filter((i) => !i.is_gift).map((i) =>
      `• ${esc(i.name_snapshot)} — ${qty(i.quantity, i.unit_snapshot)} × ${money(i.unit_price_snapshot)} = <b>${money(i.line_total)}</b>`),
    ...items.filter((i) => i.is_gift).map((i) => `🎁 ${esc(i.name_snapshot)} — ${qty(i.quantity, i.unit_snapshot)} (подарок)`),
    "",
    Number(o.discount_total) > 0 ? `Скидка рывка: −${money(o.discount_total)}` : null,
    delivery ? `Доставка: ${money(o.delivery_fee)}` : null,
    `<b>Итого: ${money(o.total)}</b> · ${o.payment_method === "transfer" ? "📲 Переводом" : "💵 Наличными"}`,
    o.comment ? `💬 ${esc(o.comment)}` : null,
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function statusLine(o: any) {
  const who = o.driverName ? ` · ${esc(o.driverName)}` : "";
  switch (o.status) {
    case "NEW": return o.driverName ? `🙋 Взял ${esc(o.driverName)} — звонит клиенту` : (o.fulfillment_type === "delivery" ? "⏳ Ждёт курьера" : "⏳ Новый");
    case "CONFIRMED": return `✅ Принят ${hm(o.confirmed_at)}${who}`;
    case "PREPARING": return `📦 Собран ${hm(o.ready_at)}${who}`;
    case "OUT_FOR_DELIVERY": return `🚗 Едет с ${hm(o.ready_at)}${who}`;
    case "DELIVERED": return `🎉 Доставлен ${hm(o.delivered_at)}${who}${o.paidWith ? " · " + PAY[o.paidWith] : ""}`;
    case "CANCELLED": return `❌ Отменён${o.cancellation_reason ? ": " + esc(o.cancellation_reason) : ""}`;
    default: return esc(o.status);
  }
}

// «Поставщики: Давид ✅ · Кристалл ⏳ (нет: Сиг)» once the order is accepted.
function suppliersLine(o: any) {
  const gs = (o.supplier_order_groups || []) as any[];
  if (!gs.length || !["CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY"].includes(o.status)) return "";
  return "\n<b>Поставщики:</b> " + gs.map((g) => `${esc(g.suppliers?.name || "")} ${g.status === "READY" || g.status === "PICKED_UP" ? "✅" : "⏳"}` +
    (g.missing_note ? ` (нет: ${esc(g.missing_note)})` : "")).join(" · ");
}
// «✏️ Изменить заказ» opens the edit page inside Telegram (Mini App); allowed until «Собран».
const editable = (o: any) => ["NEW", "CONFIRMED", "PREPARING"].includes(o.status);
const editButton = (o: any) => ({ text: "✏️ Изменить заказ", web_app: { url: `${SITE_URL}edit.html?o=${o.id}` } });
const ocb = (act: string, id: string, arg = "") => `o|${act}|${id}${arg ? "|" + arg : ""}`;
const cancellable = (o: any) => ["NEW", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY"].includes(o.status);
const ownerKeyboard = (o: any) => ({
  inline_keyboard: [
    ...(editable(o) ? [[editButton(o)]] : []),
    ...(cancellable(o) ? [[{ text: "❌ Отменить заказ", callback_data: ocb("cm", o.id) }]] : []),
  ],
});
const ownerReasonsKeyboard = (id: string) => ({
  inline_keyboard: [
    [{ text: "Передумал", callback_data: ocb("cancel", id, "mind") }, { text: "Нет денег", callback_data: ocb("cancel", id, "money") }],
    [{ text: "Нет товара", callback_data: ocb("cancel", id, "stock") }, { text: "Не дозвонились", callback_data: ocb("cancel", id, "noanswer") }],
    [{ text: "Тестовый заказ", callback_data: ocb("cancel", id, "test") }, { text: "Другое", callback_data: ocb("cancel", id, "other") }],
    [{ text: "← Назад, не отменять", callback_data: ocb("bk", id) }],
  ],
});
// Night order (23:00–11:00): the goods come from the owner's own stock, suppliers get nothing.
const stockLine = (o: any) => o.from_stock ? "\n🏠 <b>Ночной заказ — со склада.</b> Товар берёшь на складе, поставщикам ничего не уходит." : "";
const ownerText = (o: any) => `🍺 <b>Заказ №${o.order_number}</b> · ${time(o.created_at)}\n${orderBody(o)}\n\n<b>Статус:</b> ${statusLine(o)}${suppliersLine(o)}${foodLine(o)}${stockLine(o)}`;

const offerText = (o: any) => {
  const n = (o.order_items || []).filter((i: any) => !i.is_gift).length;
  return `🆕 <b>Новый заказ №${o.order_number}</b> · ${hm(o.created_at)}\n📍 ${esc(o.service_cities?.name || "")}` +
    `${o.delivery_zones?.name ? " · " + esc(o.delivery_zones.name) : ""}\n🏠 ${esc(o.address_snapshot || "—")}\n` +
    `${n} поз. · <b>${money(o.total)}</b>${o.from_stock ? "\n🏠 Со склада" : ""}${hasHotFood(o) ? "\n🍕 С горячей едой (~" + prepMinutes(o) + " мин)" : ""}\n\nКто возьмёт — звонит клиенту и подтверждает заказ.`;
};

const HINT: Record<string, string> = {
  NEW: "📞 Позвоните клиенту, уточните заказ и адрес. Клиент что-то меняет — «✏️ Изменить заказ». Всё верно — «Принят».",
  CONFIRMED: "Заберите заказ и нажмите «📦 Собран».",
  CONFIRMED_STOCK: "Возьмите товар на складе и нажмите «📦 Собран».",
  PREPARING: "Выезжаете к клиенту — нажмите «🛵 Еду»: клиент увидит, что заказ едет.",
  OUT_FOR_DELIVERY: "Отдали заказ? Выберите, как клиент заплатил:",
};
const cardText = (o: any) =>
  `🛵 <b>Заказ №${o.order_number}</b> · ${time(o.created_at)}\n${orderBody(o)}\n\n<b>Статус:</b> ${statusLine(o)}${suppliersLine(o)}${foodLine(o)}${stockLine(o)}` +
  ((o.from_stock && HINT[o.status + "_STOCK"]) || HINT[o.status] ? `\n\n${(o.from_stock && HINT[o.status + "_STOCK"]) || HINT[o.status]}` : "");

const cb = (act: string, id: string, arg = "") => `c|${act}|${id}${arg ? "|" + arg : ""}`;
function cardKeyboard(o: any) {
  const rows: any[] = [];
  if (o.fulfillment_type === "delivery" && o.address_snapshot && ["NEW", "CONFIRMED", "OUT_FOR_DELIVERY"].includes(o.status)) {
    rows.push([{ text: "🗺 Открыть на карте", url: "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(o.address_snapshot + ", " + (o.service_cities?.name || "")) }]);
  }
  if (o.status === "NEW") rows.push([{ text: "✅ Клиент подтвердил — Принят", callback_data: cb("accept", o.id) }]);
  if (o.status === "CONFIRMED") rows.push([{ text: "📦 Собран — забрал заказ", callback_data: cb("ready", o.id) }]);
  if (o.status === "PREPARING") rows.push([{ text: "🛵 Еду", callback_data: cb("go", o.id) }]);
  if (editable(o)) rows.push([editButton(o)]);
  if (o.status === "OUT_FOR_DELIVERY") rows.push([
    { text: "💵 Наличные", callback_data: cb("deliver", o.id, "cash") },
    { text: "💳 Безнал", callback_data: cb("deliver", o.id, "card") },
    { text: "📲 Перевод", callback_data: cb("deliver", o.id, "transfer") },
  ]);
  if (cancellable(o)) rows.push([{ text: "❌ Отменить заказ", callback_data: cb("cm", o.id) }]);
  return { inline_keyboard: rows };
}
const reasonsKeyboard = (id: string) => ({
  inline_keyboard: [
    [{ text: "Передумал", callback_data: cb("cancel", id, "mind") }, { text: "Нет денег", callback_data: cb("cancel", id, "money") }],
    [{ text: "Нет товара", callback_data: cb("cancel", id, "stock") }, { text: "Не дозвонились", callback_data: cb("cancel", id, "noanswer") }],
    [{ text: "Другое", callback_data: cb("cancel", id, "other") }],
    [{ text: "← Назад, не отменять", callback_data: cb("bk", id) }],
  ],
});

// ---------- Sending

async function linksOf(kind: string) {
  const { data } = await db.from("telegram_links").select("chat_id,ref_id").eq("kind", kind).eq("active", true).not("chat_id", "is", null);
  return data || [];
}

async function sendToKind(cfg: Cfg, kind: string, text: string) {
  let sent = 0;
  for (const l of await linksOf(kind)) {
    try { await tg(cfg, "sendMessage", { chat_id: l.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }); sent++; }
    catch (e) { console.error("send failed", l.chat_id, e); }
  }
  return sent;
}

async function remember(orderId: string, chat: number, message: number, kind: string) {
  await db.from("telegram_messages").insert({ order_id: orderId, chat_id: chat, message_id: message, kind });
}

async function cityDrivers(cityId: string) {
  const links = await linksOf("DRIVER");
  if (!links.length) return [];
  const { data: drivers } = await db.from("drivers").select("id").eq("active", true).eq("city_id", cityId);
  const ids = new Set((drivers || []).map((d: any) => d.id));
  return links.filter((l: any) => ids.has(l.ref_id));
}

async function onOrderCreated(cfg: Cfg, orderId: string) {
  const o = await loadOrder(orderId);
  let sent = 0;
  for (const l of await linksOf("OWNER")) {
    try {
      const m = await tg(cfg, "sendMessage", { chat_id: l.chat_id, text: ownerText(o), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: ownerKeyboard(o) });
      await remember(o.id, l.chat_id, m.message_id, "OWNER_NEW"); sent++;
    } catch (e) { console.error(e); }
  }
  if (o.fulfillment_type === "delivery" && o.status === "NEW") {
    for (const l of await cityDrivers(o.city_id)) {
      try {
        const m = await tg(cfg, "sendMessage", {
          chat_id: l.chat_id, text: offerText(o), parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "🙋 Беру", callback_data: cb("take", o.id) }]] },
        });
        await remember(o.id, l.chat_id, m.message_id, "DRIVER_OFFER"); sent++;
      } catch (e) { console.error(e); }
    }
  }
  return sent;
}

// Owner's copy of the order keeps a live status line.
async function refreshOwner(cfg: Cfg, o: any) {
  const { data: msgs } = await db.from("telegram_messages").select("chat_id,message_id").eq("order_id", o.id).eq("kind", "OWNER_NEW");
  for (const m of msgs || []) {
    await quiet(tg(cfg, "editMessageText", { chat_id: m.chat_id, message_id: m.message_id, text: ownerText(o), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: ownerKeyboard(o) }));
  }
}

async function onRemind(cfg: Cfg, orderId: string) {
  const o = await loadOrder(orderId);
  if (o.status !== "NEW") return 0;
  const drivers = await cityDrivers(o.city_id);
  const why = o.driverName ? `${esc(o.driverName)} взял его, но ещё не подтвердил (не позвонил клиенту?)`
    : drivers.length ? "никто из курьеров не взял" : "в этом городе нет курьеров, подключённых к боту";
  return await sendToKind(cfg, "OWNER", `⏰ <b>Заказ №${o.order_number}</b> ждёт уже 5 минут: ${why}.\n` +
    `👤 ${esc(o.customers?.full_name || "")} · ${esc(o.customers?.phone || "")} · ${money(o.total)}`);
}

// ---------- Suppliers: only their own lines, at purchase price, no customer data.

// One order = one trip: everything is picked up together when the hot food is ready.
// products.prep_minutes / prep_batch = Мндо's oven: one oven, a ~15 min load holds 2 pizzas/khachapuri OR 5 lahmajo;
// loads go one after another (2 pizzas + 2 lahmajo = 30 min). Every supplier of the order is told the same, longest time.
const basePrep = (o: any) => o.fulfillment_type === "delivery" ? 5 : 10;
function foodMinutes(items: any[]) {
  const g = new Map<string, { prep: number; batch: number; q: number }>();
  for (const i of items) {
    const prep = Number(i.products?.prep_minutes) || 0;
    if (!prep) continue;
    const batch = Number(i.products?.prep_batch) || 0, k = prep + "|" + batch;
    const x = g.get(k) || { prep, batch, q: 0 };
    x.q += Number(i.quantity) || 0;
    g.set(k, x);
  }
  let t = 0;
  for (const x of g.values()) t += x.batch ? Math.ceil(x.q / x.batch) * x.prep : x.prep;
  return t;
}
const prepMinutes = (o: any) => Math.max(basePrep(o), foodMinutes(o.order_items || []));
const ownPrep = (o: any, supplierId: string) => Math.max(basePrep(o), foodMinutes(supplierItems(o, supplierId)));
const hasHotFood = (o: any) => foodMinutes(o.order_items || []) > 0;
const pickupAt = (o: any) => new Date(new Date(o.confirmed_at || o.created_at).getTime() + prepMinutes(o) * 60000).toISOString();
// Courier / owner: when the food is ready and in which order to collect.
const foodLine = (o: any) => hasHotFood(o) && ["NEW", "CONFIRMED"].includes(o.status)
  ? `\n🍕 <b>Горячая еда${o.confirmed_at ? " будет готова к " + hm(pickupAt(o)) : " готовится ~" + prepMinutes(o) + " мин"}</b> — сначала забери напитки, еду последней, чтобы привезти всё вместе и горячим.`
  : "";
function supplierItems(o: any, supplierId: string) {
  return ((o.order_items || []) as any[]).filter((i) => i.supplier_id === supplierId)
    .sort((a, b) => Number(a.is_gift) - Number(b.is_gift) || String(a.name_snapshot).localeCompare(String(b.name_snapshot)));
}
function supplierText(o: any, supplierId: string) {
  const items = supplierItems(o, supplierId);
  const due = pickupAt(o);
  const hot = hasHotFood(o), mine = ownPrep(o, supplierId), slowest = mine >= prepMinutes(o);
  const sum = items.reduce((t, i) => t + Number(i.supplier_cost_snapshot || 0) * Number(i.quantity), 0);
  const g = ((o.supplier_order_groups || []) as any[]).find((x) => x.supplier_id === supplierId) || {};
  return [
    hot && slowest
      ? `🔥 <b>Заказ №${o.order_number}</b> · готовить сразу, курьер заберёт горячим к ${hm(due)}`
      : `📦 <b>Заказ №${o.order_number}</b> · подготовить к ${hm(due)}${hot ? "" : ` (${prepMinutes(o)} мин)`}`,
    hot && !slowest ? `🍕 В заказе горячая еда — курьер приедет к ${hm(due)}. Подготовьте к этому времени, пиво держите в холоде.` : null,
    o.fulfillment_type === "delivery" ? `🛵 Заберёт: ${esc(o.driverName || "курьер")}` : "🏪 Самовывоз",
    "",
    ...items.map((i) => `${i.is_gift ? "🎁" : "•"} ${esc(i.name_snapshot)} — ${qty(i.quantity, i.unit_snapshot)} × ${money(i.supplier_cost_snapshot)} = <b>${money(Number(i.supplier_cost_snapshot || 0) * Number(i.quantity))}</b>${i.is_gift ? " (подарок клиенту)" : ""}`),
    "",
    `<b>К оплате вам: ${money(sum)}</b>`,
    g.missing_note ? `⚠️ Нет: ${esc(g.missing_note)}` : null,
    g.status === "READY" ? `✅ Готово ${hm(g.ready_at)}` : null,
  ].filter((l) => l !== null).join("\n");
}
const scb = (act: string, id: string, arg = "") => `s|${act}|${id}${arg !== "" ? "|" + arg : ""}`;
function supplierKeyboard(o: any, supplierId: string) {
  const g = ((o.supplier_order_groups || []) as any[]).find((x) => x.supplier_id === supplierId) || {};
  if (g.status === "READY" || g.status === "CANCELLED" || ["CANCELLED", "DELIVERED", "REFUNDED"].includes(o.status)) return { inline_keyboard: [] };
  return { inline_keyboard: [[{ text: "✅ Готово", callback_data: scb("ready", o.id) }, { text: "⚠️ Чего-то нет", callback_data: scb("miss", o.id) }]] };
}
const missingKeyboard = (o: any, supplierId: string) => ({
  inline_keyboard: [
    ...supplierItems(o, supplierId).map((i, k) => [{ text: `Нет: ${String(i.name_snapshot).slice(0, 40)}`, callback_data: scb("mi", o.id, String(k)) }]),
    [{ text: "← Назад", callback_data: scb("back", o.id) }],
  ],
});

async function chatOf(kind: string, refId: string | null) {
  if (!refId) return null;
  const { data } = await db.from("telegram_links").select("chat_id").eq("kind", kind).eq("ref_id", refId).eq("active", true).not("chat_id", "is", null).maybeSingle();
  return data?.chat_id || null;
}

// The courier's card is the offer message he pressed «Беру» on.
async function refreshCourier(cfg: Cfg, o: any) {
  const chat = await chatOf("DRIVER", o.driverId);
  if (!chat) return;
  const { data: m } = await db.from("telegram_messages").select("message_id").eq("order_id", o.id).eq("kind", "DRIVER_OFFER").eq("chat_id", chat).maybeSingle();
  if (m) await quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: m.message_id, text: cardText(o), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: cardKeyboard(o) }));
}

async function onOrderConfirmed(cfg: Cfg, orderId: string) {
  const o = await loadOrder(orderId);
  let sent = 0;
  for (const g of (o.supplier_order_groups || []) as any[]) {
    const chat = await chatOf("SUPPLIER", g.supplier_id);
    if (chat) {
      try {
        const m = await tg(cfg, "sendMessage", { chat_id: chat, text: supplierText(o, g.supplier_id), parse_mode: "HTML", reply_markup: supplierKeyboard(o, g.supplier_id) });
        await remember(o.id, chat, m.message_id, "SUPPLIER"); sent++;
      } catch (e) { console.error(e); }
    } else {
      await sendToKind(cfg, "OWNER", `⚠️ <b>${esc(g.suppliers?.name || "Поставщик")}</b> не подключён к боту — перешлите ему заказ сами:\n\n` + supplierText(o, g.supplier_id));
    }
  }
  await refreshOwner(cfg, o);
  await refreshCourier(cfg, o);
  return sent;
}

async function onOrderCancelled(cfg: Cfg, orderId: string) {
  const o = await loadOrder(orderId);
  const { data: msgs } = await db.from("telegram_messages").select("chat_id,message_id").eq("order_id", o.id).eq("kind", "SUPPLIER");
  const chats = new Set<number>();
  for (const m of msgs || []) {
    await quiet(tg(cfg, "editMessageText", { chat_id: m.chat_id, message_id: m.message_id, text: `❌ <b>Заказ №${o.order_number} отменён</b> — не готовьте его.`, parse_mode: "HTML" }));
    chats.add(m.chat_id);
  }
  for (const chat of chats) await quiet(tg(cfg, "sendMessage", { chat_id: chat, text: `❌ Заказ №${o.order_number} отменён — не готовьте его.` }));
  await refreshOwner(cfg, o);
  await refreshCourier(cfg, o);
  // Offers to couriers who did not take the order: «Беру» must not stay pressable.
  const driverChat = await chatOf("DRIVER", o.driverId);
  const { data: offers } = await db.from("telegram_messages").select("chat_id,message_id").eq("order_id", o.id).eq("kind", "DRIVER_OFFER");
  for (const m of offers || []) {
    if (m.chat_id === driverChat) continue;
    await quiet(tg(cfg, "editMessageText", { chat_id: m.chat_id, message_id: m.message_id, text: `❌ Заказ №${o.order_number} отменён.` }));
  }
  // Who cancelled is in the reason: «… (владелец)», «… (курьер Имя)», «Клиент отменил на сайте», or admin (no suffix).
  const reason = String(o.cancellation_reason || "");
  const byOwner = reason.endsWith("(владелец)"), byDriver = reason.includes("(курьер ");
  const line = `❌ <b>Заказ №${o.order_number} отменён</b>${reason ? " — " + esc(reason) : ""}\n` +
    `👤 ${esc(o.customers?.full_name || "")} · ${esc(o.customers?.phone || "")} · ${money(o.total)}`;
  if (!byOwner) await sendToKind(cfg, "OWNER", line);
  if (driverChat && !byDriver) await quiet(tg(cfg, "sendMessage", { chat_id: driverChat, text: line, parse_mode: "HTML" }));
  // Poured beer can't go back to the supplier: say who it was written off on.
  const { data: wo } = await db.from("order_writeoffs").select("name,quantity,amount,charged_to").eq("order_id", o.id).eq("reason", "CANCEL");
  if (wo?.length) {
    const sum = wo.reduce((t: number, w: any) => t + Number(w.amount), 0);
    const onDriver = wo[0].charged_to === "DRIVER";
    const text = `🍺 Заказ №${o.order_number} отменён после «Принят» — пиво уже разлито: ` +
      wo.map((w: any) => `${esc(w.name)} ${Number(w.quantity)} л`).join(", ") +
      `.\n<b>${money(sum)}</b> по закупу ${onDriver ? "записано на курьера " + esc(o.driverName || "") : "списано на владельца"}.`;
    await sendToKind(cfg, "OWNER", text);
    if (onDriver && driverChat) await quiet(tg(cfg, "sendMessage", { chat_id: driverChat, text, parse_mode: "HTML" }));
  }
  return chats.size;
}

// The order was changed (customer before «Принят», courier or owner until «Собран»).
// Owner and courier see the new list; after «Принят» only suppliers whose part changed get a new message.
async function onOrderEdited(cfg: Cfg, b: any) {
  const o = await loadOrder(b.order_id);
  await refreshOwner(cfg, o);
  await refreshCourier(cfg, o);
  const who = b.by === "CUSTOMER" ? "Клиент" : b.by === "DRIVER" ? `Курьер ${b.actor || ""}` : (b.actor || "Владелец");
  const sumLine = `Сумма: ${money(b.total_before)} → <b>${money(o.total)}</b>`;
  const wo = Number(b.writeoff) > 0
    ? `\n🍺 Убрали уже разлитое пиво: ${money(b.writeoff)} по закупу — ${b.charged_to === "DRIVER" ? "записано на курьера " + esc(o.driverName || "") : "на владельце"}.`
    : "";
  if (b.by !== "ADMIN") await sendToKind(cfg, "OWNER", `✏️ <b>Заказ №${o.order_number} изменён</b> — ${esc(who)}\n${sumLine}${wo}`);
  if (b.by !== "DRIVER") {
    const chat = await chatOf("DRIVER", o.driverId);
    if (chat) await quiet(tg(cfg, "sendMessage", { chat_id: chat, text: `✏️ ${esc(who)} изменил заказ №${o.order_number} — проверьте состав.\n${sumLine}${wo}`, parse_mode: "HTML" }));
  }
  if (o.status === "NEW" || o.from_stock) return 0; // suppliers haven't got this order yet / night order from the stock
  let sent = 0;
  const removed: string[] = b.removed || [];
  for (const sid of [...new Set<string>([...(b.changed || []), ...removed])]) {
    const gone = removed.includes(sid) || !supplierItems(o, sid).length;
    const g = ((o.supplier_order_groups || []) as any[]).find((x) => x.supplier_id === sid);
    const text = gone
      ? `❌ <b>Заказ №${o.order_number}</b>: ваши товары убрали из заказа — не готовьте.`
      : `✏️ <b>Заказ изменён</b> — готовьте по новому списку:\n\n${supplierText(o, sid)}`;
    const chat = await chatOf("SUPPLIER", sid);
    if (!chat) {
      await sendToKind(cfg, "OWNER", `⚠️ <b>${esc(g?.suppliers?.name || "Поставщик")}</b> не подключён к боту — перешлите ему:\n\n${text}`);
      continue;
    }
    const { data: msgs } = await db.from("telegram_messages").select("id,message_id").eq("order_id", o.id).eq("kind", "SUPPLIER").eq("chat_id", chat);
    for (const m of msgs || []) {
      await quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: m.message_id, text: `✏️ Заказ №${o.order_number} изменён — смотрите новое сообщение ниже.` }));
    }
    if (gone && msgs?.length) await db.from("telegram_messages").delete().in("id", msgs.map((m: any) => m.id));
    try {
      const m = await tg(cfg, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", ...(gone ? {} : { reply_markup: supplierKeyboard(o, sid) }) });
      if (!gone) await remember(o.id, chat, m.message_id, "SUPPLIER");
      sent++;
    } catch (e) { console.error(e); }
  }
  return sent;
}

async function onSupplierCallback(cfg: Cfg, q: any, act: string, id: string, arg: string) {
  const answer = (text = "", alert = false) => quiet(tg(cfg, "answerCallbackQuery", { callback_query_id: q.id, text, show_alert: alert }));
  const chat = q.message?.chat?.id, msg = q.message?.message_id;
  const { data: link } = await db.from("telegram_links").select("ref_id").eq("kind", "SUPPLIER").eq("active", true).eq("chat_id", chat).maybeSingle();
  if (!link) return answer("Вы не подключены как поставщик.", true);
  let o = await loadOrder(id);
  const sid = link.ref_id;
  if (act === "miss") { await quiet(tg(cfg, "editMessageReplyMarkup", { chat_id: chat, message_id: msg, reply_markup: missingKeyboard(o, sid) })); return answer("Чего нет?"); }
  if (act === "back") { await quiet(tg(cfg, "editMessageReplyMarkup", { chat_id: chat, message_id: msg, reply_markup: supplierKeyboard(o, sid) })); return answer(); }

  const item = act === "mi" ? supplierItems(o, sid)[Number(arg)] : null;
  if (act === "mi" && !item) return answer("Не нашёл товар", true);
  const { data: r, error } = await db.rpc("tg_supplier", { p_chat: chat, p_order: id, p_action: act === "mi" ? "missing" : act, p_arg: item ? item.name_snapshot : null });
  if (error) { console.error(error); return answer("Не получилось: " + error.message, true); }
  if (r?.error === "cancelled") {
    await quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: msg, text: `❌ Заказ №${o.order_number} отменён — не готовьте его.` }));
    return answer("Заказ отменён", true);
  }
  if (r?.error) return answer(r.error === "not_yours" ? "В этом заказе нет ваших товаров." : "Не получилось", true);

  o = await loadOrder(id);
  await quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: msg, text: supplierText(o, sid), parse_mode: "HTML", reply_markup: supplierKeyboard(o, sid) }));
  const driverChat = await chatOf("DRIVER", o.driverId);
  if (act === "ready") {
    if (driverChat) await quiet(tg(cfg, "sendMessage", { chat_id: driverChat, text: `✅ ${esc(r.supplier)}: заказ №${o.order_number} готов — можно забирать.`, parse_mode: "HTML" }));
  } else {
    const warn = `⚠️ У <b>${esc(r.supplier)}</b> нет: ${esc(item.name_snapshot)} (заказ №${o.order_number}). Позвоните клиенту и предложите замену.`;
    if (driverChat) await quiet(tg(cfg, "sendMessage", { chat_id: driverChat, text: warn, parse_mode: "HTML" }));
    await sendToKind(cfg, "OWNER", warn);
  }
  await refreshOwner(cfg, o);
  await refreshCourier(cfg, o);
  return answer(act === "ready" ? "Отмечено: готово" : "Курьер и владелец предупреждены");
}

// ---------- End of day for suppliers (00:05 Tbilisi): total, «Сходится / Не сходится», owner's «Оплачено»

const ddmm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const plural = (n: number) => n % 10 === 1 && n % 100 !== 11 ? "заказ" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "заказа" : "заказов";

// Debt counts partial payments (supplier_payments): due = everything billed − everything paid; debt = the part from earlier days.
async function balanceOf(supplierId: string) {
  const { data, error } = await db.rpc("tg_owner", { p_chat: null, p_action: "balance", p_args: { supplier: supplierId } });
  if (error) throw error;
  return data as any;
}
async function loadSettlement(id: string) {
  const { data: st, error } = await db.from("supplier_settlements").select("*,suppliers(name)").eq("id", id).single();
  if (error) throw error;
  const b = await balanceOf(st.supplier_id);
  const due = Math.max(0, Number(b.debt));
  return { ...st, prev: [], debt: Math.max(0, due - Number(st.amount)), due: st.status === "PAID" ? 0 : due, stock: b.stock || [] };
}
const PAYM: Record<string, string> = { CASH: "💵 наличные", TRANSFER: "💳 безнал" };
const stockHeld = (stock: any[]) => stock.length
  ? "\n📦 У нас на хранении ваш товар (оплата по мере продажи): " + stock.map((x) => `${esc(x.name)} ${qty(x.qty, x.unit)}`).join(", ")
  : "";

function supplierDayText(st: any) {
  const d = st.details || {};
  const lines = (d.lines || []) as any[];
  const poured = (d.poured_lines || []) as any[];
  const row = (l: any) => `${esc(l.name)} — ${qty(l.qty, l.unit)} × ${money(l.cost)} = <b>${money(l.sum)}</b>`;
  return [
    `📊 <b>Итог за ${ddmm(st.settlement_date)}</b> · Пивка для рывка`,
    `Доставлено: ${st.orders_count} ${plural(st.orders_count)}`,
    "",
    ...lines.map((l) => `${l.gift ? "🎁" : "•"} ${row(l)}${l.gift ? " (подарок клиенту)" : ""}`),
    poured.length ? "\n🍺 Разлито, но клиент не взял (оплачиваем вам):" : null,
    ...poured.map((l) => `• ${row(l)}`),
    "",
    `<b>За день: ${money(st.amount)}</b>`,
    st.debt > 0 ? `Не оплачено за прошлые дни: ${money(st.debt)}` : null,
    st.debt > 0 ? `<b>Итого к оплате: ${money(st.due)}</b>` : null,
    "",
    st.status === "PAID" ? `💸 Оплачено ${hm(st.paid_at)}`
      : st.supplier_status === "AGREED" ? "✅ Вы подтвердили — всё сходится. Оплата утром."
      : st.supplier_status === "DISPUTED" ? (st.supplier_note ? `❌ Вы написали: «${esc(st.supplier_note)}». Владелец разберётся.` : "❌ Напишите одним сообщением, что не сходится 👇")
      : "Проверьте, пожалуйста: всё сходится?",
    stockHeld(st.stock || []) || null,
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}
const dcb = (act: string, id: string) => `d|${act}|${id}`;
const supplierDayKeyboard = (st: any) => ({
  inline_keyboard: st.status === "OPEN" && st.supplier_status === "SENT"
    ? [[{ text: "✅ Сходится", callback_data: dcb("ok", st.id) }, { text: "❌ Не сходится", callback_data: dcb("bad", st.id) }]] : [],
});

function ownerDayText(st: any, linked: boolean) {
  const d = st.details || {};
  const reply = !linked ? "⚠️ не подключён к боту — перешлите ему итог"
    : st.supplier_status === "AGREED" ? "✅ сходится"
    : st.supplier_status === "DISPUTED" ? `❌ не сходится${st.supplier_note ? ": «" + esc(st.supplier_note) + "»" : " (ждём, что напишет)"}`
    : "⏳ ещё не ответил";
  return [
    `📊 <b>${esc(st.suppliers?.name || "Поставщик")} · итог за ${ddmm(st.settlement_date)}</b>`,
    `За день: ${money(st.amount)} (${st.orders_count} ${plural(st.orders_count)})${Number(d.poured) > 0 ? ` · из них разлитое пиво ${money(d.poured)}` : ""}`,
    st.debt > 0 ? `Долг за прошлые дни: ${money(st.debt)}` : null,
    `<b>К оплате: ${money(st.due)}</b>`,
    `Поставщик: ${reply}`,
    st.status === "PAID" ? `💸 Оплачено ${time(st.paid_at)}` : null,
  ].filter((l) => l !== null).join("\n");
}
const ownerDayKeyboard = (st: any) => ({
  inline_keyboard: st.status === "OPEN" && st.due > 0
    ? [[{ text: `💵 Оплачено налом ${money(st.due)}`, callback_data: dcb("paid_cash", st.id) }],
       [{ text: `💳 Оплачено безналом ${money(st.due)}`, callback_data: dcb("paid_transfer", st.id) }]]
    : [],
});

async function refreshDay(cfg: Cfg, id: string) {
  const st = await loadSettlement(id);
  const tgm = st.tg || {};
  const linked = !!(await chatOf("SUPPLIER", st.supplier_id));
  for (const [chat, msg] of (tgm.owner || []) as [number, number][]) {
    await quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: msg, text: ownerDayText(st, linked), parse_mode: "HTML", reply_markup: ownerDayKeyboard(st) }));
  }
  if (tgm.supplier) {
    await quiet(tg(cfg, "editMessageText", { chat_id: tgm.supplier[0], message_id: tgm.supplier[1], text: supplierDayText(st), parse_mode: "HTML", reply_markup: supplierDayKeyboard(st) }));
  }
  return st;
}

async function onSupplierDay(cfg: Cfg, ids: string[]) {
  let sent = 0;
  for (const id of ids) {
    const st = await loadSettlement(id);
    const chat = await chatOf("SUPPLIER", st.supplier_id);
    const tgm: any = { owner: [] };
    if (chat) {
      try {
        const m = await tg(cfg, "sendMessage", { chat_id: chat, text: supplierDayText(st), parse_mode: "HTML", reply_markup: supplierDayKeyboard(st) });
        tgm.supplier = [chat, m.message_id]; sent++;
      } catch (e) { console.error(e); }
    } else {
      await sendToKind(cfg, "OWNER", `⚠️ <b>${esc(st.suppliers?.name || "Поставщик")}</b> не подключён к боту — перешлите ему итог:\n\n${supplierDayText(st)}`);
    }
    for (const l of await linksOf("OWNER")) {
      try {
        const m = await tg(cfg, "sendMessage", { chat_id: l.chat_id, text: ownerDayText(st, !!chat), parse_mode: "HTML", reply_markup: ownerDayKeyboard(st) });
        tgm.owner.push([l.chat_id, m.message_id]);
      } catch (e) { console.error(e); }
    }
    await db.from("supplier_settlements").update({ tg: tgm }).eq("id", id);
  }
  return sent;
}

// A payment (bot button, owner's «💸 Оплата», admin): days it closed show «Оплачено»; the supplier sees the payment and what is left.
async function onSupplierPaid(cfg: Cfg, supplierId: string, amount: number, method = "") {
  const { data: days } = await db.from("supplier_settlements").select("id").eq("supplier_id", supplierId)
    .eq("status", "PAID").gte("paid_at", new Date(Date.now() - 5 * 60000).toISOString());
  for (const d of days || []) await refreshDay(cfg, d.id);
  const b = await balanceOf(supplierId);
  const chat = await chatOf("SUPPLIER", supplierId);
  if (chat && amount > 0) await quiet(tg(cfg, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: paymentText(b, amount, method) }));
  return chat ? 1 : 0;
}
function paymentText(b: any, amount: number, method: string) {
  const debt = Number(b.debt), before = debt + amount;
  return [
    `💸 <b>Оплата: ${money(amount)}</b>${method ? " · " + PAYM[method] : ""} · ${time(new Date().toISOString())}`,
    `Долг был: ${money(Math.max(before, 0))} → ${debt > 0 ? `осталось: <b>${money(debt)}</b>` : debt < 0 ? `аванс: <b>${money(-debt)}</b>` : "<b>долга нет</b>"}`,
    Number(b.today) > 0 ? `Сегодня пока: ${money(b.today)} (войдёт в итог дня в 00:05)` : null,
    stockHeld(b.stock || []) || null,
  ].filter((l) => l !== null).join("\n");
}

async function onDayCallback(cfg: Cfg, q: any, act: string, id: string) {
  const answer = (text = "", alert = false) => quiet(tg(cfg, "answerCallbackQuery", { callback_query_id: q.id, text, show_alert: alert }));
  const chat = q.message?.chat?.id;
  const { data: r, error } = await db.rpc("tg_supplier_day", { p_chat: chat, p_settlement: id, p_action: act });
  if (error) { console.error(error); return answer("Не получилось: " + error.message, true); }
  if (r?.error === "already") { await refreshDay(cfg, id); return answer("Уже оплачено"); }
  if (r?.error) return answer(r.error === "forbidden" ? "Эта кнопка не для вас." : "Не получилось", true);
  if (act.startsWith("paid")) { await onSupplierPaid(cfg, (await loadSettlement(id)).supplier_id, Number(r.amount), r.method || ""); return answer("Отмечено: оплачено"); }
  await refreshDay(cfg, id);
  return answer(act === "ok" ? "Спасибо!" : "Напишите, что не так");
}

// After «Не сходится» the supplier writes what is wrong as a normal message.
async function onText(cfg: Cfg, m: any) {
  const { data: r } = await db.rpc("tg_supplier_day", { p_chat: m.chat.id, p_settlement: null, p_action: "note", p_note: String(m.text).slice(0, 500) });
  if (!r?.ok) return;
  const st = await refreshDay(cfg, r.id);
  await quiet(tg(cfg, "sendMessage", { chat_id: m.chat.id, text: "Спасибо, передали владельцу." }));
  await sendToKind(cfg, "OWNER", `❌ <b>${esc(st.suppliers?.name || "Поставщик")}</b>: итог за ${ddmm(st.settlement_date)} не сходится — «${esc(st.supplier_note)}»`);
}

// ---------- Chat with customers (site «💬 Написать нам» ↔ Telegram), kept apart from the orders:
// a separate group with Topics (telegram_links SUPPORT) — one topic per customer, the owner writes in the topic;
// until it is connected, the owner's bot chat gets «💬 ЧАТ» messages and answers with «Ответить».

const STATUS_RU: Record<string, string> = {
  NEW: "новый", CONFIRMED: "принят", PREPARING: "собран", OUT_FOR_DELIVERY: "едет", DELIVERED: "доставлен", CANCELLED: "отменён", REFUNDED: "возврат",
};
async function supportGroup() {
  const { data } = await db.from("telegram_links").select("chat_id").eq("kind", "SUPPORT").eq("active", true).not("chat_id", "is", null).limit(1).maybeSingle();
  return data?.chat_id || null;
}
async function loadThread(id: string) {
  const { data: t } = await db.from("support_threads").select("*").eq("id", id).single();
  let o: any = null;
  if (t?.order_id) {
    const { data } = await db.from("orders").select("id,order_number,status,total,created_at,fulfillment_type,address_snapshot").eq("id", t.order_id).maybeSingle();
    o = data;
  }
  return { t, o };
}
const whoLine = (t: any, o: any) => [
  `👤 <b>${esc(t.name || "Без имени")}</b>${t.phone ? " · " + esc(t.phone) : ""}`,
  o ? `📦 Заказ №${o.order_number} · ${STATUS_RU[o.status] || o.status} · ${money(o.total)} · ${time(o.created_at)}` : "📦 Заказа ещё нет",
  o?.address_snapshot ? `🏠 ${esc(o.address_snapshot)}` : null,
].filter(Boolean).join("\n");
const topicName = (t: any, o: any) => `${o ? "№" + o.order_number + " · " : ""}${t.name || (t.phone ? t.phone : "Клиент")}`.slice(0, 120);

// The customer's topic in the support group; created with a card on the first message, a new card when the order changes.
async function ensureTopic(cfg: Cfg, group: number, t: any, o: any) {
  if (t.tg_chat === group && t.tg_topic) {
    if (o && t.tg_order_shown !== o.id) {
      await quiet(tg(cfg, "sendMessage", { chat_id: group, message_thread_id: t.tg_topic, text: "📦 Теперь к чату прикреплён:\n" + whoLine(t, o), parse_mode: "HTML" }));
      await quiet(tg(cfg, "editForumTopic", { chat_id: group, message_thread_id: t.tg_topic, name: topicName(t, o) }));
      await db.from("support_threads").update({ tg_order_shown: o.id }).eq("id", t.id);
    }
    return t.tg_topic;
  }
  const topic = await tg(cfg, "createForumTopic", { chat_id: group, name: topicName(t, o) });
  await db.from("support_threads").update({ tg_chat: group, tg_topic: topic.message_thread_id, tg_order_shown: o?.id || null }).eq("id", t.id);
  await quiet(tg(cfg, "sendMessage", { chat_id: group, message_thread_id: topic.message_thread_id, parse_mode: "HTML",
    text: "💬 <b>Новый чат с сайта</b>\n" + whoLine(t, o) + "\n\nПишите здесь — ответ появится у клиента на сайте." }));
  return topic.message_thread_id;
}

async function photoUrl(path: string) {
  const { data } = await db.storage.from("support-chat").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

async function onSupportIn(cfg: Cfg, messageId: number) {
  const { data: m } = await db.from("support_messages").select("*").eq("id", messageId).single();
  if (!m) return 0;
  const { t, o } = await loadThread(m.thread_id);
  const photo = m.image_path ? await photoUrl(m.image_path) : null;
  const group = await supportGroup();
  if (group) {
    try {
      const topic = await ensureTopic(cfg, group, t, o);
      if (photo) await tg(cfg, "sendPhoto", { chat_id: group, message_thread_id: topic, photo, caption: "👤 📷 Скриншот от клиента" + (m.body ? "\n" + m.body : "") });
      else await tg(cfg, "sendMessage", { chat_id: group, message_thread_id: topic, text: "👤 " + m.body });
      return 1;
    } catch (e) { console.error("support group", e); } // no topics / no rights → owner's chat below
  }
  let sent = 0;
  const head = "💬 <b>ЧАТ С САЙТА</b>\n" + whoLine(t, o) + "\n\n";
  const foot = "\n\n↩️ <i>Ответьте на это сообщение («Ответить») — ответ уйдёт клиенту на сайт.</i>";
  for (const l of await linksOf("OWNER")) {
    try {
      const r = photo
        ? await tg(cfg, "sendPhoto", { chat_id: l.chat_id, photo, caption: (head + "📷 Скриншот от клиента" + (m.body ? "\n" + esc(m.body) : "") + foot).slice(0, 1000), parse_mode: "HTML" })
        : await tg(cfg, "sendMessage", { chat_id: l.chat_id, text: head + esc(m.body) + foot, parse_mode: "HTML" });
      await db.from("support_tg").insert({ chat_id: l.chat_id, message_id: r.message_id, thread_id: t.id });
      sent++;
    } catch (e) { console.error(e); }
  }
  return sent;
}

async function onSupportBlocked(cfg: Cfg, threadId: string, until: string) {
  const { t, o } = await loadThread(threadId);
  const text = `⛔ Клиент написал грубость — сообщение не доставлено, чат заблокирован до ${time(until)}.`;
  const group = await supportGroup();
  if (group) {
    try { const topic = await ensureTopic(cfg, group, t, o); await tg(cfg, "sendMessage", { chat_id: group, message_thread_id: topic, text }); return 1; }
    catch (e) { console.error(e); }
  }
  return await sendToKind(cfg, "OWNER", "💬 " + whoLine(t, o) + "\n" + text);
}

async function supportReply(threadId: string, body: string, author: string) {
  await db.from("support_messages").insert({ thread_id: threadId, dir: "OUT", body: body.slice(0, 2000), author });
  await db.from("support_threads").update({ last_out_at: new Date().toISOString() }).eq("id", threadId);
}

// Owner / staff wrote something: in a customer's topic of the support group, or as a reply in the owner's bot chat.
// Returns true when it was a chat answer (then it must not go on to the supplier «не сходится» note).
async function onSupportOwnerMessage(cfg: Cfg, m: any) {
  if (m.from?.is_bot) return true;
  const group = m.chat.type === "group" || m.chat.type === "supergroup";
  let threadId: string | null = null;
  if (group) {
    const g = await supportGroup();
    if (!g || m.chat.id !== g) return false;           // another group (a supplier's): may be its «не сходится» note
    if (!m.message_thread_id || !m.is_topic_message) return true; // the general topic: not a customer
    const { data } = await db.from("support_threads").select("id").eq("tg_chat", m.chat.id).eq("tg_topic", m.message_thread_id).maybeSingle();
    threadId = data?.id || null;
    if (!threadId) return true;
  } else if (m.reply_to_message) {
    const { data: own } = await db.from("telegram_links").select("id").eq("kind", "OWNER").eq("active", true).eq("chat_id", m.chat.id).maybeSingle();
    if (!own) return false;
    const { data } = await db.from("support_tg").select("thread_id").eq("chat_id", m.chat.id).eq("message_id", m.reply_to_message.message_id).maybeSingle();
    threadId = data?.thread_id || null;
    if (!threadId) return false;
  } else return false;
  if (!m.text) {
    await quiet(tg(cfg, "sendMessage", { chat_id: m.chat.id, message_thread_id: m.message_thread_id, text: "Клиенту уходит только текст — напишите словами." }));
    return true;
  }
  await supportReply(threadId, String(m.text), m.from?.first_name || "Пивка для рывка");
  if (!group) await quiet(tg(cfg, "sendMessage", { chat_id: m.chat.id, text: "✅ Отправлено клиенту", reply_to_message_id: m.message_id }));
  return true;
}

// ---------- Owner's menu: «📥 Приход», «💸 Оплата», «📦 Склад», «📊 Долги» (night stock and supplier payments)
// Steps that need a number keep their state in tg_owner_state (30 min). Every action is checked in tg_owner by the owner's chat.

const OWNER_MENU = {
  keyboard: [[{ text: "📥 Приход" }, { text: "💸 Оплата" }], [{ text: "📦 Склад" }, { text: "📊 Долги" }]],
  resize_keyboard: true, is_persistent: true,
};
const wcb = (act: string, arg = "") => `w|${act}${arg ? "|" + arg : ""}`;
const owner = (chat: number, action: string, args: Record<string, unknown> = {}) =>
  db.rpc("tg_owner", { p_chat: chat, p_action: action, p_args: args }).then((r) => { if (r.error) throw r.error; return r.data as any; });
async function isOwnerChat(chat: number) {
  const { data } = await db.from("telegram_links").select("id").eq("kind", "OWNER").eq("active", true).eq("chat_id", chat).maybeSingle();
  return !!data;
}
async function getState(chat: number) {
  const { data } = await db.from("tg_owner_state").select("step,data,at").eq("chat_id", chat).maybeSingle();
  return data && Date.now() - new Date(data.at).getTime() < 30 * 60000 ? data : null;
}
const setState = (chat: number, step: string, data: unknown) =>
  db.from("tg_owner_state").upsert({ chat_id: chat, step, data, at: new Date().toISOString() });
const clearState = (chat: number) => db.from("tg_owner_state").delete().eq("chat_id", chat);
const say = (cfg: Cfg, chat: number, text: string, reply_markup: unknown = OWNER_MENU) =>
  tg(cfg, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", reply_markup });
const num = (t: string) => { const m = String(t).trim().replace(",", ".").replace(/[−–—]/, "-").replace(/\s+/g, " ").match(/^([+-]?\d+(?:\.\d+)?)\s*(?:₾|лари|шт|л)?$/i); return m ? Number(m[1]) : null; };

function stockText(list: any[]) {
  if (!list.length) return "Ночной ассортимент пуст.";
  let who = "";
  return "📦 <b>Ночной склад</b>\n" + list.map((x) => {
    const head = x.supplier !== who ? `\n<b>${esc(x.supplier || "Без поставщика")}</b>\n` : "";
    who = x.supplier;
    const busy = Number(x.stock) - Number(x.left);
    return head + `${Number(x.stock) > 0 ? "•" : "▫️"} ${esc(x.name)} — ${qty(x.stock, x.unit)}${busy > 0 ? ` (в заказах ${qty(busy, x.unit)})` : ""}`;
  }).join("\n") + "\n\nДобавить — «📥 Приход».";
}
function debtsText(list: any[]) {
  if (!list.length) return "📊 Долгов нет.";
  let total = 0;
  const rows = list.map((b) => {
    const debt = Number(b.debt); total += Math.max(debt, 0);
    const held = (b.stock || []).reduce((t: number, x: any) => t + Number(x.qty) * Number(x.cost || 0), 0);
    const last = (b.last || [])[0];
    return [
      `<b>${esc(b.supplier)}</b>: ${debt > 0 ? "долг " + money(debt) : debt < 0 ? "аванс " + money(-debt) : "долга нет"}`,
      Number(b.today) > 0 ? `   сегодня пока: ${money(b.today)}` : null,
      held > 0 ? `   на складе его товара: ${money(held)} по закупу` : null,
      last ? `   последняя оплата: ${money(last.amount)} ${PAYM[last.method]} · ${time(last.at)}` : null,
    ].filter(Boolean).join("\n");
  });
  return "📊 <b>Поставщики</b>\n\n" + rows.join("\n\n") + `\n\n<b>Всего долг: ${money(total)}</b>`;
}

// Owner's private chat: menu buttons and the numbers they ask for. Returns true when handled.
async function onOwnerText(cfg: Cfg, m: any) {
  if (m.chat.type !== "private" || !m.text || m.reply_to_message || !(await isOwnerChat(m.chat.id))) return false;
  const chat = m.chat.id, t = String(m.text).trim(), low = t.toLowerCase();
  if (/приход/.test(low)) {
    await clearState(chat);
    const list = await owner(chat, "stock");
    await say(cfg, chat, "📥 <b>Приход на ночной склад</b> — что взяли?", {
      inline_keyboard: [...list.map((x: any) => [{ text: `${x.name} · ${Number(x.stock)}`.slice(0, 60), callback_data: wcb("in", x.id) }]),
        [{ text: "✖️ Отмена", callback_data: wcb("no") }]],
    });
    return true;
  }
  if (/оплат/.test(low)) {
    await clearState(chat);
    const list = await owner(chat, "suppliers");
    if (!list.length) { await say(cfg, chat, "Пока некому платить."); return true; }
    await say(cfg, chat, "💸 <b>Оплата</b> — кому?", {
      inline_keyboard: [...list.map((b: any) => [{ text: `${b.supplier} · ${Number(b.debt) > 0 ? "долг " + money(b.debt) : "долга нет"}`.slice(0, 60), callback_data: wcb("pay", b.id) }]),
        [{ text: "✖️ Отмена", callback_data: wcb("no") }]],
    });
    return true;
  }
  if (/склад/.test(low)) { await say(cfg, chat, stockText(await owner(chat, "stock"))); return true; }
  if (/долг/.test(low)) { await say(cfg, chat, debtsText(await owner(chat, "suppliers"))); return true; }
  if (/^\/?(меню|menu)$/.test(low)) { await say(cfg, chat, "Меню внизу 👇"); return true; }

  const st = await getState(chat);
  if (!st) return false;
  const n = num(t);
  if (n === null || n === 0) { await say(cfg, chat, "Напишите число, например 12. Или «✖️ Отмена» в сообщении выше."); return true; }
  if (st.step === "in_qty") {
    await setState(chat, "in_ok", { ...st.data, qty: n });
    await say(cfg, chat, `${n > 0 ? "📥 Приход" : "↩️ Вернули поставщику"}: <b>${esc(st.data.name)}</b> ${n > 0 ? "+" : "−"}${qty(Math.abs(n), st.data.unit)}\n` +
      `${esc(st.data.supplier || "")}${st.data.cost ? ` · закуп ${money(st.data.cost)}` : ""}\n\nВерно?`,
      { inline_keyboard: [[{ text: "✅ Верно", callback_data: wcb("inok") }, { text: "✖️ Отмена", callback_data: wcb("no") }]] });
    return true;
  }
  if (st.step === "pay_amount") {
    if (n < 0) { await say(cfg, chat, "Сумма должна быть больше нуля."); return true; }
    await setState(chat, "pay_method", { ...st.data, amount: n });
    await say(cfg, chat, `💸 <b>${esc(st.data.name)}</b>: ${money(n)}\nДолг сейчас: ${money(Math.max(0, st.data.debt))} → после оплаты: ${money(st.data.debt - n)}\n\nКак оплатили?`,
      { inline_keyboard: [[{ text: "💵 Наличные", callback_data: wcb("pm", "CASH") }, { text: "💳 Безнал", callback_data: wcb("pm", "TRANSFER") }],
        [{ text: "✖️ Отмена", callback_data: wcb("no") }]] });
    return true;
  }
  return false;
}

async function onOwnerMenuCallback(cfg: Cfg, q: any, act: string, arg: string) {
  const answer = (text = "", alert = false) => quiet(tg(cfg, "answerCallbackQuery", { callback_query_id: q.id, text, show_alert: alert }));
  const chat = q.message?.chat?.id, msg = q.message?.message_id;
  if (!(await isOwnerChat(chat))) return answer("Это только для владельца.", true);
  const done = (text: string) => quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: msg, text, parse_mode: "HTML" }));
  if (act === "no") { await clearState(chat); await done("✖️ Отменено."); return answer(); }

  if (act === "in") {
    const x = (await owner(chat, "stock")).find((p: any) => p.id === arg);
    if (!x) return answer("Товар не найден", true);
    await setState(chat, "in_qty", { product: x.id, name: x.name, unit: x.unit, supplier: x.supplier, cost: x.cost });
    await done(`📥 <b>${esc(x.name)}</b> (сейчас ${qty(x.stock, x.unit)}) — сколько взяли?\nНапишите число. Вернули поставщику — с минусом, например −2.`);
    return answer();
  }
  if (act === "inok") {
    const st = await getState(chat);
    if (st?.step !== "in_ok") { await done("Устарело — начните заново: «📥 Приход»."); return answer(); }
    const r = await owner(chat, "stock_in", { product: st.data.product, qty: st.data.qty });
    await clearState(chat);
    if (r?.error) {
      await done(r.error === "below_zero" ? `Нельзя убрать больше, чем есть: на складе ${Number(r.stock)}.` : "Не получилось: " + r.error);
      return answer();
    }
    const sChat = r.supplier_id ? await chatOf("SUPPLIER", r.supplier_id) : null;
    const b = r.supplier_id ? await balanceOf(r.supplier_id) : null;
    const n = Number(r.qty);
    if (sChat) {
      await quiet(tg(cfg, "sendMessage", { chat_id: sChat, parse_mode: "HTML", text:
        (n > 0
          ? `📥 <b>Взято на ночной склад</b>: ${esc(r.name)} — ${qty(n, r.unit)}${r.cost ? ` (по ${money(r.cost)})` : ""}.\nЭто ваш товар у нас на хранении: оплачиваем по мере продажи, проданное войдёт в итог дня.`
          : `↩️ <b>Вернули вам со склада</b>: ${esc(r.name)} — ${qty(-n, r.unit)}.`) + (b ? stockHeld(b.stock || []) : "") }));
    }
    await done(`✅ ${n > 0 ? "Приход" : "Возврат"}: <b>${esc(r.name)}</b> ${n > 0 ? "+" : "−"}${qty(Math.abs(n), r.unit)}. На складе: ${qty(r.stock, r.unit)}.\n` +
      (sChat ? `${esc(r.supplier)} получил сообщение.` : `⚠️ ${esc(r.supplier || "Поставщик")} не подключён к боту — сообщите ему сами.`));
    return answer("Записано");
  }
  if (act === "pay") {
    const b = await owner(chat, "balance", { supplier: arg });
    await setState(chat, "pay_amount", { supplier: arg, name: b.supplier, debt: Number(b.debt) });
    await done(`💸 <b>${esc(b.supplier)}</b>: ${Number(b.debt) > 0 ? "долг " + money(b.debt) : Number(b.debt) < 0 ? "аванс " + money(-b.debt) : "долга нет"}` +
      `${Number(b.today) > 0 ? `\nСегодня пока: ${money(b.today)} (войдёт в долг в 00:05)` : ""}\n\nСколько оплатили? Напишите сумму.`);
    return answer();
  }
  if (act === "pm") {
    const st = await getState(chat);
    if (st?.step !== "pay_method") { await done("Устарело — начните заново: «💸 Оплата»."); return answer(); }
    const r = await owner(chat, "pay", { supplier: st.data.supplier, amount: st.data.amount, method: arg });
    await clearState(chat);
    if (r?.error) { await done("Не получилось: " + r.error); return answer(); }
    const sent = await onSupplierPaid(cfg, st.data.supplier, Number(r.amount), arg);
    const after = Number(r.debt_after);
    await done(`✅ Оплата записана: <b>${esc(st.data.name)}</b> ${money(r.amount)} · ${PAYM[arg]}\n` +
      `${after > 0 ? "Осталось долга: " + money(after) : after < 0 ? "Аванс: " + money(-after) : "Долга нет"}\n` +
      (sent ? "Поставщик получил сообщение." : "⚠️ Поставщик не подключён к боту — сообщите ему сами."));
    return answer("Записано");
  }
  return answer();
}

// 11:00 Tbilisi: how the night went.
async function onStockMorning(cfg: Cfg) {
  const r = await owner(null as any, "morning");
  const sold = (r.sold || []) as any[], stock = (r.stock || []) as any[], paid = r.paid || {};
  const text = [
    `🌅 <b>Ночь (23:00–11:00)</b>: ${r.orders} ${plural(Number(r.orders))} со склада · выручка ${money(r.revenue)}`,
    sold.length ? "\n<b>Продано со склада</b> (поставщикам по закупу):\n" + sold.map((x) => `• ${esc(x.name)} — ${qty(x.qty, x.unit)} · ${money(x.cost)}`).join("\n") : "Ночью со склада ничего не продано.",
    "\n<b>Осталось на складе</b>:\n" + (stock.length ? stock.map((x) => `${Number(x.stock) > 0 ? "•" : "⚠️"} ${esc(x.name)} — ${Number(x.stock) > 0 ? qty(x.stock, x.unit) : "нет"}`).join("\n") : "—"),
    (paid.CASH || paid.TRANSFER) ? `\n💸 Оплаты поставщикам за сутки: ${[paid.CASH ? "нал " + money(paid.CASH) : "", paid.TRANSFER ? "безнал " + money(paid.TRANSFER) : ""].filter(Boolean).join(" · ")}` : null,
  ].filter((l) => l !== null).join("\n");
  return await sendToKind(cfg, "OWNER", text);
}

// ---------- Telegram updates

const WELCOME: Record<string, (label: string) => string> = {
  OWNER: () => "✅ Готово! Сюда будут приходить все новые заказы целиком.\nВнизу меню: приход на ночной склад, оплаты поставщикам, склад и долги.",
  SUPPLIER: (n) => `✅ Готово${n ? ", " + esc(n) : ""}! Сюда будут приходить заказы для подготовки — только ваши товары.`,
  DRIVER: (n) => `✅ Готово${n ? ", " + esc(n) : ""}! Сюда будут приходить новые заказы вашего города. Нажмите «🙋 Беру», позвоните клиенту — и дальше по кнопкам.`,
  SUPPORT: () => "✅ Группа подключена: сюда будут приходить чаты клиентов с сайта — у каждого клиента своя тема. Пишите в теме клиента — ответ сразу появится у него на сайте.",
};

async function onStart(cfg: Cfg, m: any) {
  const start = String(m.text || "").match(/^\/start(?:@\w+)?(?:\s+([a-f0-9]{8,64}))?/i);
  if (!start) return;
  const code = start[1];
  const { data: link } = code
    ? await db.from("telegram_links").select("id,kind,label").eq("code", code).eq("active", true).maybeSingle()
    : { data: null };
  if (!link) {
    if (m.chat.type === "private") await tg(cfg, "sendMessage", { chat_id: m.chat.id, text: "Чтобы подключиться, попросите ссылку у владельца «Пивка для рывка»." });
    return;
  }
  const group = m.chat.type === "group" || m.chat.type === "supergroup";
  // A supplier may link a private chat or a group (several people of one supplier see the orders and press «Готово»).
  if (link.kind !== "SUPPLIER" && (link.kind === "SUPPORT") !== group) {
    await tg(cfg, "sendMessage", { chat_id: m.chat.id, text: link.kind === "SUPPORT" ? "Эта ссылка — для группы чатов с клиентами." : "Эта ссылка — для личного чата с ботом." });
    return;
  }
  await db.from("telegram_links").update({
    chat_id: m.chat.id, tg_username: m.from?.username || null, linked_at: new Date().toISOString(),
  }).eq("id", link.id);
  await tg(cfg, "sendMessage", { chat_id: m.chat.id, text: WELCOME[link.kind](link.label || ""), parse_mode: "HTML",
    ...(link.kind === "OWNER" ? { reply_markup: OWNER_MENU } : {}) });
  if (link.kind === "SUPPORT" && !m.chat.is_forum) {
    await quiet(tg(cfg, "sendMessage", { chat_id: m.chat.id, text: "⚠️ Включите в настройках группы «Темы» (Topics) и сделайте бота администратором с правом «Управление темами» — тогда у каждого клиента будет своя тема." }));
  }
}

const ERR: Record<string, string> = {
  not_driver: "Вы не подключены как курьер. Попросите ссылку у владельца.",
  not_yours: "Этот заказ у другого курьера.",
  no_order: "Заказ не найден.",
  method: "Не понял способ оплаты.",
};
const STATE: Record<string, string> = {
  NEW: "новый", CONFIRMED: "уже принят", PREPARING: "уже собирается", OUT_FOR_DELIVERY: "уже в пути",
  DELIVERED: "уже доставлен", CANCELLED: "уже отменён", REFUNDED: "возвращён",
};

// Owner's order message: «❌ Отменить заказ» → reason. Checked in the database by the owner's Telegram chat.
async function onOwnerCallback(cfg: Cfg, q: any, act: string, id: string, arg: string) {
  const answer = (text = "", alert = false) => quiet(tg(cfg, "answerCallbackQuery", { callback_query_id: q.id, text, show_alert: alert }));
  const chat = q.message?.chat?.id, msg = q.message?.message_id;
  if (act === "cm") { await quiet(tg(cfg, "editMessageReplyMarkup", { chat_id: chat, message_id: msg, reply_markup: ownerReasonsKeyboard(id) })); return answer("Почему отменяем?"); }
  if (act === "bk") {
    const o = await loadOrder(id);
    await quiet(tg(cfg, "editMessageReplyMarkup", { chat_id: chat, message_id: msg, reply_markup: ownerKeyboard(o) }));
    return answer();
  }
  if (act !== "cancel") return answer();
  const { data: r, error } = await db.rpc("tg_owner_cancel", { p_chat: chat, p_order: id, p_arg: arg || null });
  if (error) { console.error(error); return answer("Не получилось: " + error.message, true); }
  const o = await loadOrder(id);
  if (r?.error === "state") { await refreshOwner(cfg, o); return answer(`Заказ ${STATE[r.status] || r.status}`, true); }
  if (r?.error) return answer(r.error === "not_owner" ? "Эта кнопка только для владельца." : "Не получилось", true);
  await refreshOwner(cfg, o); // the trigger also refreshes it, together with courier and suppliers
  return answer("Заказ отменён");
}

async function onCallback(cfg: Cfg, q: any) {
  const answer = (text = "", alert = false) => quiet(tg(cfg, "answerCallbackQuery", { callback_query_id: q.id, text, show_alert: alert }));
  const chat = q.message?.chat?.id, msg = q.message?.message_id;
  const [kind, act, id, arg] = String(q.data || "").split("|");
  if (kind === "s" && id && chat) return onSupplierCallback(cfg, q, act, id, arg ?? "");
  if (kind === "d" && id && chat) return onDayCallback(cfg, q, act, id);
  if (kind === "o" && id && chat) return onOwnerCallback(cfg, q, act, id, arg ?? "");
  if (kind === "w" && act && chat) return onOwnerMenuCallback(cfg, q, act, id ?? "");
  if (kind !== "c" || !id || !chat) return answer();

  if (act === "cm") { await quiet(tg(cfg, "editMessageReplyMarkup", { chat_id: chat, message_id: msg, reply_markup: reasonsKeyboard(id) })); return answer("Почему отменяем?"); }
  if (act === "bk") {
    const o = await loadOrder(id);
    await quiet(tg(cfg, "editMessageReplyMarkup", { chat_id: chat, message_id: msg, reply_markup: cardKeyboard(o) }));
    return answer();
  }

  const { data: r, error } = await db.rpc("tg_courier", { p_chat: chat, p_order: id, p_action: act, p_arg: arg || null });
  if (error) { console.error(error); return answer("Не получилось: " + error.message, true); }
  const o = await loadOrder(id);

  if (r?.error === "taken") {
    await quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: msg, text: `Заказ №${o.order_number} взял ${esc(r.by)}.`, parse_mode: "HTML" }));
    return answer(`Уже взял ${r.by}`);
  }
  if (r?.error === "state") {
    await quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: msg, text: cardText(o), parse_mode: "HTML", reply_markup: o.driverId ? cardKeyboard(o) : undefined }));
    return answer(`Заказ ${STATE[r.status] || r.status}`, true);
  }
  if (r?.error) return answer(ERR[r.error] || "Не получилось", true);

  // Success: this courier's card shows the current step; the owner's copy gets the new status.
  await quiet(tg(cfg, "editMessageText", { chat_id: chat, message_id: msg, text: cardText(o), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: cardKeyboard(o) }));
  if (act === "take") {
    const { data: offers } = await db.from("telegram_messages").select("chat_id,message_id").eq("order_id", id).eq("kind", "DRIVER_OFFER");
    for (const m of offers || []) {
      if (m.chat_id === chat) continue;
      await quiet(tg(cfg, "editMessageText", { chat_id: m.chat_id, message_id: m.message_id, text: `Заказ №${o.order_number} взял ${esc(r.driver)}.` }));
    }
  }
  await refreshOwner(cfg, o); // a cancel also reaches onOrderCancelled (database trigger), which tells the owner
  return answer({ take: "Заказ ваш — позвоните клиенту", accept: "Принят", ready: "Собран — теперь «🛵 Еду»", go: "Клиент видит: едет", deliver: "Доставлен 🎉", cancel: "Отменён" }[act] || "");
}

async function onUpdate(cfg: Cfg, u: any) {
  if (u.callback_query) return onCallback(cfg, u.callback_query);
  const m = u.message;
  if (!m?.chat?.id) return;
  if (m.text && /^\/start/.test(m.text)) return onStart(cfg, m);
  if (await onSupportOwnerMessage(cfg, m)) return;   // chat with a customer
  if (await onOwnerText(cfg, m)) return;             // owner's menu: stock, payments
  if (m.text && ["private", "group", "supergroup"].includes(m.chat.type)) return onText(cfg, m); // supplier's «не сходится» note
}

// ---------- Order edit page inside Telegram (Mini App)

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
}
async function webAppUser(cfg: Cfg, initData: string) {
  if (!cfg.token || !initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), cfg.token);
  const sign = [...await hmac(secret, check)].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (sign !== hash) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date") || 0) > 86400) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

async function onWebAppEdit(cfg: Cfg, b: any) {
  const user = await webAppUser(cfg, String(b.init_data || ""));
  if (!user?.id) return out({ error: "Откройте страницу заново из Telegram" }, 401);
  const { data, error } = await db.rpc("tg_order_edit", {
    p_chat: user.id, p_order: b.order_id, p_items: b.items ?? null, p_keep_bundle: b.keep_bundle ?? true, p_charge: b.charge || "DRIVER",
  });
  if (error) return out({ error: error.message }, 400);
  return out(data);
}

// ---------- Admin

async function requireOwner(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return null;
  const { data: me } = await db.from("profiles").select("role,active").eq("id", user.id).single();
  return me?.active && ["OWNER", "ADMIN"].includes(me.role) ? user : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const cfg = await config();

    if (req.headers.get("x-telegram-bot-api-secret-token")) {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== cfg.webhook) return out({ error: "Forbidden" }, 403);
      try { await onUpdate(cfg, await req.json()); } catch (e) { console.error("update", e); }
      return out({ ok: true }); // always 200, otherwise Telegram keeps retrying
    }

    if (req.headers.get("x-internal-secret")) {
      if (req.headers.get("x-internal-secret") !== cfg.internal) return out({ error: "Forbidden" }, 403);
      const b = await req.json();
      if (b.action === "order_created") return out({ sent: await onOrderCreated(cfg, b.order_id) });
      if (b.action === "remind") return out({ sent: await onRemind(cfg, b.order_id) });
      if (b.action === "order_confirmed") return out({ sent: await onOrderConfirmed(cfg, b.order_id) });
      if (b.action === "order_cancelled") return out({ sent: await onOrderCancelled(cfg, b.order_id) });
      if (b.action === "order_edited") return out({ sent: await onOrderEdited(cfg, b) });
      if (b.action === "supplier_day") return out({ sent: await onSupplierDay(cfg, b.ids || []) });
      if (b.action === "supplier_paid") return out({ sent: await onSupplierPaid(cfg, b.supplier_id, Number(b.amount)) });
      if (b.action === "support_in") return out({ sent: await onSupportIn(cfg, Number(b.message_id)) });
      if (b.action === "stock_morning") return out({ sent: await onStockMorning(cfg) });
      if (b.action === "support_blocked") return out({ sent: await onSupportBlocked(cfg, b.thread_id, b.until) });
      return out({ error: "Unknown action" }, 400);
    }

    const b = await req.json();
    if (b.action === "webapp_edit") return await onWebAppEdit(cfg, b);
    const user = await requireOwner(req);
    if (!user) return out({ error: "Unauthorized" }, 401);
    if (b.action === "setup") {
      const me = await tg(cfg, "getMe", {});
      await tg(cfg, "setWebhook", { url: SELF_URL, secret_token: cfg.webhook, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
      const value = { username: me.username, name: me.first_name, connected_at: new Date().toISOString() };
      await db.from("store_settings").upsert({ key: "telegram", value }, { onConflict: "key" });
      return out({ ok: true, ...value });
    }
    if (b.action === "test") {
      const sent = await sendToKind(cfg, "OWNER", "🔔 Проверка: бот «Пивка для рывка» на связи.");
      return out({ ok: true, sent });
    }
    if (b.action === "test_order") {
      const { data: o } = await db.from("orders").select("id").order("created_at", { ascending: false }).limit(1).single();
      if (!o) return out({ error: "Заказов пока нет" }, 400);
      return out({ ok: true, sent: await sendToKind(cfg, "OWNER", "🧪 Пример (последний заказ):\n\n" + ownerText(await loadOrder(o.id))) });
    }
    return out({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return out({ error: (e as Error)?.message || String(e) }, 400);
  }
});
