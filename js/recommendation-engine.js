/* Voice seller — deterministic cart recommendation, the way a strong waiter sells.
   The AI only turns speech into parameters (people, budget, what they drink, what kind of table); this module picks
   real products from the loaded catalog (store.js has already dropped closed hours and applied night prices) and
   returns a cart proposal plus a «красивый стол» upgrade. Nothing is added to the cart here — apply_recommendation in
   voice-tools.js does that. Pure function: (input, catalog, bundles, rank) → proposal. No DOM, no network.

   People eat by scenario, not by category — one table never mixes shashlik with sausages:
   • shashlik — 2–3 kinds of skewers (one skewer = one person), salad per 3, grilled vegetables per 5, 1.5 L beer a head;
   • sausages — lots of sausages first, lots of beer (2 L a head); then jerky / nuts / chips to keep drinking;
   • fish     — a big dried fish first, beer 2 L a head; then small fish and cheese sticks;
   • pizza    — a 40 cm pizza / khachapuri per 2–3 people, 1 L beer a head;
   • cold     — strong drinks without the grill: chicken, sujuk, sausage, pickles and something to wash it down;
   • wine     — a bottle per 2, khachapuri, a cheese plate per 4.
   Inside each slot the more profitable product wins (rank 1 = most GEL profit in its category, from reco_rank());
   the norms decide how much. The whole budget is used, never above it; the upgrade adds ~+20% of the same table. */
(function () {
  'use strict';
  const STRONG = ['strong', 'vodka', 'whisky', 'brandy', 'rum', 'gin', 'tequila', 'liqueur', 'vermouth'];
  const SNACKS = ['fish', 'cheese', 'meat-snacks', 'nuts', 'chips', 'snacks', 'salty'];
  const SCENARIOS = ['shashlik', 'sausages', 'fish', 'pizza', 'cold', 'wine'];
  const r2 = (n) => Math.round(n * 100) / 100;
  const slug = (p) => p.category_slug || (p.categories && p.categories.slug) || '';
  const price = (p) => Number(p.sale_price || 0);
  const isAvail = (p) => p && p.active !== false && price(p) > 0 && !(p.supply_mode === 'OWN_STOCK' && Number(p.available_stock || 0) <= 0);
  const expand = (list) => {
    const s = new Set();
    (list || []).forEach((c) => { if (c === 'strong' || c === 'alcohol_strong') STRONG.forEach((x) => s.add(x)); else s.add(String(c)) });
    return s;
  };
  const grams = (p) => { const m = String(p.name || '').match(/(\d{3,4})\s*г/); return m ? Number(m[1]) : (/1 кг/.test(p.name || '') ? 1000 : 0) };

  // What a product is on a table: its slot in a scenario and how many people one piece feeds.
  function kind(p) {
    const n = p.name || '', c = slug(p);
    if (c === 'restaurant') {
      if (/салат/i.test(n)) return { slot: 'salad' };
      if (/овощ/i.test(n)) return { slot: 'veg' };
      if (/картош/i.test(n)) return { slot: 'grill', group: 'potato', feeds: 1 };
      if (/мякот|чалагач|корейк/i.test(n)) return { slot: 'grill', group: 'pork', feeds: 1 };
      if (/грудк|голен|окороч|крыл/i.test(n)) return { slot: 'grill', group: 'chicken', feeds: 1 };
      return { slot: 'grill', group: 'beef', feeds: 1 };
    }
    if (c === 'meat-snacks') {
      if (/jerky|нарезк/i.test(n)) return { slot: 'beer_cont' };
      const g = grams(p);
      return { slot: 'meat_main', feeds: g >= 900 ? 4 : g >= 450 ? 3 : 2, sausage: /сосиск|колбас/i.test(n) };
    }
    if (c === 'fish') return price(p) >= 15 ? { slot: 'fish_main', feeds: grams(p) >= 450 ? 3 : 2 } : { slot: 'fish_cont' };
    if (c === 'cheese') return price(p) >= 10 ? { slot: 'cheese_plate' } : { slot: 'fish_cont' };
    if (c === 'pizza') return price(p) >= 20 ? { slot: 'pizza', feeds: 2.5, khachapuri: /хачапури/i.test(n) } : { slot: 'lahmajo' };
    if (['nuts', 'chips', 'snacks'].includes(c)) return { slot: 'beer_cont' };
    if (c === 'salty') return { slot: 'pickles' };
    if (c === 'draft') return { slot: 'beer' };
    if (c === 'wine') return { slot: 'wine' };
    if (STRONG.includes(c)) return { slot: 'strong' };
    if (c === 'soft-drinks') return { slot: 'soft' };
    return { slot: 'other' };
  }

  function roundQty(p, q) {
    const min = Number(p.minimum_quantity || (p.unit === 'liter' ? 2 : 1)), step = Number(p.quantity_step || (p.unit === 'liter' ? 2 : 1));
    if (q <= min) return min;
    return min + Math.ceil((q - min) / step - 1e-9) * step;
  }

  function recommend(input, catalog, bundles, rankMap) {
    const people = Math.max(1, Math.min(40, Math.round(Number(input.people) || 2)));
    const budget = Number(input.budget) > 0 ? Number(input.budget) : null;
    const level = ['economy', 'optimal', 'premium'].includes(input.level) ? input.level : 'optimal';
    const alcohol = ['beer', 'strong', 'wine', 'any', 'none'].includes(input.alcohol) ? input.alcohol : 'beer';
    const exclude = expand(input.exclude_categories);
    const more = expand(input.more_categories);
    const prefer = (input.prefer_categories || []).map(String);
    if (alcohol === 'none') ['draft', 'wine', ...STRONG].forEach((x) => exclude.add(x));
    const rank = (p) => (rankMap && rankMap[p.id]) || 50;
    const ok = (catalog || []).filter((p) => isAvail(p) && !exclude.has(slug(p))).map((p) => ({ p, k: kind(p) }));
    const slot = (s, f) => ok.filter((x) => x.k.slot === s && (!f || f(x))).map((x) => x.p);
    // Best for the shop first; on a tie the level decides (premium — dearer, otherwise cheaper).
    const best = (list) => list.slice().sort((a, b) => rank(a) - rank(b) || (level === 'premium' ? price(b) - price(a) : price(a) - price(b)) || String(a.name).localeCompare(String(b.name)));
    const perHead = budget ? budget / people : null;
    // Drinks: the most profitable within the ordinary shelf (a 66 ₾ vodka is not «optimal» for a company of six).
    const band = (list) => { const min = Math.min(...list.map(price)); const k = { economy: 1.15, optimal: 1.5, premium: Infinity }[level]; return best(list.filter((p) => price(p) <= min * k)) };

    // 1. Scenario: as asked; otherwise by the drink, what is open now and the money a head.
    const has = { shashlik: slot('grill').length > 0, sausages: slot('meat_main', (x) => x.k.sausage).length > 0, fish: slot('fish_main').length > 0, pizza: slot('pizza').length > 0, cold: slot('meat_main').length > 0, wine: slot('pizza').length > 0 };
    let scenario = SCENARIOS.includes(input.scenario) ? input.scenario : ({ restaurant: 'shashlik', pizza: 'pizza', fish: 'fish', 'meat-snacks': 'sausages' })[prefer.find((c) => ['restaurant', 'pizza', 'fish', 'meat-snacks'].includes(c))] || null;
    if (!scenario) {
      const grill = has.shashlik && (!perHead || perHead >= 25);
      if (alcohol === 'wine') scenario = grill ? 'shashlik' : 'wine';
      else if (alcohol === 'strong') scenario = grill ? 'shashlik' : 'cold';
      else scenario = grill ? 'shashlik' : has.sausages ? 'sausages' : has.fish ? 'fish' : 'pizza';
    }
    if (!has[scenario]) scenario = ['shashlik', 'sausages', 'fish', 'pizza', 'cold'].find((s) => has[s]) || 'sausages';
    const beerTable = ['sausages', 'fish'].includes(scenario);

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
    let cap = budget;
    const room = () => (cap ? r2(cap - total()) : Infinity);
    const qtyOf = (role) => lines.filter((l) => l.role === role).reduce((s, l) => s + l.quantity, 0);
    const byId = (id) => (ok.find((x) => x.p.id === id) || {}).p;

    // 2. Main food — a few kinds, best for the shop first, at least one pork and one chicken on the grill.
    const khach = slot('pizza', (x) => x.k.khachapuri);
    const mainList = scenario === 'shashlik' ? slot('grill', (x) => x.k.group !== 'potato')
      : scenario === 'sausages' ? slot('meat_main', (x) => x.k.sausage)
      : scenario === 'cold' ? slot('meat_main')
      : scenario === 'fish' ? slot('fish_main')
      : scenario === 'wine' && khach.length ? khach : slot('pizza');
    const feeds = (p) => (p && kind(p).feeds) || 1;
    const kindsN = people <= 2 ? 1 : people <= 4 ? 2 : people <= 8 ? 3 : 4;
    const kinds = [];
    if (scenario === 'shashlik') ['pork', 'chicken'].forEach((g) => { const b = best(mainList.filter((p) => kind(p).group === g))[0]; if (b && kinds.length < kindsN) kinds.push(b) });
    best(mainList).forEach((p) => { if (kinds.length < kindsN && !kinds.includes(p)) kinds.push(p) });
    kinds.sort((a, b) => rank(a) - rank(b));
    const mainFed = () => lines.filter((l) => l.role === 'main').reduce((s, l) => s + l.quantity * feeds(byId(l.product_id)), 0);
    const mainTarget = scenario === 'wine' ? people / 3 * 2.5 : people * (alcohol === 'strong' && scenario === 'shashlik' ? 1.15 : 1);
    const addMain = (limitRoom) => {
      const pool = (kinds.length ? kinds : mainList).filter((p) => !limitRoom || price(p) <= room());
      if (!pool.length) return false;
      const fed = (p) => (line(p) || { quantity: 0 }).quantity * feeds(p);
      pool.sort((a, b) => fed(a) - fed(b) || rank(a) - rank(b));
      add(pool[0], 1, 'main'); return true;
    };
    while (mainFed() < mainTarget - 1e-9 && addMain(false));

    // 3. Sides that belong to this table.
    if (scenario === 'shashlik') {
      const salad = best(slot('salad'))[0], veg = best(slot('veg'))[0];
      if (salad) add(salad, Math.max(1, Math.ceil(people / 3)), 'side');
      if (veg && people >= 3) add(veg, Math.ceil(people / 5), 'side');
    }
    if (scenario === 'wine') { const c = best(slot('cheese_plate'))[0]; if (c) add(c, Math.max(1, Math.ceil(people / 4)), 'side') }
    if (alcohol === 'strong' || scenario === 'cold') { const s = best(slot('pickles'))[0]; if (s) add(s, Math.max(1, Math.ceil(people / (scenario === 'cold' ? 4 : 6))), 'side') }
    // «To keep drinking» after the main — only on beer tables, different kinds (jerky, nuts, chips — not three of one).
    const contList = scenario === 'sausages' ? best(slot('beer_cont')) : scenario === 'fish' ? best(slot('fish_cont')) : scenario === 'pizza' && alcohol !== 'none' ? best(slot('beer_cont', (x) => slug(x.p) === 'chips')) : [];
    const contTarget = beerTable ? Math.max(1, Math.ceil(people / 2)) : scenario === 'pizza' ? Math.floor(people / 4) : 0;
    const addCont = (limitRoom) => {
      const cats = (p) => lines.filter((l) => l.role === 'cont' && l.category === slug(p)).length;
      const pool = contList.filter((p) => !line(p) && (!limitRoom || price(p) <= room())).sort((a, b) => cats(a) - cats(b));
      if (!pool[0]) return false;
      add(pool[0], 1, 'cont'); return true;
    };
    for (let i = 0; i < contTarget; i++) if (!addCont(false)) break;

    // 4. Drinks by the norm of this table.
    const beerP = ['beer', 'any'].includes(alcohol) ? band(slot('beer'))[0] : null;
    const beerHead = { shashlik: 1.5, sausages: 2, fish: 2, pizza: 1, cold: 0, wine: 0 }[scenario] * ({ economy: 0.75, optimal: 1, premium: 1.25 }[level]) * (more.has('draft') ? 1.33 : 1) * (alcohol === 'any' ? 0.67 : 1);
    if (beerP && beerHead > 0) add(beerP, roundQty(beerP, people * beerHead), 'drink');
    if (['strong', 'any'].includes(alcohol)) {
      const want = prefer.find((c) => STRONG.includes(c)) || 'vodka';
      const half = slot('strong', (x) => /0[,.]5/.test(x.p.name || ''));
      const s = band(half.filter((p) => slug(p) === want).length ? half.filter((p) => slug(p) === want) : half)[0];
      if (s) add(s, Math.max(1, Math.ceil(people / (alcohol === 'any' ? 5 : 2.5))), 'drink');
    }
    if (alcohol === 'wine') { const w = band(slot('wine', (x) => /0[,.]75/.test(x.p.name || '')))[0]; if (w) add(w, Math.max(1, Math.ceil(people / 2)), 'drink') }
    if (['strong', 'none'].includes(alcohol) || (alcohol === 'wine' && people >= 3)) {
      const liters = slot('soft', (x) => /1 л|0[,.]9/.test(x.p.name || ''));
      const s = band(liters.length ? liters : slot('soft'))[0];
      if (s) add(s, Math.max(1, Math.ceil(people / 2)), 'drink');
    }
    const beerL = () => beerP && line(beerP);
    const beerStep = beerP ? Number(beerP.quantity_step || 2) : 2;

    // 5. Over the budget — trim the way a seller would: extras, beer down to 1 L, cheaper skewers, sides, smaller
    //    portions. The main food goes last.
    if (budget) {
      let guard = 120;
      while (total() > budget && guard-- > 0) {
        const cont = lines.filter((l) => l.role === 'cont').sort((a, b) => b.sum - a.sum);
        if (cont.length > Math.ceil(contTarget / 2)) { set(cont[0], 0); continue }
        const bl = beerL();
        if (bl && bl.quantity - beerStep >= roundQty(beerP, people * 1)) { set(bl, bl.quantity - beerStep); continue }
        const unit = (l) => l.price / feeds(byId(l.product_id));
        const mains = lines.filter((l) => l.role === 'main').sort((a, b) => unit(b) - unit(a));
        const cheap = mainList.slice().sort((a, b) => price(a) / feeds(a) - price(b) / feeds(b))[0];
        const dear = mains.find((l) => cheap && l.product_id !== cheap.id && unit(l) > price(cheap) / feeds(cheap) + 0.5);
        if (dear) { set(dear, dear.quantity - 1); add(cheap, 1, 'main'); continue }
        const veg = lines.find((l) => l.role === 'side' && /овощ/i.test(l.name));
        if (veg) { set(veg, veg.quantity - 1); continue }
        const salad = lines.find((l) => l.role === 'side' && /салат/i.test(l.name));
        if (salad && salad.quantity > Math.ceil(people / 5)) { set(salad, salad.quantity - 1); continue }
        if (mains.length && mainFed() - feeds(byId(mains[0].product_id)) >= mainTarget * 0.75) { set(mains[0], mains[0].quantity - 1); continue }
        const strongL = lines.find((l) => STRONG.includes(l.category));
        if (strongL && strongL.quantity > Math.ceil(people / 3)) { set(strongL, strongL.quantity - 1); continue }
        if (bl && bl.quantity - beerStep >= roundQty(beerP, people * 0.7)) { set(bl, bl.quantity - beerStep); continue }
        if (cont.length) { set(cont[0], 0); continue }
        const any = lines.filter((l) => l.role !== 'drink').sort((a, b) => b.sum - a.sum)[0] || lines.slice().sort((a, b) => b.sum - a.sum)[0];
        if (any) { set(any, any.quantity - (any.unit === 'liter' ? beerStep : 1)); continue }
        break;
      }
    }

    // 6. Money left — spend it on the same table: more of the main, the «keep drinking» snacks, more beer, salad.
    const grow = () => {
      const steps = [
        () => mainFed() < mainTarget * 1.3 && addMain(true),
        () => qtyOf('cont') < contTarget + 1 && addCont(true),
        () => { const bl = beerL(); if (bl && bl.quantity < people * (beerTable ? 2.5 : 2) && price(beerP) * beerStep <= room()) { add(beerP, beerStep, 'drink'); return true } return false },
        () => { const s = lines.find((l) => l.role === 'side' && /салат/i.test(l.name)); if (s && s.quantity < Math.ceil(people / 2) && s.price <= room()) { set(s, s.quantity + 1); return true } return false },
        () => mainFed() < mainTarget * 1.6 && addMain(true),
      ];
      let guard = 60;
      while (guard-- > 0 && room() > 0) { if (!steps.some((f) => f())) break }
    };
    if (budget) grow();
    const base = lines.map((l) => ({ ...l }));
    const sum = total();

    // 7. «Красивый стол»: ~+20% of the same table — the best skewer once more, a snack for later, more beer.
    let upgrade = null;
    {
      cap = r2(sum * 1.2);
      const ups = [
        () => { const p = kinds[0] || best(mainList)[0]; if (p && price(p) <= room()) { add(p, 1, 'main'); return true } return false },
        () => { const pool = contList.filter((p) => price(p) <= room()); const p = pool.find((x) => !line(x)) || pool[0]; if (p) { add(p, 1, 'cont'); return true } return false },
        () => { if (beerP && line(beerP) && price(beerP) * beerStep <= room()) { add(beerP, beerStep, 'drink'); return true } return false },
        () => { const c = best(slot('cheese_plate'))[0]; if (['wine', 'cold'].includes(scenario) && c && price(c) <= room()) { add(c, 1, 'side'); return true } return false },
        () => { const p = kinds[1] || kinds[0]; if (p && price(p) <= room()) { add(p, 1, 'main'); return true } return false },
      ];
      let guard = 20, i = 0, idle = 0;
      while (guard-- > 0 && idle < ups.length) { if (ups[i % ups.length]()) idle = 0; else idle++; i++ }
      const added = lines.map((l) => { const b = base.find((x) => x.product_id === l.product_id); const q = r2(l.quantity - (b ? b.quantity : 0)); return q > 0 ? { product_id: l.product_id, name: l.name, name_i18n: l.name_i18n, unit: l.unit, quantity: q, sum: r2(l.price * q) } : null }).filter(Boolean);
      const extra = r2(total() - sum);
      if (added.length && extra >= sum * 0.08) upgrade = { add: added, extra, total: total(), items: lines.map((l) => ({ ...l })) };
      lines.length = 0; base.forEach((l) => lines.push(l));
    }

    // 8. A ready «рывок» as an alternative only when it fits the head count and the money.
    const servesN = (b) => { const m = String(b.serves_label || '').match(/(\d+)(?:\s*[–-]\s*(\d+))?/); return m ? [Number(m[1]), Number(m[2] || m[1])] : null };
    const fitB = (bundles || []).filter((b) => b.available !== false && b.unavailable_reason !== 'CLOSED_NOW' && Number(b.price) > 0 &&
      (!budget || (Number(b.price) >= budget * 0.75 && Number(b.price) <= budget * 1.2)) &&
      !(b.items || []).some((i) => { const p = (catalog || []).find((x) => x.id === i.product_id); return p && exclude.has(slug(p)) }))
      .filter((b) => { const s = servesN(b); return s && people >= s[0] && people <= s[1] })
      .sort((a, b) => Number(b.savings || 0) - Number(a.savings || 0))[0];

    const order = { drink: 0, main: 1, side: 2, cont: 3 };
    const sortLines = (l) => l.sort((a, b) => order[a.role] - order[b.role]);
    sortLines(lines); if (upgrade) sortLines(upgrade.items);
    return {
      people, budget, level, alcohol, scenario,
      items: lines,
      total: sum,
      left: budget ? r2(budget - sum) : null,
      within_budget: budget ? sum <= budget : true,
      beer_liters: lines.filter((l) => l.category === 'draft').reduce((s, l) => s + l.quantity, 0),
      upgrade,
      bundle: fitB ? { bundle_id: fitB.id, name: fitB.name, price: Number(fitB.price), serves: fitB.serves_label || null, savings: Number(fitB.savings || 0) } : null,
    };
  }

  window.PivkaReco = { recommend, STRONG, SNACKS, SCENARIOS };
})();
