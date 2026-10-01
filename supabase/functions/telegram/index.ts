// Telegram bot for «Пивка для рывка».
// Three kinds of callers, each with its own check (the function is deployed with verify_jwt = false):
//   1. Telegram webhook      — header X-Telegram-Bot-Api-Secret-Token = vault tg_webhook_secret
//   2. The database (pg_net) — header x-internal-secret                = vault tg_internal_secret
//   3. Admin panel           — Authorization: Bearer <staff JWT>, OWNER/ADMIN only
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SELF_URL = "https://uphnuzgaildmjrttmbaq.supabase.co/functions/v1/telegram";
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
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  return j.result;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const money = (n: unknown) => Number(n || 0).toFixed(2).replace(/\.00$/, "") + " ₾";
const qty = (q: unknown, unit: string) => unit === "liter" ? `${Number(q)} л` : `${Number(q)} шт`;
const time = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Tbilisi", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// ---------- Messages

async function ownerOrderText(orderId: string) {
  const { data: o, error } = await db.from("orders")
    .select("order_number,fulfillment_type,address_snapshot,payment_method,discount_total,delivery_fee,total,comment,created_at," +
      "customers(full_name,phone),service_cities(name),delivery_zones(name)," +
      "order_items(name_snapshot,quantity,unit_snapshot,unit_price_snapshot,line_total,is_gift)")
    .eq("id", orderId).single();
  if (error) throw error;
  const items = (o.order_items || []) as any[];
  const lines = items.filter((i) => !i.is_gift).map((i) =>
    `• ${esc(i.name_snapshot)} — ${qty(i.quantity, i.unit_snapshot)} × ${money(i.unit_price_snapshot)} = <b>${money(i.line_total)}</b>`);
  const gifts = items.filter((i) => i.is_gift).map((i) => `🎁 ${esc(i.name_snapshot)} — ${qty(i.quantity, i.unit_snapshot)} (подарок)`);
  const delivery = o.fulfillment_type === "delivery";
  const c = (o as any).customers || {};
  return [
    `🍺 <b>Новый заказ №${o.order_number}</b> · ${time(o.created_at)}`,
    `📍 ${esc((o as any).service_cities?.name || "")} · ${delivery ? "🚗 Доставка" : "🏪 Самовывоз"}`,
    `👤 ${esc(c.full_name || "Без имени")} · ${esc(c.phone || "")}`,
    delivery ? `🏠 ${esc(o.address_snapshot || "—")}${(o as any).delivery_zones?.name ? " · " + esc((o as any).delivery_zones.name) : ""}` : null,
    "",
    ...lines,
    ...gifts,
    "",
    Number(o.discount_total) > 0 ? `Скидка рывка: −${money(o.discount_total)}` : null,
    delivery ? `Доставка: ${money(o.delivery_fee)}` : null,
    `<b>Итого: ${money(o.total)}</b> · ${o.payment_method === "transfer" ? "📲 Переводом" : "💵 Наличными"}`,
    o.comment ? `💬 ${esc(o.comment)}` : null,
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function sendToKind(cfg: Cfg, kind: string, text: string) {
  const { data: links } = await db.from("telegram_links").select("chat_id").eq("kind", kind).eq("active", true).not("chat_id", "is", null);
  let sent = 0;
  for (const l of links || []) {
    try { await tg(cfg, "sendMessage", { chat_id: l.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }); sent++; }
    catch (e) { console.error("send failed", l.chat_id, e); }
  }
  return sent;
}

// ---------- Telegram updates

const WELCOME: Record<string, (label: string) => string> = {
  OWNER: () => "✅ Готово! Сюда будут приходить все новые заказы целиком.",
  SUPPLIER: (n) => `✅ Готово${n ? ", " + esc(n) : ""}! Сюда будут приходить заказы для подготовки — только ваши товары.`,
  DRIVER: (n) => `✅ Готово${n ? ", " + esc(n) : ""}! Сюда будут приходить заказы на доставку.`,
};

async function onUpdate(cfg: Cfg, u: any) {
  const m = u.message;
  if (!m?.text || !m.chat?.id) return;
  const start = m.text.match(/^\/start(?:\s+([a-f0-9]{8,64}))?/i);
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
      if (b.action === "order_created") return out({ sent: await sendToKind(cfg, "OWNER", await ownerOrderText(b.order_id)) });
      return out({ error: "Unknown action" }, 400);
    }

    const user = await requireOwner(req);
    if (!user) return out({ error: "Unauthorized" }, 401);
    const b = await req.json();
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
      return out({ ok: true, sent: await sendToKind(cfg, "OWNER", "🧪 Пример (последний заказ):\n\n" + await ownerOrderText(o.id)) });
    }
    return out({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return out({ error: (e as Error)?.message || String(e) }, 400);
  }
});
