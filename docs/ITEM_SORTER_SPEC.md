# ITEM_SORTER_SPEC — Quot3 (Milestone 10, Phases 107–115)

Owner request (2026-10-11): humans do not type fixed item names, so many lines are the same product under different spellings. Build a new **Items** page with a compact three-window layout that automatically groups items with similar names/patterns; for the selected item show what it sold for (GST and non-GST bills shown separately), to whom and on what day; plus "who paid what". It must work on ALL bills (legacy import and new ones going forward), remember the owner's merges/splits, and let the owner open the party's bill directly from the sales list. Owner answered YES to all four of: save merges/splits; all bills going forward; who-paid-what view; three-window layout.

Items marked **[A]** are planner assumptions not yet confirmed by the owner.

## 1. Measured facts (owner's 768-file legacy corpus, analysed read-only 2026-10-11)
- 768 bills, 8 474 item lines, 4 039 distinct spellings; 2 763 spellings occur once.
- Case/space/dash cleanup: 4 039 -> ~3 747. Word-order-insensitive key: -> ~3 468 ("TALCO 2044" = "2044 TALCO", "FANCY BUTTON" = "BUTTON FANCY", six orderings of "ARIHANT GRIPPER WHITE"). Safe typo fix (rare word vs very frequent word): -> ~3 430 groups.
- 1 215 groups were sold at least twice and cover ~6 260 of the 8 474 lines (~74%). The rest is a long tail of one-offs.
- Real typos found (examples): JUPITOR, GRIPER, BUTTTON, SHAKKTI, MAGIABA, OERLOCK, SCISOOR, CHALLANGE. **False matches a naive fuzzy pass makes:** STEAM->SEAM, STRIKER->STICKER, PERAL->PERL, JACKO->JACK, GERMANY->GERMAN, SHAPE->SHAPES. So fuzzy results are SUGGESTIONS, never automatic, unless the word is very rare and the target very frequent.
- Sizes/codes are distinct products: ARIHANT 32X50 vs 25X50, MILTON 505 vs D7. They must be family members, never auto-merged.
- Non-product lines exist (~32 distinct names): `GST EXTRA - 18%`, `COOLIE AND GST`, `LESS - PAYMENT`, `ADVANCE`, `DYING CHARGE + GST`. Names also carry notes in brackets: `(ADVANCE ORDER, 7 DAYS WAITING)`, `(TO BE COURIERED)`.
- 507 lines have no rate and 284 no quantity.
- GST vs non-GST: the legacy top-level `gst` field is empty on all but one bill. The real signal is the bill format: 172 bills GST format, 592 manual, 4 default. GST-format lines carry their own `gst` percent (5% on 727 lines, 18% on 385, 0% on 219), `gst_amt` and `total`; `rate` is before tax. Example: AMETO SMALL, 121 sales to 81 parties, non-GST rate 75-85 (median 82), only 3 GST sales.

## 2. Matching pipeline (pure, `shared/items/*`)
1. **Clean:** uppercase, collapse spaces, unify `-`/`_`/punctuation, `32 x 50`/`32*50` -> `32X50`, strip bracket notes into a separate `note` field (not part of the key).
2. **Non-product filter:** lines whose cleaned name matches the charge/less/advance/GST/coolie patterns (list in the code, owner-editable) are excluded from groups and listed under "Not items".
3. **Order-insensitive key:** sorted tokens of the cleaned name.
4. **Protected tokens:** any token containing a digit, a size (`32X50`), a fraction (`1/2`) or a unit (`INCH`, `MTR`) must match exactly; fuzzy matching never changes them.
5. **Vocabulary learned from the owner's bills:** token frequencies; word classes (brand, colour, size-word BIG/SMALL, unit) inferred from frequency and position; typo candidates = rare alphabetic token close to a much more frequent one (same first letter, length within 2, frequency ratio >= 10x).
6. **Confidence tiers:**
   - **Auto**: same key after steps 1-4, or typo with rare-token rule (count <= 2, target >= 10x and >= 30 uses).
   - **Suggested**: other typo candidates, plural/singular, near-identical token sets differing by one non-protected word.
   - **Separate**: everything else.
7. **Family level:** the leading brand token(s) (e.g. ARIHANT, MILTON, TALCO, SPADE, YKK) group variants beneath one family; a family is a display grouping, never a merge.
8. **Owner rules always win** (section 3).
9. Deterministic and explainable: every group shows WHY a spelling is in it (rule that matched).
No AI model in v1 (decision, section 8).

## 3. Owner rules (remembered)
Table `item_rules` (planned): `id` (uuid), `kind` (`merge` | `split` | `ignore` | `family`), `key_a`, `key_b` (cleaned keys), `canonical` (display name for merges), `note`, `created_at`, `updated_at`, `deleted_at`, `branch_id`. Confirming a suggestion writes `merge`; splitting writes `split` (never auto-merge these two again); marking a line "not an item" writes `ignore`. Rules are applied on every recompute; deleting a rule restores the automatic result. Undo of the last decision in the page.

## 4. Data scope
Works on **all bills** (imported and new), not trashed ones. Groups are recomputed incrementally when a bill is saved/edited/deleted/restored and fully on demand ("Rebuild"); a derived cache table may be used but the bills stay the truth (`DATA_MODEL.md` rule: derived data is never truth).

## 5. The Items page (route `/items`, side-rail icon, Phosphor)
Three compact windows, all keyboard reachable (Tab / Shift+Tab or Alt+1/2/3 [A]):
1. **Groups** — families with their variants beneath; search box (Ctrl+F style, fuzzy); badges: sold count, "N suggestions".
2. **Spellings** — for the selected group: every spelling with count and last used date, the rule that put it there, confirm/merge/split/move actions, suggested merges with one-key confirm.
3. **Sales** — for the selected group: tabs **Non-GST** and **GST** (separately, by the bill's format/line GST); columns date, party, bill no, qty, rate, (GST %, tax amount, line total on the GST tab); summary: count, min / median / max rate, latest rate, total qty. **Who paid what:** last rate per party, rates unusually high or low versus the group's median (flagged), per-party filter.
**Open the bill:** Enter or double-click on a sales row opens that bill in View (same as History's Open); Esc returns to the Items page with the same selection. Ctrl+Shift+? for copy of the table to TSV [A].
Esc rules follow `KEYBOARD_CELL_RULES.md` section 12/13 (Esc on Items goes to Dashboard; Esc from an opened bill goes back to Items).

## 6. Sync [A]
Owner rules sync between branches as a new snapshot kind `item_rule` (last-write-wins by `updated_at`, then revision, branch id), optional/ignorable by old branches, encrypted like bills. Deterministic ids from `key_a|key_b|kind` so two branches making the same decision do not duplicate. Details in `SYNC_POSTBOX_SPEC.md` section 11.

## 7. Performance and safety
- 5 000 bills / 60 000 lines: full rebuild in a worker or main-side with a progress indication; page opens from the cached result; incremental update on save adds < 5 ms to Save. Budgets proposed; the owner may change them.
- The page never mutates bills. Names on bills are never rewritten by merging (a merge only groups).
- Renderer shows pre-aggregated rows (virtualised list); no per-row React store subscriptions that return fresh arrays (Phase 92 rule).

## 8. Decisions and open items
- **Decision:** v1 uses rules + learned vocabulary + owner rules, no AI model. Optional later: a local embedding model (e.g. `Xenova/all-MiniLM-L6-v2`, Apache-2.0, int8 ONNX ~23 MB, via `@huggingface/transformers`; `Xenova/multilingual-e5-small` for mixed-language names, licence to be checked) used ONLY to propose "suggested" matches, never to auto-merge, and only if the rules leave too many leftovers after real use. Embeddings are weak at telling codes like 505 vs D7 apart. Not planned in any phase.
- **[A]** Rules sync between branches.
- **[A]** Item-name autocomplete while typing a bill (using the groups) is NOT in this milestone; offered to the owner, open question.
- **[A]** Milestone 10 runs before the Phase 69 release gate.

**Update (2026-10-11):** the owner's first run found the Groups/Spellings display bug and zero-rate lines polluting the rate range; fixed in Phase 117 (`docs/MILESTONE11_DESIGN.md` section 2). Phase 69 now follows Phase 127.
