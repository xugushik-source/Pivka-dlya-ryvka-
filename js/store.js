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
  currentCat = 'draft',
  nameI18n = {},
  categoryRows = [],
  catById = {},
  catPicked = false;
const lang = () => document.documentElement.lang || 'ru';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STRONG_GROUP = ['strong', 'vodka', 'whisky', 'brandy', 'rum', 'gin', 'tequila', 'liqueur', 'vermouth'];
const ALCOHOL = [...STRONG_GROUP, 'wine', 'draft'];
// Storefront navigation: 6 main tiles, then "Ещё к столу". Empty sections are hidden, never shown as empty shelves.
const CATS = [
  { slug: 'draft', ico: '🍺', label: 'Пиво', title: 'Пиво', grp: 'alc' },
  { slug: 'strong', ico: '🥃', label: 'Крепкое', title: 'Крепкие напитки', grp: 'alc', group: STRONG_GROUP },
  { slug: 'wine', ico: '🍷', label: 'Вино', title: 'Вино', grp: 'alc' },
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
  { slug: 'frozen', ico: '🥟', label: 'Пельмени', title: 'Пельмени и хинкали', grp: 'more' },
  { slug: 'supplies', ico: '🧻', label: 'Посуда и салфетки', title: 'Одноразовая посуда и салфетки', grp: 'more' }
];
// Quick add-ons offered in the cart next to a chosen Рывок (one tap, no category hunting).
const ADDON_SKUS = ['KRI-SUPPLY-NAPKIN-2525', 'KRI-SUPPLY-CUPS-PAPER-050', 'KRI-PICKLE-CORNICH-370', 'KRI-PICKLE-CORN-370', 'KRI-NUTS-MARTIN-PISTA-080', 'KRI-CHEESE-STICK-100', 'KRI-SNACK-MARTIN-150', 'KRI-SUPPLY-NAPKIN-3030'];
const SUB_LABEL = {
  vodka: ['водка', 'არაყი', 'օղի'], whisky: ['виски', 'ვისკი', 'վիսկի'], brandy: ['коньяк', 'კონიაკი', 'կոնյակ'],
  strong: ['ликёры', 'ლიქიორები', 'լիկյորներ'], rum: ['ром', 'რომი', 'ռոմ'], gin: ['джин', 'ჯინი', 'ջին'], tequila: ['текила', 'ტეკილა', 'տեկիլա']
};
// Real photos for section tiles (assets/cat): scene crops from the bar photo, or real packshots on the same bar backdrop.
const CAT_IMG = ['draft', 'strong', 'wine', 'fish', 'meat-snacks', 'cheese', 'nuts', 'chips', 'snacks', 'soft-drinks', 'energy', 'salty', 'seafood', 'frozen', 'supplies'];
const catImg = slug => CAT_IMG.includes(slug) ? './assets/cat/' + slug + '.jpg?v=20261002e' : '';
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
const TRACK_KEEP_MS = 15 * 60e3; // the card disappears 15 minutes after the order is delivered or cancelled
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
    '<a class="trackMore" href="./order.html?o=' + encodeURIComponent(trackSaved()?.id || '') + '">Что заказано и статус →</a>';
  box.hidden = false;
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
    if (end && new Date(o.now) - new Date(end) > TRACK_KEEP_MS) throw new Error('old');
    renderTrack(o);
    if (!['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status)) trackTimer = setTimeout(refreshTrack, 20e3);
    else if (end) trackTimer = setTimeout(refreshTrack, Math.max(5e3, TRACK_KEEP_MS - (new Date(o.now) - new Date(end)) + 2e3)); // hides itself on an open page
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
    if (quick) quick.hidden = true
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

let passPlan = 'DAY';
function openPass() {
  passOverlay.classList.add('on')
}
function pickPassPlan(el) {
  passPlan = el.dataset.plan;
  document.querySelectorAll('.passPlan').forEach(b => b.classList.toggle('on', b === el));
  passGo.textContent = 'Оформить PASS за ' + (passPlan === 'NIGHT' ? 40 : 20) + ' ₾ →'
}
async function activatePass() {
  if (passPhone.value.trim().length < 6) {
    alert('Укажи телефон');
    return
  }
  try {
    const r = await PIVKA_DB.startPass(passName.value.trim(), passPhone.value.trim(), passPlan);
    passBody.innerHTML = '<div class="success"><div class="big">👑</div><h2>PASS подготовлен</h2><p class="muted">' + (r.plan === 'NIGHT' ? 'Ночной PASS — 40 ₾ / месяц.' : 'Дневной PASS — 20 ₾ / месяц.') + ' Оплатите переводом — после оплаты мы включим PASS на 30 дней.</p>' + [...paymentLinks.querySelectorAll('a')].map(x => x.outerHTML).join('') + '</div>'
  } catch (e) {
    alert(e.message)
  }
}

function openSocial(type) {
  socialType = type;
  socialTitle.textContent = type === 'TREAT' ? '🍻 Угостить друга' : '🏆 Спорим на пиво?';
  socialSub.textContent = type === 'TREAT' ? 'Выбери угощение и отправь ссылку другу' : 'Выбери ставку и отправь ссылку сопернику';
  socialBody.innerHTML = '<input id="socialName" placeholder="Твоё имя"><input id="socialPhone" inputmode="tel" autocomplete="tel" placeholder="Твой телефон *"><select id="socialStake"></select><textarea id="socialMessage" placeholder="Сообщение другу"></textarea><div class="error" id="socialError"></div><button class="yellow checkout" onclick="createSocial()">Создать ссылку →</button>';
  const opts = bundleCatalog.filter(b => b.available !== false).map(b => '<option value="b:' + b.id + '">' + esc(tr(b.name)) + ' — ' + money(b.price) + '</option>');
  catalog.filter(p => p.unit === 'liter').forEach(p => opts.push('<option value="p:' + p.id + '">' + esc(pname(p)) + ' — ' + money(Number(p.sale_price) * Number(p.minimum_quantity || 2)) + '</option>'));
  socialStake.innerHTML = opts.length ? opts.join('') : '<option value="">Нет доступных ставок</option>';
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
  const [kind, id] = socialStake.value.split(':');
  try {
    const r = await PIVKA_DB.createSocialOrder({
      type: socialType,
      name: socialName.value.trim(),
      phone: socialPhone.value.trim(),
      bundleId: kind === 'b' ? id : null,
      productId: kind === 'p' ? id : null,
      quantity: kind === 'p' ? (catalog.find(x => x.id === id)?.minimum_quantity || 2) : 1,
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
  if (cart[p.id]) cart[p.id].qty += q;
  else cart[p.id] = { p, qty: q };
  const via = opts.boost ? 'gift_boost' : upsellReturn ? 'upsell' : 'catalog';
  track('add_to_cart', { productId: p.id, metadata: { qty: q, via } });
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

function syncBundle() {
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
  applyNight();
  if (!bundleCatalog.length) {
    bundles.innerHTML = '<div class="empty">Готовые рывки скоро появятся</div>';
    return
  }
  bundles.innerHTML = bundleCatalog.map((b, n) => {
    const ok = b.available !== false,
      on = ok && checkoutBundle?.id === b.id,
      save = Number(b.savings || 0),
      items = sortedItems(b),
      thumbs = items.map(i => '<span>' + (i.image_url ? '<img src="' + esc(i.image_url) + '" alt="' + esc(pname(i)) + '" loading="lazy" decoding="async" onerror="this.remove()">' : '') + (itemQty(i) ? '<em>' + itemQty(i) + '</em>' : '') + '</span>').join(''),
      comp = items.map(i => {
        const sl = itemSlug(i), ico = STRONG_GROUP.includes(sl) ? '🥃' : ITEM_ICO[sl] || '•', q = Number(i.quantity);
        return '<li>' + ico + ' ' + esc(pname(i)) + (i.unit === 'liter' ? ' — ' + q + unitL() : q > 1 ? ' × ' + q : '') + '</li>'
      }).join('');
    return `<article class="card bundle${ok?'':' off'}${on?' chosen':''}" style="--i:${n}"><div class="bthumbs">${thumbs}</div><div class="pad"><div><span class="tag">${esc(b.badge_text||'РЫВОК')}</span>${b.serves_label?'<span class="serves">'+esc(b.serves_label)+'</span>':''}</div><h3>${esc(b.name)}</h3>${b.description?'<div class="bidea">'+esc(b.description)+'</div>':''}<div class="bprices">${save>0?'<div><span class="lbl">По отдельности</span><s>'+money(b.regular_total)+'</s></div>':''}<div><span class="lbl">Рывком</span><b class="now">${money(b.price)}</b></div>${save>0?'<div><span class="lbl">Экономия</span><b class="save">'+money(save)+'</b></div>':''}</div><ul class="bcomp"><span class="lbl">В составе</span>${comp}</ul>${ok?`<button type="button" class="cta" onclick="chooseBundle('${b.id}')">${on?'Рывок выбран ✓':'ВЗЯТЬ РЫВОК'}</button>`:'<button type="button" class="cta" disabled>Временно недоступен</button>'}</div></article>`
  }).join('')
}

function goBundles() {
  document.getElementById('bundlesSection').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

function goBuild() {
  track('build_start');
  buildSection.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

function totals() {
  return Object.values(cart).reduce((s, x) => s + x.qty * Number(x.p.sale_price), 0)
}

// ---------- Night prices and day/night delivery — the same rule the server applies to the order (public.night_pricing):
// 00:00–08:00 Tbilisi every product and Рывок +10 %, rounded up to 0.50 ₾. Day prices are kept in p._day / b._day.
let NIGHT = null, nightShown = null;
const tbilisiHM = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Tbilisi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const inWin = (t, a, b) => a <= b ? t >= a && t < b : t >= a || t < b;
const nightOn = () => !!NIGHT && Number(NIGHT.percent) > 0 && inWin(tbilisiHM(), NIGHT.from || '00:00', NIGHT.to || '08:00');
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
// Delivery rule for «now»: day 4 ₾ / free from 50 ₾, after 23:00 7 ₾ / free from 80 ₾ (numbers come from the server).
function deliveryRule() {
  const d = NIGHT?.delivery || {}, n = inWin(tbilisiHM(), d.night_from || '23:00', d.night_to || '08:00');
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
// The page may stay open across 00:00 / 08:00: switch prices on time.
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
  if (giftLastWon !== null && wonAt > giftLastWon) track('gift_reached', { metadata: { threshold: wonAt, total } });
  giftLastWon = wonAt;
  let text, width;
  if (next) {
    const rem = money(Number(next.threshold) - total);
    text = won ? '🎁 ' + pname(won.products) + ' открыт · ещё ' + rem + ' до следующего' : total > 0 ? '🎁 До подарка осталось ' + rem : '🎁 Закажи от ' + money(next.threshold) + ' — подарок: ' + pname(next.products);
    width = Math.min(100, total / Number(next.threshold) * 100)
  } else {
    text = '🎁 Подарок открыт: ' + (pname(won?.products) || 'максимальный уровень');
    width = 100
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
    x.innerHTML = '<strong class="gtext">' + esc(text) + '</strong><div class="bar"><i style="width:' + width + '%"></i></div><div class="marks">' + marks + '</div>' + bundleNote + boost
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
  cartDelivery.textContent = (items.length || checkoutBundle) ? deliveryHint() : '';
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
    title: p.unit === 'liter' ? 'Что возьмём к пиву?' : 'К этому обычно берут',
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
function renderNav() {
  const vis = CATS.filter(c => catProducts(c.slug).length);
  const tile = c => `<button type="button" class="tile${catImg(c.slug)?' photo':''}${c.slug===currentCat?' on':''}" data-cat="${c.slug}" aria-pressed="${c.slug===currentCat}"${catImg(c.slug)?` style="background-image:url('${catImg(c.slug)}')"`:''}>${catImg(c.slug)?'':`<span class="ti" aria-hidden="true">${c.ico}</span>`}<span class="tt"><b>${c.label}</b><small>${countLabel(c.slug, catProducts(c.slug).length)}</small></span></button>`;
  tilesAlc.innerHTML = vis.filter(c => c.grp === 'alc').map(tile).join('');
  tilesFood.innerHTML = vis.filter(c => c.grp === 'food').map(tile).join('');
  const more = vis.filter(c => c.grp === 'more');
  tilesMore.innerHTML = more.map(tile).join('');
  moreHead.hidden = !more.length;
  catNav.innerHTML = vis.map(c => `<button type="button" class="chip${c.slug===currentCat?' on':''}" data-cat="${c.slug}">${c.ico} ${c.label}</button>`).join('');
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
      catalog = cc.map(p => ({
        ...p,
        name_i18n: nameI18n[p.id] || {},
        categories: {
          slug: p.category_slug,
          name: p.category_name
        },
        active: true,
        stock_quantity: Number(p.available_stock || 0),
        available_stock: Number(p.available_stock || 0)
      }));
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
    paymentLinks.innerHTML = links.length ? '<div class="muted payhint">Переведите сумму «К оплате» по ссылке банка и отправьте скриншот в WhatsApp вместе с заказом.</div>' + links.map(x => '<a class="yellow paylink" target="_blank" rel="noopener" href="' + esc(x.url) + '">💳 ' + esc(x.name) + '</a>').join('') : '<div class="muted">Перевод — по реквизитам, которые пришлём в WhatsApp.</div>';
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

function syncPaymentLinks() {
  paymentLinks.style.display = coPayment.value === 'transfer' ? 'block' : 'none'
}
coPayment.addEventListener('change', syncPaymentLinks);

function setFulfillment(v) {
  fulfillment = v;
  deliveryBtn.classList.toggle('on', v === 'delivery');
  pickupBtn.classList.toggle('on', v === 'pickup');
  coAddress.style.display = v === 'delivery' ? 'block' : 'none';
  coZone.style.display = v === 'delivery' ? 'block' : 'none';
  coPickupTime.style.display = v === 'pickup' ? 'block' : 'none';
  updateCheckoutTotal();
  refreshDeliveryQuote()
}

// Delivery fee comes from the server rule (zone, owner switch, PASS 12:00–22:00); the zone fee is only a fallback.
let deliveryQuoteState = { fee: null, reason: null, mode: 'CHARGE' }, quoteSeq = 0;
// After a successful order the form is replaced by the confirmation screen.
const checkoutFormAlive = () => !!document.getElementById('coZone');

async function refreshDeliveryQuote() {
  if (!checkoutFormAlive()) return;
  const seq = ++quoteSeq;
  try {
    const q = await retry(() => PIVKA_DB.deliveryQuote(fulfillment === 'delivery' ? coZone.value || null : null, coPhone.value.trim() || null, fulfillment));
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
  if (deliveryQuoteState.fee !== null) return deliveryQuoteState.fee;
  const opt = coZone.options[coZone.selectedIndex];
  return deliveryQuoteState.mode === 'CHARGE' && opt?.value ? deliveryRule().fee : 0
}

function updateCheckoutTotal() {
  if (!checkoutFormAlive()) return;
  const base = orderBase();
  const opt = coZone.options[coZone.selectedIndex];
  const fee = currentDeliveryFee();
  const mode = deliveryQuoteState.mode;
  coTotal.textContent = money(base + fee);
  checkoutNotice.style.display = fulfillment === 'delivery' ? 'block' : 'none';
  const min = opt?.dataset?.min && Number(opt.dataset.min) ? ' · Минимальный заказ ' + money(opt.dataset.min) : '';
  const feeText = deliveryQuoteState.reason === 'FREE_FROM' ? 'Доставка бесплатно — заказ от ' + deliveryRule().free + ' ₾' : deliveryQuoteState.reason === 'ZONE' && fee > 0 ? 'Доставка: ' + money(fee) + ' · от ' + deliveryRule().free + ' ₾ — бесплатно' : deliveryQuoteState.reason === 'PASS_SMALL' ? 'Доставка: ' + money(fee) + ' · с PASS от 30 ₾ — бесплатно' : deliveryQuoteState.reason === 'PASS' ? 'Доставка: 0 ₾ — PASS' : mode === 'HIDDEN' ? '' : mode === 'FREE' ? 'Доставка бесплатно' : 'Доставка: ' + money(fee);
  checkoutNotice.textContent = fulfillment === 'delivery' ? (coZone.value ? (feeText + min).replace(/^ · /, '') || 'Доставка' : 'Выбери зону доставки') : 'Самовывоз — без платы за доставку'
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
  const items = Object.values(cart);
  if (!checkoutBundle && !items.length) {
    cartHint.textContent = 'Добавь товар из каталога для оформления';
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
async function submitCheckout() {
  coError.textContent = '';
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
    const pickupText = fulfillment === 'pickup' ? 'Самовывоз через ' + coPickupTime.value + ' мин' : '';
    const payload = {
      name: coName.value.trim(),
      phone,
      fulfillment,
      address,
      payment: coPayment.value,
      comment: (pickupText ? pickupText + (coComment.value.trim() ? ' | ' : '') : '') + coComment.value.trim() + (currentCity ? ' | Город: ' + currentCity.name : '') + (coZone.value && fulfillment === 'delivery' ? ' | Зона: ' + coZone.options[coZone.selectedIndex].text : ''),
      items,
      bundleId: checkoutBundle?.id,
      cityId: currentCity?.id || null,
      zoneId: fulfillment === 'delivery' ? coZone.value || null : null
    };
    let r;
    if (checkoutBundle) r = await PIVKA_DB.createBundleOrder(payload);
    else r = await PIVKA_DB.createOrder(payload);
    const waItems = (checkoutBundle ? checkoutBundle.name + ' (' + (checkoutBundle.items || []).map(i => i.name + ' × ' + Number(i.quantity)).join(', ') + ')' + (items.length ? '\n' : '') : '') + Object.values(cart).map(x => x.p.name + ' × ' + x.qty).join('\n');
    const waText = '🍻 НОВЫЙ ЗАКАЗ №' + r.order_number + '\n' + waItems + '\n\nДоставка: ' + (fulfillment === 'delivery' ? money(r.delivery_fee || 0) + (r.delivery_reason === 'PASS' ? ' (PASS)' : '') : '—') + '\nСумма: ' + money(r.total) + '\nТелефон: ' + phone + '\n' + (fulfillment === 'delivery' ? 'Адрес: ' + address + '\nЗона: ' + coZone.options[coZone.selectedIndex].text : 'Самовывоз') + (fulfillment === 'pickup' ? '\nВремя: через ' + coPickupTime.value + ' мин' : '') + '\nОплата: ' + (coPayment.value === 'cash' ? 'Наличными' : 'Переводом') + (coComment.value.trim() ? '\nКомментарий: ' + coComment.value.trim() : '');
    track('order_complete', { bundleId: checkoutBundle?.id || null, metadata: { order_number: r.order_number, total: Number(r.total), campaign: campaignInfo() } });
    try {
      if (r.order_id) localStorage.setItem(TRACK_KEY, JSON.stringify({ id: r.order_id, n: r.order_number, at: Date.now() }))
    } catch (e) {}
    // The order has its own page; its link goes into the WhatsApp message, so the order can always be found again
    // (another browser, Instagram/Telegram in-app browser, cleared phone). No automatic jump to WhatsApp any more:
    // it replaced the store tab and people could not get back to their order.
    const orderUrl = r.order_id ? new URL('order.html?o=' + r.order_id, location.href.split(/[?#]/)[0].replace(/[^/]*$/, '')).href : '';
    const waUrl = 'https://wa.me/995579145634?text=' + encodeURIComponent(waText + (orderUrl ? '\n\nСтатус заказа: ' + orderUrl : ''));
    checkoutBody.innerHTML = `<div class="success"><div class="big">🍻</div><h2>Рывок принят!</h2><p class="muted">Заказ №${r.order_number}<br>Сумма: ${money(r.total)}</p><a class="yellow checkout orderGreen" style="display:block;text-decoration:none" href="${waUrl}" target="_blank" rel="noopener">Отправить заказ в WhatsApp →</a>${orderUrl ? `<a class="yellow checkout" style="display:block;text-decoration:none" href="${orderUrl}">Мой заказ и статус →</a><p class="muted">Ссылка на заказ будет и в вашем сообщении WhatsApp — по ней статус всегда можно открыть снова.</p>` : ''}<button class="skip" onclick="try{sessionStorage.setItem('pivka_intro_short','1')}catch(e){};location.reload()">Готово</button></div>`;
    // The same status card as on the home page.
    checkoutBody.querySelector('.success').insertAdjacentHTML('beforeend', '<div id="orderTrack" class="trackCard" hidden></div>');
    document.querySelector('#todaySection #orderTrack')?.remove();
    refreshTrack();
    Object.keys(cart).forEach(k => delete cart[k]);
    checkoutBundle = null;
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
  products.classList.remove('stagger');
  products.innerHTML = rows.length ? rows.map((p, n) => {
    const lim = p.unit === 'liter' ? 'Минимум ' + Number(p.minimum_quantity || 2) + ' л · шаг 2 л' : ALCOHOL.includes(slugOf(p)) ? '18+' : '',
      inCart = cart[p.id]?.qty;
    return `<div class="product" style="--i:${Math.min(n,8)}"><div class="thumb">${p.image_url?'<img src="'+esc(p.image_url)+'" alt="'+esc(pname(p))+'" loading="lazy" decoding="async" data-fallback="'+icon(p)+'" onerror="this.parentNode.textContent=this.dataset.fallback">':icon(p)}</div><div class="pinfo"><h3>${esc(pname(p))} ${p.top_pick?'<span class="tag">ТОП</span>':''}</h3>${lim?'<div class="lim">'+lim+'</div>':''}<div class="p">${p.unit==='liter'?money(p.sale_price)+' за 1 л':money(p.sale_price)}</div><div class="stock">${inCart?'В корзине: '+inCart+(p.unit==='liter'?unitL():''):'В наличии'}</div></div><button type="button" class="plus" data-id="${p.id}" aria-label="Добавить">+</button></div>`
  }).join('') : '<div class="empty">' + (upsellReturn ? 'Всё из этого раздела уже в корзине' : 'В этой категории пока пусто') + '</div>';
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
coPhone.addEventListener('change', refreshDeliveryQuote);
document.addEventListener('pivka:intro-done', () => track('splash_complete'), { once: true });
observeNav();
(async () => {
  track('page_view', { metadata: { lang: lang(), ref: document.referrer ? new URL(document.referrer).hostname : '' } });
  try {
    [catalog, bundleCatalog, giftTiers, upsellRules, cities, categoryRows] = await Promise.all([retry(() => PIVKA_DB.listCatalog()), PIVKA_DB.listBundles(localStorage.getItem('pivka_city')).catch(() => []), PIVKA_DB.listGiftTiers().catch(() => []), PIVKA_DB.listUpsellRules().catch(() => []), retry(() => PIVKA_DB.listCities()), PIVKA_DB.listCategories().catch(() => [])]);
    giftTiers = groupGiftTiers(giftTiers);
    categoryRows.forEach(c => catById[c.id] = c);
    catalog.forEach(p => {
      if (p.name_i18n) nameI18n[p.id] = p.name_i18n
    });
    citySelect.innerHTML = cities.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
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
    syncBundle();
    renderBundles();
    renderNav();
    renderProducts(currentCat);
    restoreCart();
    observeBundles();
    const social = new URLSearchParams(location.search).get('social');
    if (social) openIncoming(social)
  } catch (e) {
    products.innerHTML = '<div class="empty">Не удалось загрузить каталог</div>';
    console.warn(e);
    renderCart()
  }
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
    actions: ['Угостить друга', 'Спорим на пиво?', 'Пивка PASS'],
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
    actions: ['გაუმასპინძლდი მეგობარს', 'დადე ფსონი ლუდზე', 'ლუდის PASS'],
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
    actions: ['Հյուրասիրել ընկերոջը', 'Գրազ գարեջրի վրա', 'Գարեջրի PASS'],
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
    ref = localStorage.getItem('pivka_ref') || '';
    if (!ref) {
      ref = Math.random().toString(36).slice(2, 8);
      localStorage.setItem('pivka_ref', ref)
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
