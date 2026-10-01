# Street QR posters (A4)

One design, three languages (Georgian, Armenian, Russian), one QR per poster spot.
The QR holds our own URL directly — no shortener, no redirect:

```
https://xugushik-source.github.io/Pivka-dlya-ryvka-/qr/?utm_source=street_qr&utm_medium=offline&utm_campaign=guys&spot=001
```

## Files for spot 001

| File | Use |
| --- | --- |
| `street-qr-a4-spot-001.pdf` | Print shop: 216 × 303 mm = A4 + 3 mm bleed on every side, vector, fonts embedded |
| `street-qr-a4-spot-001-no-bleed.pdf` | Office printer: exact A4 210 × 297 mm |
| `street-qr-a4-spot-001.png` | 300 dpi raster with bleed (2551 × 3579 px) |
| `street-qr-a4-spot-001.svg` | Source of the design (fonts embedded) |
| `street-qr-a4-spot-001-preview.jpg` | Preview for chats |
| `../assets/qr/qr-spot-001.svg` / `.png` | The QR alone (vector / 2048 px), with its white quiet zone |

QR: error correction **Q** (survives ~25 % damage), version 9, 53 × 53 modules, code 110 mm wide
(2.08 mm per module) plus a 4-module white quiet zone. Nothing is printed inside the quiet zone.

## Another poster spot

```
npm install
npm run generate:qr -- --spot=002
```

Spots 1…999 (written as 001…). Same design and text; only the QR changes. Every run renders the poster and then
reads the QR back from the print PNG — full sheet, small (≈1 m away), blurred, tilted 20–25° and in dim light — and
fails if any view does not return exactly the poster URL. `--og` also rebuilds `assets/qr/og.jpg` (the neutral link
preview of `/qr/`). Chromium: the script uses `CHROME_PATH` if set, otherwise Playwright's own browser.

## Fonts

Noto Sans (Cyrillic/Latin), Noto Sans Georgian and Noto Sans Armenian, weight 900, in `fonts/` (SIL Open Font
License, `fonts/OFL.txt`). Characters outside them stop the generator, so no □ boxes can reach print.
The Armenian text is the owner's wording; «ՄԱՆՉԵՐ» is written with Չ (U+0549), and the generator refuses Ջ.

## Before a big print run

Print spot 001 on A4 and scan it with iPhone Camera, Android Camera and Google Lens: close up, from about 1 m,
at a slight angle, in average light. The generator's checks are simulations; the sheet in hand is the real test.
