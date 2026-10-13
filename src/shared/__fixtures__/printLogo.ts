/** Phase 34 - a wide sample logo (SVG data URL, 400x120) to exercise the logo scaling rules in tests and /dev/print-preview. */
export const SAMPLE_LOGO_WIDE = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120"><rect width="400" height="120" rx="14" fill="#1b2a4a"/><text x="200" y="76" font-family="Arial" font-size="48" font-weight="700" text-anchor="middle" fill="#ffffff">ACME</text></svg>')
/** A tall sample logo (120x300) - the height cap must win. */
export const SAMPLE_LOGO_TALL = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="300" viewBox="0 0 120 300"><rect width="120" height="300" fill="#8a1c1c"/></svg>')
