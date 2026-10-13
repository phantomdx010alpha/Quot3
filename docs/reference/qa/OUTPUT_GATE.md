# OUTPUT GATE (Phase 40) - Milestone 4 sign-off

Harness: `src/main/print/__tests__/outputGate.test.ts` (real headless Chromium + poppler + Playwright, loaded by path; skips when absent). Every PAPER_ENGINE_RULES §6 row goes model -> paper decision -> measured safety net -> A4 density fit -> HTML -> real PDF -> real image crop. Regenerate the samples here with `QUOT3_QA_DIR=<this folder> QUOT3_IMAGE_SAMPLES=<this folder> npx vitest run src/main/print/__tests__/outputGate.test.ts`.

**Signed CONDITIONALLY**: everything below was proven in headless Chromium, not in Electron, not on a printer, not through the Windows clipboard. The owner must still look at the samples and print/paste once.

| Gate item | Result | Evidence |
|---|---|---|
| A5 default correct | PASS | matrix rows 40/0, 30/0, 10/2, GST 10/0 -> A5, 1 PDF page, 148 x 210 mm |
| 40/41/80/81 and 30/31/70/71 boundaries | PASS | decision AND real PDF page count equal (41/80 rough = 1 A4 page, 81 = 2; 31/70 pro = 1, 71 = 2) |
| Extra-col warning + ack | PASS | 3 extras non-GST -> A4, `requiresAck`, "More than 2 extra columns" (dialog Y/ack flow: Phase 37 jsdom tests) |
| GST with extras -> A4 + warning | PASS | GST 10 rows + 1 extra -> A4, `requiresAck`, "GST bills with extra columns print on A4" |
| No overflow in worst fixtures | PASS (Chromium) | name120 / header40 / gstExtra3 / longText on A4, both modes: PDF stays 210 mm wide, totals present; Phase 35 layout suite (nothing outside the sheet) |
| Repeated headers on A4 page 2 | PASS | 81 rough and 71 pro rows: header on every page, Total only on the last page |
| ₹ glyph everywhere | PASS (output only) | PDF text contains it (rough + professional), Noto Sans embedded; image: font loaded + ink in the total cell |
| Image tightly cropped | PASS | every matrix row: PNG size = planned size, ink margins <= 12 CSS px padding (+1 px) on all four sides, scale >= 2; 150 rows = one tall image |
| Professional has PO + company block, rough has neither | PASS | pdftotext of both modes |
| Rough has no party address | PASS | rough text has the party name but not the address; professional has it |

## Defects found and fixed by this gate
1. **80 rough / 70 professional rows did not fit ONE A4 page** (the engine said 1 page; real PDFs had 2). The Phase 33/35 carry-forward ("a denser type tier is needed"). Fixed with **A4 density tiers** (`A4_DENSITY_TIERS`, 9 pt -> 5.5 pt): a bill the engine puts on one A4 page is measured and rendered at the least dense tier that fits (`fitDensity`), in `PrintService.resolve`, so print, PDF, image and the dialog preview all agree. 50 rows + 3 extra columns (wrapping) was the same defect.
2. Image right padding clipped (found in Phase 39's first real run) - window is printable width + 2 x padding.

## Owner look-review
Samples: `pdf-*.pdf` (rough 40 rows, rough 80 rows on one A4 page, rough 81 rows on two, pro 31, pro 70 on one A4 page, GST + 1 extra) and `image-*.png`. **Please check the 80 / 70-row single-page prints for readability** (smallest type is 5.5 pt); if too small, the alternative is accepting 2 pages above ~60 rows - say so and the tiers/limits change in two constants files.
