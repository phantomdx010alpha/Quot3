# MILESTONE9_DESIGN — Quot3 (Phases 92–106)

Written after Phase 91 from the owner's feedback on the running app (screenshot of History + diagnostics file, 2026-10-11). Phase 69 (RELEASE GATE) now runs after Phase 106. [A] = planner assumption, owner said 'yes' to the recommended options but did not spell them out; flip freely.

## 1. Settings > Sync and > License do not open (Phase 92)
Diagnostics: `Maximum update depth exceeded` from `BootstrapPanel` (logged 2026-10-10T20:06 and 2026-10-11T03:29). Reading the code: `BootstrapPanel.tsx` line 10 `useBackupStore((s) => s.list.filter((b) => b.kind === 'imported' && b.readable))` builds a new array every time the store is read; React's external-store check sees a "changed" value forever. Fix: select the stable list, filter in `useMemo`. Then audit every renderer store selector that returns a fresh array/object (also add a guard test). Not run: confirmed by code reading only.

## 2. History layout (Phase 93)
Owner screenshot: Bill No wraps to two lines ('Q3-' / '0728'), the 'Imported' badge overlaps the number, rows are taller than their fixed height so cells look shifted and neighbours overlap, selected row clipped. Fix = wider Bill No column, one-line cells, shared header/body geometry, badge placement that cannot overlap, tested at the minimum window width (1024 px).

## 3. Navigation model and Esc (Phases 94–95)
Today: `shared/routes.ts` is a stack of up to 50 pages; `navBack` pops one per Esc, so Esc keeps going back through everything, and the unsaved-work guard can fire for work that is already saved/cleared. Target [A]:
- Dashboard is the root. Esc on Dashboard: nothing.
- History / Customers / Settings: Esc -> Dashboard.
- A bill opened from History: Esc -> History.
- Create: Esc -> save/discard guard (only when there is real unsaved work) -> Dashboard.
- The stack can never go behind Dashboard; opening a page from the side rail replaces rather than stacks.
- Popups appear only for genuinely unsaved/unfinished work. Reproduce which popups before fixing (Phase 95).

## 4. Theme-aware scrollbars and title bar (Phases 96–98)
New required theme tokens: scrollbar track/thumb/hover/size, title bar bg/fg/symbol/hover, plus glass/space helpers. All go through the theme whitelist and parity test. Scrollbars: `scrollbar-color`/`scrollbar-width` + `::-webkit-scrollbar`, thin and rounded [A]. Title bar [A]: `titleBarStyle: 'hidden'` + `titleBarOverlay` keeps native Windows buttons and snap behaviour; main calls `setTitleBarOverlay` on theme change. Today the window has the default native frame.

## 5. Four new themes (Phases 99–103)
1. **Glossy Glass** — translucent, blurred chrome panels with light edges and gloss; a distinctive (non "generic AI") palette. Grid stays flat, opaque, >= 7:1 text contrast. Blur only on chrome, clamped for custom themes.
2. **Space** — non-neumorphic: flat/glow chrome, gradient-only background (no `url()`), raised/inset still distinguishable without colour.
3. **Red and Navy Blue** — own palette distinct from Navy Ember; `--rt-red` still >= 4.5:1.
4. **Red Deep-Black dark** — near-black, red accent.
Palettes are previewed to the owner before values are frozen. Print is never themed.

## 6. Extra-column Down key (Phase 104)
Bug: Down in an extra column at the bottom does nothing. [A] Fix only for extra columns: Down on the bottom-most editable row adds an extra-only tail row and moves into it (undoable, trimmed on save if empty, no effect on paper rows until it has content). Other columns unchanged.

## 7. HD image scale (Phase 105)
Diagnostics (every copy): wanted 4x, expected 2160 px wide, got 675 px, effective scale 1.25 (also 2976 vs 930). Phase 72's verify-by-measuring step caught it; the device scale factor override is not applied in the render window on the owner's Windows setup (display scaling 125%). Diagnose then fix; keep fallback and `IMAGE_MAX_PX`.

## 8. Order and gates
92 (blocking crash) -> 93 -> 94 -> 95 -> 96 -> 97 -> 98 -> 99-102 -> 103 -> 104 -> 105 -> 106 (QA gate) -> Phase 69.

**Update (2026-10-11):** Phase 69 now follows Milestone 10 (Phases 107–115, `docs/ITEM_SORTER_SPEC.md`).
