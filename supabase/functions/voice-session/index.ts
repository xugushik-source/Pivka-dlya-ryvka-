// Voice seller: issues a short-lived OpenAI Realtime client secret for the storefront.
// The permanent OPENAI_API_KEY lives only in Supabase Secrets; the browser gets an ephemeral `ek_…` key that
// expires in ~1 minute if unused, and a session that the browser closes after VOICE_MAX_SECONDS.
// Everything commercial (catalog, prices, bundles, gifts, delivery, PASS) is answered by tools that run in the
// browser on top of the existing store logic — the model never sees a price it did not get from a tool.
//
// Guards (no new tables: counted in the existing public.store_events):
//   • allowed origins only (production domain, GitHub Pages, preview hosts, localhost);
//   • per client IP: VOICE_PER_HOUR sessions an hour, one per VOICE_MIN_GAP_SECONDS;
//   • the whole shop: VOICE_DAILY_LIMIT sessions a day — after that the button says «недоступен», the shop works.
// Deployed with verify_jwt = false (the browser calls it with the public anon key only).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// ---- One place for the model / voice / limits. Override with Supabase secrets of the same name.
const env = (k: string, d: string) => Deno.env.get(k) || d;
const CONFIG = {
  model: env("VOICE_MODEL", "gpt-realtime-2.1"),
  voice: env("VOICE_VOICE", "marin"),
  transcribeModel: env("VOICE_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
  perHour: Number(env("VOICE_PER_HOUR", "8")),
  minGapSeconds: Number(env("VOICE_MIN_GAP_SECONDS", "20")),
  dailyLimit: Number(env("VOICE_DAILY_LIMIT", "300")),
  maxSeconds: Number(env("VOICE_MAX_SECONDS", "600")),
};
const ALLOWED = [
  /^https:\/\/(www\.)?pivkadlaryvka\.ge$/,
  /^https:\/\/xugushik-source\.github\.io$/,
  /^https:\/\/raw\.githack\.com$/,
  /^https:\/\/rawcdn\.githack\.com$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const LANGS: Record<string, string> = { ru: "русский", ka: "ქართული (Georgian)", hy: "Հայերեն (Armenian)" };

function instructions(lang: string) {
  return `Ты — продавец местного магазина доставки «Пивка для рывка» (Ахалкалаки и Ниноцминда, Грузия).
Говоришь коротко, живо, дружелюбно, с лёгким характером бренда. 1–3 коротких предложения. Без лекций и технических слов.
Начинай на языке: ${LANGS[lang] || LANGS.ru}. Поддерживаешь только русский, грузинский и армянский.
Переходи на другой из этих трёх языков, только если клиент явно и полноценно заговорил на нём (не из-за названия товара, имени или междометия). Всегда отвечай на текущем языке разговора и пиши/говори настоящим текстом этого языка, без транслитерации. Бренды пиши латиницей.

ГЛАВНОЕ ПРАВИЛО: товары, цены, наличие, скидки, подарки, доставку, PASS и состав готовых рывков ты знаешь ТОЛЬКО из инструментов.
Никогда не называй цену или сумму, которую не вернул инструмент. Ничего не придумывай. Если инструмент не дал данных — так и скажи.
Суммы называй из поля total/price результата инструмента.

Как продавать:
- Узнай главное: сколько человек и бюджет (если бюджета нет — спроси одним коротким вопросом или предложи эконом/оптимально/премиум).
- Сначала проверь готовые рывки (get_available_bundles). Если подходит — предложи его.
- Иначе собери корзину через recommend_cart. Это детерминированный подбор магазина — не пересчитывай его сам.
- Озвучь коротко: что получилось и итог. Например: «На шестерых за 150 ₾ — 8 литров пива, рыба, сыр и мясное. Выходит 143 ₾. Добавить в корзину?»
- В корзину добавляй только после явного согласия или явной команды («добавь», «убери», «замени», «возьми этот»). Для подбора используй apply_recommendation.
- После изменения корзины назови фактический итог из ответа инструмента.
- Разливное пиво — минимум 2 литра, шаг 2 литра (инструменты это соблюдают).
- Бюджет не превышай. Можно предложить «за +N ₾ можно добавить …», но не добавляй без согласия.
- Один полезный апселл после сборки (например, сколько осталось до подарка — get_gift_progress). Не навязывай.
- Алкоголь только 18+. Не убеждай покупать алкоголь, если похоже, что клиент несовершеннолетний.
- Заказ ты НЕ оформляешь. Когда корзина готова: «Корзина готова. Оформляем?» → prepare_checkout (откроется обычное оформление, клиент сам подтвердит).
- Не обсуждай посторонние темы — вежливо верни разговор к заказу.`;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const TOOLS = [
  ["get_store_context", "Город, язык, время (ночные цены), правила доставки и PASS, разделы каталога.", obj({})],
  ["get_catalog", "Товары магазина с реальными ценами. Фильтры необязательны.", obj({ category: str("slug раздела: draft, strong, vodka, brandy, whisky, wine, fish, meat-snacks, cheese, nuts, chips, snacks, salty, seafood, frozen, soft-drinks, energy, supplies"), query: str("часть названия") })],
  ["get_product", "Один товар по id.", obj({ product_id: str("id товара") }, ["product_id"])],
  ["get_available_bundles", "Готовые рывки: состав, цена, на сколько человек.", obj({})],
  ["get_cart", "Текущая корзина с фактическим итогом.", obj({})],
  ["recommend_cart", "Подбор корзины магазином (ничего не добавляет). Вернёт вариант с итогом.", obj({
    people: num("сколько человек"), budget: num("бюджет в лари"),
    alcohol: { type: "string", enum: ["beer", "strong", "wine", "any", "none"], description: "что пьют" },
    level: { type: "string", enum: ["economy", "optimal", "premium"] },
    exclude_categories: { type: "array", items: { type: "string" }, description: "slug разделов, которые не брать" },
    prefer_categories: { type: "array", items: { type: "string" } },
    more_categories: { type: "array", items: { type: "string" }, description: "чего побольше (draft — пиво)" },
    occasion: str("повод: football, party, date, …"),
  })],
  ["apply_recommendation", "Положить в корзину последний вариант recommend_cart (после согласия клиента).", obj({ replace: { type: "boolean", description: "true — заменить текущую корзину" } })],
  ["add_to_cart", "Добавить товар.", obj({ product_id: str("id"), quantity: num("штук или литров") }, ["product_id", "quantity"])],
  ["remove_from_cart", "Убрать товар или весь раздел.", obj({ product_id: str("id товара"), category: str("slug раздела, если «убери рыбу»") })],
  ["set_cart_quantity", "Поставить количество.", obj({ product_id: str("id"), quantity: num("новое количество") }, ["product_id", "quantity"])],
  ["add_bundle_to_cart", "Выбрать готовый рывок.", obj({ bundle_id: str("id рывка") }, ["bundle_id"])],
  ["clear_cart", "Очистить корзину (только по явной просьбе).", obj({})],
  ["get_delivery_quote", "Стоимость доставки для суммы и текущего времени.", obj({ subtotal: num("сумма товаров") })],
  ["get_gift_progress", "Сколько осталось до подарка и какой подарок.", obj({})],
  ["get_pass_status_or_offer", "Условия PASS (и действует ли он у клиента, если известен телефон).", obj({})],
  ["prepare_checkout", "Открыть обычное оформление заказа. Заказ подтверждает сам клиент.", obj({})],
].map(([name, description, parameters]) => ({ type: "function", name, description, parameters }));

function corsFor(origin: string | null) {
  const ok = !!origin && ALLOWED.some((r) => r.test(origin));
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin! : "https://pivkadlaryvka.ge",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json",
    },
  };
}

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s + "|pivka-voice"));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function count(filter: (q: any) => any) {
  const { count: n, error } = await filter(db.from("store_events").select("id", { count: "exact", head: true }));
  if (error) throw error;
  return n || 0;
}
async function log(event: string, session: string | null, metadata: Record<string, unknown>) {
  await db.from("store_events").insert({ event_name: event, session_id: session?.slice(0, 100) || null, metadata });
}

Deno.serve(async (req) => {
  const { ok, headers } = corsFor(req.headers.get("origin"));
  const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return out({ error: "method" }, 405);
  if (!ok) return out({ error: "origin" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const lang = ["ru", "ka", "hy"].includes(body.lang) ? body.lang : "ru";
  const session = typeof body.session === "string" ? body.session.slice(0, 100) : null;

  // ?check=1 — is the voice seller available right now (no secret issued).
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return out({ error: "not_configured" }, 503);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const who = await sha(ip);
  try {
    const dayStart = new Date(Date.now() - 24 * 3600e3).toISOString();
    const hourStart = new Date(Date.now() - 3600e3).toISOString();
    const gapStart = new Date(Date.now() - CONFIG.minGapSeconds * 1000).toISOString();
    const [day, hour, gap] = await Promise.all([
      count((q) => q.eq("event_name", "voice_secret_issued").gte("created_at", dayStart)),
      count((q) => q.eq("event_name", "voice_secret_issued").eq("metadata->>who", who).gte("created_at", hourStart)),
      count((q) => q.eq("event_name", "voice_secret_issued").eq("metadata->>who", who).gte("created_at", gapStart)),
    ]);
    if (day >= CONFIG.dailyLimit) return out({ error: "daily_limit" }, 429);
    if (hour >= CONFIG.perHour || gap > 0) return out({ error: "rate_limit", retry_after: CONFIG.minGapSeconds }, 429);
  } catch (e) {
    console.error("voice limits", e);
    return out({ error: "unavailable" }, 503);
  }
  if (body.check) return out({ ok: true });

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "OpenAI-Safety-Identifier": who },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 60 },
      session: {
        type: "realtime",
        model: CONFIG.model,
        instructions: instructions(lang),
        output_modalities: ["audio"],
        max_output_tokens: 600,
        audio: {
          input: {
            transcription: { model: CONFIG.transcribeModel },
            noise_reduction: { type: "near_field" },
            turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
          },
          output: { voice: CONFIG.voice },
        },
        tools: TOOLS,
        tool_choice: "auto",
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.value) {
    console.error("openai client_secrets", r.status, JSON.stringify(j).slice(0, 500));
    await log("voice_error", session, { where: "client_secret", status: r.status, lang });
    return out({ error: r.status === 429 ? "openai_quota" : "openai" }, 502);
  }
  await log("voice_secret_issued", session, { who, lang, model: CONFIG.model });
  return out({ value: j.value, expires_at: j.expires_at, model: CONFIG.model, max_seconds: CONFIG.maxSeconds });
});
