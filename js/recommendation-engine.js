/* Voice seller — deterministic cart recommendation.
   The AI only turns speech into parameters (people, budget, what they drink, what they eat); this module picks real
   products from the loaded catalog (store.js has already dropped closed hours and applied night prices) and returns a
   cart proposal. Nothing here is added to the cart — that is apply_recommendation in voice-tools.js.
   Pure function: (input, catalog, bundles) → proposal. No DOM, no network.

   How a company actually orders (catering norms, adjusted to our menu):
   • beer: 1.5 L a head for an evening (1 L light, 2 L heavy); vodka/brandy: 0.5 L per 2–3 people, plus 1 L of
     lemonade or water per 2 people to wash it down; wine: a bottle per 2 people;
   • shashlik: ~300 g of meat a head = one skewer portion a head (more with strong drinks), mixed kinds, a salad per
     3 people and grilled vegetables per 5;
   • pizza / khachapuri 40 cm: one per 2–3 people;
   • beer snacks: one «real» snack (fish, cheese, meat) per 2 people; nuts, chips and seeds only as a small extra;
   • the whole budget is used — the company asked for 200, they get ~200 worth of food and drink, never above. */
(function () {
  'use strict';
  const STRONG = ['strong', 'vodka', 'whisky', 'brandy', 'rum', 'gin', 'tequila', 'liqueur', 'vermouth'];
  const SNACKS = ['fish', 'cheese', 'meat-snacks', 'nuts', 'chips', 'snacks', 'salty'];
  const REAL_SNACKS = ['fish', 'cheese', 'meat-snacks'];
  const r2 = (n) => Math.round(n * 100) / 100;
  const slug = (p) => p.category_slug || (p.categories && p.categories.slug) || '';
  const price = (p) => Number(p.sale_price || 0);
  const isAvail = (p) => p && p.active !== false && price(p) > 0 && !(p.supply_mode === 'OWN_STOCK' && Number(p.available_stock || 0) <= 0);
  const expand = (list) => {
    const s = new Set();
    (list || []).forEach((c) => { if (c === 'strong' || c === 'alcohol_strong') STRONG.forEach((x) => s.add(x)); else s.add(String(c)) });
    return s;
  };
  // Grill menu by name: how many people one item feeds, and the order a company likes them in.
  const GRILL = [
    [/мякот/i, 1, 'meat'], [/чалагач|корейк/i, 1, 'meat'], [/кебаб|люля/i, 0.7, 'meat'], [/грудк/i, 0.8, 'meat'],
    [/окороч/i, 1, 'meat'], [/крыл/i, 0.6, 'meat'], [/картош/i, 0.7, 'meat'],
    [/салат/i, 3, 'salad'], [/овощ/i, 5, 'veg'],
  ];
  const grillKind = (p) => { const g = GRILL.find(([re]) => re.test(p.name || '')); return g ? { feeds: g[1], kind: g[2], rank: GRILL.indexOf(g) } : null };

  function roundQty(p, q) {
    const min = Number(p.minimum_quantity || (p.unit === 'liter' ? 2 : 1)), step = Number(p.quantity_step || (p.unit === 'liter' ? 2 : 1));
    if (q <= min) return min;
    return min + Math.ceil((q - min) / step - 1e-9) * step;
  }
  // economy = cheapest, premium = most expensive, optimal = the middle of the shelf.
  function pick(list, level) {
    const l = list.slice().sort((a, b) => price(a) - price(b) || String(a.id).localeCompare(String(b.id)));
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
    const ok = (catalog || []).filter((p) => isAvail(p) && !exclude.has(slug(p)));
    const by = (s) => ok.filter((p) => slug(p) === s);
    const grill = by('restaurant').map((p) => ({ p, g: grillKind(p) })).filter((x) => x.g);
    const meats = grill.filter((x) => x.g.kind === 'meat').sort((a, b) => a.g.rank - b.g.rank);
    const pizzas = by('pizza').filter((p) => price(p) >= 20); // 40 cm only; lahmajo is a snack, not a meal
    const perHead = budget ? budget / people : null;

    // What they eat: asked → as asked; otherwise grill when it is open and the money is there, then pizza, then snacks.
    let food = ['shashlik', 'pizza', 'snacks'].includes(input.food) ? input.food : null;
    if (!food) food = prefer.includes('restaurant') || more.has('restaurant') ? 'shashlik' : prefer.includes('pizza') || more.has('pizza') ? 'pizza' : null;
    if (food === 'shashlik' && !meats.length) food = pizzas.length ? 'pizza' : 'snacks';
    if (food === 'pizza' && !pizzas.length) food = meats.length ? 'shashlik' : 'snacks';
    if (!food) food = meats.length && (!perHead || perHead >= 25) ? 'shashlik' : pizzas.length && (!perHead || perHead >= 15) ? 'pizza' : 'snacks';

    const lines = [];
    const line = (p) => lines.find((l) => l.product_id === p.id);
    const add = (p, qty, role) => {
      const l = line(p);
      if (l) { l.quantity = r2(l.quantity + qty); l.sum = r2(l.price * l.quantity); return l }
      const n = { product_id: p.id, sku: p.sku, name: p.name, name_i18n: p.name_i18n || null, category: slug(p), unit: p.unit, quantity: qty, price: price(p), sum: r2(price(p) * qty), role };
      lines.push(n); return n;
    };
    const set = (l, qty) => { if (qty <= 0) lines.splice(lines.indexOf(l), 1); else { l.quantity = r2(qty); l.sum = r2(l.price * l.quantity) } };
    const total = () => r2(lines.reduce((s, l) => s + l.sum, 0));
    const room = () => (budget ? r2(budget - total()) : Infinity);

    // 1. Drinks.
    const beerList = by('draft');
    const strongList = ok.filter((p) => STRONG.includes(slug(p)) && /0[,.]5/.test(p.name || ''));
    const softList = by('soft-drinks').filter((p) => /1 л|0[,.]9/.test(p.name || ''));
    let beerPerHead = { economy: 1, optimal: 1.5, premium: 2 }[level] * (more.has('draft') ? 1.33 : 1);
    if (alcohol === 'any') beerPerHead = 1;
    const beer = ['beer', 'any'].includes(alcohol) ? pick(beerList, level) : null;
    if (beer) add(beer, roundQty(beer, people * beerPerHead), 'drink');
    if (['strong', 'any'].includes(alcohol)) {
      const kind = prefer.find((c) => STRONG.includes(c)) || 'vodka';
      const s = pick(strongList.filter((p) => slug(p) === kind).length ? strongList.filter((p) => slug(p) === kind) : strongList, level);
      if (s) add(s, Math.max(1, Math.ceil(people / (alcohol === 'any' ? 5 : 2.5))), 'drink');
    }
    if (alcohol === 'wine') { const w = pick(by('wine'), level); if (w) add(w, Math.max(1, Math.ceil(people / 2)), 'drink') }
    if (['strong', 'none'].includes(alcohol) || (alcohol === 'wine' && people >= 3)) {
      const s = pick(softList.length ? softList : by('soft-drinks'), 'economy');
      if (s) add(s, Math.max(1, Math.ceil(people / 2)), 'drink');
    }

    // 2. Food.
    const meatTarget = people * (alcohol === 'strong' ? 1.15 : 1);
    const meatFed = () => lines.filter((l) => l.role === 'meat').reduce((s, l) => s + l.quantity * (grillKind(l).feeds), 0);
    const addMeat = () => {
      // Round-robin over kinds: the kind with the fewest skewers so far, best-liked first.
      const fit = meats.filter((x) => x.p && price(x.p) <= room());
      if (!fit.length) return false;
      const cnt = (x) => (line(x.p) || { quantity: 0 }).quantity;
      fit.sort((a, b) => cnt(a) - cnt(b) || a.g.rank - b.g.rank);
      add(fit[0].p, 1, 'meat'); return true;
    };
    const snackPool = () => {
      const order = [...new Set([...prefer.filter((c) => SNACKS.includes(c)), ...[...more].filter((c) => SNACKS.includes(c)), ...REAL_SNACKS])];
      // Bigger packs for bigger companies.
      return order.map((c) => by(c).sort((a, b) => (people >= 4 ? price(b) - price(a) : price(a) - price(b)))).flat();
    };
    const addSnack = () => {
      const used = new Set(lines.map((l) => l.product_id));
      const pool = snackPool().filter((p) => price(p) <= room());
      const cats = (c) => lines.filter((l) => l.category === c).length;
      const fresh = pool.filter((p) => !used.has(p.id)).sort((a, b) => cats(slug(a)) - cats(slug(b)));
      if (fresh[0]) { add(fresh[0], 1, 'food'); return true }
      return false;
    };

    if (food === 'shashlik') {
      const salad = grill.find((x) => x.g.kind === 'salad'), veg = grill.find((x) => x.g.kind === 'veg');
      while (meatFed() < meatTarget && addMeat());
      if (salad) add(salad.p, Math.max(1, Math.ceil(people / 3)), 'side');
      if (veg && people >= 4) add(veg.p, Math.ceil(people / 5), 'side');
    } else if (food === 'pizza') {
      const n = Math.max(1, Math.ceil(people / 2.5));
      const order = pizzas.slice().sort((a, b) => (level === 'economy' ? price(a) - price(b) : 0));
      for (let i = 0; i < n; i++) add(order[i % order.length], 1, 'meal');
    }
    if (food === 'snacks' || alcohol === 'beer' || alcohol === 'any') {
      const want = food === 'snacks' ? Math.max(2, Math.ceil(people / 2)) : Math.max(1, Math.floor(people / 4));
      for (let i = 0; i < want; i++) if (!addSnack()) break;
    }
    if (alcohol === 'strong') { const s = pick(by('salty'), 'economy'); if (s) add(s, Math.max(1, Math.floor(people / 4)), 'food') }

    // 3. Over the budget: trim in the order a seller would — fewer extras first, never the drink before the food.
    if (budget) {
      let guard = 80;
      while (total() > budget && guard-- > 0) {
        const extras = lines.filter((l) => l.role === 'food').sort((a, b) => b.sum - a.sum);
        const sides = lines.filter((l) => l.role === 'side');
        const beerL = beer && line(beer);
        const strongL = lines.find((l) => STRONG.includes(l.category));
        const meatL = lines.filter((l) => l.role === 'meat').sort((a, b) => b.price / grillKind(b).feeds - a.price / grillKind(a).feeds);
        const pizzaL = lines.filter((l) => l.role === 'meal').sort((a, b) => b.price - a.price);
        if (extras.length > (food === 'snacks' ? 2 : 0)) { set(extras[0], extras[0].quantity - 1); continue }
        if (beerL && beerL.quantity > roundQty(beer, people * 1)) { set(beerL, beerL.quantity - Number(beer.quantity_step || 2)); continue }
        const cheapMeat = meats.slice().sort((a, b) => price(a.p) / a.g.feeds - price(b.p) / b.g.feeds)[0];
        const dear = meatL.find((l) => cheapMeat && l.product_id !== cheapMeat.p.id && l.price / grillKind(l).feeds > price(cheapMeat.p) / cheapMeat.g.feeds + 1);
        if (dear) { set(dear, dear.quantity - 1); add(cheapMeat.p, 1, 'meat'); continue }
        const cheapPizza = pizzas.slice().sort((a, b) => price(a) - price(b))[0];
        const dearP = pizzaL.find((l) => cheapPizza && l.price > price(cheapPizza));
        if (dearP) { set(dearP, dearP.quantity - 1); add(cheapPizza, 1, 'meal'); continue }
        const vegL = sides.find((l) => /овощ/i.test(l.name)), saladL = sides.find((l) => /салат/i.test(l.name));
        if (vegL) { set(vegL, vegL.quantity - 1); continue }
        if (saladL && saladL.quantity > Math.ceil(people / 5)) { set(saladL, saladL.quantity - 1); continue }
        if (meatL.length && meatFed() > people * 0.75) { set(meatL[0], meatL[0].quantity - 1); continue }
        if (pizzaL.length && pizzaL.reduce((s, l) => s + l.quantity, 0) > Math.ceil(people / 3)) { set(pizzaL[0], pizzaL[0].quantity - 1); continue }
        if (strongL && strongL.quantity > Math.ceil(people / 3)) { set(strongL, strongL.quantity - 1); continue }
        if (beerL && beerL.quantity > roundQty(beer, people * 0.7)) { set(beerL, beerL.quantity - Number(beer.quantity_step || 2)); continue }
        // Still too expensive for this menu: the last resort is to drop the cheapest-to-lose food entirely.
        const any = lines.filter((l) => l.role !== 'drink').sort((a, b) => b.sum - a.sum)[0];
        if (any) { set(any, any.quantity - 1); continue }
        break;
      }
    }

    // 4. Money left: spend it the way the company would be happy — more meat up to a generous portion, then a real
    //    beer snack, then a second salad, then more beer. Never nuts/chips as the filler of a big budget.
    if (budget) {
      let guard = 40;
      const cheapest = () => Math.min(...ok.filter((p) => REAL_SNACKS.includes(slug(p)) || slug(p) === 'restaurant' || slug(p) === 'draft').map(price));
      while (room() >= cheapest() && guard-- > 0) {
        if (food === 'shashlik' && meatFed() < people * 1.3 && addMeat()) continue;
        if (food === 'pizza' && lines.filter((l) => l.role === 'meal').reduce((s, l) => s + l.quantity, 0) < Math.ceil(people / 2)) {
          const p = pizzas.filter((x) => price(x) <= room()).sort((a, b) => (line(a) ? 1 : 0) - (line(b) ? 1 : 0))[0];
          if (p) { add(p, 1, 'meal'); continue }
        }
        if (lines.filter((l) => l.role === 'food' && REAL_SNACKS.includes(l.category)).length < Math.max(1, Math.ceil(people / 3)) && addSnack()) continue;
        const salad = grill.find((x) => x.g.kind === 'salad');
        if (food === 'shashlik' && salad && price(salad.p) <= room() && (line(salad.p) || { quantity: 0 }).quantity < Math.ceil(people / 2)) { add(salad.p, 1, 'side'); continue }
        if (beer && line(beer) && line(beer).quantity < people * 2 && price(beer) * Number(beer.quantity_step || 2) <= room()) { add(beer, Number(beer.quantity_step || 2), 'drink'); continue }
        if (food === 'shashlik' && meatFed() < people * 1.6 && addMeat()) continue;
        if (addSnack()) continue;
        break;
      }
    }
    const sum = total();

    // 5. One honest upsell that still fits the budget (a real snack, not nuts).
    let upsell = null;
    const left = budget ? r2(budget - sum) : null;
    const usedIds = new Set(lines.map((l) => l.product_id));
    const extra = ok.filter((p) => REAL_SNACKS.includes(slug(p)) && !usedIds.has(p.id)).sort((a, b) => price(a) - price(b));
    const fit = left === null ? extra[0] : extra.filter((p) => price(p) <= left).pop();
    if (fit) upsell = { product_id: fit.id, name: fit.name, name_i18n: fit.name_i18n || null, price: price(fit), within_budget: true };

    // 6. A ready «рывок» only when it really answers the request: right head count and most of the budget.
    const servesN = (b) => { const m = String(b.serves_label || '').match(/(\d+)(?:\s*[–-]\s*(\d+))?/); return m ? [Number(m[1]), Number(m[2] || m[1])] : null };
    const bundleOk = (bundles || []).filter((b) => b.available !== false && Number(b.price) > 0 && (!budget || (Number(b.price) <= budget && Number(b.price) >= budget * 0.75)) &&
      !(b.items || []).some((i) => { const p = (catalog || []).find((x) => x.id === i.product_id); return p && exclude.has(slug(p)) }));
    const fitB = bundleOk.map((b) => { const s = servesN(b); const d = s ? (people < s[0] ? s[0] - people : people > s[1] ? people - s[1] : 0) : 9; return { b, d } })
      .filter((x) => x.d === 0).sort((a, b) => Number(b.b.price) - Number(a.b.price))[0];

    const order = { drink: 0, meat: 1, meal: 1, side: 2, food: 3 };
    lines.sort((a, b) => order[a.role] - order[b.role]);
    return {
      people, budget, level, alcohol, food,
      items: lines,
      total: sum,
      left: left,
      within_budget: budget ? sum <= budget : true,
      beer_liters: lines.filter((l) => l.category === 'draft').reduce((s, l) => s + l.quantity, 0),
      upsell,
      bundle: fitB ? { bundle_id: fitB.b.id, name: fitB.b.name, price: Number(fitB.b.price), serves: fitB.b.serves_label || null } : null,
    };
  }

  window.PivkaReco = { recommend, STRONG, SNACKS };
})();
