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
      frames: [['<span>ПИВКА</span><span>ДЛЯ РЫВКА</span>', 1700, 'brand'], ['Не думай, что брать', 1700], ['Готовые рывки<br>уже собраны', 1900], ['Угости друга 🍻', 1600], ['Спорим на пиво? 🏆', 1600], ['Пиво, крепкое и закуски<span class="sub">с доставкой</span>', 2000]],
      cta: 'ПЕРЕЙТИ К ЗАКАЗУ →', hint: 'Чтобы сразу перейти к заказу — нажмите кнопку', help: 'Нужна помощь с заказом?'
    },
    ka: {
      frames: [['<span>ლუდი</span><span>გაქანებისთვის</span>', 1700, 'brand'], ['ნუ ფიქრობ, რა აიღო', 1800], ['მზა ნაკრებები<br>უკვე აწყობილია', 2000], ['გაუმასპინძლდი მეგობარს 🍻', 1800], ['დავდოთ ფსონი ლუდზე? 🏆', 1800], ['ლუდი, ძლიერი სასმელი და მისაყოლებელი<span class="sub">მიტანით</span>', 2300]],
      cta: 'შეკვეთაზე გადასვლა →', hint: 'შეკვეთაზე პირდაპირ გადასასვლელად დააჭირეთ ღილაკს', help: 'დახმარება გჭირდებათ შეკვეთაში?'
    },
    hy: {
      frames: [['<span>Գարեջուր</span><span>լավ երեկոյի համար</span>', 1700, 'brand'], ['Մի՛ մտածիր՝ ինչ վերցնել', 1800], ['Պատրաստի հավաքածուներն<br>արդեն հավաքված են', 2000], ['Հյուրասիրիր ընկերոջդ 🍻', 1800], ['Գրազ գարեջրի վրա՞ 🏆', 1800], ['Գարեջուր, թունդ խմիչք և խորտիկներ<span class="sub">առաքմամբ</span>', 2300]],
      cta: 'ԱՆՑՆԵԼ ՊԱՏՎԵՐԻՆ →', hint: 'Պատվերին անմիջապես անցնելու համար սեղմեք կոճակը', help: 'Օգնությո՞ւն է պետք պատվերի հարցում։'
    }
  };
  const t = () => copy[root.lang] || copy.ru;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try { seen = sessionStorage.getItem('pivka_intro_seen') === '1'; sessionStorage.setItem('pivka_intro_seen', '1'); } catch (e) {}
  // Reloads in the same tab (e.g. after checkout) show only the brand and the button for a moment.
  const short = seen;
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
    if (i >= frames.length) { reveal(); return }
    showFrame(i);
    frameTimer = setTimeout(() => playFrom(i + 1), frames[i][1]);
  }
  function restartProgress() {
    const total = short ? 1800 : t().frames.reduce((a, f) => a + f[1], 0);
    root.style.setProperty('--intro-hold', total + 'ms');
    const bar = intro.querySelector('.brand-intro__progress i');
    if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '' }
  }
  function update() {
    const c = t();
    order.textContent = c.cta;
    hint.textContent = c.hint;
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
