# Milestone 17 - owner's device checklist (Phase 187, handed over UNFILLED)

Only a real Android phone can answer these. Nothing here was run on a phone by any Claude session. Tick, or write what happened. Use the live https link (Chrome), then again from the installed app. Bring the real data (about 1.9k bills, 12.9k customers) for section 8.

Phone model / Android / Chrome version: ______________________    Date: __________

## 1. Install and offline
- [ ] Chrome offers Install (banner in the app or the Chrome menu). Installed app opens standalone (no address bar).
- [ ] Switch on airplane mode, close the app fully, open it: it starts, shows the "Offline" note, bills open.
- [ ] Offline: create and save a bill; it appears in History.
- [ ] Back online: the Offline note goes away.

## 2. Storage
- [ ] Settings > Storage says persisted: yes (installed app) ____ (browser tab) ____
- [ ] Usage figure looks sensible. Export backup downloads a file; Import (Replace) restores it.
- [ ] Restart the phone and reopen: bills still there.

## 3. Bills
- [ ] Create a bill: party autocomplete, Next/Done keys move name > qty > rate > next row, number pad shows for qty and rate.
- [ ] Bold and Red+Bold on selected text keep the keyboard open and survive the tap.
- [ ] GST / non-GST toggle, adjustment, total override, extra column, Units summary all work.
- [ ] Back with unsaved changes asks Save / Discard / Keep editing. Name required before save.
- [ ] Edit a saved bill; delete to Recently deleted; restore.
- [ ] Stock transfer / hybrid bill from the PC opens read-only ("Edit on PC").

## 4. Share
- [ ] Share image > WhatsApp receives a PNG. Rupee sign, sharpness, A5 / A4 look right.
- [ ] Share PDF > WhatsApp receives a PDF. File size ______ KB. Non-selectable text acceptable? yes / no
- [ ] Rough vs Professional (company block, PO number). Logo draws.
- [ ] Very long bill (more than 40 rows) shares without error.

## 5. Sync (needs real Supabase and the desktop engine wired)
- [ ] Settings sign-in form is usable (the real browser transport exists from 0.1.29). Use the SAME Supabase URL, anon key and license key as the PC, a seat login not used by a PC, a new branch name and a new PO prefix.
- [ ] After sign-in: Check what to download > Start syncing finishes; the Dashboard sync line says it is running.
- [ ] A bill made on the phone reaches the PC; a bill from the PC reaches the phone.
- [ ] "Sync server paused or unreachable" shows the right words when the server sleeps.

## 6. App lock
- [ ] Turn on a PIN; app asks for it at start; wrong PIN slows down; turn off needs the PIN.

## 7. Update
- [ ] After a new deploy: banner "New version available" appears within about an hour or on reopening.
- [ ] With an unsaved bill open the banner says to save or discard first and Reload is greyed; after saving Reload works and the bill is still there.

## 8. Speed with the full data (note seconds)
- [ ] App start to Dashboard: ____ s
- [ ] History opens: ____ s; typing a search feels instant? yes / no
- [ ] Customers opens: ____ s; filter typing smooth? yes / no
- [ ] Party autocomplete while typing in a bill: first letters ____ s, later letters smooth? yes / no
- [ ] First sync download (counts only, no contents): ____ bills, ____ customers, ____ minutes, phone stayed responsive? yes / no

## 9. Touch and reading
- [ ] Every button can be hit with a thumb without mis-taps (nav, chips, row buttons).
- [ ] Text is readable in both themes outdoors; TalkBack reads button names (optional).
