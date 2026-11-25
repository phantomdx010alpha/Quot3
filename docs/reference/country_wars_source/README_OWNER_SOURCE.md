# Owner's Country Wars game, copied 2026-11-24 as the INPUT of Phase 277

`country-wars.html` is ONE self-contained file (about 200 KB): canvas game, inline SVG flags (201 country codes in `FLAGSVG`), Web Audio, `localStorage` for stats and settings, no `fetch`.
Outside requests it makes (all blocked inside the Quot3 game frame, so Phase 277 must remove or vendor them): Google Fonts (`Lilita One`, `Nunito`) and a `flagcdn.com` fallback image for any country code that has no inline SVG.
The game is the OWNER'S OWN work (owner confirmed 2026-11-24). It is not from an open-source repo, so it needs the "own game" manifest rule of Phase 277.
