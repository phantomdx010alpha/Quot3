# THEME CREATION GUIDE — for Claude (give Claude this whole folder as a zip and describe the theme you want)

**How the owner uses this:** zip the project folder, give it to a Claude session and say, for example: *"Read `docs/THEME_CREATION_GUIDE.md` and make me 3 themes: a warm sunset one, a clean light one for bright rooms, and a hacker-green one. Give me the finished theme JSON files."* Claude reads this guide, designs the themes, checks them with the real validator, and hands back ready-to-drop `.json` files.

**Where a theme goes:** copy the `.json` file into `%LOCALAPPDATA%\Quot3\themes\` on the PC (Win+R, paste that path, Enter), then Settings > Themes > Reload themes, then pick it. Invalid files are skipped and listed in Settings with the reason.

---

## 0. Rules for Claude in this task (read first)

- This is a THEME task, not an app change. Do NOT edit app code, `tokens.css`, tests or docs, do NOT bump the version, do NOT build. Output = theme `.json` files (plus a short note).
- **Do NOT run the full test suite. Do NOT run `npm test`, `npm install` of the project, `npm run build` or a dev server.** The only check you run is the one theme checker in section 5 (it needs only `esbuild`, installed in a temp folder).
- Do not read skill `.md` files. Read only this guide, and, when you need to double-check a detail, `src/shared/theme/tokens.ts`, `src/shared/theme/validateTheme.ts` and `docs/design/DESIGN_TOKENS.md`.
- Never put anything but plain theme data in a file (no scripts, no `url()`, no comments, no trailing commas: it must be strict JSON).
- Be honest about what you cannot see: you cannot open the app, so you cannot say how a theme looks on screen. You can only guarantee it passes the validator and the contrast rules. Say so.
- The owner's bills and customer data are private; none of it is needed for a theme. Never ask for it.

## 1. What is possible TODAY (version 0.1.13, "schema v1")

A theme is one flat JSON file that **overrides CSS colour / size tokens** on top of a built-in theme. In v1 it can NOT contain animations, Three.js, images, fonts files or any code. The only visual "effects" available are through tokens: colours, gradients in `--bg-image`, shadow strength, glass blur (only on a glass base, see 3.2), corner radii, spacing and density, font stacks, and the motion speeds.

If the owner asks for animations / 3D / richer sections: check whether `src/shared/theme/schemaV2.ts` exists in the project. If it does NOT, tell the owner plainly that Themes 2.0 is not built in this copy, deliver the closest v1 theme (strong gradient background, glow-like accent, custom shadows). If it DOES exist, follow section 8 (schema v2); note that the app may validate v2 sections before it applies them (see the status line of section 8).

## 2. The file format (v1)

```json
{
  "id": "midnight-gold",
  "name": "Midnight Gold",
  "base": "navy-ember",
  "tokens": { "--accent": "#e9b949", "--surface-base": "#12101c" }
}
```

| Field | Rule |
|---|---|
| `id` | required, 1-40 chars, only `a-z`, `0-9`, `-`, starts with a letter or digit, NOT one of the built-in ids (`navy-ember`, `paper`, `glossy-glass`, `space`, `red-navy`, `red-black`). It is also what the owner sees as the unique key: keep it stable, a new id = a new theme. |
| `name` | required, up to 60 chars, shown in the picker. |
| `base` | optional but ALWAYS set it. One of the six built-in ids. Anything the theme does not list is inherited from the base. Default if missing: `navy-ember`. |
| `tokens` | object of `"--token-name": "value"`. Max 200 entries, each value max 200 chars, strings only. Unknown token names are ignored with a warning. |
| file | `<id>.json`, UTF-8, under 64 KB, max 50 theme files in the folder. |

**A complete theme sets all colour tokens** (section 4). That is the rule for good themes: although missing tokens are inherited from `base`, a half-set palette mixes with the base's colours and fails contrast or looks muddy. List every colour token in section 4 for each theme. Size / shape tokens may be omitted to keep the base's.

**Value rules (hard, enforced by the validator):**
- Allowed characters only: letters, digits, spaces, `# . , % ( ) - + / * ' " _`. **Not allowed:** `;  { } < > \ @ ! :` and anything resembling `url(`, `expression`, `javascript`, `import`, `image-set`, `element(`, `attr(`, comments `/* */`.
- Parentheses must be balanced. Value must not be empty.
- Colours: 6-digit hex (`#1a2b3c`) for anything that must pass a contrast check (text, surfaces, accent, rt-red, scrollbar, title bar). `rgba(r, g, b, 0.14)` is fine for tints / overlays / glass / shadows.
- Numeric tokens must be a plain number with the right unit (`26px`, `140ms`), and are **clamped** (warning, not error) to the ranges in section 4.

## 3. Design method (do this for every theme)

1. **Understand the brief.** Mood, dark or light, accent colour, anything to avoid. If the owner's description is vague, pick sensible choices and state them; do not stall with questions unless the brief is contradictory.
2. **Pick the base** (3.2) that matches the mood. Then design the palette.
3. **Build the palette from a few decisions:** one hue family for surfaces (all neutrals tinted the same hue), one accent, one red for rich text, semantic colours (ok / warn / danger / info) readable on the surfaces. Keep surfaces close in lightness (the app is dense: layers are separated by subtle steps, not big jumps).
4. **Ordering of surfaces (dark theme):** `--surface-inset` darkest < `--surface-base` < `--surface-raised` lightest of the three; the grid surfaces sit near `--surface-base`; `--surface-header` slightly lighter than the grid. **Light theme:** mirror it (inset slightly darker than base, raised lighter, grid white or near white).
5. **The grid is flat and high-contrast.** Never use gradients, blur or translucent colours for `--surface-grid` / `--surface-grid-alt`. Alternate-row colour must be only a gentle step from `--surface-grid`.
6. **Check with the tool (section 5), fix, repeat until it prints `contrast ok` and `valid`.** Then deliver.

### 3.1 Contrast rules (the app's own tests hold built-in themes to these; hold yours to them too)
- `--text-primary` on `--surface-grid` and `--surface-grid-alt`: at least **7:1**.
- `--text-primary`, `--text-secondary`, `--text-muted` on `--surface-base`, `--surface-raised`, `--surface-inset`: at least **4.5:1**. (Muted text is the usual failure; do not make it too dim.)
- `--text-on-accent` on `--accent`: at least **4.5:1**.
- `--rt-red` (the Red+Bold text colour in item names) on `--surface-grid`: at least **4.5:1**, and clearly different from `--accent` so the two are not confused.
- `--scrollbar-thumb` and `--scrollbar-thumb-hover` on `--scrollbar-track`: at least **3:1**.
- `--titlebar-fg` and `--titlebar-symbol` on both `--titlebar-bg` and `--titlebar-hover`: at least **4.5:1**.
- Raised / inset / pressed states must be distinguishable by SHAPE (shadow direction), not colour alone (the app builds them from `--shadow-*`; do not make light and dark shadow colours identical).

### 3.2 Choosing `base` (this matters: it decides structural styling a custom theme cannot change)
| base | What the theme inherits besides colours | Pick it when |
|---|---|---|
| `navy-ember` | Neumorphic chrome (soft dual shadows), no blur, no image. The default and safest. | Most dark themes. |
| `paper` | Light colour scheme (`color-scheme: light`), neumorphic. | Any LIGHT theme. Always use this base for light themes, otherwise form controls and scrollbars render dark. |
| `glossy-glass` | Glass chrome: the side rail and dialogs use `--surface-glass` + `backdrop-filter: blur(var(--glass-blur))` + `--glass-border`, and a gradient `--bg-image` sits behind the shell. | Frosted-glass looks. Tune with `--glass-blur` (0-24px), `--surface-glass`, `--glass-border`, `--bg-image`. |
| `space` | Non-neumorphic ring and glow shadows, gradient starfield `--bg-image`, no blur. | Neon / flat-with-glow looks. |
| `red-navy`, `red-black` | Neumorphic with their own tuned palettes (red-black is OLED near-black). | When the theme is a variation of those. |

`color-scheme` (light / dark) comes from the base and cannot be set by a theme. Glass blur rules exist only for the `glossy-glass` base; on other bases `--glass-blur` has no visible effect.

### 3.3 Things a v1 theme cannot do (say so instead of faking it)
Animations, moving backgrounds, 3D (Three.js), image / logo / texture backgrounds (no `url()`), custom font FILES (only font stacks of fonts already on the PC), changing layout, hiding UI, themed print output (**print, PDF and image copy are never themed**: black on white always), different colours per page.

## 4. Token catalogue (the complete whitelist; defaults shown are Navy Ember, dark)

Colours (set ALL of these in every theme):

| Token | Meaning |
|---|---|
| `--surface-base` `#0f1a2e` | App background behind everything. |
| `--surface-raised` `#14233d` | Panels, buttons, cards (raised neumorphic surfaces). |
| `--surface-inset` `#0b1424` | Input wells, pressed areas (darkest in dark themes). |
| `--surface-grid` `#101c32` | Bill grid cell background. Flat, solid hex. |
| `--surface-grid-alt` `#12203a` | Alternate grid row. Solid hex, gentle step from grid. |
| `--surface-header` `#17284a` | Grid header row. |
| `--text-primary` `#e6ecf7` | Main text (also grid text). |
| `--text-secondary` `#b4c0d6` | Secondary text. |
| `--text-muted` `#8fa0bd` | Hints, placeholders (must still be >= 4.5:1). |
| `--text-on-accent` `#0f1a2e` | Text on accent-filled buttons. |
| `--text-danger` `#ff8a8a` | Error text. |
| `--accent` `#ff7b7b` | Primary accent. |
| `--accent-hover` `#ff9494` / `--accent-active` `#e85f5f` | Hover / pressed accent. |
| `--accent-soft` `rgba(255, 123, 123, 0.14)` | Accent tint for selected backgrounds. |
| `--focus-ring` `#ffb3b3` | Keyboard focus ring (keyboard-first app: must be clearly visible on every surface). |
| `--ok` `#5fd39a` `--warn` `#f2c14e` `--danger` `#ff8a8a` `--info` `#6cb4ff` | Semantic colours. |
| `--grid-line` `#263a5c` | Grid lines. |
| `--grid-active-border` `#ff7b7b` | Border of the active cell (usually the accent). |
| `--grid-active-bg` `#1b2f52` | Active cell background. |
| `--grid-active-row-bg` `#162a4a` | Whole active row background (subtle). |
| `--grid-range-bg` `rgba(108, 180, 255, 0.18)` | Multi-cell selection tint. |
| `--grid-override-marker` `#f2c14e` | Marker for an overridden total. |
| `--grid-marked-underline` `#6cb4ff` | Underline for marked cells. |
| `--grid-adjustment-bg` `#18294a` / `--grid-total-bg` `#1d325a` | Adjustment rows and total rows. |
| `--rt-red` `#ff5a5a` | The "red" of Red+Bold text. |
| `--rt-highlight` `#5a4a12` | Highlight background for rich text (text must stay readable on it). |
| `--border-color` `#2a4064` | General borders. |
| `--overlay` `rgba(4, 9, 18, 0.66)` | Dim layer behind dialogs. |
| `--shadow-light` `rgba(46, 72, 116, 0.55)` / `--shadow-dark` `rgba(3, 8, 16, 0.75)` | Light and dark halves of the neumorphic shadow. |
| `--scrollbar-track` `#0b1424` / `--scrollbar-thumb` `#5a78b0` / `--scrollbar-thumb-hover` `#7f9bd0` | Scrollbars. |
| `--titlebar-bg` `#0b1424` / `--titlebar-fg` `#e6ecf7` / `--titlebar-symbol` `#e6ecf7` / `--titlebar-hover` `#1b2f52` | The Windows title bar strip and its buttons. |
| `--surface-glass` `rgba(20, 35, 61, 0.72)` / `--glass-border` `rgba(230, 236, 247, 0.14)` | Translucent chrome fill and its border (visible only on the glass base). |
| `--bg-image` `none` | Background behind the app shell: `none` or CSS **gradients only** (`linear-gradient(...)`, `radial-gradient(...)`, several separated by commas). Never `url()`. Chrome only, never the grid. |

Shape, size and motion (optional; **clamped** to the range shown, out-of-range values are clamped with a warning):

| Token | Default | Allowed |
|---|---|---|
| `--shadow-dist` / `--shadow-blur` | `4px` / `10px` | 0-16px / 0-40px (strength of the neumorphic depth; 0 = flat) |
| `--glass-blur` | `0px` | 0-24px |
| `--radius-sm` / `--radius-md` / `--radius-lg` | `4px` / `8px` / `14px` | 0-24 / 0-24 / 0-32px |
| `--border-width` | `1px` | 0-3px |
| `--space-1` ... `--space-8` | `4px` ... `40px` | each 0-48px |
| `--row-height` | `26px` | **22-32px** (keeps at least 20 rows visible; do not go above 28 unless asked) |
| `--grid-font-size` | `13px` | 11-16px |
| `--bar-height` / `--bottom-bar-height` | `72px` / `44px` | 40-72px / 32-44px |
| `--text-xs` ... `--text-xl` | `11` `12` `13` `16` `22` px | xs 9-14, sm 10-16, base 11-18, lg 13-24, xl 15-32 |
| `--icon-sm` / `--icon-md` / `--icon-lg` | `14px` / `18px` / `28px` | 12-24 / 14-28 / 16-40 |
| `--scrollbar-size` | `10px` | 6-16px |
| `--titlebar-height` | `32px` | 28-40px |
| `--dur-fast` / `--dur-base` | `80ms` / `140ms` | 0-400ms / 0-600ms (animation speed of the existing transitions; "reduce motion" forces 0) |

Other whitelisted tokens (set only with a reason): `--shadow-raised`, `--shadow-inset`, `--shadow-pressed` (full box-shadow lists; by default derived from dist/blur/light/dark; override only for non-neumorphic looks like Space, using the allowed characters, e.g. `0 0 0 1px #00e5ff, 0 0 14px rgba(0, 229, 255, 0.35)`), `--font-ui`, `--font-grid`, `--font-print` (font stacks of fonts installed on Windows, e.g. `'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif`; keep `--font-grid` a clear, tabular-friendly sans; `--font-print` does not affect the printed bill), `--ease-out` (e.g. `cubic-bezier(0.22, 1, 0.36, 1)`), `--z-grid`, `--z-popover`, `--z-modal`, `--z-toast` (**leave alone**).

## 5. Check every theme (required before delivering)

The checker is in the project: `tools/check-theme.mjs`. It runs the app's real `validateTheme` and the contrast rules of 3.1. It needs only `esbuild` (not the project's dependencies):

```bash
mkdir -p /tmp/thm && cd /tmp/thm && npm init -y >/dev/null && npm i esbuild      # once
cd /tmp/thm && node <project>/tools/check-theme.mjs <project> <path-to-theme.json>
```

It prints `valid`, one `ok` / `FAIL` line per contrast rule and ends with `contrast ok` or `N CONTRAST FAILURES` (exit code 1 on invalid / failure). Fix and re-run until clean. A token you did not set prints `SKIP` (it inherits the base): that is a sign to set it. Run it once per theme, not repeatedly. A worked example that passes: `docs/themes/example-midnight-gold.json` (dark, gold accent, gradient background, all colour tokens set).

## 6. What to hand back

- One file per theme: `<id>.json` (strict JSON, 2-space indent, trailing newline), sent to the owner with SendUserFile; if the owner asked for several themes, send them all, and also a single zip if there are more than three.
- A SHORT note per theme: name, base and why, the accent / surface hex values, the checker's result (`valid`, `contrast ok`, smallest contrast ratio), and anything clamped.
- Say clearly that it was not seen in the real app, and give the 3 steps to install (copy to `%LOCALAPPDATA%\Quot3\themes\`, Settings > Themes > Reload themes, pick it). Suggest the owner check: the Create grid (text, active cell, range selection), a dialog, the title bar buttons, scrollbars, and the keyboard focus ring.
- If the owner wants changes ("warmer", "less contrast on lines"), edit the same file, keep the same `id`, re-run the checker.

## 7. Common mistakes (check before delivering)

- Light theme with a dark base (use `paper`). A neon theme on `navy-ember` expecting glow shadows (override `--shadow-*` or use `space`).
- `--text-muted` too dim; `--rt-red` too close to `--accent` or low on the grid; `--focus-ring` invisible on the accent.
- `rgba()` or gradients on `--surface-grid` / `--surface-grid-alt` (keep solid hex).
- Setting `--row-height` far from 26px (clamped to 22-32 anyway).
- Using `url()`, `;`, `:`, `@`, braces or `!important` in a value (the whole file is rejected).
- Reusing a built-in `id`, or changing the `id` of a theme the owner already uses (it becomes a different theme).
- `--glass-blur` on a non-glass base (no visible effect).
- A comment or trailing comma in the JSON.

## 8. Themes 2.0 (schema v2): FILE FORMAT FINAL (Phase 165); the app APPLIES it from Phases 166-169

**Status (Phase 165):** the v2 format below is final and `validateTheme` accepts it (`src/shared/theme/schemaV2.ts` is the authority; if it disagrees with this text, the code wins, tell the owner). **Since Phase 166 the app APPLIES `gradients`, `fonts` and `shape`** (gradients only on chrome: the page behind everything, the side rail and primary buttons; never the grid or print). **Since Phase 167 the app also applies `effects`** (animation presets, section table below). **Since Phase 169 the app also draws `background` scenes** (Three.js, built into the app). Settings > Themes shows a larger preview (with the gradients), the loading warnings, and exports the active theme's sections in "Export current theme as a starter file". Animation presets are final in the names below (Phase 167 adds their detailed parameters here); 3D scene names are final (Phase 169 adds their detailed parameters here).

A v2 file is the v1 file plus `"schema": 2` and optional sections. A v1 file (no `schema`) keeps working unchanged; sections in a file without `"schema": 2` are ignored. `"schema": 3` or higher is rejected ("needs a newer version of Quot3").

```json
{
  "schema": 2, "id": "aurora-v2", "name": "Aurora (v2 example)", "base": "navy-ember",
  "tokens": { "--accent": "#5fe0b8" },
  "gradients": { "shell": { "kind": "linear", "angle": 160, "stops": [["#0b1220", 0], ["#10213d", 100]] } },
  "fonts": { "ui": "segoe-ui", "grid": "consolas" },
  "shape": { "radius": "soft", "border": "thin", "shadow": "soft" },
  "effects": { "pageTransition": { "preset": "fade-slide", "speed": 1 }, "accentGlow": { "intensity": 0.4 } },
  "background": { "scene": "particles", "colors": ["#5fe0b8", "#7db7ff"], "density": 0.5, "speed": 0.3, "intensity": 0.5 }
}
```
In the Settings preview and in the app, a theme that cannot be applied falls back to its base built-in look. A full worked file that passes the checker: `docs/themes/example-aurora-glass-v2.json`.

**Rules for every section (enforced):** only plain data; a hostile string anywhere (`url(`, `;`, braces, `<>`, `@`, `expression`, `import`, `javascript`, comments) rejects the WHOLE file. Out-of-range numbers are clamped with a warning. An unknown name (scene, preset, font, gradient / effect slot, key) is ignored with a warning and falls back (no background, preset "none", base font). Colours in v2 sections: hex (`#rgb`, `#rrggbb`, `#rrggbbaa`) or `rgb()` / `rgba()` only (no names, no `var()`).

| Section | Fields and limits |
|---|---|
| `gradients` | slots `shell` (page behind the chrome), `panel` (panels / cards), `accent` (buttons / highlights; text on it is `--text-on-accent`). Each: `kind` `"linear"` (default) or `"radial"`; `angle` 0-360 (default 180, linear only); `stops` = 2-6 pairs `[colour, position 0-100]` (sorted by position). Chrome only: never applied to the grid or print. Keep every stop dark enough / light enough for `--text-primary` (checker enforces 4.5). Becomes `--gradient-shell` / `--gradient-panel` / `--gradient-accent` (default `none`). |
| `fonts` | slots `ui`, `grid` (print is never themed). Value = a name from: `system`, `segoe-ui`, `calibri`, `arial`, `verdana`, `tahoma`, `trebuchet`, `georgia`, `cambria`, `consolas`, `cascadia-mono`, `courier-new`. No font files, no remote fonts. Prefer a mono / clean font for `grid`. |
| `shape` | `radius`: `sharp` / `soft` / `round`; `border`: `none` / `thin` / `normal` / `thick` (0 / 1 / 2 / 3 px); `shadow`: `flat` / `soft` / `strong`. They set the matching `--radius-*`, `--border-width`, `--shadow-dist/blur` tokens; if you also list the same token in `tokens`, the explicit `tokens` entry wins [A, confirmed when Phase 166 applies it]. |
| `effects` | slots and preset names (`none` always allowed): `pageTransition`: `fade`, `fade-slide`, `zoom-fade`; `hoverMotion`: `lift`, `press`, `glow`; `ambient`: `breathe`, `drift`, `shimmer`; `accentGlow`: no preset, `intensity` only. Each slot takes optional `preset`, `speed` 0.25-3 (1 = normal), `intensity` 0-1. Chrome only, never the grid or print; the owner can switch all effects off in Settings and reduce-motion always wins. Presets and what they do (all chrome only; speed 1 = base duration, duration = base / speed): `pageTransition` (only pages without the grid, e.g. Dashboard / Settings; base ms): `fade` 180, `fade-slide` 240 (rises 8 px), `zoom-fade` 220; `hoverMotion` on buttons, icon buttons and the side rail (`intensity` 0-1, default 0.5): `lift` (up to 4 px), `press` (shrinks up to 6 % while pressed), `glow` (soft accent glow up to 14 px); `accentGlow` (primary buttons; `intensity` 0-1, 0 = off, up to a 20 px blur); `ambient` (a slow soft accent wash on the side rail only; base ms): `breathe` 6000, `drift` 9000, `shimmer` 7000, `intensity` 0-1 scales an opacity capped at 0.35, never faster than 1.5 s per cycle. Effects are OFF when the owner's "Visual effects" setting (`effects.enabled`, default ON) is off, when Windows reduce-motion is on, and they pause while the window is hidden. |
| `background` | `scene` (final list, built into the app since Phase 169; a theme cannot supply shaders or code): `none`, `particles`, `waves`, `gradient-mesh`. An unknown name loads with a warning and shows no background. `colors`: 0-4 colours (hex or rgba; alpha ignored; none given = the scene's own defaults). `density` 0-1 (default 0.5), `speed` 0-2 (default 0.3), `intensity` 0-1 (default 0.5). Drawn behind the chrome, never behind the bill grid (Create page: hidden), paused when the window is hidden / minimised / in the tray / not focused, switched off by the owner's "Visual effects" and "3D backgrounds" switches or Windows reduce-motion, and dropped to the plain look if WebGL is unavailable or the PC is too slow. No images. |

**Scenes and what each parameter does (Phase 169):**

| Scene | Look | `colors` | `density` | `speed` | `intensity` |
|---|---|---|---|---|---|
| `particles` | Slowly drifting glowing dots | dot colours, used in turn (1-4) | 40 to 1200 dots | drift speed | dot brightness |
| `waves` | A rolling wire grid seen at a slant | the first two blend into the line colour | 16 to 64 grid segments | wave speed | wave height and line brightness |
| `gradient-mesh` | Large soft colour blobs that slowly move | 2-4 blob colours (2 minimum are used) | not used | blob speed | how strong the colour is (it stays see-through) |

Design advice: keep `intensity` at 0.6 or less so text on the page stays readable (the checker cannot measure contrast against a moving background; the chrome keeps its own solid colours), prefer 2-3 colours from the theme's palette, and check the theme still looks right with 3D switched off. Example: `docs/themes/example-aurora-waves-3d.json`.


**The owner can override effects on their own PC (Phase 168).** Settings > Themes > Visual effects has a master switch (Ctrl+Alt+E), per-effect on/off and strength sliders, and "pause when the window is not focused". These saved settings are applied OVER whatever the theme says and can only switch off or re-strengthen an effect the theme already uses, so design each theme to look right with its effects at the values you choose AND with them all off (the plain look). A theme file never carries these choices.

**Not possible in v2 (say so if asked):** images / `url()`, custom shaders or scripts, font files, effects on the grid or print, per-page backgrounds. Sharing a theme between PCs (Phases 170-171) uses this same JSON, so a theme must be valid on its own (no references to files on one PC).

**Checker:** the same command as section 5 now also prints the v2 summary (`v2 sections: gradients=3 fonts=2 ...`) and checks that `--text-primary` has contrast >= 4.5 on every `shell` / `panel` gradient stop and `--text-on-accent` on every `accent` stop (6-digit hex stops only). Run it once per theme.
