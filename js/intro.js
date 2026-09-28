/* Splash curtain + storefront reveals.
   Same model as the Marianna project (IntroProvider/SplashScreen): hold → revealing → done.
   HOLD 3000 ms / REVEAL 1000 ms; reduced motion 200 / 250 ms. Only transform/opacity are animated. */
(() => {
  const root = document.documentElement;
  const intro = document.getElementById('brandIntro');
  const order = document.getElementById('introOrder');
  const copy = {
    ru: ['ПИВО • ЗАКУСКИ • ДОСТАВКА', 'СДЕЛАТЬ ЗАКАЗ', 'Нужна помощь с заказом?'],
    ka: ['ლუდი • მისაყოლებელი • მიტანა', 'შეკვეთის გაკეთება', 'დახმარება გჭირდებათ შეკვეთაში?'],
    hy: ['ԳԱՐԵՋՈՒՐ • ԽՈՐՏԻԿՆԵՐ • ԱՌԱՔՈՒՄ', 'ԿԱՏԱՐԵԼ ՊԱՏՎԵՐ', 'Օգնությո՞ւն է պետք պատվերի հարցում։']
  };
  function update() {
    const t = copy[root.lang] || copy.ru;
    document.getElementById('introTagline').textContent = t[0];
    order.textContent = t[1];
    document.getElementById('checkoutHelp').textContent = t[2];
  }
  const setLang = window.setLang;
  window.setLang = function(lang) { setLang(lang); update(); };
  document.addEventListener('DOMContentLoaded', update);
  update();

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try { seen = sessionStorage.getItem('pivka_intro_seen') === '1'; sessionStorage.setItem('pivka_intro_seen', '1'); } catch (e) {}
  // Full theatrical intro once per browser session; reloads (e.g. after checkout) use the short timing.
  const short = reduced || seen;
  const HOLD_MS = short ? 200 : 3000;
  const REVEAL_MS = short ? 250 : 1000;
  root.style.setProperty('--intro-hold', HOLD_MS + 'ms');
  root.style.setProperty('--intro-reveal', REVEAL_MS + 'ms');

  const store = document.getElementById('storefront');
  const behind = [...document.body.children].filter(el => el !== intro && el.tagName !== 'SCRIPT');
  let phase = 'hold', holdTimer = 0, scrollAfter = false;

  function setupReveals() {
    if (reduced || !('IntersectionObserver' in window)) return;
    const targets = [...store.querySelectorAll('.gift,.actions,.section,#bundles,.cats,#products,#products + .card')];
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
    if (scrollAfter) {
      const target = store.querySelector('.gift') || store;
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function reveal() {
    if (phase !== 'hold') return;
    phase = 'revealing';
    clearTimeout(holdTimer);
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
  holdTimer = setTimeout(reveal, HOLD_MS);
  intro.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  order.addEventListener('click', () => { scrollAfter = true; reveal(); });
  document.addEventListener('keydown', e => { if (phase === 'hold' && e.key === 'Escape') reveal(); });
})();
