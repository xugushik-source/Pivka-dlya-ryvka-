/* Small joys of the store: short sounds, confetti on a gift, and the «your cart is waiting» nudge.
   Sounds are synthesised (Web Audio, no files): quiet, short, only after a tap; «🔇» in the top bar turns them off for good.
   Every effect also has a visual side, so a phone on silent still gets the moment. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ctx = null;
  const soundOn = () => { try { return localStorage.getItem('pivka_sound') !== 'off' } catch (e) { return true } };

  function tone(freq, start, dur, type = 'sine', vol = .06, to = null) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + start;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + .02)
  }
  // add — a soft «bloop»; gift — three rising bells; order — two glasses clinking.
  window.pivkaSound = function (kind) {
    if (!soundOn()) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      if (kind === 'add') tone(520, 0, .13, 'sine', .07, 880);
      else if (kind === 'gift') [880, 1175, 1568].forEach((f, i) => tone(f, i * .09, .35, 'triangle', .05));
      else if (kind === 'order') { tone(2093, 0, .5, 'sine', .04); tone(2637, .07, .55, 'sine', .035); tone(3136, .14, .45, 'sine', .02) }
    } catch (e) {}
  };

  // Confetti of beer and sparkles from an element (the gift bar).
  window.pivkaConfetti = function (from) {
    if (reduced || !from) return;
    const r = from.getBoundingClientRect(), box = document.createElement('div');
    box.className = 'confetti';
    box.style.left = (r.left + r.width / 2) + 'px';
    box.style.top = (r.top + r.height / 2) + 'px';
    const bits = ['🍺', '🎉', '✨', '🎁', '⭐'];
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('i');
      s.textContent = bits[i % bits.length];
      const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 110;
      s.style.setProperty('--x', Math.cos(a) * d + 'px');
      s.style.setProperty('--y', Math.sin(a) * d - 60 + 'px');
      s.style.setProperty('--r', (Math.random() * 360 - 180) + 'deg');
      s.style.animationDelay = Math.random() * 80 + 'ms';
      box.appendChild(s)
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1400)
  };
  window.pivkaGiftWon = function () {
    pivkaSound('gift');
    if (navigator.vibrate) try { navigator.vibrate([30, 40, 60]) } catch (e) {}
    pivkaConfetti(document.querySelector('#cartGift:not([hidden]) .bar') || document.querySelector('#giftBlock .bar') || document.querySelector('.cart'))
  };

  // «🔊/🔇» next to the language buttons.
  function soundButton() {
    const host = document.querySelector('.topctl');
    if (!host || document.getElementById('soundToggle')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'soundToggle';
    b.className = 'soundToggle';
    const paint = () => { b.textContent = soundOn() ? '🔊' : '🔇'; b.setAttribute('aria-label', soundOn() ? 'Выключить звуки' : 'Включить звуки') };
    b.onclick = () => { try { localStorage.setItem('pivka_sound', soundOn() ? 'off' : 'on') } catch (e) {} paint(); pivkaSound('add') };
    paint();
    host.appendChild(b)
  }

  // «Your cart is waiting»: once per visit — when someone comes back to a filled cart, returns to the tab after a while,
  // or sits on a filled cart for 90 s without checking out. The game prize is the reason to finish now.
  const NUDGE = {
    ru: ['🛒 Твоя корзина ждёт', 'Оформи доставку — получишь 3 попытки в игре «Рывок». Лучший за месяц выигрывает 4 порции шашлыка 🍖', 'Оформить →'],
    ka: ['🛒 შენი კალათა გელოდება', 'შეუკვეთე მიტანა — მიიღებ 3 ცდას თამაშში «გაქანება». თვის საუკეთესო იგებს 4 პორცია მწვადს 🍖', 'გაფორმება →'],
    hy: ['🛒 Զամբյուղդ սպասում է', 'Պատվիրիր առաքում՝ կստանաս 3 փորձ «Թռիչք» խաղում։ Ամսվա լավագույնը շահում է 4 բաժին խորոված 🍖', 'Ձևակերպել →']
  };
  let nudged = false, idleTimer = 0, hiddenAt = 0;
  try { nudged = sessionStorage.getItem('pivka_nudged') === '1' } catch (e) {}
  const lang = () => (document.documentElement.lang || 'ru').slice(0, 2);
  const cartSum = () => { try { return typeof orderBase === 'function' ? orderBase() : 0 } catch (e) { return 0 } };
  const cartFull = () => cartSum() > 0 || (typeof checkoutBundle !== 'undefined' && !!checkoutBundle);
  const busy = () => !!document.querySelector('.sheet.on');   // the cart / checkout / any sheet is open
  function showNudge(why) {
    if (nudged || !cartFull() || busy() || document.documentElement.classList.contains('intro-lock')) return;
    nudged = true;
    try { sessionStorage.setItem('pivka_nudged', '1') } catch (e) {}
    const t = NUDGE[lang()] || NUDGE.ru, el = document.createElement('div');
    el.className = 'cartNudge';
    el.setAttribute('role', 'dialog');
    el.innerHTML = '<button type="button" class="x" aria-label="Закрыть">×</button><b></b><p></p><button type="button" class="go"></button>';
    el.querySelector('b').textContent = t[0] + (cartSum() > 0 ? ' · ' + (typeof money === 'function' ? money(cartSum()) : cartSum() + ' ₾') : '');
    el.querySelector('p').textContent = t[1];
    el.querySelector('.go').textContent = t[2];
    const close = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 300) };
    el.querySelector('.x').onclick = close;
    el.querySelector('.go').onclick = () => { close(); try { track('cart_nudge_click', { metadata: { why } }) } catch (e) {} if (typeof openCart === 'function') openCart() };
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    try { track('cart_nudge_show', { metadata: { why, total: cartSum() } }) } catch (e) {}
  }
  function armIdle() {
    clearTimeout(idleTimer);
    if (!nudged) idleTimer = setTimeout(() => showNudge('idle'), 90e3)
  }
  ['pointerdown', 'scroll', 'keydown'].forEach(ev => addEventListener(ev, armIdle, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 30e3) setTimeout(() => showNudge('return'), 800)
  });
  // Came back with a cart saved from an earlier visit.
  document.addEventListener('pivka:intro-done', () => {
    let saved = false;
    try { saved = JSON.parse(localStorage.getItem('pivka_cart') || '[]').length > 0 } catch (e) {}
    if (saved) setTimeout(() => showNudge('comeback'), 2500);
    armIdle()
  }, { once: true });
  document.addEventListener('DOMContentLoaded', soundButton);
  if (document.readyState !== 'loading') soundButton();
})();
