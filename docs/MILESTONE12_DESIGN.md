# MILESTONE12_DESIGN — Quot3 (Phases 128–143): shared-notebook sync

Written 2026-10-12 from the owner's handoff of a failing two-computer sync and a design discussion held in another Claude session (the owner pasted both). Phase 69 (RELEASE GATE) still runs last, now after Phase 143. **[A]** = planner assumption: the owner has not answered it yet, so it is recorded as a default the owner may flip. Binding spec: `docs/SYNC_SHARED_STORE_SPEC.md`. Planning only; no code was changed.

## 1. Why this milestone exists
The v1 sync (Phases 51-60, 87-89, 111) passes encrypted rows through a mailbox that forgets. On 2026-10-12 two real computers (same Supabase project, same 1 927 bills, 12 893 customers) showed "A change from another branch could not be read" and `Sync pull paused {"reason":"decrypt"}` on both. Sending worked; receiving stopped at the first row it could not decrypt. The root cause was never confirmed (see the 2026-10-12 handoff: different passphrases, leftover bad rows, or a sealing bug). The discussion found three structural problems that make this kind of failure likely and painful:
1. **A hand-typed passphrase with no validation.** One typo, trailing space or Unicode difference silently jams the pull behind one bad row.
2. **A mailbox that forgets.** A branch that joins later cannot catch up; bills move by backup-file swapping (Join an existing branch, Phase 58), and imported legacy bills are "never re-sent".
3. **Customer ids are local.** Merging two computers gives the same customer twice (for example SPACE GARMENTS with 2 bills on one copy and 11 on the other).

## 2. What the owner decided
- Replace the locked-box model with **one shared notebook in Supabase** that keeps the latest version of everything, with a version number per record.
- **A compare button** (diff matcher): "here is what I have, what am I missing?" - same bill: skip; only on one side: transfer; edited on both: **the latest version wins, whichever branch it came from** (owner rejected a Main-branch hierarchy: "the latest version only wins, doesn't matter which branch it's from"). The older one is kept so nothing is lost.
- **No passphrase.** Login is the **Supabase email + password**, for the main computer and the branches alike.
- **License:** a simple generated license, made by **one simple SQL query in Supabase**, and **that query must also create the Supabase email and password** accordingly.
- **Branch names are selectable** in Settings so they cannot clash.
- Old imported bills: import on one computer, press Sync, the other downloads them. No backup swapping.
- Customers: exact same name becomes one customer automatically; similar names go on a short list with a Merge button.
- Realtime is welcome if it fits the free plan (two computers only).
- Newer bill formats later must not need Supabase changes.

## 3. Design in one page (details: the spec)
Server: `sn_records` (one row per bill / customer / merge decision / item rule, `jsonb` payload, server version), `sn_history` (replaced and losing versions), `sn_members` + `sn_branches` (logins and branches), `sn_ping` (doorbell). Access: Supabase Auth, RLS (read own organisation only), writes only through RPCs. Client: outbox -> `sn_push` with `base_version`; `sn_pull` by `server_seq`; `sn_manifest` + pure `planSync` for the first / catch-up compare; Realtime event only triggers a pull, with a 60 s poll as backup. A reader older than a record's `min_reader_ver` sets it aside and shows "Update the app to see N bills".

## 4. Assumptions [A] the owner may flip
1. **Full replacement** of the encrypted postbox (v1 code stays dormant until Phase 142, then is removed). Not an option beside it.
2. **One login per computer** (seat), created by the generator query; not one shared login for the whole organisation. Branch NAME and PO prefix are chosen in the app at activation.
3. **"Latest wins"** is decided on the **skew-corrected `edited_at`** of the two competing versions; the server's version chain and `server_seq` order everything else. Not "last to arrive" (an older edit that reconnects late must not beat a newer one) and not raw clocks.
4. **Unencrypted data on Supabase** is accepted, including the real names and phone numbers in the legacy data; protection is Auth + RLS + sign-ups disabled + TLS (spec section 11).
5. Read-only branches and any Main role are NOT built (not requested).
6. Tombstones and history are kept on the server forever (small; Free plan size limit to be watched).
7. The generator inserts users into Supabase's `auth` tables directly (fragile technique, unproven until run); fallback is creating logins in the dashboard and attaching them with one query.
8. Similar-name customer matching is the existing party fuzzy search plus token rules, never automatic.
9. The v1 license key that was pasted into a chat is retired, not reused.

## 5. Free-plan facts (recheck before relying on them)
Quoted in the design discussion (from third-party pages, not Supabase's own page): Realtime about 200 concurrent connections, about 2 M messages a month, 256 KB per message; projects pause after about 7 days of inactivity; the Free plan has no backups. Phase 138 and Phase 128 must read the current Supabase pricing / limits page before building on these. Consequences already designed in: doorbell-only Realtime (tiny, no data), 60 s poll fallback, "server paused" status distinct from "offline", forced local backup before first sync.

## 6. The owner's two computers: how they cut over (Phase 140)
Both hold the same 1 927 bills (same ids) and 12 893 customers, merged through a backup earlier. Plan: fresh backup on both -> generate the new license + two logins in Supabase -> on computer 1 sign in, pick a branch name, press Sync (everything is "only local": upload) -> on computer 2 sign in, pick a different name, press Sync (same ids and content: skipped; anything only on 2: uploaded; anything only on 1: downloaded) -> run the customer unify once, on ONE computer. The v1 `postbox`, its stuck rows and the v1 license are abandoned (owner-run drop script in Phase 142). The decrypt bug stops mattering.

## 7. Order and gates
128 -> 129 -> 130 -> 131 (server side, SQL only, written not run) -> 132 -> 133 -> 134 -> 135 -> 136 -> 137 -> 138 -> 139 (client) -> 140 (cutover) -> 141 (simulation) -> 142 (retire v1) -> 143 (QA gate) -> Phase 69. Server phases come first because the client is built against the exact RPC shapes. Anything touching a real Supabase is a standing gap until the owner runs the checklist in `docs/SUPABASE_MIGRATIONS.md`; each phase must say exactly what it did and did not run.

## 8. Not part of this milestone (from the same handoff; tracked in `PHASE_STATUS.md` Known issues)
Updater crash `Cannot set properties of undefined (setting 'autoDownload')` (`updaterPort.ts`, probably ESM/CJS interop); renderer `toLowerCase` TypeError in `normalizeKey` / `eventToKeys` / `matchShortcut`; false "previous run did not close properly" notice after Start fresh; Dashboard weather "operation was aborted" and metals "fetch failed"; image capture legacy tier 771 px vs zoom tier 2157 px (2156 expected); Windows-only test failures (`security.test.ts` pathToFileURL, `conflicts.test.ts` 5 s timeout, `harness.test.ts` soak seed 11); a `publish:` block for `electron-builder.yml`. Privacy: `docs/reference/legacy_import/Bills_JSON.zip` holds real names and phone numbers; backups are full private SQLite copies; never commit a license key or password.
