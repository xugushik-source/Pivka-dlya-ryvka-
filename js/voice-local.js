/* Voice seller — offline understanding for the text field (no AI).
   Used only when the AI seller is unavailable (no key, daily limit, network, OpenAI error). It understands the
   common short requests in RU/KA/HY and calls the SAME tools (PivkaVoiceTools) — not a second chatbot:
   head count, budget, «без крепкого», «убери рыбу», «добавь сыр», «что в корзине», «сколько до подарка»,
   «нас теперь восемь», «бюджет максимум 100», «оформляем». */
(function () {
  'use strict';
  const T = window.PivkaVoiceTools;
  const NUM = {
    ru: { один: 1, одна: 1, двое: 2, два: 2, две: 2, трое: 3, три: 3, четверо: 4, четыре: 4, пятеро: 5, пять: 5, шестеро: 6, шесть: 6, семеро: 7, семь: 7, восьмеро: 8, восемь: 8, девятеро: 9, девять: 9, десятеро: 10, десять: 10, двенадцать: 12 },
    ka: { ერთი: 1, ორი: 2, ორნი: 2, სამი: 3, სამნი: 3, ოთხი: 4, ოთხნი: 4, ხუთი: 5, ხუთნი: 5, ექვსი: 6, ექვსნი: 6, შვიდი: 7, შვიდნი: 7, რვა: 8, რვანი: 8, ცხრა: 9, ათი: 10, ათნი: 10 },
    hy: { մեկ: 1, երկու: 2, երեք: 3, չորս: 4, հինգ: 5, վեց: 6, յոթ: 7, ութ: 8, ինը: 9, տաս: 10, տասը: 10 },
  };
  // category slug → stems in the three languages
  const CAT = {
    fish: ['рыб', 'თევზ', 'ձուկ', 'ձկ'], cheese: ['сыр', 'ყველ', 'պանիր'], draft: ['пив', 'ლუდ', 'գարեջ'],
    'meat-snacks': ['мяс', 'колбас', 'суджук', 'ხორც', 'ძეხვ', 'միս', 'մսամթ', 'երշիկ'], nuts: ['орех', 'фисташ', 'миндал', 'арахис', 'თხილ', 'ფისტ', 'ընկույզ', 'պիստակ'],
    chips: ['чипс', 'ჩიფს', 'չիպս'], snacks: ['семеч', 'მზესუმზირ', 'սերմ'], salty: ['солен', 'огур', 'корниш', 'მწნილ', 'թթու'],
    strong: ['крепк', 'водк', 'коньяк', 'виски', 'მაგარ', 'არაყ', 'კონიაკ', 'ვისკ', 'թունդ', 'օղի', 'կոնյակ', 'վիսկի'],
    'soft-drinks': ['лимонад', 'газиров', 'минерал', 'ლიმონათ', 'წყალ', 'լիմոնադ'],
  };
  const has = (t, list) => list.some((w) => t.includes(w));
  // short words («да», «ок», «კი», «հա») only as whole words: «подарка» is not «да»
  const word = (t, list) => list.some((w) => new RegExp('(^|[^\\p{L}])' + w + '([^\\p{L}]|$)', 'u').test(t));
  const W = {
    remove: ['убер', 'без ', 'не надо', 'не нужн', 'ამოიღ', 'გარეშე', 'არ მინდა', 'არ გვინდა', 'հանիր', 'առանց', 'պետք չէ', 'չենք ուզում'],
    add: ['добав', 'ещё', 'еще', 'побольше', 'დაამატ', 'კიდევ', 'ավելացր', 'էլի', 'ավելի շատ'],
    cart: ['корзин', 'კალათ', 'զամբյուղ'],
    gift: ['подар', 'საჩუქ', 'նվեր'],
    checkout: ['оформ', 'заказыва', 'გავაფორმ', 'შეკვეთ', 'ձևակերպ', 'պատվիր'],
    yes: ['да', 'давай', 'добавь', 'ок', 'კი', 'დიახ', 'ჰო', 'დაამატე', 'այո', 'հա', 'լավ', 'ավելացրու'],
    cheaper: ['дешев', 'подешев', 'იაფ', 'էժան'],
    premium: ['премиал', 'премиум', 'подорож', 'лучше', 'ძვირ', 'პრემიუმ', 'թանկ', 'պրեմիում'],
    bundle: ['готов', 'рывок', 'მზა', 'ნაკრებ', 'պատրաստի', 'հավաքածու'],
  };
  const SAY = {
    ru: {
      reco: (r) => `${r.people ? 'На ' + r.people + ' чел.' : ''}${r.budget ? ' в ' + r.budget + ' ₾' : ''}: ${r.beer_liters ? r.beer_liters + ' л пива, ' : ''}${r.items.filter((i) => i.role === 'food').length} закуски. Выходит ${r.total} ₾. Добавить в корзину?`,
      added: (c) => `Готово. В корзине ${c.total} ₾.`, removed: (c) => `Убрал. Теперь ${c.total} ₾.`, nothing: 'Этого в корзине нет.',
      cart: (c) => c.items.length || c.bundle ? `В корзине: ${[c.bundle ? c.bundle.name : null, ...c.items.map((i) => i.name + ' ×' + i.quantity)].filter(Boolean).join(', ')}. Итого ${c.total} ₾.` : 'Корзина пока пустая.',
      gift: (g) => !g.tiers ? 'Подарков сейчас нет.' : g.next_threshold ? `До подарка (${g.next_gift}) осталось ${g.left} ₾.` : `Подарок уже ваш: ${g.unlocked_gift}.`,
      ask: 'Скажи, сколько вас и какой бюджет — соберу рывок.', checkout: 'Открываю оформление.', empty: 'Корзина пустая — сначала соберём рывок.',
      bundle: (b) => `Есть готовый рывок «${b.name}» за ${b.price} ₾. Взять его?`,
    },
    ka: {
      reco: (r) => `${r.people ? r.people + ' ადამიანზე' : ''}${r.budget ? ', ' + r.budget + ' ₾-ად' : ''}: ${r.beer_liters ? r.beer_liters + ' ლ ლუდი, ' : ''}${r.items.filter((i) => i.role === 'food').length} მისაყოლებელი. ჯამი ${r.total} ₾. დავამატო კალათაში?`,
      added: (c) => `მზადაა. კალათაში ${c.total} ₾-ია.`, removed: (c) => `ამოვიღე. ახლა ${c.total} ₾-ია.`, nothing: 'ეს კალათაში არ არის.',
      cart: (c) => c.items.length || c.bundle ? `კალათაში: ${[c.bundle ? c.bundle.name : null, ...c.items.map((i) => i.name + ' ×' + i.quantity)].filter(Boolean).join(', ')}. ჯამი ${c.total} ₾.` : 'კალათა ჯერ ცარიელია.',
      gift: (g) => !g.tiers ? 'საჩუქრები ახლა არ არის.' : g.next_threshold ? `საჩუქრამდე (${g.next_gift}) დარჩა ${g.left} ₾.` : `საჩუქარი უკვე თქვენია: ${g.unlocked_gift}.`,
      ask: 'მითხარი, რამდენი ხართ და რა ბიუჯეტი გაქვთ — ნაკრებს შეგირჩევ.', checkout: 'ვხსნი გაფორმებას.', empty: 'კალათა ცარიელია — ჯერ ნაკრები შევარჩიოთ.',
      bundle: (b) => `არის მზა ნაკრები „${b.name}“ ${b.price} ₾-ად. ავიღოთ?`,
    },
    hy: {
      reco: (r) => `${r.people ? r.people + ' հոգու համար' : ''}${r.budget ? ', ' + r.budget + ' ₾' : ''}՝ ${r.beer_liters ? r.beer_liters + ' լ գարեջուր, ' : ''}${r.items.filter((i) => i.role === 'food').length} խորտիկ։ Ընդամենը ${r.total} ₾։ Ավելացնե՞մ զամբյուղ։`,
      added: (c) => `Պատրաստ է։ Զամբյուղում ${c.total} ₾ է։`, removed: (c) => `Հանեցի։ Հիմա ${c.total} ₾ է։`, nothing: 'Սա զամբյուղում չկա։',
      cart: (c) => c.items.length || c.bundle ? `Զամբյուղում՝ ${[c.bundle ? c.bundle.name : null, ...c.items.map((i) => i.name + ' ×' + i.quantity)].filter(Boolean).join(', ')}։ Ընդամենը ${c.total} ₾։` : 'Զամբյուղը դեռ դատարկ է։',
      gift: (g) => !g.tiers ? 'Նվերներ հիմա չկան։' : g.next_threshold ? `Նվերին (${g.next_gift}) մնացել է ${g.left} ₾։` : `Նվերն արդեն ձերն է՝ ${g.unlocked_gift}։`,
      ask: 'Ասա՝ քանի հոգի եք և ինչ բյուջե ունեք՝ կհավաքեմ հավաքածուն։', checkout: 'Բացում եմ ձևակերպումը։', empty: 'Զամբյուղը դատարկ է՝ նախ հավաքենք։',
      bundle: (b) => `Կա պատրաստի հավաքածու «${b.name}» ${b.price} ₾-ով։ Վերցնե՞նք։`,
    },
  };
  const params = { people: null, budget: null, exclude_categories: [], more_categories: [], level: 'optimal' };
  let pendingReco = false, pendingBundle = null;

  function num(t) {
    const m = t.match(/(\d{1,4})/g);
    return m ? m.map(Number) : [];
  }
  function people(t, l) {
    const m = t.match(/(\d{1,2})\s*(чел|человек|душ|კაც|ადამიან|ჰოგ|հոգի|մարդ)/);
    if (m) return Number(m[1]);
    for (const L of [l, 'ru', 'ka', 'hy']) for (const [w, n] of Object.entries(NUM[L])) if (new RegExp('(^|[^\\p{L}])' + w + '([^\\p{L}]|$)', 'u').test(t)) {
      if (/(нас|ვართ|ենք|теперь|стало|ახლა|հիմա)/.test(t) || L !== 'ru' || /^(двое|трое|четверо|пятеро|шестеро|семеро|восьмеро|девятеро|десятеро)$/.test(w)) return n;
    }
    const m2 = t.match(/(нас|ვართ|ենք)\D{0,12}(\d{1,2})|(\d{1,2})\D{0,6}(ვართ|ենք)/);
    return m2 ? Number(m2[2] || m2[3]) : null;
  }
  function budget(t) {
    const m = t.match(/(бюджет|до|максимум|макс|не больше|ბიუჯეტ|მაქსიმუმ|բյուջե|առավելագույնը|մինչև)\D{0,14}(\d{2,4})/) || t.match(/(\d{2,4})\s*(лари|лар|₾|gel|ლარ|լարի|լար)/);
    return m ? Number(m[2] || m[1]) : null;
  }
  function cats(t) { return Object.entries(CAT).filter(([, ws]) => has(t, ws)).map(([c]) => c) }

  async function handle(text, l) {
    const S = SAY[l] || SAY.ru;
    const t = ' ' + String(text || '').toLowerCase().replace(/ё/g, 'е') + ' ';
    const c = cats(t);
    // yes after a proposal
    if ((pendingReco || pendingBundle) && word(t, W.yes) && !c.length && !people(t, l) && !budget(t)) {
      if (pendingBundle) { const r = await T.run('add_bundle_to_cart', { bundle_id: pendingBundle }); pendingBundle = null; return r.ok ? S.added(r.cart) : S.ask }
      const r = await T.run('apply_recommendation', { replace: true }); pendingReco = false; return r.ok ? S.added(r.cart) : S.ask;
    }
    if (has(t, W.gift)) return S.gift(await T.run('get_gift_progress', {}));
    if (has(t, W.cart) && !has(t, W.add) && !has(t, W.remove)) return S.cart(await T.run('get_cart', {}));
    if (has(t, W.checkout)) { const r = await T.run('prepare_checkout', {}); return r.ok ? S.checkout : S.empty }
    if (has(t, W.bundle) && !people(t, l)) {
      const b = (await T.run('get_available_bundles', {})).bundles[0];
      if (b) { pendingBundle = b.bundle_id; return S.bundle(b) }
    }
    const p = people(t, l), bud = budget(t);
    const removing = has(t, W.remove), adding = has(t, W.add) && !removing;
    // «убери рыбу» on a cart that has it
    if (removing && c.length && !p && !bud) {
      const cartNow = await T.run('get_cart', {});
      const inCart = c.filter((x) => cartNow.items.some((i) => x === 'strong' ? (PivkaReco.STRONG || []).includes(i.category) : i.category === x));
      params.exclude_categories = [...new Set([...params.exclude_categories, ...c])];
      if (inCart.length) {
        let r; for (const x of inCart) r = await T.run('remove_from_cart', { category: x });
        return S.removed(r.cart);
      }
      if (params.people) return recommend(S);
      return S.nothing;
    }
    if (adding && c.length && !p && !bud) {
      params.more_categories = [...new Set([...params.more_categories, ...c])];
      const list = (await T.run('get_catalog', { category: c[0] })).products.sort((a, b) => a.price - b.price);
      const pick = list[Math.floor((list.length - 1) / 2)];
      if (pick) { const r = await T.run('add_to_cart', { product_id: pick.product_id, quantity: pick.unit === 'L' ? 2 : 1 }); return S.added(r.cart) }
      return S.nothing;
    }
    if (has(t, W.cheaper)) params.level = 'economy';
    if (has(t, W.premium)) params.level = 'premium';
    if (p) params.people = p;
    if (bud) params.budget = bud;
    if (removing && c.length) params.exclude_categories = [...new Set([...params.exclude_categories, ...c])];
    if (p || bud || has(t, W.cheaper) || has(t, W.premium) || (removing && c.length)) {
      if (!params.people && !params.budget) return S.ask;
      return recommend(S);
    }
    return S.ask;
  }
  async function recommend(S) {
    const r = await T.run('recommend_cart', { people: params.people || 2, budget: params.budget || undefined, level: params.level, exclude_categories: params.exclude_categories, more_categories: params.more_categories });
    pendingReco = true;
    return S.reco(r);
  }

  window.PivkaVoiceLocal = { handle, reset: () => { Object.assign(params, { people: null, budget: null, exclude_categories: [], more_categories: [], level: 'optimal' }); pendingReco = false; pendingBundle = null }, _parse: { people, budget, cats } };
})();
