# REQUIREMENTS_ORIGINAL — Quot3

**Binding source of truth.** Part A is the owner's requirements document, verbatim (typos and informal language preserved on purpose — do not "clean it up"). Part B is the clarifications and assumptions the owner confirmed in the planning session. Part C maps each requirement to the phases that deliver it. When anything elsewhere in the docs is ambiguous, this file wins; if the owner changes a rule, edit this file in place and log it in `PHASE_STATUS.md`.

"ifkwim" = "if you know what I mean". The owner's existing app is "Meenakshi Buttons" (screenshots in `legacy_app/`); Quot3 is its faster, more polished rewrite.

---

## Part A — Owner's requirements (verbatim)

okay soo here are the complete requirements -
this application essentially should be a free entry without an item catalouge with essentially 2 formats of tables switchable - 
1- gst mode (alt+1)
2- non gst mode (alt+2) - default 
3- more formats can be added when required

in non gst mode the tables cols are - 
sl.no- (it auto updates if either item name and one of any or both rate and qty cols are filled)
item name - where we can write the item names 
rate, qty - pretty self explanatory
totals which are auto calculated - but also editable when required ifkwim

in gst mode the cols to be in this order
sl no - qty - rate - total - gst % (gst rate where we can add the number of the gst on that item like 5 or 18 or anything)
gst amt- (auto calculated from the total amounts and the gst rate applied on that ifkwim)
amount - (auto calculated - addition of the total + gst amt for that item)

each format should include options to add the extra cols, also to remove them aswell when required
which can we added or removed safely and we should be able to edit the col header names for them aswell ifkwim
this should work for the both or more extra formats added later ifkwim

when switching the formats of bills white it contains the pre enterered datas
those all should stay ifkwim across the formats

the grand totals should be automatically calculated at the end of last total rows ifkwim

the cells transition should be smooth af, it should have all the functionalities of the letters or the selected words colors like in the excel ifkwim for item names, as well as ability to make then bold aswell as well as another different separate options to make them red+bold for selected letters ot words red and bolt directly with push of only one button
there should also be an adjustment system
like if in the items col row after all the item names we write an item name but dont enter any qty or rate, and directly write into the totals instead then it should be considered as an adjustment
and how it should be treated like is simple, after the all the items totals comes the total, and then grandtotal in the total columns, if the identified item is a adjustement item, then it should 
automatically shift into the next row ifkwim soo the grandtotals of items goes up the adjustments, and then comes the adjustment totals automatically and then the ultimate totals of of grandtotal and the adjustments combined ifkwim

we need the basic functionalities like printing, printing in a5 mode configuration by default,
2 printing modes, an profession mode (which should include all the details of the parties name, address, transport and mobile number, as well as the our own configured company logo (our not customer) and name, phone number and the address (all configurable via settings) rough mode, which should have just the party name, phone number, transport (no our side company logo address or any other shit like party address ifkwim)
for printing specifically, we need two othes within, an a4 more and a5 mode as default printing
lets present you edge cases- if a party bill has upto 40 items (in rough mode, for the professional mode its 30 items threshold) (inclusive the adjustment rows), and its non gst mode with upto 2 extra cols if any then it should be automatically suggested and printed in a5 page by default (can be force changed when needed), if more than 2 extra cols then it should automatically prompt a warning that it would be printed in a4 page due to special issues ifkwim
and for the item rows more than 40 items then it should be printed in a4 aswell (upto 80 items in rough and 70 items in professional)
and if the quotation is gst mode without any extra cols, then it should be printed in the a5, but if gst bill with extra cols then it should be printed in the a4 sheet with warning prompt ifkwim
we need dedicated rough print and professional print buttons in the bottom bar of the screens (ohh also for the printing and images in general, the professional format also gets a po number) 

now for this same shit ifkwim we just crop the black white space and keep only the contents and tables from pdf and then we get an image, copyable to the clipboard when pressed the button, and then we can paste it whever we want, like WhatsApp and shit ifkwim (i need this feature strictly no compromises), we should get 2 separate buttons in the bottom bar for this aswell, like separate for rough copy and professional image copy ifkwim


now we talk in details about the control and ui
for controls the cell migration we can use regular arrows freely as we want, and please it should not lock to a cell at any point strictly, we should be able to move through the cells freely even if its empty and shit ifkiwm
as well as it should also work with the normal excel cotrol with enter and tabs and shift ect to move and switch cells, for this is the tricky part in ecel we use f2 to edit a cell within, we need that functionality aswell but in addition, we also need another feaure, like on every cell by default if the cell if filled, we try to move, the writing cursor should always land on the end of last letter f that cell content, so we are natutrally able to write anything,
but if we want to move to left of the contets without pressinf f2, we can just use the mouse to point or press left arrow twice soo the cell becomes unlocked and we can do edit stuff there, and then when we want to switch the cell for example we want to go right cell, we can just use tab button or move the writing cursor to the dead end of the cell contnent letters and in theend when we press the right again then we land on next cell ifkwim (please try to understand this tricky part in details, its different than excel, where if we type something in cell which already has content witout pressing f it deletes the stuff, which shouldn't happen)

the app should be built such that it should have all the mapped shortcuts and stuff soo we can eve use it when we dont have a mouse to use, we should be able to use it even just with a keyboard ifkiwm

for the ui, it shouldn't be super big shitty looking ahh content ifkwim, it should be compact but spacious like excel or tally where we get enough rows on a screen (naturally 20 rows visible on screen before the scrolling ifkwim)
especially the upper bar where we add the party names, and other details, it should be compact, not super big shitty looking stuff

the theme of the ui be default at neumorhism deep navy blue with light red accents to support the premium and smooth looks 
for the party name and details filling, it should get auto fill options in drop down to select from list of partys with fuzzy match as we go, is info can be gotton from the paty import, which is a settings excel party import deature, where we can get the party names and contact number and address details when required ifkwim, the format of the excel import and the details will be provided later, upon party select the it should auto fill the other info automatically, 
the address info in ui should be pull down to reveal stuff to keep it naturally compact
in case of new party, we can just write the name and if push the right arrow to move to the next conatts info feild to add those optinal info like contact, address and tansport button or drag the mouse to the cell focus, then we make the quotaitionautomaticallly and upon save only the new party with all that details gets added ifkwim
and at any point we press escape to go back while actively making a bill, we should get the warning to save the bill or not, and if yes and the party has no name then it should give warning to add the name and shit and basic stuff ifkwim before saving, and same goes for already saved bills open and we make changes it should prompt if we should save the changes or not

then there should be another history page where we can view the saved bills, from single branch or multiple branches if configured ifkwim (for this we need a simple lisense feature in the supabase for matching) (supabase never stores bills data, it only acts as postbox for both ifkwim)
the history page should be such that as shown in the image layout, the dates column in the left and the actuall bills in the right panle, wehere we can select and open the bills , and other history related features ifkwim as you seem fit
and then  a customers page, where we can get a list customers, how many bills created on theier name, their phone numbers and other details all searchable and shit ifkwim

more other custom pages can be added later as seem fit, 
when we open the app we shouldn't directly land on the quotation pag, rather we should land on the dashboard with 4 pages options, create, history, customers, settings
and other dashboard stats and stuff as seem fit ifkwim
we also need another feature in the create page, names as the tsv copy, when we do that it shoud copy the entire tables along with prty name, contact, and transport (only the party side) and then we should be able to paste it in excel to edit as we required 


for the extra cols feature we need another feature
the entire reason this column exusts ti to record the item codes directly into a single cell for example- header - ameto, row cell -  (125-5) which means the item is ameto and the item code is 125 the dash or emdash or even equals sign gives and the number that follows after that means the number of the number of units of thar code ifkiwim
soo we need a feature to calculate the total number of units only for that specific items (not code), and the codes could be anuthing not only numbers soo keep that only in mind that while auto calculations only the numbers after - or = matters, its not necessary that we that the item name and col header be same, soo it must be kept independent, on a button push we should get a summary of which col deader has how many units in them
and for this same issue, lets say if we need to add the another header item in the same col, then we should get a mark option, when we mark a cell content of the same col later on then it becomes an independent header, and upon pushing the show makrked calculations info then it shows the caluclations separately
i have provided you an image for example



now we talk about the most important stuff, the crimbing, conjustion and the overflow hadling throuhut the ui and the pdf, it should have a proper long item names and headers and stuff handling, properly without any conjestion and end up looking ugly, different branches could have different addresses and other infos, soo the bill ids for backend and the po numbers for thehistory view should have a configurable po prefix in the settings to avioid confusion ifkwim
these are basically all my requirements for now, now tell me if you understand everything correctly or not, and them suggest the final stacks for everything

### Part A addendum (verbatim, sent after the zip request, 2026-10-07)

AND YEAH I FORGOT TO MENTION A THING ASWELL
THAT WE ALSO NEED A UNDO, REDO AND RELATED FEATURES IFKWIM

Interpretation (Claude, not yet explicitly confirmed — see Part B row A6): "undo, redo and related features" = full undo/redo across the bill (grid + party bar + formatting + extra columns + format switches), plus the safety-net features that normally travel with it: recently-deleted bills with restore, revision history of saved bills with compare/restore, and draft crash-recovery. Spec: `UNDO_REDO_RULES.md`.

---

### Part A addendum 2 — post-Phase-68 messages (2026-10-10, owner's words, condensed only by removing nothing of substance)

**Problems message:** image copy and the print dialog are slow; print comes out centred (should be top); image quality is low; header borders (Item Name / Quantity) do not line up with body columns; extra-column cells are locked on the total rows and should continue below the grand totals; after Save, Create shows the old bill; wants auto round-off; wants a setting for smooth arrow navigation; wants to import the legacy JSON bills (PO to the new prefix, continue the next number, in Settings, from any folder). Instruction at the time: understand and clarify only, no changes.

**Answers:** A — 1 YES BOTH, 2 YES, 3 YES. E — 1 YES, 2 YES, 3 YES. G — 1 YES ROUND TO NEAREST, 2 NO, NO EXTRA LINE SHOWN, JUST DO IT WITHOUT DISPLAY, 3 YES. H — 1 DON'T KEEP THEIR PREFIX, KEEP ONLY THE NUMBER, 2 YES RECOMPUTE, 3 YES, BUT ALSO CHECK IF THOSE EXACT PARTIES ALREADY EXIST, 4 YES SEND IT, AND WE SHOULD BE ABLE TO RECEIVE IT WITH A PROPER DISPLAY UI PROGRESS BAR; also asked how sync works now; all imported bills must be seen and editable in History.

**Final feature message:** be able to totally wipe existing data to start fresh; About section publisher "ANKIT SHUKLA" with email "PHANTOMDX9@GMAIL.COM"; on Create a small collapsible window above the bottom bar with 2 options — a functional horizontal, simplistic calculator like Tally's Ctrl+N, and a switchable % calculator showing the % of the active quotation's grand total with predefined, configurable defaults 18%, 5%, 3% and an empty field to type a %; on Create/View the active cell should highlight the entire row. Then: update the docs only and deliver the zip so the new phases can start.

### Part A addendum 3 — post-Phase-91 messages (2026-10-11, owner's words, condensed only by removing nothing of substance)

**Feedback on the running app (with a History screenshot and diagnostics file):** the History UI is wrong (rows/bill numbers/badge); the app has no proper page-switch model, it is all connected, Esc goes back and back and back when it should just stop at the Dashboard like a proper app, and that is why popups appear on repeated Esc for actions already done; Settings > Sync and > License do not open (diagnostics attached); scroll bars throughout the app are generic black or white and ugly, they should match the theme and every theme added later; the same for the upper bar with minimize, maximize and close (that thin strip). Instruction at the time: understand only, discuss before planning.

**Follow-up:** 'yes' to the proposed answers (Esc rules, title bar, scrollbars, HD image fix) and: introduce 4 more themes - a non-generic-AI palette glossy glass theme; a space theme (non-neumorphic); a red and navy blue theme; a red deep-black dark mode theme. Also: in the Create grid, pressing Down in the extra columns should extend the row but does nothing and stays stuck; it should do that only in the extra columns so more can be written there. Then: update the docs with all of this and the new phases and give the zip.

### Part A addendum 4 — item sorter (2026-10-11, owner's words)

We need to build an item sorter with similar data as in the JSON bills, because as humans we do not have fixed item names on purpose, but most of those items are the same thing with different names. A new page with a compact 3 windows where we are automatically able to group the items with similar patterns and names; for the selected item the other window shows how much it was sold for, GST format and non-GST format separately, to whom and on what day it was sold; an algorithm that detects everything and more to make life easier. (Planner then analysed the bills and researched free Hugging Face models; the owner asked for the planner's suggestion, noting that in future humans will always enter in a similar pattern.) **Answers:** YES to saving merges and splits so the app remembers them; YES to working on all bills going forward, not only the legacy import; YES to a who-paid-what view (last rate per party, unusually high/low rates); YES to the three-window layout; and "we should also be able to open the bills of the parties directly from there as well".

### Part A addendum 5 — post-Phase-115 messages (2026-10-11, owner's words, condensed only by removing nothing of substance)

**Bug/feature message (with two screenshots):** each time I switch the page using Esc I still get stacked, unrelated, annoying notifications; on the new Items page I cannot see the names of the items - the first load shows a few, going down they become invisible, and when landed on them the other two windows still show the info, and on the other two windows pressing Down for more shows empty (a visual bug); in the Create page it sometimes still opens pre-made bills - make it a hard rule that clicking Create always comes in clear and formatted; in Create add delete row: pressing the Delete key on a row deletes that row only, excluding the extra-column content for that row; the rows should be rearrangeable as we please (without compromising already-built stuff) - tell the drawbacks now; the automatic round-off to the closest number still does not happen in the grand totals; Ctrl+C / Ctrl+V still do not work on Create (tab-separated contents are not copied/pasted), and when a range is selected and even just Ctrl is pressed the focus goes off and nothing happens before C, and Ctrl+V does nothing; for the Dashboard add excess, app-unrelated tiles: a weather tile (default Bangalore, changeable via Settings), a live free API showing the Indian rupee vs dollar comparison and at least 4-5 other tiles, symmetrical so that none is left alone on the next line. Instruction: do not edit anything, understand the requirements so the next milestone can be planned. **Follow-up:** "yes now make the docs updates and give me the updated zip".

### Part A addendum 6 — Milestone 17, phone version (2026-10-21, owner's words, verbatim, typos kept)

> PRESENTED IS THE ALREADY PERFECTLY WORKING STANDALONE QUOTATIONS APPLICATION FOR PC
> WE HAVE TO EXPAND THE FEATURES TO SUPPORT THE ANDROID VIA PWA IN THE SAME APP USING VERCEL AS THE HOST
> THIS IS STRICTLY A PLANNING PHASE ONLY
> STUDY ALL THE FUNCTIONALITIES AND PRESENT ME WITH THE PIPELINE AND IDEAS THE BETTER ONES IF ANY
> KEEP THE ANDROID INFRASTRUCTURE STRICTLY PWA ONLY

> WHAT IF WE DONT CREATE NEW WORKFLOW BUT MAKE CHANGES AND UPGRADE THE CURRENT DIR INSTEAD IFKWIM?
> AND MAKE VERSION CHANGES

> DESKTOP IS COMPLETED AND WORKS FINE DUDE, DESKTOP IS ALREADY COMPLETE
> LOL
> DONT BS
> AND EXPLAIN IN PLAIN WORDS WITHOUT USING SHITTY BIG ASS COMPLEX TERMS AND LONG PARAGRAPHS

> WE USE INDEXED DB PERSISTENT STORAGE FOR PWA ON PHONE
> AND ALSO A BETTER AND SUPER SIMPLIFIED NON AI BIG ASS LOOKING, SUPR COMPACT BILL CREATON, EDIT OR VIEW BILLS SHIT ON THE MOBILE AS WELL AS FOR PHONE WE JUST HAVE THE SHARE IMAGE OR PDF FEATURE ONLY BECAUSE THAT ONLY MAKES SENSE AND SHIT, WE DROP PRINT AND OTHER UNRELEATED FEATURE WHICH ARE FOR THE PC ONLY
> LIST EVERYTHING IN DETAILS HERE IN A HANDOFF MD ONLY FOR ANOTHER CLAUDE SESSION ...

**What the owner decided (firm):** (1) same repo and folder, upgrade the current directory and change the version, no new workflow; (2) Android through a PWA only on Vercel (no TWA, Capacitor, Play Store, native wrapper); (3) phone data in IndexedDB with persistent storage (no SQLite-wasm / OPFS); (4) super compact, simple phone UI, no AI; (5) the phone can create, edit and view bills; (6) phone output is share image / share PDF only, no print, PC-only features dropped; (7) desktop is finished and does not change. Design: `docs/MILESTONE17_DESIGN.md`.

## Part B — Confirmed clarifications and assumptions (planning session, 2026-10-07)

The owner confirmed "your assumptions are right" for all of the following:

| # | Assumption | Status |
|---|---|---|
| A1 | The GST-mode column list skipped "item name" by omission; Item Name sits after Sl.No. GST columns in order: Sl.No, Item Name, Qty, Rate, Total, GST %, GST Amt, Amount. | Confirmed |
| A2 | The row-count thresholds (rough 40 / professional 30 for A5; 80 / 70 for A4) apply to GST mode too. | Confirmed |
| A3 | Past the A4 limits (80 rough, 70 professional), the bill flows onto page 2+ with repeated table headers. | Confirmed |
| A4 | Extra columns belong to the **whole bill**: they stay visible and keep their data when switching between GST and non-GST. | Confirmed |
| A5 | Esc first leaves cell editing; Esc again (outside a cell edit) triggers the save-or-discard prompt. Drafts also autosave for crash recovery. | Confirmed |
| A6 | "Undo, redo and related features" (late addition) = bill-wide undo/redo, recently-deleted + restore, revision history with compare/restore. Scope in `UNDO_REDO_RULES.md`. | **Proposed — owner to confirm scope** |

Understanding the owner confirmed in the same session (no objection raised):
- **Formats are views over one superset row model.** Alt+1 / Alt+2 change visible columns and derived-value formulas only. New formats are registry entries.
- **Totals are auto but overridable.** An overridden total shows a small marker and has a "reset to auto" action.
- **Adjustments** — a row with an item name and a total but **no qty and no rate** is an adjustment. Footer order: items → items subtotal → adjustment rows → adjustments total → final total (items subtotal + adjustments). Adjustments may be negative (discounts).
- **Cell rule** — a selected cell with content is never replaced by typing; the caret parks at the end of the content. See `KEYBOARD_CELL_RULES.md`.
- **Extra-column units rule** — only the number after the last `-`, `–`, `—` or `=` counts; marked cells start independent headers. See `EXTRA_COLS_UNITS_RULES.md`. Worked example from the legacy screenshot is reproduced there.
- **Paper engine** — pure function; user can always force A4/A5. See `PAPER_ENGINE_RULES.md`.
- **Copy-as-image** — crops to content only, 2–3× scale, onto the Windows clipboard, pasteable into WhatsApp. "Strictly no compromises."
- **Supabase** = encrypted postbox + license matching only; never a store of readable bills.
- **Platform** — The desktop app stays Windows only, data in `%LOCALAPPDATA%\Quot3\`. A phone PWA (Android, hosted on Vercel, data in IndexedDB) is ADDED by Milestone 17; it is purely additive and does not change the desktop (see Part A addendum 6 and `docs/MILESTONE17_DESIGN.md`).
- **Stack** — Electron + React + TypeScript + Vite (electron-vite) + Tailwind v3 + custom DOM grid + SQLite (better-sqlite3) + Drizzle + decimal.js + Zustand/Immer + Fuse.js + ExcelJS + electron-builder/updater. **Rejected:** Tauri (owner has no experience), Python wrapper EXE (second runtime, AV false positives), Glide Data Grid (canvas can't do per-word red/bold).
- **Smoothness target** — "240 FPS" means input-to-paint under one 240 Hz frame for typing/navigation on an 80-row bill, measured, not assumed.

**Post-Phase-68 clarifications (2026-10-10)** — see `docs/MILESTONE8_DESIGN.md`. A7 smooth-arrow setting, default ON, both edit-mode exits (owner: YES BOTH). A8 round-off default ON, nearest rupee, hidden, per-bill flag. A9 legacy import: number only, recompute totals, link-or-create parties, send via sync. A10 Create blank after Save with resumable unsaved bill and New button **[A]**. A11 duplicate legacy numbers rule and fingerprint dedupe **[A]**. A12 wipe levels 1/2. A13 calculator drawer. A14 active-row highlight. A15 About publisher.

**Post-Phase-91 clarifications (2026-10-11)** — see `docs/MILESTONE9_DESIGN.md`. A16 Dashboard is the navigation root, Esc never goes behind it [A]. A17 no stale 'already done' popups. A18 scrollbars and title bar strip follow the theme [A: native buttons kept, thin rounded scrollbars]. A19 four new themes. A20 Down in extra columns adds rows [A]. A21 HD image must really apply on the owner's PC.

**Item-sorter clarifications (2026-10-11)** — see `docs/ITEM_SORTER_SPEC.md`. A22 Items page with three windows. A23 merges/splits remembered. A24 works on all bills. A25 who-paid-what. A26 open the party's bill from the sales list. A27 rules sync between branches [A]. A28 no AI model in v1; fuzzy matches are suggestions [A].

**Post-Phase-115 clarifications (2026-10-11)** — see `docs/MILESTONE11_DESIGN.md`. A29 notifications must not stack [A]. A30 Items page names always visible. A31 Create ALWAYS opens clean (hard rule). A32 delete row keeps the row's extra-column content [A]. A33 row reorder with extras staying on position [A]. A34 round-off must really apply. A35 clipboard Ctrl+C/V on ranges. A36 HD image must really apply. A37 Dashboard live tiles, symmetric, city configurable [A].

**Milestone 17 clarifications (2026-10-21)** — see `docs/MILESTONE17_DESIGN.md`. All [A] = unconfirmed, owner may flip. A38 the phone is its own seat and branch with its own PO prefix [A]. A39 the phone creates only GST and non-GST bills; stock transfer and hybrid open read-only with "Edit on PC" [A]. A40 extra columns on the phone: full support, compact [A]. A41 rich text on the phone: B and R+B on selection, fallback to plain text with preserved runs if unreliable on Android [A]. A42 revisions on the phone: small cap of 5, no compare screen [A]. A43 first sync: store everything if the measured size is fine, else recent bills plus all customers [A]. A44 optional app lock (PIN / biometric), off by default [A]. A45 Vercel production from a separate `pwa` branch until 0.2.0 [A]. A46 share defaults remember the last choice [A]. A47 company profile: synced if desktop syncs it today, else the phone has its own [A, CHECK in code]. A48 "Reset phone data" with a double confirm [A]. A49 call / WhatsApp links from Customers [A]. A50 optional staged rollout: view / search / share build first, editing after [A].

## Part C — Open items the owner will supply later

| Item | Needed by | Notes |
|---|---|---|
| App icon (.ico / source PNG ≥ 512px) | Phase 63 | Owner: "I'll provide the icon when required by the phase." |
| Party Excel import format (columns, sheet layout, sample file) | Phase 47 | Owner: "format of the excel import and the details will be provided later." |
| Supabase project URL + anon key; license key scheme preferences | Phase 51–52 | Optional feature; app works fully without. |
| Sample real bills (long item names, 40/41/80/81-row cases, extra-col bills) | Phase 33 / 40 | For print and image QA. |
| Review of the Professional print layout (screenshots) | Phase 34 | Content is specified; visual layout needs owner sign-off. |
| Company profile defaults (name, address, phone), logo | Phase 48 | Entered by owner in Settings at runtime — not needed in repo. |
| Confirm A6 (undo scope), D-K3 (Left at start edge), D-X1 (marked-cell number) | before Phases 17, 10, 7 | Defaults are implemented; owner may flip constants. |

## Part D — Requirement → phase map

| Requirement | Phases |
|---|---|
| Two switchable formats (Alt+1 GST, Alt+2 non-GST default), extensible | 8, 20 |
| Free-entry grid, Sl.No auto rule, auto totals + editable totals | 9, 12, 13 |
| Extra columns add/remove/rename; data kept across formats | 21 |
| Grand total at end of total rows; adjustments logic | 6, 19 |
| Excel-like cell navigation, never locks, F2, append-caret rule | 10, 11 |
| Rich text: colour/bold, one-key Red+Bold | 14, 15 |
| Copy/paste in grid; TSV copy of whole bill | 16, 31 |
| **Undo/redo (bill-wide), undo history panel** | 17, 18 |
| **Recently deleted + restore; revision history + compare** | 43, 44 |
| Units summary, Mark, show-marked | 7, 22 |
| Overflow/long-text handling (UI) | 23 |
| Overflow/long-text handling (print, PDF, image) | 35 |
| Compact UI, ≥20 rows visible, compact party bar, address pull-down | 9, 25 |
| Party fuzzy autocomplete, new-party flow | 26 |
| Esc guard, unsaved-changes prompts, name-required validation | 27, 28 |
| Draft autosave / crash recovery | 29 |
| Full keyboard-only operation, shortcut map | 4, 30, 67 |
| Printing: rough/professional, A5 default/A4, paper engine, warnings | 33–37 |
| PDF export | 38 |
| PO number (professional), configurable PO prefix | 27, 34, 48 |
| Copy as image (rough + professional), crop to content | 39 |
| History page (dates left, bills right), search, actions | 41, 42 |
| Customers page | 45 |
| Dashboard landing (Create/History/Customers/Settings + stats) | 4, 46 |
| Party Excel import (Settings) | 47 |
| Company profile/logo, paper defaults | 48 |
| Themes (navy+red default, custom drop-in) | 3, 49 |
| Backups / restore | 50 |
| Multi-branch via Supabase postbox + license | 51–60 |
| Standalone Windows installer, auto-update | 62–65 |
| 240 FPS smoothness (measured) | 24, 68 |
| Create blank after Save; header border | 70 |
| Instant HD image copy; instant top-aligned print | 71–73 |
| Smooth arrow navigation setting | 74–75 |
| Round-off | 76–77 |
| Active-row highlight | 78 |
| Extra-column free cells and tail rows | 79–81 |
| Calculator drawer (basic + %) | 82–83 |
| Legacy JSON import + History imported bills | 84–86 |
| Sync fixes + progress UI | 87–89 |
| About publisher; Start fresh wipe | 90 |
| Settings Sync / License pages open | 92 |
| History list layout | 93 |
| Dashboard-rooted navigation, Esc, no stale popups | 94–95 |
| Theme-aware scrollbars and title bar | 96–98 |
| Four new themes + picker | 99–103 |
| Down in extra columns extends rows | 104 |
| HD image scale applies | 105 |
| Item sorter: grouping, spellings, sales GST / non-GST, who-paid-what, open the bill, remembered rules | 107–115 |
| Notification discipline | 116 |
| Items page display bug | 117 |
| Create always blank | 118 |
| Grid clipboard Ctrl+C / Ctrl+V | 119 |
| Round-off applies | 120 |
| HD image applies | 121 |
| Delete row | 122 |
| Row reorder | 123–124 |
| Dashboard weather / forex / other tiles | 125–126 |
| Phone version (Android PWA, Vercel, IndexedDB, compact bills, share image / PDF only) | 173–188 |
