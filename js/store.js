const cart = {};
let catalog = [],
  bundleCatalog = [],
  giftTiers = [],
  upsellRules = [],
  cities = [],
  currentCity = null,
  selected = null,
  selectedQty = 2,
  fulfillment = 'delivery',
  checkoutBundle = null,
  socialType = 'TREAT',
  currentCat = 'shawarma',
  nameI18n = {},
  categoryRows = [],
  catById = {},
  catPicked = false;
const lang = () => document.documentElement.lang || 'ru';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STRONG_GROUP = ['strong', 'vodka', 'whisky', 'brandy', 'rum', 'gin', 'tequila', 'liqueur', 'vermouth'];
const ALCOHOL = [...STRONG_GROUP, 'wine', 'draft', 'beer'];
// Storefront navigation: 6 main tiles, then "Ещё к столу". Empty sections are hidden, never shown as empty shelves.
const CATS = [
  { slug: 'draft', ico: '🍺', label: 'Пиво', title: 'Пиво', grp: 'alc', group: ['draft', 'beer'] },
  { slug: 'strong', ico: '🥃', label: 'Крепкое', title: 'Крепкие напитки', grp: 'alc', group: STRONG_GROUP },
  { slug: 'wine', ico: '🍷', label: 'Вино', title: 'Вино', grp: 'alc' },
  { slug: 'pizza', ico: '🍕', label: 'Пицца и хачапури', title: 'Пицца и хачапури', grp: 'food' },
  { slug: 'shawarma', ico: '🌯', label: 'Шаурма', title: 'Шаурма на мангале', grp: 'food' },
  { slug: 'restaurant', ico: '🍢', label: 'Ресторан', title: 'Ресторанные блюда', grp: 'food' },
  { slug: 'fish', ico: '🐟', label: 'Рыба', title: 'Рыба', grp: 'food' },
  { slug: 'meat-snacks', ico: '🥩', label: 'Мясное', title: 'Мясные закуски', grp: 'food' },
  { slug: 'cheese', ico: '🧀', label: 'Сыр', title: 'Сыр', grp: 'food' },
  { slug: 'nuts', ico: '🥜', label: 'Орехи', title: 'Орехи', grp: 'food' },
  { slug: 'chips', ico: '🍟', label: 'Чипсы', title: 'Чипсы', grp: 'food' },
  { slug: 'snacks', ico: '🥨', label: 'Снеки', title: 'Снеки', grp: 'food' },
  { slug: 'chocolate', ico: '🍫', label: 'Шоколад', title: 'Шоколад', grp: 'food' },
  { slug: 'salty', ico: '🥒', label: 'Соленья', title: 'Соленья и закуски', grp: 'food' },
  { slug: 'seafood', ico: '🦐', label: 'Морепродукты', title: 'Морепродукты', grp: 'food' },
  { slug: 'soft-drinks', ico: '🥤', label: 'Напитки', title: 'Напитки', grp: 'more' },
  { slug: 'energy', ico: '⚡', label: 'Энергетики', title: 'Энергетики', grp: 'more' },
  { slug: 'coffee', ico: '☕', label: 'Кофе', title: 'Кофе', grp: 'more' },
  { slug: 'frozen', ico: '🥟', label: 'Пельмени и хаш', title: 'Пельмени и хаш', grp: 'more' },
  { slug: 'supplies', ico: '🧻', label: 'Посуда и салфетки', title: 'Одноразовая посуда и салфетки', grp: 'more' }
];
// Hot food is baked for the order (products.prep_minutes / prep_batch): the courier picks everything up together.
const FOOD_NOTE = '🍕 Еду пекут под заказ (~{n} мин) — привезём всё вместе: горячую еду и холодное пиво';
// Selling hours (products.sell_from / sell_until, Asia/Tbilisi). The server refuses closed products anyway.
const HOURS = {}, PREP = {};
let catalogAll = [], hoursKey = '';
const hm2min = t => { const [h, m] = String(t).split(':'); return +h * 60 + +m };
// Pre-order: the customer picks a delivery time (Tbilisi). The storefront then shows what is sold at that time, with
// that time's night prices and delivery fee; the server (create_*_preorder) checks the same as of that moment.
let PRE = null;
// Hours are counted by the server's clock (Asia/Tbilisi), not the phone's: SKEW = server now − phone now (public.server_now).
let SKEW = 0;
const nowMs = () => Date.now() + SKEW;
const atDate = () => PRE || new Date(nowMs());
(async () => { try { const t0 = Date.now(), r = await PIVKA_DB.client().rpc('server_now'); if (!r.error && r.data) SKEW = Date.parse(r.data) - (t0 + Date.now()) / 2 } catch (e) {} })();
function tbilisiMin() {
  try { return hm2min(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tbilisi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(atDate())) } catch (e) { const d = atDate(); return d.getHours() * 60 + d.getMinutes() }
}
const tbDay = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' });
function preLabel(d) {
  const day = tbDay(d) === tbDay(new Date()) ? tr('сегодня') : tbDay(d) === tbDay(new Date(Date.now() + 864e5)) ? tr('завтра')
    : d.toLocaleDateString('ru-RU', { timeZone: 'Asia/Tbilisi', day: '2-digit', month: '2-digit' });
  return day + ' ' + d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tbilisi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}
// Half-hour slots from ~40 minutes ahead for two days.
// Store pause (store_settings «pause», public.store_pause): a notice on top and no pre-order slots inside the window.
let PAUSE = null;
const paused = (t) => !!PAUSE && t >= Date.parse(PAUSE.from) && t < Date.parse(PAUSE.until);
async function loadPause() {
  try {
    const r = await PIVKA_DB.client().rpc('store_pause');
    PAUSE = r.error ? null : r.data;
  } catch (e) { PAUSE = null }
  const el = document.getElementById('pauseNote');
  if (el) { el.hidden = !PAUSE; el.textContent = PAUSE ? '⚠️ ' + tr(PAUSE.message || 'Сейчас не работаем') : '' }
  renderPreBar()
}
function preOptions() {
  const step = 30 * 60e3, out = ['<option value="">' + esc(tr('Как можно скорее')) + '</option>'];
  for (let t = Math.ceil((Date.now() + 40 * 60e3) / step) * step; t < Date.now() + 48 * 3600e3; t += step)
    if (!paused(t))
    out.push('<option value="' + t + '"' + (PRE && +PRE === t ? ' selected' : '') + '>' + esc(preLabel(new Date(t))) + '</option>');
  if (PRE && !out.some(o => o.includes('"' + +PRE + '"'))) out.splice(1, 0, '<option value="' + +PRE + '" selected>' + esc(preLabel(PRE)) + '</option>');
  return out.join('')
}
function renderPreBar() {
  const el = document.getElementById('preBar');
  if (!el) return;
  const closed = catalogAll.some(p => { const h = HOURS[p.id]; return h && h[0] && h[1] && !openNow(p) });
  el.hidden = !PRE && !closed && !paused(nowMs());
  if (!el.hidden) el.innerHTML = '<label>🕐 ' + esc(tr(PRE ? 'Предзаказ — привезём к' : 'Предзаказ: выбери время — покажем всё, что будет в продаже')) +
    '<select onchange="setPre(this.value)">' + preOptions() + '</select></label>';
  if (typeof coWhen !== 'undefined' && coWhen) coWhen.innerHTML = preOptions()
}
function setPre(v) {
  PRE = v ? new Date(+v) : null;
  setCatalog(catalogAll);
  // what is not sold at the new time leaves the cart (the server would refuse it)
  Object.keys(cart).forEach(id => { if (!catalog.some(p => p.id === id)) delete cart[id] });
  syncBundle();
  renderNav();
  renderAllPrices();
  restoreCart();
  if (checkoutFormAlive()) { coPickupTime.style.display = fulfillment === 'pickup' && !PRE ? 'block' : 'none'; refreshDeliveryQuote() }
  track('preorder_time', { metadata: { at: PRE ? PRE.toISOString() : null } })
}
// «Осталось N», gone when 0: our own shelf (МАДО…) around the clock; the night assortment (23:00–10:00) from the
// owner's night stock. Only what was entered into the stock can be sold.
const STOCK = {};
const stockNight = () => { const m = tbilisiMin(); return m < 10 * 60 || m >= 23 * 60 };
const stockLeft = p => { const e = STOCK[p.id]; return e && (e.own || stockNight()) ? e.left : null };
async function loadStock() {
  try {
    let r = await PIVKA_DB.client().rpc('shelf_stock');
    if (r.error) r = await PIVKA_DB.client().rpc('night_stock');
    if (!r.error) (r.data || []).forEach(x => STOCK[x.product_id] = { left: Number(x.left_qty), own: !!x.own })
  } catch (e) {}
}
function openNow(p) {
  if (stockLeft(p) !== null && stockLeft(p) <= 0) return false;
  const h = HOURS[p.id];
  if (!h || !h[0] || !h[1]) return true;
  const m = tbilisiMin(), f = hm2min(h[0]), u = hm2min(h[1]);
  return f <= u ? m >= f && m < u : m >= f || m < u
}
// Closed by its own selling hours (the supplier's hours: products.sell_from / sell_until), not by stock.
function closedByHours(p) {
  const h = HOURS[p.id];
  if (!h || !h[0] || !h[1]) return false;
  const m = tbilisiMin(), f = hm2min(h[0]), u = hm2min(h[1]);
  return !(f <= u ? m >= f && m < u : m >= f || m < u)
}
// «Откроется в ЧЧ:ММ»: the supplier's opening time, but not before the shop opens (STORE_OPEN, store_settings.pause.daily.to).
const STORE_OPEN = '10:00';
function opensAt(p) {
  const f = String((HOURS[p.id] || [])[0] || STORE_OPEN).slice(0, 5);
  return hm2min(f) < hm2min(STORE_OPEN) ? STORE_OPEN : f
}
// The shop is closed now (02:00–10:00) and no pre-order time is chosen: the cart can be filled, the order waits.
const shopClosed = () => !PRE && typeof paused === 'function' && paused(nowMs());
// Lines in the cart that are not sold now (their supplier closed while the cart was waiting).
const closedInCart = () => Object.values(cart).filter(x => !openNow(x.p));
function setCatalog(list) {
  catalogAll = list;
  catalog = list.filter(openNow);
  hoursKey = catalog.map(p => p.id).join();
  if (!catProducts(currentCat).length) currentCat = (CATS.find(c => catProducts(c.slug).length) || CATS[0]).slug;
  renderHoursNote();
  renderPreBar()
}
function renderHoursNote() {
  const el = document.getElementById('hoursNote');
  if (!el) return;
  const closed = slug => catalogAll.some(p => slugOf(p) === slug && !openNow(p));
  const beer = closed('draft'), food = closed('pizza');
  const text = beer && food ? (stockNight() ? '🌙 С 23:00 до 02:00 — крепкое и закуска к нему. Магазин — с 10:00, пиво, пицца и хачапури — с 12:00.'
      : '☀️ Пиво, пицца, хачапури и ламаджо — с 12:00. Остальное уже везём.')
    : food ? '🍕 Пицца, хачапури и ламаджо — с 12:00. Пиво уже наливаем.' : '';
  el.hidden = !text || !!PRE;
  el.textContent = text ? tr(text) : ''
}
// «⏱ ~15 мин» next to a dish (products.prep_minutes); lahmajo also says how many go into one oven load.
function prepLabel(p) {
  const [m, b] = PREP[p.id] || [];
  if (!m) return '';
  const t = tr('⏱ Готовим ~{n} мин').replace('{n}', m) + (Number(b) > 2 ? ' · ' + tr('до {b} шт за заход').replace('{b}', b) : '');
  return '<div class="prep">' + esc(t) + '</div>'
}
// Minutes the kitchen needs for these lines: one batch per kind (lahmajo: per 5 pieces), kinds one after another.
function foodMinutes(lines) {
  const g = new Map();
  lines.forEach(([id, q]) => {
    const [prep, batch] = PREP[id] || [];
    if (!prep) return;
    const k = prep + '|' + (batch || 0), x = g.get(k) || { prep: +prep, batch: +batch || 0, q: 0 };
    x.q += Number(q) || 0;
    g.set(k, x)
  });
  let t = 0;
  g.forEach(x => t += x.batch ? Math.ceil(x.q / x.batch) * x.prep : x.prep);
  return t
}
setInterval(async () => {
  await loadStock();
  if (!catalogAll.length || catalogAll.filter(openNow).map(p => p.id).join() === hoursKey) return;
  setCatalog(catalogAll);
  try { bundleCatalog = await PIVKA_DB.listBundles(localStorage.getItem('pivka_city')) } catch (e) {}
  syncBundle();
  renderNav();
  renderProducts();
  renderBundles();
  restoreCart()
}, 60e3);
// Quick add-ons offered in the cart next to a chosen Рывок (one tap, no category hunting).
const ADDON_SKUS = ['KRI-SUPPLY-NAPKIN-2525', 'KRI-SUPPLY-CUPS-PAPER-050', 'KRI-PICKLE-CORNICH-370', 'KRI-PICKLE-CORN-370', 'KRI-NUTS-MARTIN-PISTA-080', 'KRI-CHEESE-STICK-100', 'KRI-SNACK-MARTIN-150', 'KRI-SUPPLY-NAPKIN-3030'];
const SUB_LABEL = {
  vodka: ['водка', 'არაყი', 'օղի'], whisky: ['виски', 'ვისკი', 'վիսկի'], brandy: ['коньяк', 'კონიაკი', 'կոնյակ'],
  strong: ['ликёры', 'ლიქიორები', 'լիկյորներ'], rum: ['ром', 'რომი', 'ռոմ'], gin: ['джин', 'ჯინი', 'ջին'], tequila: ['текила', 'ტეკილა', 'տեկիլա'],
  draft: ['разливное от 2 л', 'ჩამოსასხმელი 2 ლ-დან', 'լցովի 2 լ-ից'], beer: ['в бутылках', 'ბოთლში', 'շշով']
};
// Real photos for section tiles (assets/cat): scene crops from the bar photo, or real packshots on the same bar backdrop.
const CAT_IMG = ['shawarma', 'draft', 'strong', 'wine', 'pizza', 'restaurant', 'fish', 'meat-snacks', 'cheese', 'nuts', 'chips', 'snacks', 'soft-drinks', 'energy', 'salty', 'seafood', 'frozen', 'supplies'];
const catImg = slug => CAT_IMG.includes(slug) ? './assets/cat/' + slug + '.jpg?v=20261014a' : '';
const LI = () => ({ ru: 0, ka: 1, hy: 2 }[lang()] || 0);
const tr = s => (window.PIVKA_I18N ? PIVKA_I18N.translate(s, lang()) : s);
function catConf(slug) {
  return CATS.find(c => c.slug === slug) || CATS.find(c => c.group && c.group.includes(slug)) || null
}
function slugOf(p) {
  return p?.categories?.slug || p?.category_slug || ''
}
function inCat(p, slug) {
  const c = CATS.find(x => x.slug === slug);
  return c && c.group ? c.group.includes(slugOf(p)) : slugOf(p) === slug
}
function catProducts(slug) {
  return catalog.filter(p => inCat(p, slug))
}
function plural(n, forms) {
  if (LI()) return n + ' ' + forms[LI() + 2];
  const m10 = n % 10, m100 = n % 100;
  return n + ' ' + (m10 === 1 && m100 !== 11 ? forms[0] : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? forms[1] : forms[2])
}
function countLabel(slug, n) {
  return slug === 'draft' ? plural(n, ['сорт', 'сорта', 'сортов', 'სახეობა', 'տեսակ']) : plural(n, ['позиция', 'позиции', 'позиций', 'პროდუქტი', 'ապրանք'])
}
// Where this visit came from (admin «Аналитика» → «Откуда»):
//   qr / qr:<spot> — the poster QR (/qr/ teaser → ?from=qr); friend — «Подлови друга»; link:<name> — a link we send (?s=tg, ?s=wa, ?s=ig…);
//   google / instagram / facebook / telegram / whatsapp / <site> — by referrer; direct — typed, saved or an app that hides the referrer.
function visitSource() {
  try { const s = sessionStorage.getItem('pivka_src'); if (s) return s } catch (e) {}
  const q = new URLSearchParams(location.search), c = campaignInfo()?.last || {};
  const clean = x => String(x || '').toLowerCase().replace(/[^\w.-]/g, '').slice(0, 30);
  let src = '';
  if (q.get('from') === 'qr') src = c.utm_source === 'friend' ? 'friend' : 'qr' + (c.spot ? ':' + clean(c.spot) : '');
  else if (q.get('s')) src = 'link:' + clean(q.get('s'));
  else if (q.get('utm_source')) src = clean(q.get('utm_source'));
  else {
    let h = '';
    try { h = document.referrer ? new URL(document.referrer).hostname : '' } catch (e) {}
    if (h && h !== location.hostname) src = /google\./.test(h) ? 'google' : /instagram/.test(h) ? 'instagram' : /facebook|fb\./.test(h) ? 'facebook' : /t\.me|telegram/.test(h) ? 'telegram' : /whatsapp|wa\.me/.test(h) ? 'whatsapp' : clean(h);
  }
  src = src || 'direct';
  try { sessionStorage.setItem('pivka_src', src); if (!localStorage.getItem('pivka_src_first')) localStorage.setItem('pivka_src_first', src) } catch (e) {}
  return src
}
function track(event, extra = {}) {
  try { PIVKA_DB.trackEvent(event, extra) } catch (e) {}
}

function pname(p) {
  if (!p) return '';
  const n = p.name_i18n || nameI18n[p.id || p.product_id];
  return (n && n[lang()]) || p.name || ''
}

function unitL() {
  return {
    ru: ' л',
    ka: ' ლ',
    hy: ' լ'
  } [lang()] || ' л'
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]))
}
const money = n => Number(n).toFixed(2).replace('.00', '') + ' ₾';

function openRequest() {
  requestOverlay.classList.add('on')
}
async function sendRequest() {
  if (requestProduct.value.trim().length < 2) {
    alert('Напиши название товара');
    return
  }
  try {
    await PIVKA_DB.submitProductRequest(requestProduct.value.trim(), requestPhone.value.trim(), requestComment.value.trim());
    requestBody.innerHTML = '<div class="success"><div class="big">✓</div><h2>Записали</h2><p class="muted">Если такой товар часто спрашивают, магазин увидит это в разделе спроса.</p></div>'
  } catch (e) {
    alert(e.message)
  }
}

let repeatItems = [];
function openRepeat() {
  repeatOverlay.classList.add('on');
  repeatResult.innerHTML = '';
  try {
    const phone = JSON.parse(localStorage.getItem('pivka_profile') || '{}').phone;
    if (phone && !repeatPhone.value) repeatPhone.value = phone
  } catch (e) {}
  if (repeatPhone.value.trim()) findRepeat()
}
async function findRepeat() {
  const phone = repeatPhone.value.trim();
  if (!phoneOk(phone)) {
    repeatResult.innerHTML = '<div class="error">Введите номер полностью, например 591 24 40 75</div>';
    return
  }
  repeatResult.innerHTML = '<div class="muted">Ищем…</div>';
  try {
    const r = await retry(() => PIVKA_DB.getRepeatOrder(phone));
    if (!r.found) {
      repeatResult.innerHTML = '<div class="empty">Прошлый заказ с этим номером не найден. Проверьте номер — можно без +995.</div>';
      return
    }
    repeatItems = r.items || [];
    // Stock is not checked: supplier goods have no stock in the database, so only switched-off products count as missing.
    const unavailable = (r.items || []).filter(i => !i.active);
    repeatResult.innerHTML = '<h3>Заказ №' + r.order_number + '</h3>' + (r.items || []).map(i => '<div class="line row"><span>' + esc(i.name) + ' × ' + i.quantity + '</span><b>' + money(Number(i.current_price) * Number(i.quantity)) + '</b></div>').join('') + (unavailable.length ? '<div class="error">Некоторых товаров сейчас не хватает. Добавим доступные, остальные можно заменить вручную.</div>' : '') + '<button class="yellow checkout" onclick="applyRepeat()">Добавить в корзину →</button>'
  } catch (e) {
    repeatResult.innerHTML = '<div class="error">Не получилось найти заказ — проверьте интернет и попробуйте ещё раз.</div>'
  }
}

function applyRepeat() {
  const items = repeatItems;
  items.forEach(i => {
    const p = catalog.find(x => x.id === i.product_id);
    if (!p || !p.active) return;
    PIVKA_DB.trackEvent('add_to_cart', {
      productId: p.id
    });
    cart[p.id] = {
      p,
      qty: p.unit === 'liter' ? Math.max(2, Math.floor(Number(i.quantity) / 2) * 2) : Number(i.quantity)
    }
  });
  renderCart();
  closeSheet('repeatOverlay');
  openCart()
}

// 9 digits (591 24 40 75) or with the country code (+995 591 24 40 75).
function phoneOk(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 9 || (d.length === 12 && d.startsWith('995'))
}

// Order status for the customer. The browser keeps the id of the order it just placed (a random uuid) and asks the
// database for its status — no phone, no login. Steps: Получен → Принят → Собран → (30 s) Едет → Доставлен / Отменён.
const TRACK_KEY = 'pivka_last_order';
// Referral: ?ref=CODE (a friend's personal link) is kept until this phone's first order; the server credits the
// friend only if this is really a new customer. Points: up to 10 % of the products (not Рывки), no gift then.
const REF_RE = /^[A-Z0-9]{4,10}$/;
const SHARE_TEXT = '🎁 Дарю тебе бесплатную доставку + закуску к первому заказу в «Пивка для рывка» — шашлык, пицца, хачапури домой, платишь курьеру.\nЖми 👇\n{link}\nА после заказа возьми свою ссылку — тоже дари друзьям подарок и получай 50% с их первого заказа баллами 😉';
let REF = '';
try {
  const q = (new URLSearchParams(location.search).get('ref') || '').toUpperCase();
  if (REF_RE.test(q)) {
    localStorage.setItem('pivka_ref', q);
    // one «came by a friend's link» per tab, for the owner's referral funnel
    if (sessionStorage.getItem('pivka_ref_seen') !== q) { sessionStorage.setItem('pivka_ref_seen', q); setTimeout(() => track('ref_visit', { metadata: { code: q } }), 0) }
  }
  REF = localStorage.getItem('pivka_ref') || '';
  if (!REF_RE.test(REF)) REF = ''
} catch (e) {}
let BONUS = { balance: 0, pct: 10, use: true };
// «Подарок от друга»: who invited and what a new customer gets on the first order (store_settings.referral.friend_*).
// The server decides (private.apply_friend_gift); here it is only shown. eligible: null = phone not typed yet.
let GIFT = null, giftSeq = 0;
setTimeout(() => loadGift(), 0);
async function loadGift(phone) {
  if (!REF) return;
  const seq = ++giftSeq;   // the phone may change while a check is on its way: only the latest answer counts
  try {
    const r = await PIVKA_DB.client().rpc('ref_gift_info', { p_code: REF, p_phone: phone || null });
    if (seq !== giftSeq) return;
    GIFT = r.error || !r.data ? null : r.data
  } catch (e) {}
  renderGiftBanner()
}
const giftName = () => GIFT?.gift ? (GIFT.gift[lang()] || GIFT.gift.ru) : '';
const giftOn = () => !!GIFT && GIFT.eligible !== false;
const giftApplies = () => giftOn() && payGoods() >= Number(GIFT.min || 0);
function renderGiftBanner() {
  const el = document.getElementById('giftBanner');
  if (!el) return;
  el.hidden = !giftOn();
  if (el.hidden) return;
  el.querySelector('b').textContent = '🎁 ' + tr(GIFT.name ? 'Тебя пригласил {name} — «Пивка для рывка» дарит тебе бесплатную доставку + {gift} к первому заказу от {min} ₾' : 'Тебя пригласил друг — «Пивка для рывка» дарит тебе бесплатную доставку + {gift} к первому заказу от {min} ₾')
    .replace('{name}', GIFT.name || '').replace('{gift}', giftName()).replace('{min}', GIFT.min);
  // came to order, not to invite: the «раздай свою ссылку» banner waits until after the first order
  const rb = document.getElementById('refBanner');
  if (rb) rb.style.display = 'none'
}
// Demo mode for recording promo videos (?demo=ryvok, kept for the tab): 50 points on any phone, and «Подтвердить
// заказ» shows the success screen without creating anything — no order, no bots, no suppliers, no courier.
let DEMO = false;
try {
  if (new URLSearchParams(location.search).get('demo') === 'ryvok') sessionStorage.setItem('pivka_demo', '1');
  DEMO = sessionStorage.getItem('pivka_demo') === '1'
} catch (e) {}
// A points order has no discounts and no gift: a Рывок then goes at the full price of its products.
const fullBase = () => totals() + (checkoutBundle ? Number(checkoutBundle.regular_total || checkoutBundle.price || 0) : 0);
const bonusX = () => BONUS.use && BONUS.balance > 0 ? Math.min(BONUS.balance, Math.floor(fullBase() * BONUS.pct / 100 * 2) / 2) : 0;
// goods to pay: with points — full prices minus points, otherwise the usual (Рывок discount)
const payGoods = () => bonusX() > 0 ? fullBase() - bonusX() : orderBase();
async function loadBonus() {
  const ph = coPhone.value.trim();
  BONUS.balance = 0;
  if (DEMO && ph.replace(/\D/g, '').length >= 9) BONUS.balance = 50;
  else if (ph.replace(/\D/g, '').length >= 9) try {
    const r = await PIVKA_DB.client().rpc('bonus_info', { p_phone: ph });
    if (!r.error && r.data) BONUS = { ...BONUS, balance: Number(r.data.balance) || 0, pct: Number(r.data.spend_percent) || 10 }
  } catch (e) {}
  renderBonus();
  if (REF) await loadGift(ph.replace(/\D/g, '').length >= 9 ? ph : null);
  refreshDeliveryQuote()
}
function renderBonus() {
  const el = document.getElementById('coBonus');
  if (!el) return;
  const x = Math.min(BONUS.balance, Math.floor(fullBase() * BONUS.pct / 100 * 2) / 2);
  el.hidden = !(BONUS.balance > 0);
  if (el.hidden) return;
  el.innerHTML = '<input type="checkbox" id="coBonusUse"' + (BONUS.use ? ' checked' : '') + '> <span>💎 ' + esc(tr('Списать баллы')) + ': <b>−' + money(x) + '</b> · ' +
    esc(tr('у тебя')) + ' ' + money(BONUS.balance) + '<br><small>' + esc(tr(checkoutBundle ? 'До {p}% от заказа. С баллами рывок — по полной цене, без скидки и подарка.' : 'До {p}% от заказа. Заказ с баллами — без скидок и подарков.').replace('{p}', BONUS.pct)) + '</small></span>';
  el.querySelector('input').onchange = e => { BONUS.use = e.target.checked; renderBonus(); refreshDeliveryQuote() }
}
// «Пригласи друга»: the personal link of the phone that made this order.
async function referralCard(orderId) {
  try {
    const r = await PIVKA_DB.client().rpc('referral_info', { p_order: orderId });
    if (r.error || !r.data?.code) return '';
    const d = r.data, link = location.origin + location.pathname.replace(/[^/]*$/, '') + '?ref=' + d.code;
    return '<div class="refCard"><b>🤝 ' + esc(tr('Пригласи друга — получи {p}% от его первого заказа баллами').replace('{p}', d.reward_percent)) + '</b>' +
      '<span>' + esc(tr('1 балл = скидка 1 ₾, до {p}% каждого заказа. Баллы на наличные не меняются.').replace('{p}', d.spend_percent)) + (Number(d.balance) > 0 ? ' ' + esc(tr('У тебя')) + ': <b>' + money(d.balance) + '</b>' : '') + '</span>' +
      '<input readonly value="' + esc(link) + '" onclick="this.select()">' +
      '<button type="button" class="yellow checkout" onclick="shareRef(\'' + esc(link) + '\')">' + esc(tr('Отправить ссылку другу')) + '</button></div>'
  } catch (e) { return '' }
}
// «Пригласи друга» is a campaign (store_settings.referral.until): when it is over, the button and the curtain line go.
(async () => {
  try {
    const r = await PIVKA_DB.client().rpc('referral_status');
    if (r.error || !r.data || r.data.active) return;
    document.getElementById('refBanner')?.remove();
    document.getElementById('introRef')?.remove()
  } catch (e) {}
})();
// Home page: anyone gets the personal link by phone — no order needed (virality first).
function openRef() {
  try {
    const p = JSON.parse(localStorage.getItem('pivka_profile') || '{}');
    if (!refPhone.value && p.phone) refPhone.value = p.phone;
    if (!refName.value && p.name) refName.value = p.name
  } catch (e) {}
  refError.textContent = '';
  openSheet('refOverlay');
  track('ref_open')
}
// Came by the stories link (?invite) only to eat: close the sheet and go to the food.
function refToMenu() {
  closeSheet('refOverlay');
  (document.getElementById('bundlesSection') || document.getElementById('buildSection'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  track('ref_to_menu')
}
async function getRefLink() {
  refError.textContent = '';
  const phone = refPhone.value.trim();
  if (phone.replace(/\D/g, '').length < 9) { refError.textContent = tr('Укажи номер телефона'); return }
  refGo.disabled = true;
  try {
    const r = await PIVKA_DB.client().rpc('my_ref_link', { p_phone: phone, p_name: refName.value.trim() || null, p_ref: REF || null });
    if (r.error) throw r.error;
    const d = r.data, link = location.origin + location.pathname.replace(/[^/]*$/, '') + '?ref=' + d.code;
    try { const p = JSON.parse(localStorage.getItem('pivka_profile') || '{}'); localStorage.setItem('pivka_profile', JSON.stringify({ ...p, phone, name: refName.value.trim() || p.name || '' })) } catch (e) {}
    refOut.innerHTML = '<div class="refCard"><b>🔗 ' + esc(tr('Твоя ссылка')) + '</b>' +
      (Number(d.balance) > 0 || Number(d.friends) > 0 ? '<span>' + esc(tr('У тебя')) + ': <b>' + money(d.balance) + '</b> · ' + esc(tr('друзей')) + ': ' + Number(d.friends) + '</span>' : '') +
      '<input readonly value="' + esc(link) + '" onclick="this.select()">' +
      '<button type="button" class="yellow checkout" onclick="shareRef(\'' + esc(link) + '\')">' + esc(tr('Отправить ссылку другу')) + '</button></div>';
    refGo.hidden = true;
    track('ref_link', { metadata: { code: d.code, friends: Number(d.friends) || 0 } })
  } catch (e) {
    refError.textContent = e.message || tr('Не получилось. Попробуй ещё раз.')
  }
  refGo.disabled = false
}
async function shareRef(link) {
  // Points are a discount, not money: the friend's text says «бонусные баллы», never «деньги».
  const text = tr(SHARE_TEXT).replace('{link}', link);
  const code = (link.match(/[?&]ref=([A-Z0-9]+)/) || [])[1] || '';
  try { if (navigator.share) { await navigator.share({ text }); track('ref_share', { metadata: { code, via: 'share' } }); return } } catch (e) { return }
  track('ref_share', { metadata: { code, via: 'copy' } });
  try { await navigator.clipboard.writeText(link); alert(tr('Ссылка скопирована')) } catch (e) { prompt('', link) }
}
const TRACK_KEEP_MS = 60e3; // a cancelled order's card disappears after a minute (owner, 2026-10-12)
const TRACK_DELIVERED_KEEP_MS = 24 * 3600e3; // after delivery only the game stays — up to a day, while attempts remain
// Someone who ordered in the last 12 hours comes back to see the status: skip the long intro credits.
try {
  const o = JSON.parse(localStorage.getItem('pivka_last_order') || 'null');
  if (o && o.at && Date.now() - o.at < 12 * 3600e3) sessionStorage.setItem('pivka_intro_short', '1')
} catch (e) {}
let trackTimer = null;

function trackSaved() {
  try {
    return JSON.parse(localStorage.getItem(TRACK_KEY) || 'null')
  } catch (e) {
    return null
  }
}

// trackTime / trackNow / trackSteps live in js/track.js (shared with order.html).

let trackTick = null;
function renderTrack(o) {
  const box = document.getElementById('orderTrack');
  if (!box) return;
  clearTimeout(trackTick);
  box.innerHTML = '<div class="trackHead"><b>Ваш заказ</b><span>Заказ №' + esc(o.order_number) + '</span></div><ol class="track">' +
    trackSteps(o).map(s => '<li class="' + s[2] + '"><i></i><span>' + esc(s[0]) + '</span><time>' + trackTime(s[1]) + '</time></li>').join('') + '</ol>' +
    // Until the courier confirms, the customer can still change the order.
    (o.status === 'NEW' ? '<a class="trackEdit" href="./edit.html?o=' + encodeURIComponent(trackSaved()?.id || '') + '">✏️ Изменить заказ</a>' : '') +
    '<div class="ryvokSlot"></div>' +
    '<a class="trackMore" href="./order.html?o=' + encodeURIComponent(trackSaved()?.id || '') + '">Что заказано и статус →</a>';
  box.hidden = false;
  // «Рывок» game: appears only after the courier pressed «Еду»; loads on its own and never blocks the card.
  const gid = trackSaved()?.id;
  if (gid && ryvokEligible(o)) ryvokState(gid).then(g => {
    const slot = box.querySelector('.ryvokSlot');
    if (slot && trackSaved()?.id === gid) slot.innerHTML = ryvokBlock(gid, g, document.documentElement.lang || 'ru');
  });
  if (o.status === 'OUT_FOR_DELIVERY' && o.fulfillment !== 'pickup' && o.ready_at) {
    // Switch «Собран» → «Едет» exactly on time, without waiting for the next poll.
    const left = new Date(o.ready_at).getTime() + 30e3 - trackNow(o);
    if (left > 0) trackTick = setTimeout(() => renderTrack(o), left + 300)
  }
}

async function refreshTrack() {
  clearTimeout(trackTimer);
  const saved = trackSaved();
  const box = document.getElementById('orderTrack');
  if (!saved || !saved.id || !box) {
    if (box) box.hidden = true;
    return false
  }
  try {
    const o = await PIVKA_DB.orderTrack(saved.id);
    if (!o) throw new Error('gone');
    o._at = Date.now();
    const end = o.delivered_at || o.cancelled_at;
    const keep = o.status === 'DELIVERED' ? TRACK_DELIVERED_KEEP_MS : TRACK_KEEP_MS;
    if (end && new Date(o.now) - new Date(end) > keep) throw new Error('old');
    // Delivered: the order itself leaves the page; only the «Рывок» game stays (up to a day) until the attempts are used.
    if (o.status === 'DELIVERED') {
      const g = await ryvokState(saved.id, 5e3);
      if (!g || !(g.left > 0)) throw new Error('old');
      clearTimeout(trackTick);
      box.innerHTML = ryvokBlock(saved.id, g, document.documentElement.lang || 'ru').replace('🎮 Пока везём — сделай рывок!', tr('🎮 Доиграй рывок — чемпионат месяца!'));
      box.hidden = false;
      trackTimer = setTimeout(refreshTrack, 60e3);
      return true
    }
    renderTrack(o);
    if (!['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status)) trackTimer = setTimeout(refreshTrack, 20e3);
    else if (end) trackTimer = setTimeout(refreshTrack, Math.min(60e3, Math.max(5e3, keep - (new Date(o.now) - new Date(end)) + 2e3))); // hides itself on an open page; refreshes the game block
    return true
  } catch (e) {
    if (e.message === 'gone' || e.message === 'old') {
      try { localStorage.removeItem(TRACK_KEY) } catch (x) {}
      box.hidden = true;
      return false
    }
    trackTimer = setTimeout(refreshTrack, 30e3); // no internet: keep the last shown state and try again
    return !box.hidden
  }
}

// Last order on the home page: shown without any input when the phone was saved at checkout.
let lastOrderItems = [];
async function renderLastOrder() {
  const box = document.getElementById('lastOrder');
  if (!box) return;
  let phone = '';
  try {
    phone = JSON.parse(localStorage.getItem('pivka_profile') || '{}').phone || ''
  } catch (e) {}
  if (!phoneOk(phone)) return;
  try {
    const r = await PIVKA_DB.getRepeatOrder(phone);
    if (!r || !r.found || !(r.items || []).length) return;
    lastOrderItems = r.items;
    const names = r.items.slice(0, 3).map(i => esc(i.name) + ' × ' + Number(i.quantity)).join(', ') + (r.items.length > 3 ? ' +' + (r.items.length - 3) : '');
    box.innerHTML = '<div class="trackHead"><b>🔁 Ваш прошлый заказ</b><span>№' + esc(r.order_number) + '</span></div><div class="lastItems">' + names + '</div>' +
      '<div class="lastBtns"><button type="button" class="yellow" onclick="repeatLast()">Повторить →</button><button type="button" class="skip" onclick="openRepeat()">Другой номер</button></div>';
    box.hidden = false;
    const quick = document.getElementById('repeatQuick');
    if (quick) quick.hidden = true;
    // «Повторить» is only for those who already ordered; a newcomer never sees it.
    const card = document.getElementById('repeatCard');
    if (card) card.hidden = false
  } catch (e) {
    console.warn(e)
  }
}

function repeatLast() {
  repeatItems = lastOrderItems;
  applyRepeat()
}

async function initOrderTrack() {
  // While the status card is shown it is the same order, so the «last order» card would only repeat it.
  if (!(await refreshTrack())) renderLastOrder()
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && trackSaved()) refreshTrack()
});
// Back from the game page (browser back keeps the old page in memory): re-check, so a finished game closes the card.
window.addEventListener('pageshow', (e) => { if (e.persisted && trackSaved()) refreshTrack() });

function openSocial(type) {
  socialType = type;
  socialTitle.textContent = type === 'TREAT' ? '🍻 Угостить друга' : '🏆 Спорим на пиво?';
  socialSub.textContent = type === 'TREAT' ? 'Выбери угощение и отправь ссылку другу' : 'Выбери ставку и отправь ссылку сопернику';
  socialBody.innerHTML = '<input id="socialName" placeholder="Твоё имя"><input id="socialPhone" inputmode="tel" autocomplete="tel" placeholder="Твой телефон *"><select id="socialStake"></select><textarea id="socialMessage" placeholder="Сообщение другу"></textarea><div class="error" id="socialError"></div><button class="yellow checkout" onclick="createSocial()">Создать ссылку →</button>';
  // Outside the selling hours (morning: beer and «рывки» from 10–12) the choice used to be empty. The friend accepts
  // the link later, so offer everything and say when it opens; the order itself is created only on acceptance.
  const later = b => b.unavailable_reason === 'CLOSED_NOW';
  const opts = bundleCatalog.filter(b => b.available !== false || later(b)).map(b => '<option value="b:' + b.id + '">' + esc(tr(b.name)) + ' — ' + money(b.price) + (later(b) ? ' · ' + tr('днём') : '') + '</option>');
  (catalogAll.length ? catalogAll : catalog).filter(p => p.unit === 'liter').forEach(p => opts.push('<option value="p:' + p.id + '">' + esc(pname(p)) + ' — ' + money(Number(p.sale_price) * Number(p.minimum_quantity || 2)) + (openNow(p) ? '' : ' · ' + tr('с 12:00')) + '</option>'));
  socialStake.innerHTML = opts.length ? opts.join('') : '<option value="">' + esc(tr(type === 'TREAT' ? 'Угощения появятся после открытия' : 'Ставки появятся после открытия')) + '</option>';
  const prof = JSON.parse(localStorage.getItem('pivka_profile') || '{}');
  socialName.value = prof.name || '';
  socialPhone.value = prof.phone || '';
  socialOverlay.classList.add('on')
}
async function createSocial() {
  socialError.textContent = '';
  if (socialPhone.value.trim().length < 6) {
    socialError.textContent = 'Укажи телефон';
    return
  }
  if (!socialStake.value) {
    socialError.textContent = tr(socialType === 'TREAT' ? 'Выбери угощение' : 'Выбери ставку');
    return
  }
  const [kind, id] = socialStake.value.split(':');
  try {
    const r = await PIVKA_DB.createSocialOrder({
      type: socialType,
      name: socialName.value.trim(),
      phone: socialPhone.value.trim(),
      bundleId: kind === 'b' ? id : null,
      productId: kind === 'p' ? id : null,
      quantity: kind === 'p' ? ((catalogAll.length ? catalogAll : catalog).find(x => x.id === id)?.minimum_quantity || 2) : 1,
      message: socialMessage.value.trim()
    });
    const link = location.origin + location.pathname + '?social=' + r.token;
    socialBody.innerHTML = '<div class="success"><div class="big">' + (socialType === 'TREAT' ? '🍻' : '🏆') + '</div><h2>Ссылка готова</h2><p class="muted">Отправь её другу. Он откроет ссылку и подтвердит участие/адрес.</p><input id="shareLink" value="' + link + '" readonly><button class="yellow checkout" onclick="navigator.clipboard.writeText(shareLink.value)">Скопировать ссылку</button></div>'
  } catch (e) {
    socialError.textContent = e.message
  }
}
async function openIncoming(token) {
  try {
    const x = await PIVKA_DB.getSocialOrder(token);
    socialTitle.textContent = x.type === 'BET' ? '🏆 Тебя вызывают на спор' : '🍻 Тебя хотят угостить';
    socialSub.textContent = x.bundle_name || x.product_name || 'Пивка для рывка';
    socialBody.innerHTML = '<div class="form"><p class="muted">' + (x.message || '') + '</p><input id="inName" placeholder="Твоё имя"><input id="inPhone" inputmode="tel" placeholder="Телефон"><input id="inAddress" placeholder="Адрес"><button class="yellow checkout" onclick="acceptIncoming(\'' + token + '\')">' + (x.type === 'BET' ? 'Принять спор' : 'Принять угощение') + '</button></div>';
    socialOverlay.classList.add('on')
  } catch (e) {}
}
async function acceptIncoming(token) {
  try {
    const r = await PIVKA_DB.acceptSocialOrder(token, {
      name: inName.value,
      phone: inPhone.value,
      address: inAddress.value
    });
    socialBody.innerHTML = r.type === 'BET' ? '<div class="success"><div class="big">🏆</div><h2>Спор принят</h2><p class="muted">После результата проигравший подтверждает проигрыш и оплачивает ставку.</p><button class="yellow checkout" onclick="declareLoss(\'' + token + '\',\'RECIPIENT\')">Я проиграл</button></div>' : '<div class="success"><div class="big">🍻</div><h2>Адрес подтверждён</h2><p class="muted">Теперь отправитель может оплатить угощение.</p><button class="yellow checkout" onclick="prepareTreat(\'' + token + '\')">Подготовить заказ к оплате</button></div>'
  } catch (e) {
    alert(e.message)
  }
}
async function prepareTreat(token) {
  try {
    const r = await PIVKA_DB.finalizeTreat(token);
    socialBody.innerHTML = '<div class="success"><div class="big">💳</div><h2>Заказ №' + r.order_number + ' подготовлен</h2><p class="muted">Сумма: ' + money(r.total) + '<br>Он ждёт онлайн-оплаты. Платёжный провайдер подключим отдельно — до этого заказ не считается оплаченным.</p></div>'
  } catch (e) {
    alert(e.message)
  }
}
async function declareLoss(token, side) {
  try {
    const r = await PIVKA_DB.resolveBet(token, side);
    socialBody.innerHTML = '<div class="success"><div class="big">💳</div><h2>Результат записан</h2><p class="muted">Заказ победителю создан и ждёт онлайн-оплаты проигравшим. Доставка не запускается до подтверждения оплаты.</p></div>'
  } catch (e) {
    alert(e.message)
  }
}

function closeSheet(id) {
  document.getElementById(id).classList.remove('on')
}

function icon(p) {
  const x = p.categories?.slug;
  return ['strong', 'vodka', 'whisky', 'brandy', 'rum', 'gin', 'tequila', 'wine'].includes(x) ? '🥃' : x === 'fish' ? '🐟' : x === 'cheese' ? '🧀' : x === 'snacks' ? '🥨' : x === 'chips' ? '🍟' : x === 'nuts' ? '🥜' : x === 'soft-drinks' ? '🥤' : '🍺'
}

// Android / iOS keyboard: keep open sheets inside the visible part of the screen and the focused field in view.
(function () {
  const vv = window.visualViewport, root = document.documentElement;
  const fit = () => { if (!vv) return; root.style.setProperty('--vvh', vv.height + 'px'); root.style.setProperty('--vvt', vv.offsetTop + 'px') };
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit() }
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!t.matches || !t.matches('.sheet input, .sheet textarea, .sheet select')) return;
    setTimeout(() => { fit(); t.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 320)
  })
})();
function openSheet(id) {
  document.getElementById(id).classList.add('on')
}

function bumpCart() {
  const bar = document.querySelector('.cart');
  if (!bar || reducedMotion) return;
  bar.classList.remove('bump');
  void bar.offsetWidth;
  bar.classList.add('bump')
}

function openQty(p) {
  selected = p;
  selectedQty = Math.max(2, Number(p.minimum_quantity || 2));
  const step = Math.max(2, Number(p.quantity_step || 2));
  qtyName.textContent = pname(p);
  // Draft beer: 2 / 4 / 6 / 8 л only (min 2, step 2).
  const vals = [0, 1, 2, 3].map(i => selectedQty + i * step);
  qtyButtons.innerHTML = vals.map((v, i) => `<button type="button" class="q ${i?'':'on'}" onclick="pickQty(this,${v})">${v}${unitL()}<br><small>${money(v*p.sale_price)}</small></button>`).join('');
  qtyAdd.onclick = () => {
    closeSheet('qtyOverlay');
    add(p, selectedQty)
  };
  track('product_view', { productId: p.id });
  openSheet('qtyOverlay')
}

function pickQty(el, q) {
  selectedQty = q;
  document.querySelectorAll('.q').forEach(x => x.classList.remove('on'));
  el.classList.add('on')
}

function add(p, q = 1, opts = {}) {
  if (p.unit === 'liter') q = Math.max(2, Math.floor(Number(q) / 2) * 2);
  const left = stockLeft(p);
  if (left !== null && (cart[p.id]?.qty || 0) + q > left) {
    q = left - (cart[p.id]?.qty || 0);
    if (q <= 0) { alert(tr('На складе осталось только {n}').replace('{n}', left)); return }
  }
  if (cart[p.id]) cart[p.id].qty += q;
  else cart[p.id] = { p, qty: q };
  const via = opts.boost ? 'gift_boost' : upsellReturn ? 'upsell' : 'catalog';
  track('add_to_cart', { productId: p.id, metadata: { qty: q, via } });
  if (window.pivkaSound) pivkaSound('add');
  if (via !== 'catalog') track('upsell_add', { productId: p.id, metadata: { via, category: slugOf(p) } });
  renderCart();
  bumpCart();
  if (upsellReturn) {
    renderProducts();
    return
  }
  if (!opts.boost) setTimeout(() => offerUpsell(p), 180)
}

function chooseBundle(id) {
  const b = bundleCatalog.find(x => x.id === id);
  if (!b || b.available === false) return;
  checkoutBundle = b;
  try {
    localStorage.setItem('pivka_bundle', b.id)
  } catch (e) {}
  track('bundle_add', { bundleId: b.id });
  cartHint.textContent = 'Готовый рывок «' + b.name + '» выбран. Теперь добавь к нему любые товары.';
  renderCart();
  renderBundles();
  openCart()
}

function removeBundle() {
  checkoutBundle = null;
  try {
    localStorage.removeItem('pivka_bundle')
  } catch (e) {}
  renderCart();
  renderBundles();
  openCart()
}

// Рывки: the server says whether a Рывок is on sale now; for a pre-order it is re-checked against the chosen time.
function preBundles() {
  bundleCatalog.forEach(b => {
    if (!('_av' in b)) { b._av = b.available; b._ur = b.unavailable_reason }
    if (!PRE) { b.available = b._av; b.unavailable_reason = b._ur; return }
    const can = b._av !== false || b._ur === 'CLOSED_NOW';
    const ok = can && (b.items || []).every(i => { const p = catalogAll.find(x => x.id === i.product_id); return !p || openNow(p) });
    b.available = ok;
    b.unavailable_reason = ok ? null : can ? 'CLOSED_NOW' : b._ur
  })
}
function syncBundle() {
  preBundles();
  let id = checkoutBundle?.id;
  if (!id) try {
    id = localStorage.getItem('pivka_bundle')
  } catch (e) {}
  if (!id) return;
  const b = bundleCatalog.find(x => x.id === id);
  checkoutBundle = b && b.available !== false ? b : null;
  if (!checkoutBundle) try {
    localStorage.removeItem('pivka_bundle')
  } catch (e) {}
}

// Photo/composition order: strong first (ЁРШ), then beer, fish, meat, cheese, nuts, chips, seeds, drinks.
const ITEM_RANK = { strong: 0, vodka: 0, whisky: 0, brandy: 0, rum: 0, gin: 0, tequila: 0, liqueur: 0, vermouth: 0, wine: 1, draft: 1, fish: 2, 'meat-snacks': 3, cheese: 4, nuts: 5, chips: 6, snacks: 7, chocolate: 7, 'soft-drinks': 8, energy: 8 };
const ITEM_ICO = { draft: '🍺', wine: '🍷', fish: '🐟', 'meat-snacks': '🥩', cheese: '🧀', nuts: '🥜', chips: '🥔', snacks: '🌻', chocolate: '🍫', 'soft-drinks': '🥤', energy: '⚡' };

function itemSlug(i) {
  return slugOf(catalog.find(p => p.id === i.product_id)) || ''
}

function sortedItems(b) {
  return (b.items || []).slice().sort((a, c) => (ITEM_RANK[itemSlug(a)] ?? 9) - (ITEM_RANK[itemSlug(c)] ?? 9))
}

function itemQty(i) {
  const q = Number(i.quantity);
  return i.unit === 'liter' ? q + unitL() : q > 1 ? '× ' + q : ''
}

function bundleItemsText(b) {
  return sortedItems(b).map(i => esc(pname(i)) + ' × ' + Number(i.quantity) + (i.unit === 'liter' ? unitL() : '')).join(' · ')
}

function renderBundles() {
  preBundles();
  applyNight();
  // At night Рывки with beer or food are not sold: hide them instead of a wall of disabled cards.
  const shown = bundleCatalog.filter(b => b.unavailable_reason !== 'CLOSED_NOW');
  // No Рывки switched on at all (owner, 2026-10-23): the whole section goes, not an empty shelf.
  const sec = document.getElementById('bundlesSection');
  if (sec) sec.hidden = !bundleCatalog.length;
  if (!bundleCatalog.length) return;
  if (!shown.length) {
    bundles.innerHTML = '<div class="empty">' + (bundleCatalog.length ? tr(stockNight() ? '🌙 Ночью готовые рывки не собираем — возьми крепкое и закуску в «Собрать свой». Рывки — с 10:00, с пивом и пиццей — с 12:00.' : '☀️ Рывки с пивом и пиццей — с 12:00. А пока собери свой в «Собрать свой».') : 'Готовые рывки скоро появятся') + '</div>';
    return
  }
  bundles.innerHTML = shown.map((b, n) => {
    const ok = b.available !== false,
      on = ok && checkoutBundle?.id === b.id,
      save = Number(b.savings || 0),
      items = sortedItems(b),
      thumbs = items.map(i => '<span>' + (i.image_url ? '<img src="' + esc(i.image_url) + '" alt="' + esc(pname(i)) + '" loading="lazy" decoding="async" onerror="this.remove()">' : '') + (itemQty(i) ? '<em>' + itemQty(i) + '</em>' : '') + '</span>').join(''),
      comp = items.map(i => {
        const sl = itemSlug(i), ico = STRONG_GROUP.includes(sl) ? '🥃' : ITEM_ICO[sl] || '•', q = Number(i.quantity);
        return '<li>' + ico + ' ' + esc(pname(i)) + (i.unit === 'liter' ? ' — ' + q + unitL() : q > 1 ? ' × ' + q : '') + '</li>'
      }).join('');
    return `<article class="card bundle${ok?'':' off'}${on?' chosen':''}" style="--i:${n}"><div class="bthumbs">${thumbs}</div><div class="pad"><div><span class="tag">${esc(b.badge_text||'РЫВОК')}</span>${b.serves_label?'<span class="serves">'+esc(b.serves_label)+'</span>':''}</div><h3>${esc(b.name)}</h3>${b.description?'<div class="bidea">'+esc(b.description)+'</div>':''}<div class="bprices">${save>0?'<div><span class="lbl">По отдельности</span><s>'+money(b.regular_total)+'</s></div>':''}<div><span class="lbl">Рывком</span><b class="now">${money(b.price)}</b></div>${save>0?'<div><span class="lbl">Экономия</span><b class="save">'+money(save)+'</b></div>':''}</div><ul class="bcomp"><span class="lbl">В составе</span>${comp}</ul>${ok?`<button type="button" class="cta" onclick="chooseBundle('${b.id}')">${on?'Рывок выбран ✓':'ВЗЯТЬ РЫВОК'}</button>`:'<button type="button" class="cta" disabled>'+(b.unavailable_reason==='CLOSED_NOW'?tr('Днём, с 12:00'):'Временно недоступен')+'</button>'}</div></article>`
  }).join('')
}

function goBundles() {
  (document.getElementById('bundlesSection')?.hidden ? document.getElementById('buildSection') : document.getElementById('bundlesSection'))?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

function goBuild() {
  track('build_start');
  buildSection.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

function totals() {
  return Object.values(cart).reduce((s, x) => s + x.qty * Number(x.p.sale_price), 0)
}

// ---------- Night prices and day/night delivery — the same rule the server applies to the order (public.night_pricing):
// 00:00–02:00 (closing) Tbilisi every product and Рывок +10 %, rounded up to 0.50 ₾. Day prices are kept in p._day / b._day.
let NIGHT = null, nightShown = null;
const tbilisiHM = () => atDate().toLocaleTimeString('en-GB', { timeZone: 'Asia/Tbilisi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const inWin = (t, a, b) => a <= b ? t >= a && t < b : t >= a || t < b;
const nightOn = () => !!NIGHT && Number(NIGHT.percent) > 0 && inWin(tbilisiHM(), NIGHT.from || '00:00', NIGHT.to || '02:00');
function nightPrice(x) {
  const st = Number(NIGHT.step || 0.5);
  return Math.ceil(Math.round(x * (1 + Number(NIGHT.percent) / 100) / st * 1e6) / 1e6) * st
}
function applyNight() {
  const on = nightOn();
  nightShown = on;
  catalog.forEach(p => {
    if (p._day == null) p._day = Number(p.sale_price);
    p.sale_price = on && p._day > 0 ? nightPrice(p._day) : p._day
  });
  bundleCatalog.forEach(b => {
    if (b._day == null) b._day = { price: Number(b.price), regular: Number(b.regular_total || 0) };
    b.price = on ? nightPrice(b._day.price) : b._day.price;
    b.regular_total = b._day.regular + (b.price - b._day.price)
  });
  document.querySelectorAll('.nightNote').forEach(x => x.hidden = !on)
}
// Delivery rule for «now»: day 3 ₾ / free from 50 ₾, after 23:00 5 ₾ / free from 80 ₾ (numbers come from the server).
function deliveryRule() {
  const d = NIGHT?.delivery || {}, n = inWin(tbilisiHM(), d.night_from || '23:00', d.night_to || '02:00');
  return { fee: Number(n ? d.night_fee ?? 7 : d.day_fee ?? 3), free: Number(n ? d.night_free_from ?? 80 : d.day_free_from ?? 50) }
}
async function loadNight() {
  try {
    const r = await PIVKA_DB.client().rpc('night_pricing');
    if (r.error) throw r.error;
    NIGHT = r.data
  } catch (e) {
    NIGHT = null
  }
  renderAllPrices()
}
function renderAllPrices() {
  applyNight();
  renderProducts();
  renderBundles();
  renderCart();
  if (checkoutFormAlive()) updateCheckoutTotal()
}
// The page may stay open across 00:00 / 02:00: switch prices on time.
setInterval(() => { if (NIGHT && nightOn() !== nightShown) renderAllPrices() }, 30e3);
// The gift is earned on day prices (the server checks it before the night markup).
function giftTotals() {
  return Object.values(cart).reduce((s, x) => s + x.qty * Number(x.p._day ?? x.p.sale_price), 0)
}

function orderBase() {
  return totals() + Number(checkoutBundle?.price || 0)
}

function renderCart() {
  applyNight();
  const items = Object.values(cart),
    total = orderBase(),
    count = items.length;
  PIVKA_DB.saveCart(items.map(x => ({
    product_id: x.p.id,
    quantity: x.qty
  })), total).catch(() => {});
  const bundleCount = checkoutBundle ? 1 : 0;
  cartCount.textContent = (count || bundleCount) ? '🛒 ' + (count + bundleCount) + ' поз.' : '🛒 Корзина пуста';
  cartTotal.textContent = money(total) + ' →';
  const go = document.getElementById('cartGo');
  if (go) { go.textContent = shopClosed() ? tr('Сейчас закрыто — откроемся в 10:00') : tr('Оформить заказ →'); go.classList.toggle('closedGo', shopClosed()) }
  document.querySelector('.cart').classList.toggle('show', count > 0 || bundleCount > 0);
  // A Рывок has its own discount and does not count toward the gift — only extra products do.
  renderGift(giftTotals());
  try {
    localStorage.setItem('pivka_cart', JSON.stringify(items.map(x => ({
      id: x.p.id,
      qty: x.qty
    }))))
  } catch (e) {}
}

// ---------- Gift progress: server grants only the highest reached tier; here we show the way to the next one.
let giftLastWon = null;

function boostCandidates(rem) {
  const targets = upsellTargets(cartSources());
  const pool = catalog.filter(p => p.unit !== 'liter' && !cart[p.id] && Number(p.sale_price) > 0 && !ALCOHOL.includes(slugOf(p)));
  const rel = pool.filter(p => targets.some(t => inCat(p, t) || slugOf(p) === t));
  const base = rel.length >= 2 ? rel : pool.filter(p => ['snacks', 'chips', 'nuts', 'fish', 'cheese', 'meat-snacks', 'chocolate'].includes(slugOf(p)));
  return base.sort((a, b) => {
    const A = Number(a.sale_price), B = Number(b.sale_price);
    return (A >= rem ? 0 : 1) - (B >= rem ? 0 : 1) || Math.abs(A - rem) - Math.abs(B - rem)
  }).slice(0, 3)
}

function boostAdd(id) {
  const p = catalog.find(x => x.id === id);
  if (!p) return;
  add(p, 1, { boost: true });
  if (cartOverlay.classList.contains('on')) openCart()
}

// Several products can share one gift threshold (e.g. two Jerky at 50 ₾): show them as one level.
function groupGiftTiers(rows) {
  const levels = new Map();
  (rows || []).forEach(r => {
    const k = Number(r.threshold);
    if (!levels.has(k)) levels.set(k, []);
    levels.get(k).push(r)
  });
  const label = (r, l) => {
    const p = r.products || {};
    return ((p.name_i18n && p.name_i18n[l]) || p.name || '') + (Number(r.quantity) > 1 ? ' ×' + Number(r.quantity) : '')
  };
  return [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([threshold, parts]) => ({
    threshold,
    products: {
      name: parts.map(r => label(r, 'ru')).join(' + '),
      name_i18n: Object.fromEntries(['ru', 'ka', 'hy'].map(l => [l, parts.map(r => label(r, l)).join(' + ')]))
    }
  }))
}

function renderGift(total) {
  const boxes = [giftBlock, cartGift].filter(Boolean);
  if (!giftTiers.length) {
    boxes.forEach(x => x.hidden = true);
    return
  }
  const next = giftTiers.find(x => total < Number(x.threshold)),
    won = [...giftTiers].reverse().find(x => total >= Number(x.threshold)),
    wonAt = won ? Number(won.threshold) : 0;
  if (giftLastWon !== null && wonAt > giftLastWon) {
    track('gift_reached', { metadata: { threshold: wonAt, total } });
    setTimeout(() => window.pivkaGiftWon && pivkaGiftWon(), 60)
  }
  giftLastWon = wonAt;
  let text, width, hot = false;
  if (next) {
    const rem = money(Number(next.threshold) - total);
    // The closer the gift, the louder the line: far → calm, half-way → «уже близко», last 20 % → «всего X!».
    // Share of the way still left to the next gift (from the gift already won, if any).
    const share = (Number(next.threshold) - total) / (Number(next.threshold) - wonAt), g = pname(next.products);
    text = total <= 0 ? '🎁 Закажи от ' + money(next.threshold) + ' — подарок: ' + g
      : share <= .2 ? tr('😱 Всего {x} до подарка! Добавь мелочь — и {g} твой').replace('{x}', rem).replace('{g}', g)
      : share <= .5 ? tr('🔥 Уже близко! Ещё {x} — и {g} в подарок').replace('{x}', rem).replace('{g}', g)
      : won ? '🎁 ' + pname(won.products) + ' открыт · ещё ' + rem + ' до следующего' : '🎁 До подарка осталось ' + rem;
    width = Math.min(100, total / Number(next.threshold) * 100);
    hot = total > 0 && share <= .2
  } else {
    text = tr('🎉 Есть! В подарок: {g}').replace('{g}', pname(won?.products) || '');
    width = 100;
    hot = true
  }
  let boost = '';
  // Top-up hints only when the gift is genuinely close; otherwise they would push expensive items.
  if (next && total > 0 && Number(next.threshold) - total <= 15) {
    const list = boostCandidates(Number(next.threshold) - total);
    if (list.length) boost = '<div class="boost"><div class="bt">Добрать быстрее</div>' + list.map(p => `<button type="button" class="boostItem" onclick="boostAdd('${p.id}')"><span>${esc(pname(p))}</span><b>${money(p.sale_price)} +</b></button>`).join('') + '</div>'
  }
  const bundleNote = checkoutBundle ? '<div class="muted gnote">Рывок в подарок не считается — только товары сверху</div>' : '';
  const marks = '<span>0 ₾</span>' + giftTiers.map(x => '<span>' + money(x.threshold) + '</span>').join('');
  barGift.textContent = total > 0 ? (next ? '🎁 До подарка осталось ' + money(Number(next.threshold) - total) : '🎁 Подарок открыт: ' + (pname(won?.products) || '')) : '';
  boxes.forEach(x => {
    x.hidden = false;
    const was = x.dataset.w ? Number(x.dataset.w) : width;
    x.dataset.w = width;
    x.innerHTML = '<strong class="gtext">' + esc(text) + '</strong><div class="bar' + (hot ? ' hot' : '') + (width > was ? ' bump' : '') + '"><i style="width:' + width + '%"></i></div><div class="marks">' + marks + '</div>' + bundleNote + boost
  })
}

// ---------- Cart
function deliveryHint() {
  if (!checkoutFormAlive()) return '';
  if (deliveryQuoteState.mode === 'HIDDEN') return '';
  if (deliveryQuoteState.mode === 'FREE') return 'Доставка бесплатно';
  const r = deliveryRule();
  return orderBase() >= r.free ? 'Доставка бесплатно — заказ от ' + r.free + ' ₾' : 'Доставка ' + r.fee + ' ₾ · от ' + r.free + ' ₾ — бесплатно';
  const fees = [...coZone.options].map(o => Number(o.dataset.fee)).filter(n => !isNaN(n));
  return fees.length ? 'Доставка от ' + money(Math.min(...fees)) + ' · самовывоз бесплатно' : ''
}

function openCart() {
  const items = Object.values(cart);
  const bundleLine = checkoutBundle ? '<div class="line row"><div><b>🔥 ' + esc(tr(checkoutBundle.name)) + '</b><div class="muted">Готовый рывок · цена уже со скидкой</div><div class="muted">' + bundleItemsText(checkoutBundle) + '</div></div><div class="step"><b style="white-space:nowrap">' + money(checkoutBundle.price) + '</b><button type="button" aria-label="Убрать рывок" onclick="removeBundle()">×</button></div></div>' : '';
  cartLines.innerHTML = bundleLine + (items.length ? items.map(x => `<div class="line row"><div><b>${esc(pname(x.p))}</b><div class="muted">${money(x.p.sale_price)} × ${x.qty}${x.p.unit==='liter'?unitL():''}</div></div><div class="step"><button type="button" onclick="change('${x.p.id}',-1)">−</button><b>${x.qty}</b><button type="button" onclick="change('${x.p.id}',1)">+</button></div></div>`).join('') : (checkoutBundle ? '' : '<div class="empty">Пока пусто. Добавь что-нибудь вкусное.</div>'));
  const recs = (items.length || checkoutBundle) ? upsellTargets(cartSources()).slice(0, 3) : [];
  cartRecs.innerHTML = recs.length ? '<div class="bt">К этому обычно берут</div><div class="recs">' + recs.map(t => {
    const [ico, label] = targetLabel(t);
    return '<button type="button" onclick="openUpsellCategory(\'' + t + '\')">' + ico + ' ' + esc(label) + '</button>'
  }).join('') + '</div>' : '';
  const addons = checkoutBundle ? ADDON_SKUS.map(s => catalog.find(p => p.sku === s)).filter(p => p && !cart[p.id]).slice(0, 6) : [];
  if (addons.length) cartRecs.innerHTML = '<div class="bt">Добавь к рывку</div><div class="recs addons">' + addons.map(p =>
    '<button type="button" onclick="addAddon(\'' + p.id + '\')">＋ ' + esc(pname(p)) + ' · ' + money(p.sale_price) + '</button>').join('') + '</div>' + cartRecs.innerHTML;
  const foodMin = foodMinutes(items.map(x => [x.p.id, x.qty]).concat((checkoutBundle?.items || []).map(i => [i.product_id, i.quantity])));
  cartDelivery.textContent = (items.length || checkoutBundle) ? [deliveryHint(), foodMin ? tr(FOOD_NOTE).replace('{n}', foodMin) : ''].filter(Boolean).join(' · ') : '';
  sheetTotal.textContent = money(orderBase());
  track('cart_open', { metadata: { total: orderBase(), lines: items.length + (checkoutBundle ? 1 : 0) } });
  openSheet('cartOverlay')
}

function addAddon(id) {
  const p = catalog.find(x => x.id === id);
  if (!p) return;
  cart[p.id] = { p, qty: 1 };
  track('add_to_cart', { productId: p.id, metadata: { qty: 1, via: 'bundle_addon', bundleId: checkoutBundle?.id || null } });
  renderCart();
  openCart()
}

function change(id, d) {
  const x = cart[id];
  if (!x) return;
  const left = stockLeft(x.p);
  if (d > 0 && left !== null && x.qty + d > left) { alert(tr('На складе осталось только {n}').replace('{n}', left)); return }
  x.qty += d * (x.p.unit === 'liter' ? 2 : 1);
  if (x.p.unit === 'liter' && x.qty > 0 && x.qty < 2) x.qty = 2;
  if (x.qty <= 0) delete cart[id];
  renderCart();
  openCart()
}

function clearCart() {
  if (!Object.keys(cart).length && !checkoutBundle) return;
  if (!confirm('Очистить весь заказ?')) return;
  Object.keys(cart).forEach(k => delete cart[k]);
  checkoutBundle = null;
  try {
    localStorage.removeItem('pivka_bundle');
    localStorage.removeItem('pivka_cart')
  } catch (e) {}
  renderBundles();
  upsellFlow = null;
  upsellReturn = false;
  upsellCategory = null;
  upsellOffered.clear();
  upsellCategoryBar.classList.add('hidden');
  renderCart();
  cartLines.innerHTML = '<div class="empty">Корзина очищена</div>';
  cartRecs.innerHTML = '';
  cartDelivery.textContent = '';
  sheetTotal.textContent = money(0);
  cartHint.textContent = 'Добавь товары заново'
}

// ---------- Upsell: rules come from public.upsell_rules (product rule first, else category rule),
// two-way, and always skip sections already present anywhere in the cart (including the chosen Рывок).
let upsellReturn = false,
  upsellCategory = null,
  upsellFlow = null;
const upsellOffered = new Set();

function cartSources() {
  const list = Object.values(cart).map(x => x.p);
  (checkoutBundle?.items || []).forEach(i => {
    const p = catalog.find(q => q.id === i.product_id);
    if (p) list.push(p)
  });
  return list
}

function upsellTargets(sources) {
  const inCart = new Set(cartSources().map(slugOf)),
    score = new Map();
  sources.forEach(p => {
    let rules = upsellRules.filter(r => r.source_product_id && r.source_product_id === p.id);
    if (!rules.length) rules = upsellRules.filter(r => r.source_category_id && catById[r.source_category_id]?.slug === slugOf(p));
    rules.forEach(r => {
      const t = catById[r.target_category_id]?.slug;
      if (t) score.set(t, Math.min(score.has(t) ? score.get(t) : 1e9, Number(r.priority || 100)))
    })
  });
  return [...score].filter(([t]) => !inCart.has(t) && catalog.some(q => slugOf(q) === t)).sort((a, b) => a[1] - b[1]).map(x => x[0])
}

function targetLabel(slug) {
  const c = CATS.find(x => x.slug === slug);
  if (c) return [c.ico, c.label];
  const row = categoryRows.find(x => x.slug === slug);
  return ['🥃', row ? row.name : slug]
}

function offerUpsell(p) {
  const key = slugOf(p);
  if (upsellOffered.has(key)) return;
  const targets = upsellTargets([p]);
  if (!targets.length) return;
  upsellOffered.add(key);
  upsellFlow = {
    source: p,
    title: p.unit === 'liter' ? 'Что возьмём к пиву?' : key === 'restaurant' ? 'Что взять к шашлыку?' : 'К этому обычно берут',
    subtitle: 'Выбери раздел — можно несколько товаров'
  };
  resumeUpsell()
}

function resumeUpsell() {
  if (!upsellFlow) {
    openCart();
    return
  }
  const targets = upsellTargets(upsellFlow.source ? [upsellFlow.source] : cartSources()).slice(0, 4);
  if (!targets.length) {
    upsellFlow = null;
    openCart();
    return
  }
  upsellTitle.textContent = upsellFlow.title;
  upsellSub.textContent = upsellFlow.subtitle;
  upsellList.innerHTML = targets.map(t => {
    const [ico, label] = targetLabel(t);
    const img = catImg(t) || catImg(STRONG_GROUP.includes(t) ? 'strong' : '');
    return '<button type="button" class="up' + (img ? ' photo' : '') + '" data-cat="' + t + '"' + (img ? ' style="background-image:url(\'' + img + '\')"' : '') + '>' + (img ? '' : '<span class="emo">' + ico + '</span>') + '<b>' + esc(label) + '</b><span class="accent">Выбрать →</span></button>'
  }).join('');
  upsellList.querySelectorAll('.up').forEach(b => b.onclick = () => openUpsellCategory(b.dataset.cat));
  track('upsell_view', { productId: upsellFlow.source?.id || null, metadata: { targets } });
  openSheet('upsellOverlay')
}

function finishUpsell(toCart) {
  upsellFlow = null;
  closeSheet('upsellOverlay');
  if (toCart) openCart()
}

function openUpsellCategory(cat) {
  closeSheet('upsellOverlay');
  closeSheet('cartOverlay');
  if (!upsellFlow) upsellFlow = { source: null, title: 'К этому обычно берут', subtitle: 'Выбери раздел — можно несколько товаров' };
  upsellReturn = true;
  upsellCategory = cat;
  upsellCategoryTitle.textContent = targetLabel(cat)[1] + ' — выбирай сколько хочешь';
  upsellCategoryBar.classList.remove('hidden');
  setCategory(cat, true);
  upsellCategoryBar.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

function finishUpsellCategory() {
  upsellReturn = false;
  upsellCategory = null;
  upsellCategoryBar.classList.add('hidden');
  renderProducts();
  resumeUpsell()
}

// ---------- Category navigation: big tiles for the first choice, compact sticky nav afterwards.
// Owner's priority on the storefront: shawarma, restaurant dishes, pizza, beer, strong — then everything else.
const TOP_CATS = ['shawarma', 'restaurant', 'pizza', 'draft', 'strong'];
function renderNav() {
  const vis = CATS.filter(c => catProducts(c.slug).length);
  const top = TOP_CATS.map(s => vis.find(c => c.slug === s)).filter(Boolean);
  const tile = c => `<button type="button" class="tile${catImg(c.slug)?' photo':''}${c.slug===currentCat?' on':''}" data-cat="${c.slug}" aria-pressed="${c.slug===currentCat}"${catImg(c.slug)?` style="background-image:url('${catImg(c.slug)}')"`:''}>${catImg(c.slug)?'':`<span class="ti" aria-hidden="true">${c.ico}</span>`}<span class="tt"><b>${c.label}</b><small>${countLabel(c.slug, catProducts(c.slug).length)}</small></span></button>`;
  tilesAlc.innerHTML = top.map(tile).join('');
  tilesFood.innerHTML = vis.filter(c => c.grp !== 'more' && !top.includes(c)).map(tile).join('');
  const more = vis.filter(c => c.grp === 'more');
  tilesMore.innerHTML = more.map(tile).join('');
  moreHead.hidden = !more.length;
  catNav.innerHTML = [...top, ...vis.filter(c => !top.includes(c))].map(c => `<button type="button" class="chip${c.slug===currentCat?' on':''}" data-cat="${c.slug}">${c.ico} ${c.label}</button>`).join('');
  document.querySelectorAll('.tile,#catNav .chip').forEach(b => b.onclick = () => pickCategory(b.dataset.cat))
}

function pickCategory(cat) {
  if (upsellReturn) {
    upsellReturn = false;
    upsellCategory = null;
    upsellFlow = null;
    upsellCategoryBar.classList.add('hidden')
  }
  setCategory(cat);
  catHead.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

function setCategory(cat, fromUpsell = false) {
  currentCat = cat;
  catPicked = true;
  renderNav();
  renderProducts(cat);
  track('category_view', { metadata: { category: cat, via: fromUpsell ? 'upsell' : 'nav' } })
}

// One quiet retry for reads: mobile networks drop single requests.
async function retry(fn) {
  try {
    return await fn()
  } catch (e) {
    await new Promise(r => setTimeout(r, 700));
    return fn()
  }
}

async function changeCity(id) {
  currentCity = cities.find(x => x.id === id) || null;
  if (!currentCity) return;
  localStorage.setItem('pivka_city', id);
  try {
    const cc = await PIVKA_DB.listCityCatalog(id);
    if (cc.length) {
      setCatalog(cc.map(p => ({
        ...p,
        name_i18n: nameI18n[p.id] || {},
        categories: {
          slug: p.category_slug,
          name: p.category_name
        },
        active: true,
        stock_quantity: Number(p.available_stock || 0),
        available_stock: Number(p.available_stock || 0)
      })));
      renderNav();
      renderProducts();
      restoreCart()
    }
  } catch (e) {
    console.warn(e)
  }
  // Each block loads independently: a failed catalog request must not leave checkout without zones or bank links.
  try {
    try {
      bundleCatalog = await PIVKA_DB.listBundles(id);
      syncBundle();
      renderBundles();
      renderCart()
    } catch (e) {
      console.warn(e)
    }
    const [links, zones] = await Promise.all([retry(() => PIVKA_DB.listPaymentLinks(id)), retry(() => PIVKA_DB.listDeliveryZones(id))]);
    // Bank transfer links (BOG / TBC) are shown only when the customer picks «Переводом».
    paymentLinks.innerHTML = links.length ? '<div class="muted payhint">Переведите сумму «К оплате» по ссылке банка и отправьте скриншот в чат (кнопка 💬 → «📷 Скриншот»).</div>' + '<button type="button" class="yellow paylink" data-chat style="width:100%;border:0;cursor:pointer">📷 Отправить скриншот перевода</button>' + links.map(x => '<a class="yellow paylink" target="_blank" rel="noopener" href="' + esc(x.url) + '">💳 ' + esc(x.name) + '</a>').join('') : '<div class="muted">Перевод — по реквизитам, которые пришлём в WhatsApp.</div>';
    syncPaymentLinks();
    coZone.innerHTML = '<option value="">Выберите зону доставки</option>' + zones.map(z => '<option value="' + z.id + '" data-fee="' + Number(z.fee || 0) + '" data-min="' + Number(z.minimum_order || 0) + '">' + z.name + ' · ' + money(z.fee) + '</option>').join('');
    if (zones.length === 1) {
      coZone.value = zones[0].id
    }
    updateCheckoutTotal();
    refreshDeliveryQuote()
  } catch (e) {
    console.warn(e)
  }
}

// Payment from a Russian card: shown only when the owner filled the details (store_settings «ru_card»).
// Amount in ₽ = total × Bank of Russia rate for GEL × (1 + markup), markup 15% — «за комфорт».
let ruCard = null, ruRate = null;
async function loadRuCard() {
  try {
    const r = await PIVKA_DB.client().rpc('ru_card_info');
    if (r.error || !r.data) return;
    const j = await (await fetch('https://www.cbr-xml-daily.ru/daily_json.js')).json();
    const g = j && j.Valute && j.Valute.GEL;
    if (!g || !(g.Value > 0)) return;
    ruRate = g.Value / (g.Nominal || 1);
    ruCard = r.data;
    if (![...coPayment.options].some(o => o.value === 'ru_card')) coPayment.insertAdjacentHTML('beforeend', '<option value="ru_card">' + esc(tr('🇷🇺 Российской картой (+15%)')) + '</option>');
    syncPaymentLinks();
  } catch (e) {}
}
const ruAmount = gel => Math.ceil(gel * ruRate * (1 + Number(ruCard.markup || 15) / 100) / 10) * 10;
function renderRuCard() {
  let box = document.getElementById('ruCardBox');
  if (!box) { box = document.createElement('div'); box.id = 'ruCardBox'; box.className = 'rucard'; paymentLinks.insertAdjacentElement('afterend', box) }
  const on = coPayment.value === 'ru_card' && ruCard;
  box.style.display = on ? 'block' : 'none';
  if (!on) return;
  const gel = orderBase() + currentDeliveryFee();
  const k = ruRate * (1 + Number(ruCard.markup || 15) / 100);
  box.innerHTML = '<div class="rusum">' + esc(tr('К оплате')) + ': <b>' + ruAmount(gel).toLocaleString('ru-RU') + ' ₽</b></div>' +
    '<div class="muted">' + esc(tr('Курс ЦБ сегодня')) + ' ' + ruRate.toFixed(2) + ' ₽ + ' + Number(ruCard.markup || 15) + '% ' + esc(tr('за комфорт оплаты из России')) + ' = ' + k.toFixed(2) + ' ₽ ' + esc(tr('за 1 ₾')) + '</div>' +
    (ruCard.pay_url ? '<a class="yellow paylink" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none" href="' + esc(ruCard.pay_url) + '">' + esc(tr('Оплатить в рублях')) + ' →</a>' : '') +
    (ruCard.card ? '<div class="rurow">💳 ' + esc(ruCard.card) + (ruCard.bank ? ' · ' + esc(ruCard.bank) : '') + '</div>' : '') +
    (ruCard.sbp_phone ? '<div class="rurow">📱 ' + esc(tr('СБП по номеру')) + ' ' + esc(ruCard.sbp_phone) + '</div>' : '') +
    (ruCard.holder ? '<div class="muted">' + esc(tr('Получатель')) + ': ' + esc(ruCard.holder) + '</div>' : '') +
    '<div class="muted payhint">' + esc(tr('Переведите сумму в рублях и отправьте скриншот в чат.')) + '</div>' +
    '<button type="button" class="yellow paylink" data-chat style="width:100%;border:0;cursor:pointer">' + esc(tr('📷 Отправить скриншот перевода')) + '</button>';
}
function syncPaymentLinks() {
  paymentLinks.style.display = coPayment.value === 'transfer' ? 'block' : 'none';
  renderRuCard()
}
coPayment.addEventListener('change', () => { syncPaymentLinks(); updateCheckoutTotal() });

function setFulfillment(v) {
  fulfillment = v;
  deliveryBtn.classList.toggle('on', v === 'delivery');
  pickupBtn.classList.toggle('on', v === 'pickup');
  coAddress.style.display = v === 'delivery' ? 'block' : 'none';
  coZone.style.display = v === 'delivery' ? 'block' : 'none';
  coPickupTime.style.display = v === 'pickup' && !PRE ? 'block' : 'none';
  updateCheckoutTotal();
  refreshDeliveryQuote()
}

// Delivery fee comes from the server rule (zone, owner switch, day/night); the zone fee is only a fallback.
let deliveryQuoteState = { fee: null, reason: null, mode: 'CHARGE' }, quoteSeq = 0;
// After a successful order the form is replaced by the confirmation screen.
const checkoutFormAlive = () => !!document.getElementById('coZone');

async function refreshDeliveryQuote() {
  if (!checkoutFormAlive()) return;
  const seq = ++quoteSeq;
  try {
    const zone = fulfillment === 'delivery' ? coZone.value || null : null, phone = coPhone.value.trim() || null;
    const q = PRE ? await retry(async () => { const x = await PIVKA_DB.client().rpc('delivery_quote_at', { p_zone: zone, p_phone: phone, p_fulfillment: fulfillment, p_subtotal: payGoods(), p_at: PRE.toISOString() }); if (x.error) throw x.error; return x.data })
      : await retry(() => PIVKA_DB.deliveryQuote(zone, phone, fulfillment, payGoods()));
    if (seq !== quoteSeq || !checkoutFormAlive()) return;
    deliveryQuoteState = { fee: coZone.value || fulfillment !== 'delivery' || q.mode !== 'CHARGE' ? Number(q.fee) : null, reason: q.reason, mode: q.mode || 'CHARGE' }
  } catch (e) {
    deliveryQuoteState = { fee: null, reason: null, mode: deliveryQuoteState.mode }
  }
  if (!checkoutFormAlive()) return;
  applyDeliveryMode();
  updateCheckoutTotal()
}

function applyDeliveryMode() {
  const mode = deliveryQuoteState.mode;
  [...coZone.options].forEach(o => {
    if (!o.value) return;
    o.dataset.label = o.dataset.label || o.textContent.split(' · ')[0];
    o.textContent = mode === 'HIDDEN' ? o.dataset.label : mode === 'FREE' ? o.dataset.label + ' · бесплатно' : o.dataset.label + ' · ' + money(deliveryRule().fee)
  })
}

function currentDeliveryFee() {
  if (fulfillment !== 'delivery' || !coZone.value) return 0;
  if (giftApplies() && GIFT.free_delivery) return 0;
  if (deliveryQuoteState.fee !== null) return deliveryQuoteState.fee;
  const opt = coZone.options[coZone.selectedIndex];
  return deliveryQuoteState.mode === 'CHARGE' && opt?.value ? deliveryRule().fee : 0
}

function updateCheckoutTotal() {
  if (!checkoutFormAlive()) return;
  const base = payGoods();
  const opt = coZone.options[coZone.selectedIndex];
  const fee = currentDeliveryFee();
  renderBonus();
  const mode = deliveryQuoteState.mode;
  coTotal.textContent = money(base + fee) + (coPayment.value === 'ru_card' && ruCard ? ' ≈ ' + ruAmount(base + fee).toLocaleString('ru-RU') + ' ₽' : '');
  renderRuCard();
  checkoutNotice.style.display = fulfillment === 'delivery' ? 'block' : 'none';
  const min = opt?.dataset?.min && Number(opt.dataset.min) ? ' · Минимальный заказ ' + money(opt.dataset.min) : '';
  const feeText = deliveryQuoteState.reason === 'FREE_FROM' ? 'Доставка бесплатно — заказ от ' + deliveryRule().free + ' ₾' : deliveryQuoteState.reason === 'ZONE' && fee > 0 ? 'Доставка: ' + money(fee) + ' · от ' + deliveryRule().free + ' ₾ — бесплатно' : mode === 'HIDDEN' ? '' : mode === 'FREE' ? 'Доставка бесплатно' : 'Доставка: ' + money(fee);
  checkoutNotice.textContent = fulfillment === 'delivery' ? (coZone.value ? (feeText + min).replace(/^ · /, '') || 'Доставка' : 'Выбери зону доставки') : 'Самовывоз — без платы за доставку';
  if (giftOn()) checkoutNotice.textContent = '🎁 ' + (giftApplies() ? tr('Подарок от друга: бесплатная доставка + {gift}').replace('{gift}', giftName())
    : tr('До подарка от друга: ещё {x}').replace('{x}', money(Number(GIFT.min) - payGoods()))) + (fulfillment === 'delivery' && !giftApplies() && coZone.value ? ' · ' + checkoutNotice.textContent : '')
}

function openCheckout(bundle = null) {
  checkoutNotice.style.display = 'none';
  try {
    const p = JSON.parse(localStorage.getItem('pivka_profile') || '{}');
    if (!coName.value && p.name) coName.value = p.name;
    if (!coPhone.value && p.phone) coPhone.value = p.phone;
    if (!coAddress.value && p.address) coAddress.value = p.address
  } catch (e) {}
  if (bundle) checkoutBundle = bundle;
  coWhen.innerHTML = preOptions();
  loadBonus();
  const items = Object.values(cart);
  if (!checkoutBundle && !items.length) {
    cartHint.textContent = 'Добавь товар из каталога для оформления';
    return
  }
  const shut = closedInCart();
  if (shut.length) {
    cartHint.textContent = tr('Сейчас не продаётся: {list}. Уберите эти позиции или выберите время предзаказа.').replace('{list}', shut.map(x => pname(x.p) + ' (' + tr('откроется в {t}').replace('{t}', opensAt(x.p)) + ')').join(', '));
    openSheet('cartOverlay');
    return
  }
  if (shopClosed()) {
    cartHint.textContent = tr('Сейчас закрыто, откроемся в 10:00. Корзина сохранится — или выберите время предзаказа вверху каталога.');
    openSheet('cartOverlay');
    return
  }
  closeSheet('cartOverlay');
  // Zones failed to load earlier (bad network) — try again, otherwise the customer cannot pick one.
  if (coZone.options.length < 2 && currentCity) changeCity(currentCity.id);
  updateCheckoutTotal();
  refreshDeliveryQuote();
  coError.textContent = '';
  track('checkout_start', { bundleId: checkoutBundle?.id || null, metadata: { total: orderBase() } });
  openSheet('checkoutOverlay')
}
function showDemoSuccess(r) {
  checkoutBody.innerHTML = `<div class="success"><div class="big">🍻</div><h2>Рывок принят!</h2><p class="muted">Заказ №${r.order_number}<br>${Number(r.bonus_used) > 0 ? '💎 ' + esc(tr('Баллами')) + ': −' + money(r.bonus_used) + '<br>' : ''}${r.friend_gift ? '🎁 ' + esc(tr('Подарок от друга добавлен в заказ')) + '<br>' : ''}Сумма: ${money(r.total)}</p><button class="skip" onclick="location.reload()">Готово</button></div>`
}

async function submitCheckout() {
  coError.textContent = '';
  const shut = closedInCart();
  if (shut.length && !PRE) {
    coError.textContent = tr('Сейчас не продаётся: {list}. Уберите эти позиции или выберите время предзаказа.').replace('{list}', shut.map(x => pname(x.p)).join(', '));
    return
  }
  if (Object.values(cart).some(x => x.p.unit === 'liter' && (x.qty < 2 || x.qty % 2 !== 0))) {
    coError.textContent = 'Пиво заказывается кратно 2 литрам';
    return
  }
  const phone = coPhone.value.trim(),
    address = coAddress.value.trim();
  if (!phone) {
    coError.textContent = 'Укажи номер телефона';
    return
  }
  // Georgian number (9 digits or +995, as the browser autofills it) or any international number with «+».
  if (!phoneOk(phone) && !/^\+\d{10,15}$/.test(phone.replace(/[\s()-]/g, ''))) {
    coError.textContent = 'Введите номер полностью, например 591 24 40 75';
    return
  }
  if (fulfillment === 'delivery' && !address) {
    coError.textContent = 'Укажи адрес доставки';
    return
  }
  if (fulfillment === 'delivery' && !coZone.value) {
    coError.textContent = 'Выбери зону доставки';
    return
  }
  const zoneOpt = coZone.options[coZone.selectedIndex],
    zoneMin = Number(zoneOpt?.dataset?.min ?? 0);
  if (fulfillment === 'delivery' && orderBase() < zoneMin) {
    coError.textContent = 'Минимальный заказ на доставку — ' + money(zoneMin);
    return
  }
  if (!coAge.checked) {
    coError.textContent = 'Подтверди, что тебе исполнилось 18 лет';
    return
  }
  const items = Object.values(cart).map(x => ({
    product_id: x.p.id,
    quantity: x.qty
  }));
  submitOrder.disabled = true;
  submitOrder.textContent = 'Создаём заказ…';
  try {
    try {
      localStorage.setItem('pivka_profile', JSON.stringify({
        name: coName.value.trim(),
        phone,
        address
      }))
    } catch (e) {}
    const pickupText = fulfillment === 'pickup' && !PRE ? 'Самовывоз через ' + coPickupTime.value + ' мин' : '';
    const payload = {
      name: coName.value.trim(),
      phone,
      fulfillment,
      address,
      payment: coPayment.value,
      comment: (pickupText ? pickupText + (coComment.value.trim() ? ' | ' : '') : '') + coComment.value.trim() + (currentCity ? ' | Город: ' + currentCity.name : '') + (coZone.value && fulfillment === 'delivery' ? ' | Зона: ' + coZone.options[coZone.selectedIndex].text : '') +
        (coPayment.value === 'ru_card' && ruCard ? ' | 🇷🇺 Оплата с российской карты: ' + ruAmount(payGoods() + currentDeliveryFee()) + ' ₽ (курс ЦБ ' + ruRate.toFixed(2) + ' + ' + Number(ruCard.markup || 15) + '%)' : ''),
      items,
      bundleId: checkoutBundle?.id,
      cityId: currentCity?.id || null,
      zoneId: fulfillment === 'delivery' ? coZone.value || null : null
    };
    // One server call: regular order or Рывок, pre-order time, friend's referral code, points.
    if (DEMO) {
      // nothing leaves the phone: a fake «Рывок принят» for the video
      await new Promise(res => setTimeout(res, 700));
      const fee = currentDeliveryFee();
      showDemoSuccess({ order_number: 128, total: payGoods() + fee, bonus_used: bonusX() });
      return
    }
    const x = await PIVKA_DB.client().rpc('checkout_order', { p: {
      name: payload.name, phone: payload.phone, fulfillment, address: address || '', payment: payload.payment || 'cash', comment: payload.comment,
      items, zone: payload.zoneId, bundle: checkoutBundle?.id || null, city: payload.cityId, at: PRE ? PRE.toISOString() : null,
      ref: REF || null, use_bonus: bonusX() > 0 } });
    if (x.error) throw x.error;
    const r = x.data;
    try { localStorage.removeItem('pivka_ref') } catch (e) {}
    REF = '';
    if (window.pivkaSound) pivkaSound('order');
    track('order_complete', { bundleId: checkoutBundle?.id || null, metadata: { order_number: r.order_number, total: Number(r.total), campaign: campaignInfo(), src: visitSource() } });
    try {
      if (r.order_id) localStorage.setItem(TRACK_KEY, JSON.stringify({ id: r.order_id, n: r.order_number, at: Date.now() }))
    } catch (e) {}
    // The order has its own page (status, «Рывок» game, chat with us) — no WhatsApp, no phone number.
    const orderUrl = r.order_id ? new URL('order.html?o=' + r.order_id, location.href.split(/[?#]/)[0].replace(/[^/]*$/, '')).href : '';
    checkoutBody.innerHTML = `<div class="success"><div class="big">🍻</div><h2>Рывок принят!</h2><p class="muted">Заказ №${r.order_number}<br>${Number(r.bonus_used) > 0 ? '💎 ' + esc(tr('Баллами')) + ': −' + money(r.bonus_used) + '<br>' : ''}${r.friend_gift ? '🎁 ' + esc(tr('Подарок от друга добавлен в заказ')) + '<br>' : ''}${r.scheduled_for ? '🕐 ' + esc(tr('Предзаказ — привезём к')) + ' ' + esc(preLabel(new Date(r.scheduled_for))) + '<br>' : ''}Сумма: ${money(r.total)}</p>${orderUrl ? `<a class="yellow checkout" style="display:block;text-decoration:none" href="${orderUrl}">Мой заказ и статус →</a>${['transfer', 'ru_card'].includes(coPayment.value) ? '<button type="button" class="yellow checkout" data-chat style="display:block;width:100%;border:0;cursor:pointer">📷 Отправить скриншот перевода</button>' : ''}<button type="button" class="skip" data-chat>💬 Вопрос по заказу? Напишите нам в чат</button>` : ''}<button class="skip" onclick="try{sessionStorage.setItem('pivka_intro_short','1')}catch(e){};location.reload()">Готово</button></div>`;
    // The same status card as on the home page.
    checkoutBody.querySelector('.success').insertAdjacentHTML('beforeend', '<div id="orderTrack" class="trackCard" hidden></div>');
    if (r.order_id) referralCard(r.order_id).then(h => { const s = checkoutBody.querySelector('.success'); if (h && s) s.insertAdjacentHTML('beforeend', h) });
    if (window.PivkaPWA) PivkaPWA.offer(checkoutBody.querySelector('.success'));   // «Установить на телефон», ≤ 1 in 14 days
    document.querySelector('#todaySection #orderTrack')?.remove();
    refreshTrack();
    Object.keys(cart).forEach(k => delete cart[k]);
    checkoutBundle = null;
    if (PRE) { PRE = null; setCatalog(catalogAll); renderNav(); renderAllPrices() }
    try {
      localStorage.removeItem('pivka_cart');
      localStorage.removeItem('pivka_bundle')
    } catch (e) {}
    renderCart();
    renderBundles()
  } catch (e) {
    coError.textContent = e.message || 'Не получилось создать заказ. Попробуй ещё раз.';
    submitOrder.disabled = false;
    submitOrder.textContent = 'Подтвердить заказ →'
  }
}

function renderCatHead(cat, rows) {
  const c = CATS.find(x => x.slug === cat);
  catTitle.textContent = c ? c.title : (categoryRows.find(x => x.slug === cat)?.name || '');
  let meta = countLabel(cat, rows.length);
  if (cat === 'draft') meta += ' · ' + ['от 2 л, шаг 2 л', '2 ლ-დან, ნაბიჯი 2 ლ', '2 լ-ից, քայլը 2 լ'][LI()];
  if (c?.group) {
    const subs = [...new Set(rows.map(slugOf))].map(s => SUB_LABEL[s]?.[LI()]).filter(Boolean);
    if (subs.length) meta = subs.join(' · ')
  }
  catMeta.textContent = meta
}

function renderProducts(filter = currentCat) {
  applyNight();
  currentCat = filter;
  const known = CATS.some(c => c.slug === filter);
  let rows = catalog.filter(p => known ? inCat(p, filter) : slugOf(p) === filter);
  // Inside an upsell section do not offer again what is already in the cart.
  if (upsellReturn) rows = rows.filter(p => !cart[p.id]);
  rows.sort((a, b) => (Number(b.top_pick) - Number(a.top_pick)) || (Number(a.home_rank || 100) - Number(b.home_rank || 100)));
  renderCatHead(filter, rows);
  const shut = upsellReturn ? [] : catalogAll.filter(p => closedByHours(p) && !rows.includes(p) && (known ? inCat(p, filter) : slugOf(p) === filter));
  products.classList.remove('stagger');
  products.innerHTML = rows.length || shut.length ? rows.map((p, n) => {
    const lim = p.unit === 'liter' ? 'Минимум ' + Number(p.minimum_quantity || 2) + ' л · шаг 2 л' : ALCOHOL.includes(slugOf(p)) ? '18+' : '',
      inCart = cart[p.id]?.qty;
    return `<div class="product" style="--i:${Math.min(n,8)}"><div class="thumb">${p.image_url?'<img src="'+esc(p.image_url)+'" alt="'+esc(pname(p))+'" loading="lazy" decoding="async" data-fallback="'+icon(p)+'" onerror="this.parentNode.textContent=this.dataset.fallback">':icon(p)}</div><div class="pinfo"><h3>${esc(pname(p))} ${p.top_pick?'<span class="tag">ТОП</span>':''}</h3>${lim?'<div class="lim">'+lim+'</div>':''}<div class="p">${p.unit==='liter'?money(p.sale_price)+' за 1 л':money(p.sale_price)}</div><div class="stock">${inCart?'В корзине: '+inCart+(p.unit==='liter'?unitL():''):stockLeft(p)!==null?tr('Осталось: {n}').replace('{n}',stockLeft(p)):'В наличии'}</div>${prepLabel(p)}</div><button type="button" class="plus" data-id="${p.id}" aria-label="Добавить">+</button></div>`
  }).join('') + shut.map(p => `<div class="product sold"><div class="thumb">${p.image_url?'<img src="'+esc(p.image_url)+'" alt="'+esc(pname(p))+'" loading="lazy" decoding="async">':icon(p)}</div><div class="pinfo"><h3>${esc(pname(p))}</h3><div class="p">${p.unit==='liter'?money(p.sale_price)+' за 1 л':money(p.sale_price)}</div><div class="stock">${esc(tr('Откроется в {t}').replace('{t}', opensAt(p)))}</div></div><button type="button" class="plus" disabled aria-label="Закрыто">+</button></div>`).join('') : '<div class="empty">' + (upsellReturn ? 'Всё из этого раздела уже в корзине' : 'В этой категории пока пусто') + '</div>';
  if (!reducedMotion) {
    void products.offsetWidth;
    products.classList.add('stagger')
  }
  products.querySelectorAll('.plus').forEach(b => b.addEventListener('click', () => {
    const p = catalog.find(x => String(x.id) === String(b.dataset.id));
    if (!p) return;
    if (p.unit === 'liter') openQty(p);
    else add(p, 1)
  }))
}

function restoreCart() {
  try {
    const saved = JSON.parse(localStorage.getItem('pivka_cart') || '[]');
    saved.forEach(x => {
      const p = catalog.find(p => p.id === x.id);
      if (p) cart[p.id] = {
        p,
        qty: p.unit === 'liter' ? Math.max(2, Math.floor(Number(x.qty) / 2) * 2) : Number(x.qty)
      }
    })
  } catch (e) {}
  renderCart()
}

// Compact category bar appears once the big tiles have scrolled away (under the bar itself).
function observeNav() {
  let ticking = false;
  const check = () => {
    ticking = false;
    const r = buildSection.getBoundingClientRect();
    catNav.classList.toggle('show', r.height > 0 && r.bottom < 90)
  };
  addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(check)
    }
  }, { passive: true });
  addEventListener('resize', check, { passive: true });
  check()
}

function observeBundles() {
  if (!('IntersectionObserver' in window)) {
    track('bundle_view', { metadata: { count: bundleCatalog.length } });
    return
  }
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    track('bundle_view', { metadata: { count: bundleCatalog.length } })
  }, { threshold: .1 });
  io.observe(bundles)
}
coZone.addEventListener('change', () => { updateCheckoutTotal(); refreshDeliveryQuote() });
coPhone.addEventListener('change', loadBonus);
document.addEventListener('pivka:intro-done', () => track('splash_complete'), { once: true });
observeNav();
(async () => {
  track('page_view', { metadata: { lang: lang(), ref: document.referrer ? new URL(document.referrer).hostname : '', src: visitSource() } });
  try {
    [catalog, bundleCatalog, giftTiers, upsellRules, cities, categoryRows] = await Promise.all([retry(() => PIVKA_DB.listCatalog()), PIVKA_DB.listBundles(localStorage.getItem('pivka_city')).catch(() => []), PIVKA_DB.listGiftTiers().catch(() => []), PIVKA_DB.listUpsellRules().catch(() => []), retry(() => PIVKA_DB.listCities()), PIVKA_DB.listCategories().catch(() => [])]);
    giftTiers = groupGiftTiers(giftTiers);
    loadRuCard();
    await loadStock();
    categoryRows.forEach(c => catById[c.id] = c);
    catalog.forEach(p => {
      if (p.name_i18n) nameI18n[p.id] = p.name_i18n;
      HOURS[p.id] = [p.sell_from, p.sell_until];
      PREP[p.id] = [p.prep_minutes, p.prep_batch]
    });
    setCatalog(catalog);
    citySelect.innerHTML = cities.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
    // Cities that are not open yet: shown greyed out with a note («скоро»), not selectable.
    PIVKA_DB.listSoonCities().then(soon => soon.forEach(c => citySelect.insertAdjacentHTML('beforeend',
      '<option disabled>' + esc(c.name + ' — ' + tr(c.note || 'скоро')) + '</option>')));
    const savedCity = localStorage.getItem('pivka_city');
    currentCity = cities.find(c => c.id === savedCity) || cities[0] || null;
    if (currentCity) {
      citySelect.value = currentCity.id;
      await changeCity(currentCity.id)
    }
    // Fallback if the categories request failed: every product already carries its category id and slug.
    catalog.forEach(p => {
      if (p.category_id && !catById[p.category_id]) catById[p.category_id] = { id: p.category_id, slug: slugOf(p), name: p.categories?.name || '' }
    });
    loadNight();
    loadPause();
    syncBundle();
    renderBundles();
    renderNav();
    renderProducts(currentCat);
    restoreCart();
    observeBundles();
    const social = new URLSearchParams(location.search).get('social');
    if (social) openIncoming(social)
  } catch (e) {
    // Usually a weak connection: reload once by itself, then offer a button.
    console.warn(e);
    let tries = 0;
    try { tries = Number(sessionStorage.getItem('pivka_reload') || 0) } catch (x) {}
    if (tries < 1) {
      try { sessionStorage.setItem('pivka_reload', tries + 1) } catch (x) {}
      products.innerHTML = '<div class="empty">' + esc(tr('Слабая связь — загружаем ещё раз…')) + '</div>';
      setTimeout(() => location.reload(), 2500);
      return
    }
    products.innerHTML = '<div class="empty">' + esc(tr('Не удалось загрузить каталог')) + '<br><button type="button" class="cta" style="margin-top:12px" onclick="try{sessionStorage.removeItem(\'pivka_reload\')}catch(e){}location.reload()">' + esc(tr('Обновить')) + '</button></div>';
    renderCart()
  }
  try { sessionStorage.removeItem('pivka_reload') } catch (x) {}
})();
const I18N = {
  ru: {
    logo: 'Пивка<br><b>для рывка</b>',
    hero: 'ВЕЧЕР НАЧИНАЕТСЯ С РЫВКА',
    sub: 'Пиво, крепкое и закуски — быстро и без лишних поисков.',
    build: 'Собрать рывок',
    ready: 'Готовые наборы',
    catalog: 'Каталог',
    city: '📍 Город доставки',
    trust: ['⚡ Быстрый заказ', '💵 Наличные / перевод', '🔞 Только 18+'],
    actions: ['Угостить друга', 'Спорим на пиво?'],
    cats: ['Пиво', 'Крепкий алкоголь', 'Вино', 'Рыба', 'Снеки', 'Мясные закуски', 'Шоколад', 'Сыр', 'Орехи', 'Напитки', 'Энергетики'],
    notfound: 'Не нашли товар?',
    tell: 'Сообщить',
    repeat: '🔁 Повторить прошлый рывок',
    repeatBtn: 'Повторить',
    cart: 'Корзина пуста',
    checkout: 'Оформить заказ →',
    clear: 'Очистить корзину',
    delivery: '🚗 Доставка',
    pickup: '🏪 Самовывоз',
    confirm: 'Подтвердить заказ →',
    name: 'Имя',
    phone: 'Телефон *',
    address: 'Адрес доставки *',
    zone: 'Выберите зону доставки',
    comment: 'Комментарий к заказу',
    age: 'Мне исполнилось 18 лет',
    done: 'Готово →'
  },
  ka: {
    logo: 'ლუდი<br><b>გაქანებისთვის</b>',
    hero: 'საღამო იწყება კარგი შეკვეთით',
    sub: 'ლუდი, ძლიერი ალკოჰოლი და მისაყოლებელი — სწრაფად და მარტივად.',
    build: 'შეკვეთის აწყობა',
    ready: 'მზა ნაკრებები',
    catalog: 'კატალოგი',
    city: '📍 მიწოდების ქალაქი',
    trust: ['⚡ სწრაფი შეკვეთა', '💵 ნაღდი / გადარიცხვა', '🔞 მხოლოდ 18+'],
    actions: ['გაუმასპინძლდი მეგობარს', 'დადე ფსონი ლუდზე'],
    cats: ['ლუდი', 'ძლიერი ალკოჰოლი', 'ღვინო', 'თევზი', 'სნექები', 'ხორცის მისაყოლებელი', 'შოკოლადი', 'ყველი', 'თხილეული', 'სასმელები', 'ენერგეტიკული'],
    notfound: 'ვერ იპოვე პროდუქტი?',
    tell: 'შეგვატყობინე',
    repeat: '🔁 გაიმეორე წინა შეკვეთა',
    repeatBtn: 'გამეორება',
    cart: 'კალათა ცარიელია',
    checkout: 'შეკვეთის გაფორმება →',
    clear: 'კალათის გასუფთავება',
    delivery: '🚗 მიტანა',
    pickup: '🏪 თვითგატანა',
    confirm: 'შეკვეთის დადასტურება →',
    name: 'სახელი',
    phone: 'ტელეფონი *',
    address: 'მიტანის მისამართი *',
    zone: 'აირჩიე მიტანის ზონა',
    comment: 'კომენტარი შეკვეთაზე',
    age: '18 წლის ან უფროსი ვარ',
    done: 'მზადაა →'
  },
  hy: {
    logo: 'Գարեջուր<br><b>լավ երեկոյի համար</b>',
    hero: 'ԵՐԵԿՈՆ ՍԿՍՎՈՒՄ Է ԼԱՎ ՊԱՏՎԵՐԻՑ',
    sub: 'Գարեջուր, թունդ ալկոհոլ և խորտիկներ՝ արագ և առանց ավելորդ փնտրտուքի։',
    build: 'Հավաքել պատվերը',
    ready: 'Պատրաստի հավաքածուներ',
    catalog: 'Կատալոգ',
    city: '📍 Առաքման քաղաք',
    trust: ['⚡ Արագ պատվեր', '💵 Կանխիկ / փոխանցում', '🔞 Միայն 18+'],
    actions: ['Հյուրասիրել ընկերոջը', 'Գրազ գարեջրի վրա'],
    cats: ['Գարեջուր', 'Թունդ ալկոհոլ', 'Գինի', 'Ձուկ', 'Խորտիկներ', 'Մսային խորտիկներ', 'Շոկոլադ', 'Պանիր', 'Ընկույզներ', 'Ըմպելիքներ', 'Էներգետիկ'],
    notfound: 'Չգտա՞ք ապրանքը',
    tell: 'Հայտնել',
    repeat: '🔁 Կրկնել նախորդ պատվերը',
    repeatBtn: 'Կրկնել',
    cart: 'Զամբյուղը դատարկ է',
    checkout: 'Ձևակերպել պատվերը →',
    clear: 'Մաքրել զամբյուղը',
    delivery: '🚗 Առաքում',
    pickup: '🏪 Ինքնավերցում',
    confirm: 'Հաստատել պատվերը →',
    name: 'Անուն',
    phone: 'Հեռախոս *',
    address: 'Առաքման հասցե *',
    zone: 'Ընտրեք առաքման գոտին',
    comment: 'Մեկնաբանություն պատվերին',
    age: 'Ես 18 տարեկան կամ ավելի եմ',
    done: 'Պատրաստ է →'
  }
};

function setLang(lang) {
  setTimeout(() => { if (typeof renderGiftBanner === 'function') renderGiftBanner() }, 0);
  try {
    localStorage.setItem('pivka_lang', lang)
  } catch (e) {}
  document.documentElement.lang = lang;
  document.querySelectorAll('.langBtn').forEach(x => {
    const on = x.dataset.lang === lang;
    x.classList.toggle('active', on);
    x.setAttribute('aria-pressed', String(on))
  });
  const t = I18N[lang] || I18N.ru;
  const $ = s => document.querySelector(s);
  const logo = $('.logo');
  if (logo) logo.innerHTML = t.logo;
  document.querySelectorAll('.trust div').forEach((x, i) => {
    if (t.trust[i]) x.textContent = t.trust[i]
  });
  document.querySelectorAll('.action').forEach((x, i) => {
    const sp = x.querySelector('span');
    if (t.actions[i]) x.innerHTML = (sp ? sp.outerHTML : '') + t.actions[i]
  });
  const nf = $('#notFound b'), nfb = $('#notFound button');
  if (nf) nf.textContent = t.notfound;
  if (nfb) nfb.textContent = t.tell;
  const rep = $('#repeatCard b'), repb = $('#repeatCard button');
  if (rep) rep.textContent = t.repeat;
  if (repb) repb.textContent = t.repeatBtn;
  if ((typeof cart === 'undefined' || !Object.keys(cart).length) && (typeof checkoutBundle === 'undefined' || !checkoutBundle)) cartCount.textContent = '🛒 ' + t.cart;
  const clr = $('#clearCartBtn'), ord = $('#cartOverlay .orderGreen');
  if (clr) clr.textContent = t.clear;
  if (ord) ord.textContent = t.checkout;
  const set = (id, prop, v) => {
    const el = document.getElementById(id);
    if (el) el[prop] = v
  };
  set('deliveryBtn', 'textContent', t.delivery);
  set('pickupBtn', 'textContent', t.pickup);
  set('submitOrder', 'textContent', t.confirm);
  set('coName', 'placeholder', t.name);
  set('coPhone', 'placeholder', t.phone);
  set('coAddress', 'placeholder', t.address);
  set('coComment', 'placeholder', t.comment);
  const ageLabel = $('#coAge')?.parentElement?.querySelector('span');
  if (ageLabel) ageLabel.textContent = t.age;
  const done = $('#upsellCategoryBar button');
  if (done) done.textContent = t.done;
  if (typeof catalog !== 'undefined' && catalog.length) {
    renderNav();
    renderProducts(currentCat);
    renderBundles();
    renderCart()
  }
}
// Saved choice first; otherwise the phone's language (a Georgian phone opens in Georgian).
function detectLang() {
  try {
    const saved = localStorage.getItem('pivka_lang');
    if (['ru', 'ka', 'hy'].includes(saved)) return saved
  } catch (e) {}
  const nav = (navigator.languages || [navigator.language || '']).map(x => String(x).slice(0, 2).toLowerCase());
  return nav.find(x => ['ka', 'hy', 'ru'].includes(x)) || 'ru'
}
document.documentElement.lang = detectLang();
document.addEventListener('DOMContentLoaded', () => setLang(detectLang()));
initOrderTrack();

// Street QR campaign. /qr/ (the teaser) saves the poster spot / friend ref in localStorage and sends people here
// with ?from=qr. Orders keep the campaign in their analytics event, so posters can be compared later.
function campaignInfo() {
  try {
    const last = JSON.parse(localStorage.getItem('pivka_campaign') || 'null');
    const first = JSON.parse(localStorage.getItem('pivka_campaign_first') || 'null');
    return last ? { last, first } : null
  } catch (e) {
    return null
  }
}

const CATCH_TEXT = {
  ru: 'Парни реально знают, чего мы хотим 😂\nСмотри:',
  hy: 'Տղերքն իրոք գիտեն՝ ինչ ենք ուզում 😂\nՆայիր՝',
  ka: 'ბიჭებმა ნამდვილად იციან, რა გვინდა 😂\nნახე:'
};
// Link that plays the same teaser for the friend; ref = who shared, origin_spot = the poster that started it.
function catchFriendUrl() {
  let ref = '';
  try {
    ref = localStorage.getItem('pivka_share_id') || '';
    if (!ref) {
      ref = Math.random().toString(36).slice(2, 8);
      localStorage.setItem('pivka_share_id', ref)
    }
  } catch (e) {}
  const c = campaignInfo()?.last || {};
  // Short on purpose: /qr/?r=<ref>&o=<spot>; the teaser page expands it to utm_source=friend&utm_medium=share&…
  const u = new URL('qr/', location.href.split(/[?#]/)[0].replace(/[^/]*$/, ''));
  const p = new URLSearchParams();
  if (ref) p.set('r', ref);
  if (c.origin_spot || c.spot) p.set('o', c.origin_spot || c.spot);
  if (c.utm_campaign && c.utm_campaign !== 'guys') p.set('c', c.utm_campaign);
  u.search = p.toString();
  return u.href
}
async function catchFriend() {
  const url = catchFriendUrl();
  const text = (CATCH_TEXT[lang()] || CATCH_TEXT.ru) + '\n' + url;
  const meta = { ref: new URL(url).searchParams.get('r'), origin_spot: new URL(url).searchParams.get('o') };
  if (navigator.share) {
    try {
      await navigator.share({ text });
      track('qr_share', { metadata: { ...meta, method: 'share' } });
      return
    } catch (e) {
      if (e && e.name === 'AbortError') return
    }
  }
  catchLink.value = url;
  catchCopy.textContent = 'Скопировать ссылку';
  catchOverlay.dataset.text = text;
  openSheet('catchOverlay')
}
async function copyCatchLink() {
  const text = catchOverlay.dataset.text || catchLink.value;
  try {
    await navigator.clipboard.writeText(text)
  } catch (e) {
    catchLink.select();
    try { document.execCommand('copy') } catch (x) {}
  }
  catchCopy.textContent = 'Скопировано ✓';
  track('qr_share', { metadata: { ref: new URL(catchLink.value).searchParams.get('r'), method: 'copy' } })
}
(() => {
  let seen = false;
  try { seen = localStorage.getItem('pivka_teaser_seen') === '1' } catch (e) {}
  const btn = document.getElementById('catchFriend');
  if (btn && seen) btn.hidden = false;
  if (new URLSearchParams(location.search).get('from') === 'qr') track('qr_landing', { metadata: { campaign: campaignInfo() } })
})();
