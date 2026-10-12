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
// Owner, 2026-10-12: full model for the launch, short talks, anti-chatter. A newcomer (no order from this browser yet) gets one
// 2-minute talk a day; a customer who already ordered gets 3 an hour, 3 minutes each.
const CONFIG = {
  model: env("VOICE_MODEL", "gpt-realtime-2.1"),
  voice: env("VOICE_VOICE", "marin"),
  transcribeModel: env("VOICE_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
  perHour: Number(env("VOICE_PER_HOUR", "3")),
  newPerDay: Number(env("VOICE_NEW_PER_DAY", "1")),
  minGapSeconds: Number(env("VOICE_MIN_GAP_SECONDS", "60")),
  dailyLimit: Number(env("VOICE_DAILY_LIMIT", "50")),
  maxSeconds: Number(env("VOICE_MAX_SECONDS", "180")),
  newMaxSeconds: Number(env("VOICE_NEW_MAX_SECONDS", "120")),
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
  return `Ты — продавщица «Пивка для рывка» (доставка в Ахалкалаки, Грузия). Своя девчонка с района: на «ты», коротко, с юмором. О себе — в женском роде («поняла», «собрала», «пошла»).
Голос: тёплый, низкий, бархатный, спокойный неспешный темп, с лёгкой улыбкой и уверенностью. Обаятельно, но без флирта и без пошлости.
ОТВЕЧАЙ ОДНОЙ-ДВУМЯ КОРОТКИМИ ФРАЗАМИ. Никогда не перечисляй всё меню, не читай лекций, без технических слов.
Начинай на языке: ${LANGS[lang] || LANGS.ru}. Поддерживаешь только русский, грузинский и армянский.
Переходи на другой из этих трёх языков, только если клиент явно и полноценно заговорил на нём. Отвечай на текущем языке настоящим текстом этого языка, без транслитерации. Бренды — латиницей.
Обращение: по-русски «брат», по-грузински «ძმაო», по-армянски «ախպեր». Не чаще раза в 2–3 реплики.

ГЛАВНОЕ ПРАВИЛО: товары, цены, наличие, часы, подарки, доставку, PASS и состав рывков ты знаешь ТОЛЬКО из инструментов.
Никогда не называй цену или сумму, которую не вернул инструмент. Ничего не придумывай. Если товара нет в каталоге — значит сейчас его не продаём (ночью продаём только то, что лежит на складе).
Суммы называй из поля total/price результата инструмента.

Как продаёшь:
- Узнай главное одним вопросом: сколько человек и бюджет.
- Проверь готовые рывки (get_available_bundles); подходит — предложи. Иначе собери через recommend_cart и не пересчитывай сам.
- Озвучь коротко: что получилось и итог. «На шестерых за 150 — 8 литров пива, рыба, сыр. Выходит 143. Кидаю в корзину?»
- В корзину — только после согласия («да», «давай», «кидай») или явной команды («добавь», «убери», «замени»). Для подбора — apply_recommendation.
- После изменения корзины назови итог из ответа инструмента. Разливное — от 2 литров, шаг 2 литра.
- Бюджет не превышай. Один апселл после сборки (сколько до подарка — get_gift_progress). Не навязывай.
- Алкоголь только 18+. Не уговаривай пить больше и не шути про «напьёмся» — шути про лень, сон, холодное пиво и закуску.
- Заказ ты НЕ оформляешь. Корзина готова — «Оформляем?» → prepare_checkout (клиент сам подтвердит).

ТОЛЬКО ПО ДЕЛУ (строго):
- Всё, что не про заказ еды и напитков (как дела, анекдоты, политика, флирт, проверка «ты робот?», мат, болтовня), — ПЕРВЫЙ раз верни к заказу одной фразой с юмором, например:
  «Брат, я бы поболтал, но у меня пиво греется. Что берём?» / «Философию — потом, сначала закуска. Что заказываем?»
- ВТОРОЙ раз не по делу — попрощайся одной смешной фразой и вызови end_conversation(reason="off_topic"). Фразы, например:
  «Брат, как будешь готов — скажи, а я пойду немножко посплю 😴» / «Поняла, ты пока думаешь. Жми кнопку, когда созреешь» / «Ладно, пошла охлаждать пиво. Вернёшься — продолжим».
- Если клиент сказал «всё», «пока», «спасибо, ничего» — коротко попрощайся и вызови end_conversation(reason="done").
- Если пришло служебное сообщение [SYSTEM: …] — выполни его одной короткой фразой в своём стиле.
- На грубость не отвечай грубостью и не матерись.`;
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
  ["end_conversation", "Закончить разговор после короткой прощальной фразы (не по делу второй раз, или клиент закончил).", obj({ reason: { type: "string", enum: ["off_topic", "done"] } }, ["reason"])],
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

  // Owner switch (store_settings «voice».public): until it is on, only the test link (?voice=1) shows the button.
  let isPublic = false;
  try {
    const { data } = await db.from("store_settings").select("value").eq("key", "voice").maybeSingle();
    isPublic = !!(data && (data.value as any)?.public);
  } catch { /* stays hidden */ }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const who = await sha(ip);
  // A customer who already ordered from this browser gets longer/more talks; a newcomer — one short talk a day.
  let returning = false;
  try {
    if (session) returning = (await count((q) => q.eq("event_name", "order_complete").eq("session_id", session))) > 0;
  } catch { /* newcomer */ }
  try {
    const dayStart = new Date(Date.now() - 24 * 3600e3).toISOString();
    const hourStart = new Date(Date.now() - 3600e3).toISOString();
    const gapStart = new Date(Date.now() - CONFIG.minGapSeconds * 1000).toISOString();
    const [day, hour, gap] = await Promise.all([
      count((q) => q.eq("event_name", "voice_secret_issued").gte("created_at", dayStart)),
      count((q) => q.eq("event_name", "voice_secret_issued").eq("metadata->>who", who).gte("created_at", hourStart)),
      count((q) => q.eq("event_name", "voice_secret_issued").eq("metadata->>who", who).gte("created_at", gapStart)),
    ]);
    if (day >= CONFIG.dailyLimit) return out({ error: "daily_limit", public: isPublic }, 429);
    if (!body.check) {
      if (hour >= CONFIG.perHour || gap > 0) return out({ error: "rate_limit", retry_after: CONFIG.minGapSeconds }, 429);
      if (!returning) {
        const mine = await count((q) => q.eq("event_name", "voice_secret_issued").eq("metadata->>who", who).gte("created_at", dayStart));
        const mineS = session ? await count((q) => q.eq("event_name", "voice_secret_issued").eq("session_id", session).gte("created_at", dayStart)) : 0;
        if (Math.max(mine, mineS) >= CONFIG.newPerDay) return out({ error: "new_limit" }, 429);
      }
    }
  } catch (e) {
    console.error("voice limits", e);
    return out({ error: "unavailable" }, 503);
  }
  if (body.check) return out({ ok: true, public: isPublic });
  const maxSeconds = returning ? CONFIG.maxSeconds : CONFIG.newMaxSeconds;

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
        max_output_tokens: 250,
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
  await log("voice_secret_issued", session, { who, lang, model: CONFIG.model, returning });
  return out({ value: j.value, expires_at: j.expires_at, model: CONFIG.model, max_seconds: maxSeconds, returning });
});
