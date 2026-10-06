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
      "created_at,confirmed_at,ready_at,delivered_at,cancellation_reason,city_id," +
      "customers(full_name,phone),service_cities(name),delivery_zones(name)," +
      "order_items(name_snapshot,quantity,unit_snapshot,unit_price_snapshot,line_total,is_gift,supplier_id,supplier_cost_snapshot)," +
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
    case "PREPARING": return `📦 Собирается${who}`;
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
const ownerText = (o: any) => `🍺 <b>Заказ №${o.order_number}</b> · ${time(o.created_at)}\n${orderBody(o)}\n\n<b>Статус:</b> ${statusLine(o)}${suppliersLine(o)}`;

const offerText = (o: any) => {
  const n = (o.order_items || []).filter((i: any) => !i.is_gift).length;
  return `🆕 <b>Новый заказ №${o.order_number}</b> · ${hm(o.created_at)}\n📍 ${esc(o.service_cities?.name || "")}` +
    `${o.delivery_zones?.name ? " · " + esc(o.delivery_zones.name) : ""}\n🏠 ${esc(o.address_snapshot || "—")}\n` +
    `${n} поз. · <b>${money(o.total)}</b>\n\nКто возьмёт — звонит клиенту и подтверждает заказ.`;
};

const HINT: Record<string, string> = {
  NEW: "📞 Позвоните клиенту, уточните заказ и адрес. Клиент что-то меняет — «✏️ Изменить заказ». Всё верно — «Принят».",
  CONFIRMED: "Заберите заказ и нажмите «Собран» — клиент увидит, что заказ едет.",
  OUT_FOR_DELIVERY: "Отдали заказ? Выберите, как клиент заплатил:",
};
const cardText = (o: any) =>
  `🛵 <b>Заказ №${o.order_number}</b> · ${time(o.created_at)}\n${orderBody(o)}\n\n<b>Статус:</b> ${statusLine(o)}${suppliersLine(o)}` +
  (HINT[o.status] ? `\n\n${HINT[o.status]}` : "");

const cb = (act: string, id: string, arg = "") => `c|${act}|${id}${arg ? "|" + arg : ""}`;
function cardKeyboard(o: any) {
  const rows: any[] = [];
  if (o.fulfillment_type === "delivery" && o.address_snapshot && ["NEW", "CONFIRMED", "OUT_FOR_DELIVERY"].includes(o.status)) {
    rows.push([{ text: "🗺 Открыть на карте", url: "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(o.address_snapshot + ", " + (o.service_cities?.name || "")) }]);
  }
  if (o.status === "NEW") rows.push([{ text: "✅ Клиент подтвердил — Принят", callback_data: cb("accept", o.id) }]);
  if (o.status === "CONFIRMED" || o.status === "PREPARING") rows.push([{ text: "📦 Собран — забрал заказ", callback_data: cb("ready", o.id) }]);
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

const prepMinutes = (o: any) => o.fulfillment_type === "delivery" ? 5 : 10;
function supplierItems(o: any, supplierId: string) {
  return ((o.order_items || []) as any[]).filter((i) => i.supplier_id === supplierId)
    .sort((a, b) => Number(a.is_gift) - Number(b.is_gift) || String(a.name_snapshot).localeCompare(String(b.name_snapshot)));
}
function supplierText(o: any, supplierId: string) {
  const items = supplierItems(o, supplierId);
  const due = new Date(new Date(o.confirmed_at || o.created_at).getTime() + prepMinutes(o) * 60000).toISOString();
  const sum = items.reduce((t, i) => t + Number(i.supplier_cost_snapshot || 0) * Number(i.quantity), 0);
  const g = ((o.supplier_order_groups || []) as any[]).find((x) => x.supplier_id === supplierId) || {};
  return [
    `📦 <b>Заказ №${o.order_number}</b> · подготовить за ${prepMinutes(o)} мин (к ${hm(due)})`,
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
  if (o.status === "NEW") return 0; // suppliers haven't got this order yet
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

async function loadSettlement(id: string) {
  const { data: st, error } = await db.from("supplier_settlements").select("*,suppliers(name)").eq("id", id).single();
  if (error) throw error;
  const { data: prev } = await db.from("supplier_settlements").select("settlement_date,amount")
    .eq("supplier_id", st.supplier_id).eq("status", "OPEN").lt("settlement_date", st.settlement_date).order("settlement_date");
  const debt = (prev || []).reduce((t: number, x: any) => t + Number(x.amount), 0);
  return { ...st, prev: prev || [], debt, due: debt + Number(st.amount) };
}

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
    st.debt > 0 ? `Не оплачено за прошлые дни: ${money(st.debt)} (${st.prev.map((x: any) => ddmm(x.settlement_date)).join(", ")})` : null,
    st.debt > 0 ? `<b>Итого к оплате: ${money(st.due)}</b>` : null,
    "",
    st.status === "PAID" ? `💸 Оплачено ${hm(st.paid_at)}`
      : st.supplier_status === "AGREED" ? "✅ Вы подтвердили — всё сходится. Оплата утром."
      : st.supplier_status === "DISPUTED" ? (st.supplier_note ? `❌ Вы написали: «${esc(st.supplier_note)}». Владелец разберётся.` : "❌ Напишите одним сообщением, что не сходится 👇")
      : "Проверьте, пожалуйста: всё сходится?",
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
  inline_keyboard: st.status === "OPEN" ? [[{ text: `💸 Оплачено ${money(st.due)}`, callback_data: dcb("paid", st.id) }]] : [],
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

// Owner paid (bot button or admin): every day that was closed by this payment shows «Оплачено»; the supplier is told.
async function onSupplierPaid(cfg: Cfg, supplierId: string, amount: number) {
  const { data: days } = await db.from("supplier_settlements").select("id,settlement_date").eq("supplier_id", supplierId)
    .eq("status", "PAID").gte("paid_at", new Date(Date.now() - 5 * 60000).toISOString()).order("settlement_date");
  for (const d of days || []) await refreshDay(cfg, d.id);
  const chat = await chatOf("SUPPLIER", supplierId);
  if (chat && days?.length) {
    await quiet(tg(cfg, "sendMessage", { chat_id: chat, parse_mode: "HTML",
      text: `💸 Владелец отметил оплату <b>${money(amount)}</b> за ${days.map((d: any) => ddmm(d.settlement_date)).join(", ")}. Спасибо!` }));
  }
  return days?.length || 0;
}

async function onDayCallback(cfg: Cfg, q: any, act: string, id: string) {
  const answer = (text = "", alert = false) => quiet(tg(cfg, "answerCallbackQuery", { callback_query_id: q.id, text, show_alert: alert }));
  const chat = q.message?.chat?.id;
  const { data: r, error } = await db.rpc("tg_supplier_day", { p_chat: chat, p_settlement: id, p_action: act });
  if (error) { console.error(error); return answer("Не получилось: " + error.message, true); }
  if (r?.error === "already") { await refreshDay(cfg, id); return answer("Уже оплачено"); }
  if (r?.error) return answer(r.error === "forbidden" ? "Эта кнопка не для вас." : "Не получилось", true);
  if (act === "paid") { await onSupplierPaid(cfg, (await loadSettlement(id)).supplier_id, Number(r.amount)); return answer("Отмечено: оплачено"); }
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

// ---------- Telegram updates

const WELCOME: Record<string, (label: string) => string> = {
  OWNER: () => "✅ Готово! Сюда будут приходить все новые заказы целиком.",
  SUPPLIER: (n) => `✅ Готово${n ? ", " + esc(n) : ""}! Сюда будут приходить заказы для подготовки — только ваши товары.`,
  DRIVER: (n) => `✅ Готово${n ? ", " + esc(n) : ""}! Сюда будут приходить новые заказы вашего города. Нажмите «🙋 Беру», позвоните клиенту — и дальше по кнопкам.`,
};

async function onStart(cfg: Cfg, m: any) {
  const start = String(m.text || "").match(/^\/start(?:\s+([a-f0-9]{8,64}))?/i);
  if (!start) return;
  const code = start[1];
  const { data: link } = code
    ? await db.from("telegram_links").select("id,kind,label").eq("code", code).eq("active", true).maybeSingle()
    : { data: null };
  if (!link) {
    await tg(cfg, "sendMessage", { chat_id: m.chat.id, text: "Чтобы подключиться, попросите ссылку у владельца «Пивка для рывка»." });
    return;
  }
  await db.from("telegram_links").update({
    chat_id: m.chat.id, tg_username: m.from?.username || null, linked_at: new Date().toISOString(),
  }).eq("id", link.id);
  await tg(cfg, "sendMessage", { chat_id: m.chat.id, text: WELCOME[link.kind](link.label || ""), parse_mode: "HTML" });
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
  return answer({ take: "Заказ ваш — позвоните клиенту", accept: "Принят", ready: "Клиент видит: едет", deliver: "Доставлен 🎉", cancel: "Отменён" }[act] || "");
}

async function onUpdate(cfg: Cfg, u: any) {
  if (u.callback_query) return onCallback(cfg, u.callback_query);
  if (u.message?.text && u.message.chat?.id) return /^\/start/.test(u.message.text) ? onStart(cfg, u.message) : onText(cfg, u.message);
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
