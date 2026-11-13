# M23 owner checklist (UNFILLED) — Price List, billing auto-rate, seat permissions, activity log, "by hand", case button

Written in Phase 249 (release 0.1.55 [A]). **Nothing below was verified by Claude.** The sandbox has no Windows, no Android phone and no Supabase; every box is for the owner to tick on the real thing. After ticking, record the date and any failure in `PHASE_STATUS.md` -> STANDING GAPS. Use invented names for any test data you type; never paste real customer data into a chat.

Result key: tick `[x]` = worked, write `FAIL:` and what you saw if not.

## 0. Before you start
- [ ] Installed Quot3 shows version 0.1.55 (Settings > Updates).
- [ ] Phone app opened from the `pwa` deployment and shows 0.1.55 in About (accept the "reload" prompt).
- [ ] Supabase: `supabase/sql/18_price_list.sql`, then `19_price_perms.sql`, then the activity-log file were each run ONCE, in that order (see `docs/SUPABASE_MIGRATIONS.md` checklist G). Date run: ______ Region: ______
- [ ] Nothing else changed: with the Price List switched OFF and AI OFF the app behaves exactly like 0.1.52 (billing, grid, print, sync of bills and customers).

## 1. Desktop: legacy import (needs the owner's `bills_data.db`, never committed)
- [ ] Settings > Price List > Import: pick the legacy folder; the preview shows tabs, categories and row counts that match the old software.
- [ ] Import runs once; running it again does not create duplicates.
- [ ] An item edited after import is not overwritten by a re-import.

## 2. Desktop: Price List page and feel
- [ ] Open the Price List; categories and tabs show; the page remembers where you were (Esc goes back).
- [ ] Search finds an item by any words of its name (no AI).
- [ ] Add / edit / delete an item, a tab, a category, a price level; Undo works where it should.
- [ ] Typing, arrow keys and PageUp / PageDown feel smooth with 1000+ rows.

## 3. Billing auto-fill (GST and non-GST)
- [ ] GST bill: type an item name that is in the list, leave the cell; the rate fills from the right price level for that format; one Ctrl+Z removes it.
- [ ] Non-GST bill: same, with its own level.
- [ ] A rate you typed yourself is never overwritten; opening a saved bill never changes it.
- [ ] Strip mode: the match strip shows the match and its levels; Auto fills only in Auto mode.
- [ ] Off mode (Price List off): billing is exactly as before, no strip, no fill.

## 4. Seat permissions (two seats including a phone)
- [ ] Seat 1 (main branch) can open Settings > Price List > Who can edit and tick rights per seat.
- [ ] Seat 2 PC with no rights: Price List is read-only with the plain-words reason; with only "edit" it can fill an empty price but not change a filled one.
- [ ] Seat 2 phone shows the same words and the same disabled buttons in all three layouts (tidy, guided, inbox).
- [ ] Seat 1 cannot lose its own rights.
- [ ] Offline revoke: take the phone offline, edit as seat 2, have seat 1 remove the right, bring the phone online: the change is refused, stays on the phone, the status says so in plain words, nothing crashes.
- [ ] With shared sync OFF, no Price List permission applies.

## 5. Activity log
- [ ] Seat 1 sees the Price List activity log (who, when, old -> new); seats 2 and 3 do not see it.
- [ ] The author shown is the signed-in seat, not something typed on a device.

## 6. Phone Price List and sync words
- [ ] Phone: browse and search the Price List in every layout; names and amounts are never cut.
- [ ] First sync preview shows the Price List line (entries and size note).
- [ ] A server where file 18 was NOT run: the phone says "This server has no Price List yet" and bills and customers still sync.
- [ ] Settings > Storage and backup (new layouts) shows the Price List size note; Export then Import restores the Price List; an old backup file (before 0.1.53) still imports.
- [ ] Classic layout looks exactly as before.

## 7. "by hand" and the case button
- [ ] Typing "by hand" in an item name turns that phrase red and bold (word match, any case); one Undo reverses typing and format together; "Clear formatting" on it sticks.
- [ ] Opening an old saved bill does not rewrite it.
- [ ] The case button changes the selected name text; one Undo step.
- [ ] **Phase 247 (phone "by hand", case button, price strip + auto-fill) was SKIPPED on the owner's instruction and is NOT built on the phone.** Tick here only if you want it built in a later phase: [ ]

## 8. Real-device and real-server gaps (Claude cannot do these)
- [ ] Grid smoothness measured on a real Windows PC with the strip on and off (note PC model): ______
- [ ] Supabase checklist G in `docs/SUPABASE_MIGRATIONS.md` completed (date, region, failures): ______
- [ ] Real Android phone: install, first sync, edit as a granted seat, offline refusal, backup / restore: ______
- [ ] Update path: the installed 0.1.52 app updates to 0.1.55 through Settings > Updates.

Known test status at the gate (Claude, sandbox only): see `PHASE_STATUS.md` -> Current state, "Phase 249".
