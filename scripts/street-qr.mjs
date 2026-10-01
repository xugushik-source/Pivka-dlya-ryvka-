#!/usr/bin/env node
// Street QR posters: one design, a different QR per poster spot.
//
//   npm run generate:qr -- --spot=002            → assets/qr/qr-spot-002.{svg,png} + print/street-qr-a4-spot-002*
//   npm run generate:qr -- --spot=001 --og       → also assets/qr/og.jpg (neutral link preview for /qr/)
//
// The QR holds our own URL directly (no shortener, no redirect). The poster SVG is the source; PNG (300 dpi) and
// PDF (A4 + 3 mm bleed, and A4 without bleed) are rendered from it by Chromium, with the fonts embedded.
// After rendering, the QR is decoded back from the print PNG — including small, blurred and tilted views of the
// whole sheet — and the run fails if any view does not give back exactly the poster URL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://xugushik-source.github.io/Pivka-dlya-ryvka-/';
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const spotNum = Number(args.spot || 1);
if (!Number.isInteger(spotNum) || spotNum < 1 || spotNum > 999) throw new Error('--spot must be 1…999');
const SPOT = String(spotNum).padStart(3, '0');
const CAMPAIGN = String(args.campaign || 'guys');
if (!/^[\w-]{1,30}$/.test(CAMPAIGN)) throw new Error('--campaign: letters, digits, _ or - only');
const URL_ = `${SITE}qr/?utm_source=street_qr&utm_medium=offline&utm_campaign=${CAMPAIGN}&spot=${SPOT}`;

// ---- Text (owner's exact wording — do not «correct»; ՄԱՆՉԵՐ is with Չ U+0549, not Ջ)
const TEXT = {
  ka: { head: ['ბიჭებო,', 'ვიცით, რა გინდათ.'], scan: 'დაასკანერე', age: 'მკაცრად 18+' },
  hy: { head: ['ՄԱՆՉԵՐ,', 'ԳԻՏԵՆՔ՝ ԻՆՉ ԿՈՒԶԵՔ։'], scan: 'ՍԿԱՆԱՎՈՐԵՔ', age: 'ԽԻՍՏ 18+' },
  ru: { head: ['ПАРНИ,', 'МЫ ЗНАЕМ,', 'ЧЕГО ВЫ ХОТИТЕ.'], scan: 'СКАНИРУЙ', age: 'СТРОГО 18+' },
};
if (!TEXT.hy.head[0].includes('Չ') || TEXT.hy.head[0].includes('Ջ')) throw new Error('ՄԱՆՉԵՐ must use Չ (U+0549)');

// ---- Geometry, millimetres. Trim = A4 210×297, bleed 3 mm on every side.
const B = 3, W = 210 + 2 * B, H = 297 + 2 * B, CX = W / 2, SAFE = 186; // text never wider than 186 mm
const QR_MM = 110, QUIET = 4;                                               // code size; quiet zone in modules
const INK = '#f4f1ea', ACCENT = '#ffb51b', BG = '#0b0c0d';

const qr = QRCode.create(URL_, { errorCorrectionLevel: 'Q' });
const N = qr.modules.size;
function qrPath(x0, y0, m) {   // horizontal runs of dark modules → one path
  let d = '';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!qr.modules.get(r, c)) continue;
      let e = c; while (e + 1 < N && qr.modules.get(r, e + 1)) e++;
      d += `M${(x0 + c * m).toFixed(3)} ${(y0 + r * m).toFixed(3)}h${((e - c + 1) * m).toFixed(3)}v${m.toFixed(3)}h${(-(e - c + 1) * m).toFixed(3)}z`;
      c = e;
    }
  }
  return d;
}

const font = f => fs.readFileSync(path.join(ROOT, 'print/fonts', f)).toString('base64');
// One family, split by script with unicode-range, so every line picks the right Noto face.
const FONT_CSS = [
  ['noto-sans-latin-900-normal.woff2', 'U+0000-00FF,U+2000-206F'],
  ['noto-sans-cyrillic-900-normal.woff2', 'U+0400-04FF'],
  ['noto-sans-armenian-armenian-900-normal.woff2', 'U+0530-058F,U+FB13-FB17'],
  ['noto-sans-georgian-georgian-900-normal.woff2', 'U+10A0-10FF,U+1C90-1CBF,U+2D00-2D2F'],
].map(([f, r]) => `@font-face{font-family:'Poster';font-weight:900;src:url(data:font/woff2;base64,${font(f)}) format('woff2');unicode-range:${r}}`).join('');

function posterSvg() {
  const m = QR_MM / N, plate = QR_MM + 2 * QUIET * m;
  const t = (y, s, size, fill, fit = SAFE) =>
    `<text x="${CX}" y="${(y + B).toFixed(2)}" font-size="${size}" fill="${fill}" data-fit="${fit}">${s}</text>`;
  const lines = [];
  // Top: three short teasers (Georgian, Armenian, Russian), the address word in accent.
  let y = 24;
  for (const k of ['ka', 'hy', 'ru']) {
    TEXT[k].head.forEach((s, i) => { lines.push(t(y, s, 10.2, i === 0 ? ACCENT : INK)); y += 11.2 });
    y += 4.6;
  }
  const plateY = y - 2 + B, plateX = CX - plate / 2;
  // Bottom: «scan» in three languages, then 18+.
  const scanY = plateY - B + plate + 15;
  lines.push(t(scanY, `${TEXT.ka.scan}  ·  ${TEXT.hy.scan}  ·  ${TEXT.ru.scan}`, 7.4, INK));
  const ageY = 297 - 19;
  lines.push(`<text x="${12 + B}" y="${ageY + B}" font-size="4.6" fill="#b9bcbf" style="text-anchor:start" data-fit="140">${TEXT.ka.age}  ·  ${TEXT.hy.age}  ·  ${TEXT.ru.age}</text>`);
  const tri = (x, yy) => `<path d="M${x} ${yy}l3.2 5.4h-6.4z" fill="${ACCENT}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">
<title>Street QR A4 · spot ${SPOT}</title>
<desc>${URL_}</desc>
<style>${FONT_CSS}text{font-family:'Poster',sans-serif;font-weight:900;text-anchor:middle;letter-spacing:-.01em}</style>
<rect width="${W}" height="${H}" fill="${BG}"/>
${lines.join('\n')}
<rect x="${plateX.toFixed(3)}" y="${plateY.toFixed(3)}" width="${plate.toFixed(3)}" height="${plate.toFixed(3)}" rx="2.4" fill="#ffffff"/>
<path d="${qrPath(plateX + QUIET * m, plateY + QUIET * m, m)}" fill="#000000"/>
${tri(CX, scanY + B - 13)}
<g transform="translate(${W - 12 - B - 12} ${ageY + B - 3.4})"><circle r="12" fill="none" stroke="${INK}" stroke-width="1.4"/><text y="3.6" font-size="10.4" fill="${INK}" data-fit="22">18+</text></g>
</svg>`;
}

function qrOnlySvg() {   // the code alone, 1 unit = 1 module, with its white quiet zone
  const size = N + 2 * QUIET, mm = (QR_MM * size / N).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${mm}mm" height="${mm}mm" shape-rendering="crispEdges">
<title>${URL_}</title>
<rect width="${size}" height="${size}" fill="#ffffff"/>
<path d="${qrPath(QUIET, QUIET, 1)}" fill="#000000"/>
</svg>`;
}

// PNG with a 300 dpi pHYs chunk (printers read it; browsers ignore it).
function withDpi(buf, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9); data.writeUInt32BE(ppm, 0); data.writeUInt32BE(ppm, 4); data[8] = 1;
  const type = Buffer.from('pHYs');
  const crc = crc32(Buffer.concat([type, data]));
  const chunk = Buffer.concat([u32(9), type, data, u32(crc)]);
  return Buffer.concat([buf.subarray(0, 33), chunk, buf.subarray(33)]); // after signature (8) + IHDR (25)
  function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decode(pngBuf) {
  const p = PNG.sync.read(pngBuf);
  return jsQR(new Uint8ClampedArray(p.data.buffer, p.data.byteOffset, p.data.length), p.width, p.height, { inversionAttempts: 'dontInvert' })?.data || null;
}

async function main() {
  const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => fs.existsSync(f));
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  const out = (rel, data) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); console.log('  ' + rel, (fs.statSync(f).size / 1024).toFixed(0) + ' KB'); };
  console.log(`spot ${SPOT} → ${URL_}\nQR version ${qr.version}, ${N}×${N} modules, EC Q, ${(QR_MM / N).toFixed(2)} mm/module`);

  // 1. Fit the text to the safe width in a real renderer, then keep that SVG as the source of truth.
  await page.setContent(`<!doctype html><body style="margin:0">${posterSvg()}</body>`);
  await page.evaluate(() => document.fonts.ready);
  const fitted = await page.evaluate(() => {
    const report = [];
    document.querySelectorAll('text[data-fit]').forEach(el => {
      const max = Number(el.dataset.fit);
      let size = Number(el.getAttribute('font-size'));
      while (el.getBBox().width > max && size > 2) { size *= 0.97; el.setAttribute('font-size', size.toFixed(2)) }
      report.push([el.textContent, Math.round(el.getBBox().width), size.toFixed(2)]);
      el.removeAttribute('data-fit');
    });
    const svg = document.querySelector('svg');
    return { svg: svg.outerHTML, report };
  });
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + fitted.svg;
  fitted.report.forEach(([s, w, f]) => console.log(`    ${w} mm  ${f} mm  ${s}`));
  // No □ tofu: every character must fall into one of the embedded Noto subsets.
  const RANGES = [[0x20, 0xff], [0x2000, 0x206f], [0x400, 0x45f], [0x531, 0x58f], [0x10a0, 0x10ff]];
  const missing = [...new Set(Object.values(TEXT).flatMap(t => [...t.head, t.scan, t.age]).join('').replace(/\s/g, ''))]
    .filter(ch => !RANGES.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b));
  if (missing.length) throw new Error('Characters outside the poster fonts: ' + missing.join(' '));

  out(`assets/qr/qr-spot-${SPOT}.svg`, qrOnlySvg());
  out(`assets/qr/qr-spot-${SPOT}.png`, withDpi(await QRCode.toBuffer(URL_, { errorCorrectionLevel: 'Q', margin: QUIET, width: 2048, color: { dark: '#000000', light: '#ffffff' } }), 600));
  out(`print/street-qr-a4-spot-${SPOT}.svg`, svg);

  // 2. 300 dpi PNG of the full sheet with bleed: 216×303 mm → 2551×3579 px.
  const px = mm => Math.round(mm / 25.4 * 300);
  const pw = px(W), ph = px(H);
  await page.setViewportSize({ width: pw, height: ph });
  await page.setContent(`<!doctype html><body style="margin:0;background:#000">${svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${pw}" height="${ph}"`)}</body>`);
  await page.evaluate(() => document.fonts.ready);
  const printPng = await page.screenshot({ clip: { x: 0, y: 0, width: pw, height: ph } });
  out(`print/street-qr-a4-spot-${SPOT}.png`, withDpi(printPng, 300));
  await page.setViewportSize({ width: 900, height: Math.round(900 * H / W) });
  await page.setContent(`<!doctype html><body style="margin:0;background:#000">${svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="900" height="' + Math.round(900 * H / W) + '"')}</body>`);
  await page.evaluate(() => document.fonts.ready);
  out(`print/street-qr-a4-spot-${SPOT}-preview.jpg`, await page.screenshot({ type: 'jpeg', quality: 86, fullPage: true }));

  // 3. Vector PDFs: with bleed (216×303 mm, for a print shop) and plain A4 (210×297 mm, office printer).
  // Chromium rounds the page to whole CSS pixels (≈0.1 mm off), so render a hair larger and then set the exact
  // MediaBox in points; the background runs past the edge, so nothing white can appear.
  const exactBox = (buf, w, h) => {
    const s = buf.toString('latin1'), m = s.match(/\/MediaBox\s*\[[^\]]*\]/);
    if (!m) throw new Error('PDF without MediaBox');
    let box = `/MediaBox [0 0 ${(w / 25.4 * 72).toFixed(3)} ${(h / 25.4 * 72).toFixed(3)}]`;
    if (box.length > m[0].length) throw new Error('MediaBox does not fit');
    box = box.replace(']', ' '.repeat(m[0].length - box.length) + ']');   // same byte length keeps the xref valid
    return Buffer.from(s.replace(m[0], box), 'latin1');
  };
  const pdf = async (w, h, shift) => {
    const W2 = w + 0.3, H2 = h + 0.3;
    await page.setContent(`<!doctype html><html><head><style>@page{size:${W2}mm ${H2}mm;margin:0}html,body{margin:0;width:${W2}mm;height:${H2}mm;overflow:hidden;background:${BG}}svg{display:block;margin:${-shift}mm 0 0 ${-shift}mm}</style></head><body>${svg.replace(/^<\?xml[^>]*>\s*/, '')}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    return exactBox(await page.pdf({ preferCSSPageSize: true, printBackground: true, pageRanges: '1' }), w, h);
  };
  out(`print/street-qr-a4-spot-${SPOT}.pdf`, await pdf(W, H, 0));
  out(`print/street-qr-a4-spot-${SPOT}-no-bleed.pdf`, await pdf(210, 297, B));

  // 4. Read the code back like a phone would: whole sheet, small (≈1 m away), blurred, tilted.
  const views = [['print PNG 300 dpi', null], ['sheet 600 px wide (~1 m)', 'width:600px'], ['sheet 380 px wide (far)', 'width:380px'],
    ['blur 1.5 px', 'width:700px;filter:blur(1.5px)'], ['tilt 25° left-right', 'width:700px;transform:perspective(900px) rotateY(25deg)'],
    ['tilt 20° up-down', 'width:700px;transform:perspective(900px) rotateX(20deg)'], ['dim light', 'width:700px;filter:brightness(.55) contrast(.8)']];
  const b64 = printPng.toString('base64');
  let failed = 0;
  for (const [name, css] of views) {
    let data;
    if (!css) data = decode(printPng);
    else {
      await page.setViewportSize({ width: 1000, height: 1300 });
      await page.setContent(`<!doctype html><body style="margin:0;background:#808080;display:grid;place-items:center;height:1300px"><img src="data:image/png;base64,${b64}" style="${css}"></body>`);
      await page.waitForFunction(() => document.images[0].complete);
      data = decode(await page.screenshot());
    }
    const ok = data === URL_;
    if (!ok) failed++;
    console.log(`  QR read · ${name}: ${ok ? 'OK' : 'FAIL (' + data + ')'}`);
  }
  if (args.og) {
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.setContent(`<!doctype html><html><head><style>${FONT_CSS}body{margin:0;width:1200px;height:630px;background:${BG};color:${INK};font-family:'Poster',sans-serif;font-weight:900;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box}h1{font-size:84px;line-height:1;margin:0 0 34px;letter-spacing:-.01em}p{margin:6px 0;font-size:34px;color:#b9bcbf}</style></head><body><h1>МЫ ЗНАЕМ,<br>ЧЕГО ТЫ ХОЧЕШЬ.</h1><p>${TEXT.ka.head.join(' ')}</p><p>${TEXT.hy.head.join(' ')}</p></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    out('assets/qr/og.jpg', await page.screenshot({ type: 'jpeg', quality: 86 }));
  }
  await browser.close();
  if (failed) { console.error(`${failed} QR view(s) could not be read`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
