# Milestone 18 - owner's device checklist for the phone layouts (handed over UNFILLED)

Only a real Android phone can answer these. Nothing here was run on a phone by any Claude session. Use the live https link in Chrome, then again from the installed app. Bring the real data. Open Settings > Themes > Layout to switch. Run section 1 once, then sections 2 to 4 for EACH layout (Tidy tabs, Guided flow, Bills inbox). Companion: `docs/MILESTONE18_DESIGN.md` sections 8 and 11. Classic is the default and should look and behave exactly as before.

Build under test: **0.1.39** (the Milestone 18 gate build; 0.1.38 had a failing CSS scope test fixed in 0.1.39).

Phone model / Android / Chrome version: ______________________    Date: __________    App version: ________

## 1. Switching and classic
- [ ] Settings > Themes shows a Layout choice with Classic selected; each new layout appears once it is built.
- [ ] Classic: every screen looks and works exactly as before (Home, History, bill view, editor, Customers, Settings).
- [ ] Switch to each new layout and back: count of bills, customers, the open draft, the Dashboard / sync line are identical before and after.
- [ ] Switch with an unsaved bill open: the app asks Save / Discard / Keep editing first.
- [ ] Close and reopen the app: the chosen layout is remembered. Export a backup and Import it: the layout choice comes back.
- [ ] Both a dark theme and Light look right in every layout.

## 2. Reading (per layout: Tidy ____  Guided ____  Inbox ____)
- [ ] A bill with very long item names: every name wraps fully, nothing is cut with "..." (Home, lists, bill view, editor).
- [ ] A long party name wraps in lists and in the header.
- [ ] A big amount (lakhs) is never cut; money shows Indian grouping, never "12988.00".
- [ ] GST bill shows Before GST / GST / Total; a non-GST bill still says Total.
- [ ] Text size 16-17 px feels readable; buttons are 48 px and easy to hit with a thumb, no mis-taps.
- [ ] One status pill at the top instead of stacked banners; tapping it lists everything (read-only, offline, update, install, storage cleared, version gate).
- [ ] Nothing is pushed sideways or hidden under sticky bars or floating buttons (gesture-navigation phone too).

## 3. Making a bill (per layout)
- [ ] Create opens a clean bill every time; name required before save; unsaved Back asks Save / Discard / Keep editing; a recovery offer appears after a crash or kill.
- [ ] Item name box grows while typing a long name; B and R+B on a selection keep the keyboard open and survive the tap.
- [ ] Tidy: raised New button reachable; editor hides the bottom nav; GST / Non-GST control visible; sheet holds typed total ("Set price yourself"), extra columns / Mark, B / R+B, GST %.
- [ ] Guided: Party > Items > Review; Back steps back first; the quick-add bar sits ABOVE the keyboard with the running total visible; added lines can be tapped and edited.
- [ ] Inbox: tap a cell to edit; the docked toolbar sits above the keyboard; previous / next move across cells; B and R+B work; Done closes the keyboard.
- [ ] Bill date: set an earlier date and save; it lands on that day in the list.
- [ ] Remove an item row: the Undo bar appears and brings the same row back.
- [ ] Stock transfer / hybrid bill from the PC opens read-only with "Edit on PC" in every layout.

## 4. Sharing (per layout)
- [ ] After Save: Tidy and Inbox show the Saved sheet with Share; Guided ends on Review with Share image / Share PDF.
- [ ] Share image: WhatsApp receives a PNG. Share PDF: WhatsApp receives a PDF. The line "pick WhatsApp in the share list" is true on this phone.
- [ ] Rough vs Professional gives the expected output; sharing never changes the bill.
- [ ] A share button on each bill row (Guided Home) and floating Share (Inbox bill view) work.

## 5. Settings words (new layouts)
- [ ] "Connect to your PC", "Last backup", "Bill number letters", "Set price yourself", "Before GST", "GST", "Line total" read clearly.
- [ ] Supabase URL / anon key / license key sit under a closed "Advanced" fold and still sign in; "rev N" is in the overflow menu.

## 6. Speed
- [ ] First letters in party autocomplete: ____ s (should be quick from the first bill after the app opens). Typing stays smooth in every layout.
- [ ] Switching layouts takes: ____ s (a layout downloads once, then works offline).

## 7. Decisions for the owner (tick or write)
- [ ] Keep the larger sizes (16 / 17-18 / 48 px)? yes / change to ______
- [ ] Give classic the "names wrap" option (`ui.wrapNames`)? yes / no
- [ ] GST % quick chips 5 / 12 / 18 / 28 remembering the last choice? yes / no
- [ ] Bill date picker (backdating) allowed? yes / no
- [ ] Which layout do you want as your own daily one? ______
