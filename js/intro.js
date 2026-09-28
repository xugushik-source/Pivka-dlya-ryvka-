(() => {
  const intro = document.getElementById('brandIntro');
  const order = document.getElementById('introOrder');
  const copy = {
    ru: ['ПИВО • ЗАКУСКИ • ДОСТАВКА', 'СДЕЛАТЬ ЗАКАЗ', 'Нужна помощь с заказом?'],
    ka: ['ლუდი • მისაყოლებელი • მიტანა', 'შეკვეთის გაკეთება', 'დახმარება გჭირდებათ შეკვეთაში?'],
    hy: ['ԳԱՐԵՋՈՒՐ • ԽՈՐՏԻԿՆԵՐ • ԱՌԱՔՈՒՄ', 'ԿԱՏԱՐԵԼ ՊԱՏՎԵՐ', 'Օգնությո՞ւն է պետք պատվերի հարցում։']
  };
  function update() {
    const lang = document.documentElement.lang;
    const t = copy[lang] || copy.ru;
    document.getElementById('introTagline').textContent = t[0];
    order.textContent = t[1];
    document.getElementById('checkoutHelp').textContent = t[2];
  }
  order.addEventListener('click', () => {
    const main = document.getElementById('storefront');
    main.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'start'});
  });
  const setLang = window.setLang;
  window.setLang = function(lang) { setLang(lang); update(); };
  document.addEventListener('DOMContentLoaded', update);
  update();
})();
