// Installing the site on the phone (PWA). The offer is shown only after an order has been placed and at most once
// in 14 days («Не сейчас» counts too). Android/Chrome: the system install prompt. iPhone: a short how-to
// («Поделиться → На экран „Домой“») — Safari has no install prompt. Already installed → nothing is shown.
(function () {
  'use strict';
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  addEventListener('appinstalled', () => { deferred = null; try { localStorage.setItem('pivka_installed', '1') } catch (e) {} });

  const KEY = 'pivka_install_ask', GAP = 14 * 864e5;
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosSafari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Telegram|Line\//.test(ua);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const T = (s) => (window.PIVKA_I18N ? PIVKA_I18N.translate(s, PIVKA_I18N.language) : s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const due = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) > GAP && !localStorage.getItem('pivka_installed') } catch (e) { return false } };
  const mark = () => { try { localStorage.setItem(KEY, String(Date.now())) } catch (e) {} };

  // iPhone picture: Safari's bottom bar with the Share button → the «На экран „Домой“» line.
  const PIC = '<svg viewBox="0 0 300 120" width="100%" role="img" aria-hidden="true" style="max-width:300px;display:block;margin:10px auto">' +
    '<rect x="1" y="1" width="298" height="118" rx="16" fill="#14181a" stroke="#2c3336"/>' +
    '<rect x="16" y="16" width="120" height="88" rx="12" fill="#1f2528"/>' +
    '<g transform="translate(76 60)" fill="none" stroke="#0a84ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M-14 -4 v24 h28 v-24"/><path d="M0 -22 v28"/><path d="M-9 -13 l9 -9 l9 9"/></g>' +
    '<text x="150" y="66" fill="#ffb51b" font-size="28" font-family="system-ui" text-anchor="middle">→</text>' +
    '<rect x="166" y="34" width="118" height="52" rx="12" fill="#1f2528"/>' +
    '<g transform="translate(186 60)" fill="none" stroke="#fff" stroke-width="3"><rect x="-9" y="-9" width="18" height="18" rx="4"/><path d="M0 -5 v10 M-5 0 h10"/></g>' +
    '<text x="204" y="65" fill="#fff" font-size="13" font-family="system-ui">Домой</text></svg>';

  function card() {
    if (standalone() || !due() || !(deferred || ios)) return '';
    return '<div class="installCard" id="installCard"><b>📲 ' + esc(T('Установить «Пивка» на телефон')) + '</b>' +
      '<span>' + esc(T('Следующий заказ — в одно касание, прямо с экрана телефона.')) + '</span>' +
      '<div class="installRow"><button type="button" class="installGo">' + esc(T('Установить')) + '</button>' +
      '<button type="button" class="installLater">' + esc(T('Не сейчас')) + '</button></div></div>';
  }
  function iosHelp(box) {
    box.innerHTML = '<b>📲 ' + esc(T('Как установить на iPhone')) + '</b>' + PIC +
      (iosSafari ? '' : '<span>' + esc(T('Откройте этот сайт в Safari — установить можно только из него.')) + '</span>') +
      '<span>1. ' + esc(T('Нажмите «Поделиться» (квадрат со стрелкой) внизу экрана.')) + '</span>' +
      '<span>2. ' + esc(T('Выберите «На экран „Домой“» и нажмите «Добавить».')) + '</span>' +
      '<div class="installRow"><button type="button" class="installLater">' + esc(T('Понятно')) + '</button></div>';
    box.querySelector('.installLater').onclick = () => box.remove();
  }
  // Called on the success screen after an order.
  function offer(where) {
    const h = where && card();
    if (!h) return;
    mark();
    where.insertAdjacentHTML('beforeend', h);
    const box = where.querySelector('#installCard');
    box.querySelector('.installLater').onclick = () => box.remove();
    box.querySelector('.installGo').onclick = async () => {
      if (deferred) {
        deferred.prompt();
        try { await deferred.userChoice } catch (e) {}
        deferred = null;
        box.remove();
      } else iosHelp(box);
    };
  }
  window.PivkaPWA = { offer, standalone };
})();
