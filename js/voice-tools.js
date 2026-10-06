/* Voice seller — the only door between the AI and the shop.
   Every tool runs on top of the existing store.js state and functions (cart, catalog, bundleCatalog, giftTiers,
   renderCart, orderBase, delivery rule, night prices). The model passes ids and quantities only; prices, names and
   totals always come from the loaded catalog — a price said by the model is never used.
   Arguments are validated: unknown product/bundle ids are rejected, quantities are clamped to the store rules
   (draft beer: minimum and step from the product, 2 L by default). */
(function () {
  'use strict';
  const r2 = (n) => Math.round(Number(n) * 100) / 100;
  const ID = /^[0-9a-f-]{36}$/i;
  let lastReco = null;
  let listener = () => {};

  const L = () => (typeof lang === 'function' ? lang() : 'ru');
  const nm = (p) => (typeof pname === 'function' ? pname(p) : p.name);
  const cat = (p) => (typeof slugOf === 'function' ? slugOf(p) : p.category_slug || '');
  const findP = (id) => (ID.test(String(id || '')) ? catalog.find((p) => p.id === id) : null) || null;
  const avail = (p) => p && p.active !== false && Number(p.sale_price) > 0 && !(p.supply_mode === 'OWN_STOCK' && Number(p.available_stock || 0) <= 0);
  const fail = (code, extra) => ({ ok: false, error: code, ...(extra || {}) });

  function legalQty(p, q) {
    q = Number(q);
    if (!isFinite(q) || q <= 0) return null;
    if (p.unit === 'liter') {
      const min = Number(p.minimum_quantity || 2), step = Number(p.quantity_step || 2);
      q = Math.min(q, 60);
      return q <= min ? min : min + Math.ceil((q - min) / step - 1e-9) * step;
    }
    const min = Number(p.minimum_quantity || 1), step = Number(p.quantity_step || 1);
    q = Math.min(Math.round(q), 50);
    return q <= min ? min : min + Math.ceil((q - min) / step - 1e-9) * step;
  }

  function productView(p) {
    return { product_id: p.id, name: nm(p), category: cat(p), unit: p.unit === 'liter' ? 'L' : 'pcs', price: Number(p.sale_price),
      min: p.unit === 'liter' ? Number(p.minimum_quantity || 2) : undefined, description: p.description || undefined };
  }
  function bundleView(b) {
    return { bundle_id: b.id, name: (typeof tr === 'function' ? tr(b.name) : b.name), price: Number(b.price), regular_total: Number(b.regular_total || 0) || undefined,
      serves: b.serves_label || undefined, available: b.available !== false,
      items: (b.items || []).map((i) => { const p = catalog.find((x) => x.id === i.product_id); return { name: p ? nm(p) : i.name, quantity: Number(i.quantity) } }) };
  }
  function giftView() {
    if (!giftTiers || !giftTiers.length) return { tiers: false };
    const t = giftTotals();
    const next = giftTiers.find((x) => t < Number(x.threshold));
    const won = [...giftTiers].reverse().find((x) => t >= Number(x.threshold));
    return { counted_total: r2(t), next_threshold: next ? Number(next.threshold) : null, left: next ? r2(Number(next.threshold) - t) : 0,
      next_gift: next ? nm(next.products) : null, unlocked_gift: won ? nm(won.products) : null,
      note: checkoutBundle ? 'bundle_not_counted' : undefined };
  }
  function cartView() {
    const items = Object.values(cart).map((x) => ({ product_id: x.p.id, name: nm(x.p), category: cat(x.p), quantity: x.qty, unit: x.p.unit === 'liter' ? 'L' : 'pcs', price: Number(x.p.sale_price), sum: r2(x.qty * Number(x.p.sale_price)) }));
    return { items, bundle: checkoutBundle ? bundleView(checkoutBundle) : null, total: r2(orderBase()), gift: giftView(), night_prices: typeof nightOn === 'function' ? nightOn() : false };
  }
  // After every change: redraw the existing cart UI and answer with the authoritative state.
  function changed(kind, meta) {
    renderCart();
    if (typeof bumpCart === 'function') bumpCart();
    const v = cartView();
    listener({ type: 'cart', cart: v, kind });
    if (kind) track(kind, { metadata: { ...(meta || {}), total: v.total, via: 'voice' } });
    return { ok: true, cart: v };
  }
  function putP(p, q) {
    if (q <= 0) delete cart[p.id];
    else cart[p.id] = { p, qty: q };
  }
  const STRONG = (window.PivkaReco && PivkaReco.STRONG) || [];
  // Delivery / PASS rules from the server (public.night_pricing); loaded by store.js, fetched here if not yet.
  async function policy() {
    if (typeof NIGHT !== 'undefined' && NIGHT && NIGHT.delivery) return NIGHT.delivery;
    try { const r = await PIVKA_DB.client().rpc('night_pricing'); if (!r.error && r.data) { if (typeof NIGHT !== 'undefined' && !NIGHT) NIGHT = r.data; return r.data.delivery || {} } } catch (e) {}
    return {};
  }
  const catMatch = (c, want) => want === 'strong' ? STRONG.includes(c) : c === want || (want === 'beer' && c === 'draft');

  const TOOLS = {
    get_store_context() {
      const d = (typeof NIGHT !== 'undefined' && NIGHT && NIGHT.delivery) || {};
      return {
        city: currentCity ? currentCity.name : null, language: L(), tbilisi_time: typeof tbilisiHM === 'function' ? tbilisiHM() : null,
        night_prices_now: typeof nightOn === 'function' ? nightOn() : false,
        night_prices_rule: (typeof NIGHT !== 'undefined' && NIGHT) ? { from: NIGHT.from, to: NIGHT.to, percent: NIGHT.percent } : null,
        delivery_now: typeof deliveryRule === 'function' ? deliveryRule() : null,
        delivery_rules: { day_fee: d.day_fee, day_free_from: d.day_free_from, evening_from: d.night_from, evening_fee: d.night_fee, evening_free_from: d.night_free_from },
        draft_beer_rule: 'min 2 L, step 2 L',
        categories: [...new Set(catalog.filter(avail).map(cat))],
        bundles_count: bundleCatalog.filter((b) => b.available !== false).length,
      };
    },
    get_catalog({ category, query } = {}) {
      const q = String(query || '').toLowerCase().trim().slice(0, 60);
      const c = String(category || '').trim();
      const list = catalog.filter(avail).filter((p) => !c || catMatch(cat(p), c)).filter((p) => !q || [p.name, ...Object.values(p.name_i18n || {})].some((n) => String(n || '').toLowerCase().includes(q)));
      return { count: list.length, products: list.slice(0, 40).map(productView) };
    },
    get_product({ product_id }) {
      const p = findP(product_id);
      return p ? { ok: true, product: productView(p), available: avail(p) } : fail('unknown_product');
    },
    get_available_bundles() {
      return { bundles: bundleCatalog.filter((b) => b.available !== false).map(bundleView) };
    },
    get_cart() { return cartView() },
    recommend_cart(args = {}) {
      const r = PivkaReco.recommend(args || {}, catalog, bundleCatalog);
      r.items = r.items.map((i) => ({ ...i, name: nm(i) }));
      if (r.upsell) r.upsell.name = nm(r.upsell);
      lastReco = r;
      listener({ type: 'recommendation', reco: r });
      track('voice_recommendation', { metadata: { people: r.people, budget: r.budget, total: r.total, lines: r.items.length, bundle: !!r.bundle } });
      return { ok: true, ...r, note: 'Not in the cart yet. Ask before apply_recommendation.' };
    },
    apply_recommendation({ replace } = {}) {
      if (!lastReco || !lastReco.items.length) return fail('no_recommendation');
      if (replace) Object.keys(cart).forEach((k) => delete cart[k]);
      for (const i of lastReco.items) {
        const p = findP(i.product_id);
        if (!avail(p)) continue;
        const q = legalQty(p, (cart[p.id] ? cart[p.id].qty : 0) + Number(i.quantity));
        putP(p, q);
      }
      track('voice_recommendation_accepted', { metadata: { total: lastReco.total } });
      return changed('voice_add_to_cart', { from: 'recommendation' });
    },
    add_to_cart({ product_id, quantity }) {
      const p = findP(product_id);
      if (!p) return fail('unknown_product');
      if (!avail(p)) return fail('not_available');
      const q = legalQty(p, (cart[p.id] ? cart[p.id].qty : 0) + Number(quantity || 1));
      if (!q) return fail('bad_quantity');
      putP(p, q);
      return changed('voice_add_to_cart', { product: p.id, qty: q });
    },
    remove_from_cart({ product_id, category }) {
      if (product_id) {
        const p = findP(product_id);
        if (!p) return fail('unknown_product');
        if (!cart[p.id]) return fail('not_in_cart');
        delete cart[p.id];
        return changed('voice_remove_from_cart', { product: p.id });
      }
      const c = String(category || '').trim();
      if (!c) return fail('need_product_or_category');
      const ids = Object.values(cart).filter((x) => catMatch(cat(x.p), c)).map((x) => x.p.id);
      if (!ids.length) return fail('not_in_cart', { bundle_has_it: !!(checkoutBundle && (checkoutBundle.items || []).some((i) => { const p = catalog.find((x) => x.id === i.product_id); return p && catMatch(cat(p), c) })) });
      ids.forEach((id) => delete cart[id]);
      return changed('voice_remove_from_cart', { category: c, lines: ids.length });
    },
    set_cart_quantity({ product_id, quantity }) {
      const p = findP(product_id);
      if (!p) return fail('unknown_product');
      if (Number(quantity) <= 0) { delete cart[p.id]; return changed('voice_remove_from_cart', { product: p.id }) }
      if (!avail(p)) return fail('not_available');
      const q = legalQty(p, quantity);
      if (!q) return fail('bad_quantity');
      putP(p, q);
      return changed('voice_add_to_cart', { product: p.id, qty: q });
    },
    add_bundle_to_cart({ bundle_id }) {
      const b = ID.test(String(bundle_id || '')) ? bundleCatalog.find((x) => x.id === bundle_id) : null;
      if (!b) return fail('unknown_bundle');
      if (b.available === false) return fail('not_available');
      checkoutBundle = b; // same as chooseBundle() without opening the cart sheet over the voice sheet
      try { localStorage.setItem('pivka_bundle', b.id) } catch (e) {}
      track('bundle_add', { bundleId: b.id, metadata: { via: 'voice' } });
      if (typeof renderBundles === 'function') renderBundles();
      return changed('voice_add_to_cart', { bundle: b.id });
    },
    clear_cart() {
      Object.keys(cart).forEach((k) => delete cart[k]);
      checkoutBundle = null;
      try { localStorage.removeItem('pivka_bundle') } catch (e) {}
      if (typeof renderBundles === 'function') renderBundles();
      return changed('voice_remove_from_cart', { all: true });
    },
    async get_delivery_quote({ subtotal } = {}) {
      const sub = Number(subtotal) > 0 ? Number(subtotal) : orderBase();
      let phone = null;
      try { phone = JSON.parse(localStorage.getItem('pivka_profile') || '{}').phone || null } catch (e) {}
      const zone = (typeof coZone !== 'undefined' && coZone.options && [...coZone.options].find((o) => o.value)) || null;
      try {
        if (!zone) throw new Error('no zone yet');
        const q = await PIVKA_DB.deliveryQuote(zone.value, phone, 'delivery', sub);
        if (q.reason === 'NO_ZONE') throw new Error('no zone');
        return { ok: true, subtotal: r2(sub), fee: Number(q.fee || 0), reason: q.reason, free_from: q.free_from ?? null, pickup_fee: 0 };
      } catch (e) {
        await policy();
        const r = deliveryRule();
        return { ok: true, subtotal: r2(sub), fee: sub >= r.free ? 0 : r.fee, free_from: r.free, pickup_fee: 0, estimated: true };
      }
    },
    get_gift_progress() { return giftView() },
    async get_pass_status_or_offer() {
      const d = await policy();
      const offer = {
        day: { price: d.pass_price, hours: (d.pass_from || '12:00') + '–' + (d.pass_to || '23:00'), free_from: d.pass_free_from, small_order_fee: d.pass_fee },
        night: { price: d.pass_night_price, extra_hours: (d.night_from || '23:00') + '–' + (d.night_to || '08:00'), free_from: d.pass_free_from, small_order_fee: d.pass_night_fee },
        how: 'PASS is bought from the 👑 PASS button and switched on after a bank transfer.',
      };
      let active = null;
      try {
        const phone = JSON.parse(localStorage.getItem('pivka_profile') || '{}').phone;
        const zone = typeof coZone !== 'undefined' && [...coZone.options].find((o) => o.value);
        if (phone && zone) { const q = await PIVKA_DB.deliveryQuote(zone.value, phone, 'delivery', 100); active = /PASS/.test(q.reason || '') ? (q.plan || true) : false }
      } catch (e) {}
      return { offer, active_for_saved_phone: active };
    },
    prepare_checkout() {
      if (!checkoutBundle && !Object.keys(cart).length) return fail('cart_empty');
      track('voice_checkout_open', { metadata: { total: r2(orderBase()) } });
      // The answer goes back to the seller first; then the existing checkout opens and the voice sheet closes.
      setTimeout(() => { listener({ type: 'checkout' }); openCheckout() }, 60);
      return { ok: true, opened: 'checkout', total: r2(orderBase()), note: 'The customer confirms the order in the form (age 18+, address, payment).' };
    },
  };

  async function run(name, args) {
    const fn = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
    if (!fn) return fail('unknown_tool');
    let a = {};
    try { a = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {}) } catch (e) { return fail('bad_arguments') }
    if (typeof a !== 'object' || Array.isArray(a)) return fail('bad_arguments');
    try { return await fn(a) } catch (e) { console.warn('voice tool', name, e); return fail('tool_failed') }
  }

  window.PivkaVoiceTools = { run, names: Object.keys(TOOLS), onChange: (f) => { listener = typeof f === 'function' ? f : () => {} }, cartView, legalQty, lastReco: () => lastReco };
})();
