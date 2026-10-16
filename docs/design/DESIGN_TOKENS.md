# DESIGN_TOKENS — Quot3

Owner direction: **neumorphism, deep navy blue, light-red accents, premium and smooth** — but **compact and dense like Excel/Tally** on work screens. Neumorphism is applied to *chrome* (panels, buttons, inset input wells, dashboard cards). The **grid is flat and high-contrast** so text stays legible at 26px row height.

All tokens live in `src/renderer/styles/tokens.css` as CSS custom properties on `:root[data-theme="…"]`. Components reference tokens only. Phase 3 creates the file and the theme loader; this doc is the spec.

## Token groups

| Group | Tokens (examples) |
|---|---|
| Surfaces | `--surface-base`, `--surface-raised`, `--surface-inset`, `--surface-grid`, `--surface-grid-alt`, `--surface-header` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-on-accent`, `--text-danger` |
| Accent | `--accent`, `--accent-hover`, `--accent-active`, `--accent-soft` (tint), `--focus-ring` |
| Semantic | `--ok`, `--warn`, `--danger`, `--info` |
| Grid | `--grid-line`, `--grid-active-border`, `--grid-active-bg`, `--grid-active-row-bg` (Phase 78: whole active row, set by the `data-active-row` DOM attribute), `--grid-range-bg`, `--grid-override-marker`, `--grid-marked-underline`, `--grid-adjustment-bg`, `--grid-total-bg` |
| Rich-text | `--rt-red` (the "red" used by Red+Bold), `--rt-highlight` |
| Neumorphic shadows | `--shadow-raised` (dual: light top-left + dark bottom-right), `--shadow-inset`, `--shadow-pressed`, `--shadow-dist`, `--shadow-blur` |
| Shape | `--radius-sm/md/lg`, `--border-width` |
| Spacing | `--space-1 … --space-8` (4px base) |
| Density | `--row-height` (26px), `--grid-font-size` (13px), `--bar-height` (≤ 72px detail bar), `--bottom-bar-height` (≤ 44px) |
| Type | `--font-ui`, `--font-grid` (tabular-nums), `--font-print`, `--text-xs … --text-xl` |
| Motion | `--ease-out`, `--dur-fast` (80ms), `--dur-base` (140ms); all transitions reference these; `prefers-reduced-motion` zeroes them |
| Scrollbar (Phase 96) | `--scrollbar-track`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-size` (clamped 6-16px). Applied by Phase 97. |
| Title bar (Phase 96) | `--titlebar-bg`, `--titlebar-fg`, `--titlebar-symbol`, `--titlebar-hover`, `--titlebar-height` (clamped 28-40px). Applied by Phase 98 (`titleBarOverlay`). |
| Glass / background (Phase 96) | `--surface-glass` (translucent chrome fill), `--glass-blur` (clamped 0-24px; built-ins 0px), `--glass-border`, `--bg-image` (url-free gradient or `none`). Chrome only - never the grid. |
| Z-index | `--z-grid`, `--z-popover`, `--z-modal`, `--z-toast` |

## Default theme: "Navy Ember" (dark)
Indicative values (Phase 3: the final values live in `src/renderer/styles/tokens.css`, the single source of truth; `src/__tests__/tokensParity.test.ts` enforces whitelist parity and the contrast rules below):
```
--surface-base:   #0F1A2E   /* deep navy */
--surface-raised: #14233D
--surface-inset:  #0B1424
--surface-grid:   #101C32
--surface-grid-alt: #12203A
--text-primary:   #E6ECF7
--text-muted:     #8FA0BD
--accent:         #FF7B7B   /* light red */
--accent-hover:   #FF9494
--accent-soft:    rgba(255,123,123,.14)
--rt-red:         #FF5A5A   /* Red+Bold text colour; must meet 4.5:1 on --surface-grid and on white print */
```
Contrast rule: body text ≥ 4.5:1, grid text ≥ 7:1 on `--surface-grid`. Neumorphic shadow pairs are tuned so raised/inset states are distinguishable *without* relying on colour.

A **light theme** ("Paper") ships too (same token names), used to prove the swap works and for bright rooms.

**Glossy Glass (Phase 99, dark):** third built-in. Sea-glass teal ink with a warm amber accent (not purple/blue). Chrome (side rail, dialogs, title strip edge) uses `--surface-glass` + `backdrop-filter: blur(var(--glass-blur))` (14px, inside the 0-24px clamp) + `--glass-border` and a gradient-only `--bg-image` behind the shell; rules live in `ui.css` under `:root[data-theme='glossy-glass']`, so custom themes with `base: glossy-glass` inherit them. Grid surfaces are solid and flat (text >= 7:1, measured 14-15:1). Palette is a judgement [A] pending owner preview.

**Space (Phase 100, dark):** fourth built-in. Black-blue void, electric-cyan accent, gradient-only starfield/nebula `--bg-image`, no blur. Non-neumorphic: Space overrides `--shadow-raised/-inset/-pressed` in its own block (outer ring + glow / inner ring + inner shade / heavier inner ring) so the states differ by shape, not just colour. Grid solid and flat (text 16:1). Palette [A] pending owner preview.

**Red and Navy Blue (Phase 101, dark):** fifth built-in. Royal navy surfaces (bluer/more saturated than Navy Ember) with a crimson accent `#ff4a5e`; `--rt-red` is a warm orange-red `#ff9a6c` kept far from the accent (>= 4.5:1 on the grid). Neumorphic like Navy Ember, no blur, no image. Palette [A] pending owner preview.

**Red Deep-Black (Phase 102, dark):** sixth built-in. OLED-friendly: near-black surfaces (inset is pure `#000000`), vivid red accent `#ff3b3b`, `--rt-red` salmon-orange `#ff8a6e` far from the accent. Neumorphic with a faint red-tinted light, no blur, no image. Grid text 17:1. Palette [A] pending owner preview.

## Print is not themed
Print/PDF/image output uses the **print token set** (`--print-*` in `print.css`), always black text on white regardless of UI theme, with `--rt-red` mapped to a print-safe red. The UI theme never leaks into output.

## Custom theme files (Phase 49)
Location: `%LOCALAPPDATA%\Quot3\themes\*.json`. Loaded at startup and on "Reload themes"; invalid files are skipped and reported in Settings.
```json
{
  "id": "my-theme",
  "name": "My Theme",
  "base": "navy-ember",
  "tokens": { "--accent": "#FFB347", "--surface-base": "#101010" }
}
```
- `base` (optional) inherits from a built-in; only listed tokens are overridden.
- Only whitelisted `--*` token names are accepted (anything else is ignored) and values are sanitised (no `url()`, no `expression`, length-limited) — a theme file must never be able to execute anything.
- `--bg-image` accepts gradients (`linear-gradient(...)`, `radial-gradient(...)`) but never `url()`; `--glass-blur` is clamped to 24px so a theme cannot make chrome repaint expensive. Every theme must define every token (parity test); a custom theme inherits the rest from its `base`.
- `--row-height` and font-size tokens are clamped to a safe range so a theme cannot break the 20-visible-rows rule.

## Theme schema v2 (Phase 165, Themes 2.0)
A theme file may add `"schema": 2` and the optional sections `gradients`, `fonts`, `shape`, `effects`, `background` next to `tokens` (format, limits and presets: `docs/THEME_CREATION_GUIDE.md` section 8; code: `src/shared/theme/schemaV2.ts`, `validateTheme`). A file without `schema` is v1 and validates exactly as before; `schema` > 2 is set aside ("needs a newer version"). Same hostile-value rules as tokens (no `url()`, `;`, braces, `<>`, `@`, `expression`, `import`): a hostile string anywhere rejects the whole file; out-of-range numbers clamp with a warning; an unknown scene / preset / font / slot / key is ignored with a warning and falls back. Colours in v2 sections are hex or `rgb()`/`rgba()` only. A theme only PICKS built-in presets, scenes and fonts by name; it never carries code. New tokens (defaults `none` in the bare `:root` block of `tokens.css`; set by Phase 166+ from the gradients / effects): `--gradient-shell`, `--gradient-panel`, `--gradient-accent`, `--accent-glow`. Chrome only: never the grid or print. Phase 165 validates; **Phase 166 applies `gradients` / `fonts` / `shape`** (`shared/theme/applyV2.ts` `v2ToTokens`: gradients -> `--gradient-*`, fonts -> `--font-ui` / `--font-grid`, shape presets -> `--radius-*`, `--border-width`, `--shadow-dist/blur`; the theme's own `tokens` win over them). `--gradient-shell` sits under `.q3-shell`'s `--bg-image`, `--gradient-panel` on the side rail, `--gradient-accent` on primary buttons (`ui.css`); `grid.css` never references them (test). **Phase 167 applies `effects`** (`shared/theme/effects.ts` resolver, `renderer/theme/effects.ts` sets `data-fx-*` attributes and app-owned `--fx-*` variables on `<html>`; `--accent-glow` is set only while glow is on; rules in `styles/effects.css`, all prefixed `html[data-fx-...]`, transform / opacity only, never the grid, Create page or print). Scenes: Phase 169.

## Rules for components
- No hex/rgb/px-shadow literals in component files; no inline style colours.
- Phosphor icons only; `light` for nav, `bold` for active/primary, `duotone` for empty states; sizes from tokens.
- No emoji.
- `focus-visible` ring on every interactive element (keyboard-first app).

**Milestone 8 (Phase 78, planned).** New token `--grid-active-row-bg`: background of the whole row containing the active cell on Create/View. Defined for every theme and added to the theme whitelist; applied through a DOM attribute on the row, no React re-render.

**Milestone 9 (Phases 96–103, planned).** New required tokens per theme: `--scrollbar-track`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-size`, `--titlebar-bg`, `--titlebar-fg`, `--titlebar-symbol`, `--titlebar-hover`, plus the glass/space helpers (`--surface-glass`, `--glass-blur`, `--glass-border`, `--bg-image` gradient-only). All join the theme whitelist and the parity test; blur is clamped for custom themes and never applied to the grid. Four new built-in themes: Glossy Glass, Space (non-neumorphic), Red and Navy Blue, Red Deep-Black. Scrollbars and the title bar strip are themed only through these tokens; print is never themed.

**Milestone 11 (Phase 126, planned).** Dashboard 'Today' tiles use existing surface/border/text tokens only (no new colour tokens); the tile grid is 3 columns on wide and 2 on narrow windows with the enabled-tile count reflowed so no tile is left alone on the last row; the 'offline' state uses `--text-muted`.

**Phase 171-172 (theme sharing).** No new tokens. A theme file received from another PC goes through the same `validateTheme` as a dropped file and lands in the themes folder only when valid (`docs/THEME_CREATION_GUIDE.md` unchanged: the file format did not change). Setting `themes.share` (default off) controls sending and receiving.
