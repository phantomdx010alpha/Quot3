# M25_OWNER_CHECKLIST - Milestone 25 (release 0.1.64 [A]), UNFILLED

For the OWNER, on real devices. Nothing below was run by Claude: the sandbox has no real Supabase, Windows PC, Android phone, UPI app, WhatsApp or printer. Tick a line only when YOU saw it work; write what you saw next to it. A line that fails goes to Claude as a Phase 297 fix-pack report (screenshots help; never paste a password, code, key, token, UPI id or account number).

Release steps and the Supabase order are in `GITHUB_UPDATE_PUSH.md` section 12c. Result key: `[x]` = worked, `FAIL:` plus what you saw if not.

Date: ____   Windows version: ____   Phone + browser: ____   App version shown in Settings > Updates (PC) and Profile (phone): ____

## 0. Before you start (read this)
- [ ] 0.1 **Phase 282 (the QR library and the QR picture) is NOT built in this release.** Section D lines that need the QR picture (D6, D7, D8, D10) cannot pass until 282 is done. Until then the QR card says "The QR picture could not be drawn on this phone." Mark those lines `BLOCKED: 282`, do not mark them FAIL, and tell Claude to do Phase 282 as the first fix-pack item.
- [ ] 0.2 Deploy order followed (`GITHUB_UPDATE_PUSH.md` 12c): master `M05_payments.sql` and its two functions, then every company project's `23_seat_rights.sql`, then push and tag, then seat 1's PC updated first, then the phones.

## A. Desktop (Windows, seat 1 PC)
- [ ] A1 Backup folder after TWO launches of the new version: only 3 automatic backups remain; manual backups are all still there; `pre-*` files are at most 3 per kind. Settings > Backup shows the "newest 3" sentence.
- [ ] A2 Games > Country Wars opens, the fonts and flags show, sound works, and it plays with the internet switched off. Games > Credits lists it as "Owner" (no repo line).
- [ ] A3 Settings > Company seats > Phone rights: seat 1 shows every right on and cannot be restricted; the other seats can be changed; a new seat starts from the Staff preset.

## B. Phone share image
- [ ] B1 Share a phone bill that has an adjustment row as image and as PDF: there is NO "Adjustments total" line and no duplicate total row.

## C. Rights on a real phone (a restricted seat vs seat 1)
Set a second seat to Staff on the desktop first, wait about a minute, then on that seat's phone:
- [ ] C1 No customer address and no contact shown in Customers, bill view, party search (searching by an address word finds nothing), History.
- [ ] C2 No Price List, no sales figures, no Payments page (Settings and Home have no entry).
- [ ] C3 The SHARED bill image / PDF still carries the customer address and contact (this is the owner's decision D6; the flags hide things in the app only).
- [ ] C4 With the matching rights OFF: cannot export, cannot delete, cannot edit old bills, cannot edit customers. Each is refused in plain words and nothing changes.
- [ ] C5 Seat 1's own phone still has everything and cannot lose a right.
- [ ] C6 Change a right on the desktop while the phone is open and syncing: the phone follows within a few minutes with no typing.
- [ ] C7 An OLD phone (not updated yet) keeps working with no login prompt and no data loss.
- [ ] C8 An old company project that has NOT run `23_seat_rights.sql`: the phone has everything and nothing breaks (only seat 1 can edit Payments).

## D. Payments (needs Phase 282 for the QR picture; see 0.1)
- [ ] D1 Payments page opens from Settings in a new layout (Tidy, Guided, Inbox); the default payees match your old QR page.
- [ ] D2 Add a payee, edit it, remove it (on a phone with the edit right); the list stays in step.
- [ ] D3 A SECOND phone receives the change by itself.
- [ ] D4 A phone without the edit right can see the page but cannot change it (or does not see it, if the see right is off).
- [ ] D5 A bill's Share QR button puts the bill's grand total (with round-off) in the amount box, and you can edit or clear it.
- [ ] D6 The QR scans in a real UPI app for EACH of the three shapes (UPI id, bank account, merchant) and shows the right payee and amount. BLOCKED until 282.
- [ ] D7 The QR goes to WhatsApp as its OWN image, never inside the bill image. BLOCKED until 282.
- [ ] D8 The QR image names the bill (PO number and party name only) and shows no account number, address or phone. BLOCKED until 282.
- [ ] D9 Classic layout has no Payments or Profile page (by design, pinned screens; ask Claude if you want them there).
- [ ] D10 The QR looks right on a real screen and scans from a printed or on-screen copy. BLOCKED until 282.

## E. Data protection, restore and the daily check (real Android phone)
- [ ] E1 The protection banner shows when the browser has not granted persistent storage, in plain words, and the install steps (Add to Home screen) are correct for your Android browser.
- [ ] E2 Wipe site data for the phone app, open it, type the one code: customers, bills, Price List, Payments, company details and rights all come back, with the progress screen.
- [ ] E3 Bills that only lived on the old phone and never synced do NOT come back (the screen says so in plain words).
- [ ] E4 Clear only the data (keep the login) so a marker says data existed: the restore offer appears without a code, and one button refills the phone.
- [ ] E5 The unsynced warning appears when bills are waiting to upload and goes away after sync. It only warns; nothing is blocked.
- [ ] E6 The daily check: Dashboard sync line and Settings > Branch and sync show "Checked HH:MM, all in step" (or "Fetched N missing records"); with the phone offline it says "Could not check: offline" and nothing else breaks. "Check now" works (new layouts).
- [ ] E7 Delete a few bills from the phone's store is not possible from the app; if you have a way to damage the local data, the daily check refills it.

## F. Profile page
- [ ] F1 Settings > Profile (first row, new layouts) and the Home entry both open it; it works offline.
- [ ] F2 Groups read correctly: who, connection, rights (plain words, last checked), this phone's data (counts, storage, protected, last export, last self-check), company, payments (hidden when the see-payments right is off), help.
- [ ] F3 Nothing secret is shown: no code, token, password, key, UPI id or account number. "Copy diagnostics" pastes text with none of those.
- [ ] F4 A restricted seat's Profile hides what its rights hide.

## G. Everything old still works
- [ ] G1 Existing PC and phone sync, bill, share and print exactly as 0.1.61 / 0.1.62; the first-launch code screen does not appear for an already-set-up phone.
- [ ] G2 Classic layout looks and behaves as before.

## Result
Passed: ____   Failed: ____   Blocked: ____   Notes for Claude: ____
