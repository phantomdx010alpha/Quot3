# CALCULATOR_PANEL_RULES — Quot3 (Milestone 8, Phases 82–83)

Owner request (post-Phase-68): a small collapsible window above the bottom bar on the Create page with two switchable modes: (1) a horizontal, simplistic calculator like the one Tally opens, (2) a % calculator for the active quotation's grand total.

## 1. Placement and behaviour
- Collapsible drawer directly above the bottom bar on Create (and View). Closed by default on first run; open state and mode persist in `uiPrefs` (`calc.open`, `calc.mode`).
- Toggle key: **proposed Alt+C** (Ctrl+N is taken by New bill). Phase 83 MUST run the shortcut-conflict test and may pick another key; record the final key in `KEYBOARD_CELL_RULES.md`.
- Esc closes the drawer and returns focus to the previously active grid cell. Opening focuses the expression field.
- The panel is not undoable and never marks the bill dirty. It never writes into the grid. No on-screen keypad in v1 (open question for the owner).

## 2. Mode 1 — horizontal calculator
- One-line expression field plus a live result beside it. Enter commits: the result replaces the expression so the owner can continue (`=` semantics). Esc with text clears; Esc when empty closes.
- Engine: pure `shared/calc/*`, **decimal.js only**, hand-written tokenizer + recursive-descent parser. **No `eval`, no `Function`.**
- Operators: `+ - * / ( )` and unary minus; `x` and `×` accepted as `*`; `÷` as `/`; thousands commas stripped.
- `%` semantics (Tally/phone style): `a + b%` = a + a·b/100; `a - b%` = a − a·b/100; `a * b%` = a·b/100; standalone `b%` = b/100.
- Divide by zero and malformed input show an inline error state, never throw, never NaN.
- Result display uses the app money/number formatter; precision is not rounded by round-off.

## 3. Mode 2 — % calculator
- Shows the live active-bill grand total (after round-off when enabled).
- Preset chips default `18, 5, 3`, configurable in Settings (`calc.percentPresets`, comma list, validated 0 < p ≤ 1000, max 8 chips) plus a typed-% field.
- For each % shows three results: **% of total**, **total + %**, **total − %**. Copy-on-click per result.
- Updates live as the bill changes, without re-rendering the grid (subscribe to the derived total only).

## 4. Tests required (Phase 82/83)
Parser table tests (precedence, unary minus, `%` forms, commas, divide by zero, garbage); property test that results equal decimal.js reference; panel keyboard test (open, type, Enter chain, Esc returns focus); shortcut-conflict test; perf: opening the drawer must not change grid frame times.
