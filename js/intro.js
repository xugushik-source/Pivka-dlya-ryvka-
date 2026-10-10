/* Splash curtain + storefront reveals.
   Same model as the Marianna project (IntroProvider/SplashScreen): hold → revealing → done.
   The curtain runs like film credits: one short phrase at a time, long enough to read. Language is chosen on the
   curtain itself (default: saved choice, else the phone's language); changing it restarts the credits.
   «Перейти к заказу» skips at any moment. Only transform/opacity are animated. */
(() => {
  const root = document.documentElement;
  const intro = document.getElementById('brandIntro');
  const order = document.getElementById('introOrder');
  const credits = document.getElementById('credits');
  const hint = document.getElementById('introHint');
  // [html, ms on screen]
  const copy = {
    ru: {
      frames: [['<span>ПИВКА</span><span>ДЛЯ РЫВКА</span>', 1700, 'brand'],
        ['🔥 Готовые рывки<span class="sub">Пиво и закуска уже собраны — выбрал и готово</span>', 2300],
        ['🎁 Угости друга<span class="sub">Ты платишь — мы привозим ему</span>', 2200],
        ['🏆 Спорим на пиво?<span class="sub">Проиграл — угощаешь</span>', 2200],
        ['🧺 Или собери свой<span class="sub">Пиво, крепкое, рыба, сыр, чипсы</span>', 2200],
        ['🚚 Привезём домой<span class="sub">Ахалкалаки и Ниноцминда</span>', 2000],
        ['🎮 Игра «Рывок»<span class="sub">Курьер выехал — играй, пока везём. 3 попытки с каждого заказа, лучший за месяц выигрывает 4 порции шашлыка</span>', 3400],
        ['🌙 С 00:00 до 08:00 — цены +10 %<span class="sub">Доставка днём 3 ₾, бесплатно от 50 ₾ · после 23:00 — 7 ₾, бесплатно от 80 ₾</span>', 3200]],
      cta: 'ПЕРЕЙТИ К ЗАКАЗУ →', hint: 'Чтобы сразу перейти к заказу — нажмите кнопку', help: 'Нужна помощь с заказом?',
      night: '🌙 00:00–08:00 цены +10 % · доставка после 23:00 — 7 ₾'
    },
    ka: {
      frames: [['<span>ლუდი</span><span>გაქანებისთვის</span>', 1700, 'brand'],
        ['🔥 მზა ნაკრებები<span class="sub">ლუდი და მისაყოლებელი უკვე აწყობილია — აირჩიე და მზადაა</span>', 2500],
        ['🎁 გაუმასპინძლდი მეგობარს<span class="sub">შენ იხდი — ჩვენ მას მივუტანთ</span>', 2400],
        ['🏆 დავდოთ ფსონი ლუდზე?<span class="sub">წააგე — შენ უმასპინძლდები</span>', 2400],
        ['🧺 ან ააწყე შენი<span class="sub">ლუდი, ძლიერი სასმელი, თევზი, ყველი, ჩიფსები</span>', 2400],
        ['🚚 სახლამდე მოგიტანთ<span class="sub">ახალქალაქი და ნინოწმინდა</span>', 2200],
        ['🎮 თამაში «გაქანება»<span class="sub">კურიერი გამოვიდა — ითამაშე, სანამ მოგიტანთ. ყოველ შეკვეთაზე 3 ცდა, თვის საუკეთესო იგებს 4 პორცია მწვადს</span>', 3600],
        ['🌙 00:00-დან 08:00-მდე — ფასები +10 %<span class="sub">მიტანა დღისით 3 ₾, უფასოდ 50 ₾-დან · 23:00-ის შემდეგ — 7 ₾, უფასოდ 80 ₾-დან</span>', 3400]],
      cta: 'შეკვეთაზე გადასვლა →', hint: 'შეკვეთაზე პირდაპირ გადასასვლელად დააჭირეთ ღილაკს', help: 'დახმარება გჭირდებათ შეკვეთაში?',
      night: '🌙 00:00–08:00 ფასები +10 % · მიტანა 23:00-ის შემდეგ — 7 ₾'
    },
    hy: {
      frames: [['<span>Գարեջուր</span><span>լավ երեկոյի համար</span>', 1700, 'brand'],
        ['🔥 Պատրաստի հավաքածուներ<span class="sub">Գարեջուրն ու խորտիկն արդեն հավաքված են՝ ընտրիր և վերջ</span>', 2500],
        ['🎁 Հյուրասիրիր ընկերոջդ<span class="sub">Դու վճարում ես՝ մենք տանում ենք նրան</span>', 2400],
        ['🏆 Գրազ գարեջրի վրա՞<span class="sub">Պարտվողը հյուրասիրում է</span>', 2400],
        ['🧺 Կամ հավաքիր քոնը<span class="sub">Գարեջուր, թունդ խմիչք, ձուկ, պանիր, չիպսեր</span>', 2400],
        ['🚚 Կբերենք տուն<span class="sub">Ախալքալաք և Նինոծմինդա</span>', 2200],
        ['🎮 «Թռիչք» խաղը<span class="sub">Առաքիչը դուրս եկավ՝ խաղա, մինչ բերում ենք։ Յուրաքանչյուր պատվերից 3 փորձ, ամսվա լավագույնը շահում է 4 բաժին խորոված</span>', 3600],
        ['🌙 00:00-ից 08:00 — գները +10 %<span class="sub">Առաքումը ցերեկը 3 ₾, անվճար 50 ₾-ից · 23:00-ից հետո՝ 7 ₾, անվճար 80 ₾-ից</span>', 3400]],
      cta: 'ԱՆՑՆԵԼ ՊԱՏՎԵՐԻՆ →', hint: 'Պատվերին անմիջապես անցնելու համար սեղմեք կոճակը', help: 'Օգնությո՞ւն է պետք պատվերի հարցում։',
      night: '🌙 00:00–08:00 գները +10 % · առաքումը 23:00-ից հետո՝ 7 ₾'
    }
  };
  const t = () => copy[root.lang] || copy.ru;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Full credits on every visit. Only the reload right after a placed order is short (store.js sets the flag).
  let short = false;
  try { short = sessionStorage.getItem('pivka_intro_short') === '1'; sessionStorage.removeItem('pivka_intro_short'); } catch (e) {}
  const REVEAL_MS = reduced ? 250 : 800;
  root.style.setProperty('--intro-reveal', REVEAL_MS + 'ms');
  if (short) root.classList.add('intro-short');

  let frameTimer = 0, frameNo = 0, running = false, shownLang = null;
  function showFrame(i) {
    const f = t().frames[i];
    const old = credits.querySelector('.credit:not(.out)');
    if (old) { old.classList.add('out'); setTimeout(() => old.remove(), 650) }
    const el = document.createElement('p');
    el.className = 'credit in' + (f[2] ? ' ' + f[2] : '');
    el.innerHTML = f[0];
    credits.appendChild(el);
    shownLang = root.lang;
    // Long Georgian/Armenian words must fit the phone width: shrink the line until it does.
    let size = parseFloat(getComputedStyle(el).fontSize), guard = 12;
    while (el.scrollWidth > credits.clientWidth && guard-- > 0) { size *= .9; el.style.fontSize = size + 'px' }
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('in')));
  }
  function playFrom(i) {
    clearTimeout(frameTimer);
    frameNo = i;
    const frames = t().frames;
    if (!running) return;
    if (i >= frames.length) {
      // The song plays to its last chord; the store opens right after it (or at once without sound).
      if (audio && !audio.paused && audio.duration) { frameTimer = setTimeout(reveal, Math.max(0, (audio.duration - audio.currentTime) * 1000)); return }
      reveal(); return
    }
    showFrame(i);
    frameTimer = setTimeout(() => playFrom(i + 1), frames[i][1]);
  }
  function restartProgress() {
    const total = short ? 1800 : t().frames.reduce((a, f) => a + f[1], 0);
    root.style.setProperty('--intro-hold', total + 'ms');
    const bar = intro.querySelector('.brand-intro__progress i');
    if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '' }
  }
  // «🔊 Со звуком»: «Чакруло» (Georgian table song, 1957) only on the curtain. Browsers play sound only after a tap,
  // so it is the visitor's choice; it fades out when the store opens.
  const soundBtn = document.getElementById('introSound');
  const SOUND_TXT = { ru: ['🔊 Со звуком', '🔇 Выключить'], ka: ['🔊 ხმით', '🔇 გამორთვა'], hy: ['🔊 Ձայնով', '🔇 Անջատել'] };
  let audio = null;
  function soundLabel() {
    if (!soundBtn) return;
    const on = !!audio && !audio.paused, l = SOUND_TXT[root.lang] || SOUND_TXT.ru;
    soundBtn.textContent = on ? l[1] : l[0];
    soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
  function soundOff() {
    if (!audio || audio.paused) return;
    const a = audio, v = a.volume;
    let k = 0;
    const id = setInterval(() => { a.volume = Math.max(0, v * (1 - ++k / 12)); if (k >= 12) { clearInterval(id); a.pause(); soundLabel() } }, 60)
  }
  if (soundBtn) soundBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (audio && !audio.paused) { audio.pause(); soundLabel(); return }
    if (!audio) { audio = new Audio('assets/sound/chakrulo.mp3'); audio.addEventListener('ended', soundLabel) }
    audio.volume = .75;
    if (audio.ended) audio.currentTime = 0;
    audio.play().then(soundLabel).catch(soundLabel);
    soundLabel()
  });
  function update() {
    soundLabel();
    const c = t();
    order.textContent = c.cta;
    hint.textContent = c.hint;
    const nl = document.getElementById('introNight');
    if (nl) nl.textContent = c.night;
    document.getElementById('checkoutHelp').textContent = c.help;
    intro.querySelectorAll('.intro-langs button').forEach(b => b.classList.toggle('on', b.dataset.l === (root.lang || 'ru')));
    if (running && shownLang !== root.lang) {
      restartProgress();
      if (short) { credits.innerHTML = ''; showFrame(0) } else playFrom(frameNo > 0 ? 1 : 0)
    }
  }
  const setLang = window.setLang;
  window.setLang = function(lang) { setLang(lang); update(); };
  intro.querySelectorAll('.intro-langs button').forEach(b => b.addEventListener('click', () => window.setLang(b.dataset.l)));
  document.addEventListener('DOMContentLoaded', update);

  const store = document.getElementById('storefront');
  const behind = [...document.body.children].filter(el => el !== intro && el.tagName !== 'SCRIPT');
  let phase = 'hold', holdTimer = 0, scrollAfter = false;

  function setupReveals() {
    if (reduced || !('IntersectionObserver' in window)) return;
    const targets = [...store.querySelectorAll('.block,.gift,.notfound,.secondary')];
    const vh = innerHeight || root.clientHeight;
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    targets.forEach(el => {
      // Already on screen: covered by the page transition, reveal immediately (no stuck hidden blocks).
      const r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) return;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  function done() {
    phase = 'done';
    intro.classList.add('is-done');
    intro.setAttribute('aria-hidden', 'true');
    root.classList.remove('intro-lock');
    behind.forEach(el => el.removeAttribute('inert'));
    document.dispatchEvent(new Event('pivka:intro-done'));
    if (scrollAfter) {
      const target = document.getElementById('todaySection') || store;
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function reveal() {
    if (phase !== 'hold') return;
    phase = 'revealing';
    running = false;
    clearTimeout(holdTimer);
    clearTimeout(frameTimer);
    intro.classList.add('is-revealing');
    soundOff();
    store.classList.add('enter');
    store.classList.remove('pre-enter');
    setTimeout(done, REVEAL_MS);
  }

  if (!root.classList.contains('js') || !intro) return;
  root.classList.add('intro-lock');
  behind.forEach(el => el.setAttribute('inert', ''));
  store.classList.add('pre-enter');
  setupReveals();
  running = true;
  update();
  restartProgress();
  if (short) { showFrame(0); holdTimer = setTimeout(reveal, 1800) } else playFrom(0);
  intro.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  order.addEventListener('click', () => { scrollAfter = true; reveal(); });
  document.addEventListener('keydown', e => { if (phase === 'hold' && e.key === 'Escape') reveal(); });
})();
