/* Voice seller — deterministic cart recommendation.
   The AI only turns speech into parameters (people, budget, what to drink, what not to take); this module picks real
   products from the loaded catalog at their current prices (night prices already applied by store.js) and returns a
   cart proposal. Nothing here is added to the cart — that is apply_recommendation in voice-tools.js.
   Pure function: (input, catalog, bundles) → proposal. No DOM, no network. */
(function () {
  'use strict';
  const STRONG = ['strong', 'vodka', 'whisky', 'brandy', 'rum', 'gin', 'tequila', 'liqueur', 'vermouth'];
  // Snack order of preference with beer; the first ones are the «real» beer food.
  const SNACKS = ['fish', 'cheese', 'meat-snacks', 'nuts', 'chips', 'snacks', 'salty'];
  // Only on request (frozen/raw, need cooking): seafood, frozen.
  const ON_REQUEST = ['seafood', 'frozen'];
  const r2 = (n) => Math.round(n * 100) / 100;
  const slug = (p) => p.category_slug || (p.categories && p.categories.slug) || '';
  const price = (p) => Number(p.sale_price || 0);
  const isAvail = (p) => p && p.active !== false && price(p) > 0 && !(p.supply_mode === 'OWN_STOCK' && Number(p.available_stock || 0) <= 0);
  const expand = (list) => {
    const s = new Set();
    (list || []).forEach((c) => { if (c === 'strong' || c === 'alcohol_strong') STRONG.forEach((x) => s.add(x)); else s.add(String(c)) });
    return s;
  };
  // Liters for draft beer: minimum and step from the product (2 L by the store rules).
  function beerQty(p, liters) {
    const min = Number(p.minimum_quantity || 2), step = Number(p.quantity_step || 2);
    if (liters < min) return min;
    return min + Math.ceil((liters - min) / step - 1e-9) * step;
  }
  // Pick a product of a category by level: economy = cheapest, premium = most expensive, optimal = middle.
  function pick(list, level, used) {
    const l = list.filter((p) => !used.has(p.id)).sort((a, b) => price(a) - price(b) || String(a.id).localeCompare(String(b.id)));
    if (!l.length) return null;
    if (level === 'economy') return l[0];
    if (level === 'premium') return l[l.length - 1];
    return l[Math.floor((l.length - 1) / 2)];
  }

  function recommend(input, catalog, bundles) {
    const people = Math.max(1, Math.min(40, Math.round(Number(input.people) || 2)));
    const budget = Number(input.budget) > 0 ? Number(input.budget) : null;
    const level = ['economy', 'optimal', 'premium'].includes(input.level) ? input.level : 'optimal';
    const alcohol = ['beer', 'strong', 'wine', 'any', 'none'].includes(input.alcohol) ? input.alcohol : 'beer';
    const exclude = expand(input.exclude_categories);
    const more = expand(input.more_categories);
    const prefer = (input.prefer_categories || []).map(String);
    if (alcohol === 'none') ['draft', 'wine', ...STRONG].forEach((x) => exclude.add(x));
    if (alcohol === 'beer') STRONG.forEach((x) => exclude.add(x));
    const ok = (catalog || []).filter((p) => isAvail(p) && !exclude.has(slug(p)));
    const by = (s) => ok.filter((p) => slug(p) === s);
    const lines = [];
    const used = new Set();
    const push = (p, qty, role) => { used.add(p.id); lines.push({ product_id: p.id, sku: p.sku, name: p.name, name_i18n: p.name_i18n || null, category: slug(p), unit: p.unit, quantity: qty, price: price(p), sum: r2(price(p) * qty), role }) };

    // 1. Drink.
    const perHead = { economy: 1, optimal: 1.5, premium: 2 }[level] * (more.has('draft') ? 1.5 : 1);
    if (alcohol !== 'none' && !exclude.has('draft') && alcohol !== 'wine' && alcohol !== 'strong') {
      const beer = pick(by('draft'), level, used);
      if (beer) push(beer, beerQty(beer, people * perHead), 'drink');
    }
    if ((alcohol === 'strong' || alcohol === 'any') && !exclude.has('vodka')) {
      const v = pick(ok.filter((p) => STRONG.includes(slug(p))), level, used);
      if (v) push(v, Math.max(1, Math.ceil(people / 5)), 'drink');
    }
    if (alcohol === 'wine') {
      const w = pick(by('wine'), level, used);
      if (w) push(w, Math.max(1, Math.ceil(people / 3)), 'drink');
    }
    // Non-alcoholic company: soft drinks instead.
    if (alcohol === 'none') {
      const s = pick(by('soft-drinks'), level, used);
      if (s) push(s, Math.max(1, Math.ceil(people / 2)), 'drink');
    }

    // 2. Food: about one snack per two people, spread over different categories (preferred first).
    const FOOD = [...SNACKS, ...ON_REQUEST];
    const wantSnacks = Math.max(2, Math.ceil(people / 2)) + (more.size && [...more].some((c) => FOOD.includes(c)) ? 1 : 0);
    const order = [...new Set([...prefer.filter((c) => FOOD.includes(c)), ...[...more].filter((c) => FOOD.includes(c)), ...SNACKS])].filter((c) => !exclude.has(c));
    let round = 0;
    while (lines.filter((l) => l.role === 'food').length < wantSnacks && round < 3) {
      let added = false;
      for (const c of order) {
        if (lines.filter((l) => l.role === 'food').length >= wantSnacks) break;
        const p = pick(by(c), level, used);
        if (p) { push(p, 1, 'food'); added = true }
      }
      if (!added) break;
      round++;
    }
    // «Побольше рыбы» on a second pass: one more piece of the requested category.
    [...more].filter((c) => FOOD.includes(c)).forEach((c) => { const l = lines.find((x) => x.category === c); if (l) { l.quantity += 1; l.sum = r2(l.price * l.quantity) } });

    // 3. Budget: never above it — drop the most expensive snack first, then lower beer (but not under the minimum
    //    and not under 0.5 L a head), then switch to cheaper products of the same categories.
    const total = () => r2(lines.reduce((s, l) => s + l.sum, 0));
    if (budget) {
      let guard = 60;
      while (total() > budget && guard-- > 0) {
        const food = lines.filter((l) => l.role === 'food').sort((a, b) => b.sum - a.sum);
        const beer = lines.find((l) => l.category === 'draft');
        const cheaper = (l) => { const alt = by(l.category).filter((p) => price(p) < l.price && !used.has(p.id)).sort((a, b) => price(b) - price(a))[0]; return alt };
        // a) swap to a cheaper product somewhere
        const swappable = lines.map((l) => [l, cheaper(l)]).filter(([, a]) => a).sort((a, b) => (b[0].price - price(b[1])) * b[0].quantity - (a[0].price - price(a[1])) * a[0].quantity)[0];
        if (swappable && level !== 'economy') {
          const [l, a] = swappable;
          used.delete(l.product_id); used.add(a.id);
          Object.assign(l, { product_id: a.id, sku: a.sku, name: a.name, name_i18n: a.name_i18n || null, price: price(a), sum: r2(price(a) * l.quantity) });
          continue;
        }
        if (food.length > 2 && food[0].quantity > 1) { food[0].quantity -= 1; food[0].sum = r2(food[0].price * food[0].quantity); continue }
        if (food.length > 2) { lines.splice(lines.indexOf(food[0]), 1); continue }
        if (beer) {
          const p = (catalog || []).find((x) => x.id === beer.product_id) || {};
          const min = Number(p.minimum_quantity || 2), step = Number(p.quantity_step || 2);
          if (beer.quantity - step >= Math.max(min, Math.ceil(people * 0.5))) { beer.quantity -= step; beer.sum = r2(beer.price * beer.quantity); continue }
        }
        if (swappable) {
          const [l, a] = swappable;
          used.delete(l.product_id); used.add(a.id);
          Object.assign(l, { product_id: a.id, sku: a.sku, name: a.name, name_i18n: a.name_i18n || null, price: price(a), sum: r2(price(a) * l.quantity) });
          continue;
        }
        if (food.length) { lines.splice(lines.indexOf(food[0]), 1); continue }
        break;
      }
    }
    // 3b. Room left in the budget: more food (new categories first, then a second piece), up to one item a head,
    //     never above the budget. Without a budget: about three snacks per four people.
    {
      const foodCount = () => lines.filter((l) => l.role === 'food').reduce((s, l) => s + l.quantity, 0);
      const cap = budget ? people : Math.ceil(people * 0.75);
      let guard = 40;
      while (foodCount() < cap && guard-- > 0) {
        const room = budget ? budget - total() : Infinity;
        const inCat = (c) => lines.filter((l) => l.category === c).length;
        const fresh = order.map((c, i) => [c, i, pick(by(c), level, used)]).filter(([, , p]) => p && price(p) <= room)
          .sort((a, b) => inCat(a[0]) - inCat(b[0]) || a[1] - b[1]).map((x) => x[2]);
        if (fresh.length) { push(fresh[0], 1, 'food'); continue }
        const again = lines.filter((l) => l.role === 'food' && l.price <= room).sort((a, b) => a.quantity - b.quantity || a.price - b.price)[0];
        if (again) { again.quantity += 1; again.sum = r2(again.price * again.quantity); continue }
        break;
      }
    }
    const sum = total();

    // 4. One honest upsell inside / just above the budget.
    let upsell = null;
    const left = budget ? r2(budget - sum) : null;
    const extra = ok.filter((p) => SNACKS.includes(slug(p)) && !used.has(p.id)).sort((a, b) => price(a) - price(b));
    if (left !== null && left > 0) {
      const fit = extra.filter((p) => price(p) <= left).pop();
      if (fit) upsell = { product_id: fit.id, name: fit.name, name_i18n: fit.name_i18n || null, price: price(fit), within_budget: true };
    } else if (extra[0]) upsell = { product_id: extra[0].id, name: extra[0].name, name_i18n: extra[0].name_i18n || null, price: price(extra[0]), within_budget: false };

    // 5. A ready «рывок» that fits: within the budget, close to the head count, no excluded categories.
    const servesN = (b) => { const m = String(b.serves_label || '').match(/(\d+)(?:\s*[–-]\s*(\d+))?/); return m ? [Number(m[1]), Number(m[2] || m[1])] : null };
    const bundleOk = (bundles || []).filter((b) => b.available !== false && Number(b.price) > 0 && (!budget || Number(b.price) <= budget) &&
      !(b.items || []).some((i) => { const p = (catalog || []).find((x) => x.id === i.product_id); return p && exclude.has(slug(p)) }));
    const fitB = bundleOk.map((b) => { const s = servesN(b); const d = s ? (people < s[0] ? s[0] - people : people > s[1] ? people - s[1] : 0) : 9; return { b, d } })
      .filter((x) => x.d <= 1).sort((a, b) => a.d - b.d || Number(b.b.price) - Number(a.b.price))[0];

    return {
      people, budget, level, alcohol,
      items: lines,
      total: sum,
      within_budget: budget ? sum <= budget : true,
      beer_liters: lines.filter((l) => l.category === 'draft').reduce((s, l) => s + l.quantity, 0),
      upsell,
      bundle: fitB ? { bundle_id: fitB.b.id, name: fitB.b.name, price: Number(fitB.b.price), serves: fitB.b.serves_label || null } : null,
    };
  }

  window.PivkaReco = { recommend, STRONG, SNACKS };
})();
