# Milestone 16 — Themes 2.0: richer themes, animations, 3D backgrounds, theme sharing (Phases 165–172)

Planned 2026-10-16 from the owner's request (chat, after release 0.1.13). Ships as version **0.1.14** (Phase 172). Anything the owner did not state is marked **[A]** (unconfirmed assumption: say so in the phase log). Phase 69 (RELEASE GATE) still runs AFTER the last feature phase. Independent of Milestone 15; sharing (170-171) uses the shared-notebook Supabase of Milestone 12.

**Testing rule (owner, explicit):** no full test-suite runs in this milestone (see `CLAUDE_MUST_READ.md` 10k). **DO NOT RUN THE FULL TEST SUITE: never `npm test`, never a bare `npx vitest run`, never the whole `src` folder. Run ONLY the required tests.** `npm run typecheck` once plus ONLY the test files you wrote/changed and the ones likely to conflict. Name them in the phase log; list everything not run. No build, no dev server, no "double or triple checks".

## 1. What the owner wants

1. A theme file added on one PC should reach the other branches automatically and land in their own `themes` folder (so it shows in their theme picker).
2. Custom themes are too limited today: allow much more customisation, animations, and even Three.js (3D) backgrounds.

## 2. What exists today (read from the code, 0.1.13)

- A custom theme is a drop-in JSON in `%LOCALAPPDATA%\Quot3\themes\` read by `main/services/themeService.ts` (untrusted: size-capped, `validateTheme` in `shared/theme/validateTheme.ts`).
- The file is FLAT: `{ id, name, base?, tokens: { "--token": "value" } }`. Only whitelisted token names (`shared/theme/tokens.ts`); numeric tokens are clamped (`CLAMPS`); values may not contain `url(`, `;`, braces, `<>`, `@`, `expression`, `import`, `image-set`, etc.; max 200 tokens, 200 chars each.
- Applied by `renderer/theme/ThemeProvider.tsx`; Settings > Themes is `ThemesSection.tsx`. Rules from earlier milestones: every built-in theme defines every token (parity test), glass/blur never on the grid, print is never themed (`CLAUDE_MUST_READ.md` 10d).
- CSP is strict (`main/security.ts`); the renderer is sandboxed with no Node.

## 3. Design rules

1. **A theme is DATA, never code.** No JavaScript, no shader source, no HTML/CSS text from a theme file may ever execute. This is the main security rule because shared themes would travel to every branch. Three.js scenes, shaders and animation presets are written in the app and shipped with it; a theme only PICKS one by name and gives validated parameters (numbers, colours, enums).
2. **Schema v2, backward compatible.** Add `schema: 2` and optional sections next to the existing `tokens`: `gradients` (named, built from validated colour stops + angle, no `url()`), `fonts` (names from a bundled / system-safe list [A]), `shape` (radii, border widths, shadow presets), `effects` (animation preset names + intensity / speed), `background` (scene name + parameters). A v1 file (no `schema`) keeps working unchanged. Unknown keys are ignored with a warning; hostile or out-of-range values are rejected or clamped exactly like today. Validation stays pure in `shared/theme/`.
3. **New tokens always have defaults** in `tokens.css`, so every old theme and every built-in still passes the parity test.
4. **Animations** come from a registry of named presets (page transitions, hover/press motion, accent glow, subtle ambient motion). Each has a speed, an intensity and an on/off. They respect the existing reduce-motion setting and a new master switch "Visual effects" (Settings). **Never on the grid or print.**
5. **Performance budget stays** (`CLAUDE_MUST_READ.md` 5.6): nothing on the keystroke path; effects run on their own layer (CSS transforms/opacity, or a canvas behind the chrome with `pointer-events: none`). Pause animation and 3D when the window is hidden, minimised or in the tray (background mode, Milestone 15), cap the frame rate [A: 60 fps], and fall back to the plain theme when WebGL fails or a frame budget is blown. Do not claim a frame rate without a measurement on a real PC.
6. **Three.js:** one pinned dependency (`DEPENDENCY_VERSIONS.md` first, exact version, installed once). Loaded lazily only when the active theme asks for a scene. The scene registry lives in the renderer; no network, no remote assets, no `eval`/`new Function`; CSP is checked and only relaxed if truly required (record why). A theme that names an unknown scene falls back to no background with a warning.
7. **Images in themes:** NOT in this milestone [A] (`url()` stays forbidden). Backgrounds are procedural scenes and gradients only.
8. **Sharing (170-171):** the other branches get the theme JSON through the existing shared-notebook Supabase, not a second channel. Rules of Milestone 12 apply: server work = new numbered SQL file only (never edit a file the owner has run), RLS own-organisation select only, RPC-only writes, no `service_role`, never run against a real Supabase from the sandbox ("works on Supabase" is a standing gap). A received theme is validated like a local file; a bad one is set aside, never applied, never breaks the look. Same theme id = newer `edited_at` wins and the older version is kept (server history); nothing is silently deleted; removing a shared theme is local to that PC [A]. Size cap per theme [A: 64 KB]. Sharing is OFF by default (Settings toggle) [A]. A reader older than a theme's `min_reader_ver` sets it aside ("Update the app to use N themes").
9. **Rules kept:** format registry untouched, Phase 92 selector rule for any new store, Zod-validated IPC through `window.quot3`, renderer imports nothing from Electron/Node/main, Windows-only, tokens only in UI (no hard-coded colours outside tokens), no emoji in the UI.

## 4. Standing gaps (only a real PC shows these)

How the effects and 3D look and perform on a mid-range office PC, WebGL availability, behaviour with the window hidden / tray, and theme sharing against a real Supabase (sync has never been exercised against a real project from the sandbox).

## 5. Theme creation guide for Claude (owner request)

The owner wants to give the whole project zip to a Claude session, describe a theme in words, and get finished theme JSON files back. `docs/THEME_CREATION_GUIDE.md` is that instruction file (v1 format that works today, the token catalogue, design and contrast method, hand-back rules, and a DRAFT section 8 for Themes 2.0), `tools/check-theme.mjs` is the checker it uses (real `validateTheme` + the contrast rules; needs only `esbuild`), and `docs/themes/example-midnight-gold.json` is a worked example that passes. **Phase 165 must rewrite section 8 of the guide to the final schema and extend the checker and the example for v2; Phases 167 and 169 update the preset / scene lists; Phase 172 confirms the guide, checker and example all agree with the code (run the checker on the example and on one v1 theme).**

## 6. Order

165 -> 166 -> 167 -> 168 -> 169 (3D, can wait) -> 170 -> 171 (sharing, can run any time after 165) -> 172. The owner may ship 165-168 first (0.1.14 without 3D / sharing) by moving the gate; if so, say so in the Phase 172 log. Each phase is small enough for one session.
