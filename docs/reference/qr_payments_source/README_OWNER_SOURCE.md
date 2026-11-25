# Owner's original QR page (ank-meen-qr), copied 2026-11-24 as the SOURCE OF TRUTH for Milestone 25 Payments

Files: `index.html` (all logic: `BANKS`, `ACCOUNTS`, `buildUpiUrl`, `generateQR`, `buildComposedImage`, full-screen view), `manifest.json`, `sw.js`, `Logo MB.jpg`.
The default payees and the three URL shapes (merchant / plain UPI ID / bank account `account@IFSC.ifsc.npci`) must be reproduced EXACTLY by Phase 279 (tests compare the produced URL text with the original's output for the default payees).
The original loads `qrcodejs` from a CDN; the phone app bundles its own QR library instead (design `docs/MILESTONE25_DESIGN.md`, section 5). This folder is reference only: nothing here is shipped or imported.
