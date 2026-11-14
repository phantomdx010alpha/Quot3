# MILESTONE 24 — Master Supabase, one-code onboarding, Seat-1 admin, company profile, quick fixes (Phases 251-274)

**Planned 2026-11-13 (docs only; nothing built, run or tested).** Binding for Phases 251-274. Rules: `CLAUDE_MUST_READ.md` section 10s (and the new "ONE PHASE PER SESSION" block at its top). Everything in 10r and earlier still holds.
Items marked **[A]** are unconfirmed assumptions; say so in every phase log. Owner answers to the open questions (section 11) change them, nothing else.

---

## 1. What the owner asked for (2026-11-13, in his words, cleaned)

1. A **master Supabase project** that knows every company's own Supabase project, so a new phone/PC needs **one code**, not URL + anon key + license + e-mail + password.
2. The PWA, when not linked, asks for **one field** (the code). After it verifies, everything syncs and the user carries on.
3. **Seat 1 is the admin automatically.** From the desktop app, with no SQL pushed by hand, seat 1 can create up to **15 seats**, delete, reset and rename seats, regenerate a seat's code, and control the other seat settings (including Price List rights).
4. Must be **swift and non-breaking**: companies already working must not break; already-logged-in devices must carry on and pick changes up live.
5. Other devices **inherit** logo, company name, contact number, address from seat 1 by default; they may edit locally afterwards.
6. Fix list: Price List rights not working for other seats; Price List page search (remove tab filter, one overall search, fix focus-jump); PWA Price List price columns stacked; desktop Dashboard tiles compact (5 in a row, Today+Month combined, second graph); AI default OFF and its controls hidden when OFF.

## 2. Facts found in the code (verified 2026-11-13 in the 0.1.55 zip; re-check before relying)

- **One Supabase project per company today.** `supabase/sql/01..20`: `licenses` (one row = one organisation; key stored only as SHA-256), `sn_members` (seat = one Supabase Auth user, `seat_no` 1-50), `sn_branches`, `sn_records`, `sn_push/sn_pull`, price files 18/19/20. Everything is already keyed by `org_id`.
- **Seats are made by owner-only SQL** (`14_license_admin.sql`): `qt_create_org`, `qt_add_seats`, `qt_reset_seat`, `qt_revoke_seat`, `qt_set_license_status`, `qt_attach_seat`. They are `revoke`d from `anon` / `authenticated`, so the app cannot call them; **a caller using the project's service_role key can** (PostgREST RPC). `qt_create_org` / `qt_add_seats` / `qt_reset_seat` return the passwords ONCE. `qt_make_login` writes into Supabase's `auth` tables directly (unproven on real Supabase [A]; the owner has run it, so it works for him).
- **The PWA stores five things** (`src/pwa/sync/session.ts` `VaultData`: `supabaseUrl`, `anonKey`, `license`, `email`, `session`) in one encrypted blob; the password is NOT kept, the refresh token keeps it signed in; when that fails the person types the password again.
- **Desktop keeps** the same in the OS secret store (`src/main/sync/electronSecretStore.ts`, `activationV2.ts`, settings > Shared sync).
- **Price rights.** `sn_price_perms` (file 19), seat 1 sets via `pricelist:permsSet`. The desktop (`priceRightsService.ts`) and phone (`pwa/data/priceRights.ts`, `runtime.refreshPriceRights`) keep a **cached copy** of their own flags. The cache is refreshed only when the Price List page opens (`PriceList.tsx` `load(true)`) or on the phone's refresh call; a failed refresh is swallowed (desktop logs at info level, phone ignores it); then a seat with no cache has NO rights. Seat 1's table reads the SERVER (`permsList`), so it can say "granted" while the other device's cache says "none". The server also refuses a push that lacks the flag. Also: filling an empty cell needs `edit`, changing a value needs `overwrite` (`shared/pricelist/perms.ts requiredFlags`). **Root cause on the owner's devices NOT yet confirmed; Phases 255-256 find it.**
- **AI:** `AI_DEFAULTS` (`src/shared/ai/aiSettings.ts`) are already all `false`; the Create-page `AiPanelSwitch` (Phase 226) is "always visible". The price strip (`priceStripStore`) is a separate Phase 240 feature.
- **Dashboard:** `src/renderer/pages/Dashboard.tsx` with `TodayTiles`, `StatTile`, `Sparkline`, `DashList` in `components/dashboard/`.
- **Settings keys `company.*`** already exist (name / address / phone / logo used by print). Phases 270-272 must read how before touching.

## 3. Architecture (additive; the existing design is NOT replaced)

```
                         ┌──────────────── MASTER Supabase (ONE project, yours) ───────────────┐
 Desktop (seat 1) ─────► │ Edge Functions  (the only door; no table is readable by any client)  │
 Desktop / PWA (seats) ─►│   client:  redeem, adopt, refresh, profile-get, heartbeat           │
                         │   admin:   seat-list/create/reset/revoke/rename/regen  (seat 1 only) │
                         │ Tables: companies, seats, devices, enrol_tokens, attempts, log       │
                         └───────────────┬─────────────────────────────────────────────────────┘
                                         │ service_role (held ONLY inside the master, encrypted)
                          ┌──────────────▼───────────┐   ┌──────────────────────────┐
                          │ Company A Supabase (as is)│   │ Company B Supabase (as is)│  ...
                          │ licenses/sn_*/qt_* SQL    │   │ same                      │
                          └──────────────────────────┘   └──────────────────────────┘
```
- **Bills and Price List data never touch the master.** Devices keep syncing with their company project exactly as today. The master only holds the company registry, seat credentials, device tokens and the company profile.
- **Company projects are unchanged** by the master except by the already-existing numbered SQL (and one new file 21 in Phase 256: the rights doorbell). The master drives them through their existing `qt_*` owner functions via PostgREST with the stored service_role key. No Auth Admin API is needed [A].
- **Legacy mode is permanent.** A device that was set up the old way (URL + key + license + login typed in) keeps working forever; the master is optional per company and per device.

## 4. Master data model (`supabase/master/` , a SEPARATE numbered series `M01..`; never mixed into `supabase/sql/`)

All tables: RLS ON, no policies, `revoke all` from `public, anon, authenticated`. Only Edge Functions (master's own service role) read or write.
- `companies(id uuid pk, label text unique, supabase_url, anon_key, license_key_enc, service_role_enc, status 'active'|'suspended', max_seats int default 15 check 1..15, profile jsonb, profile_version int, created_at)`
- `seats(company_id, seat_no 1..15, label text, email, password_enc, code_hash, code_enc, code_hint, legacy bool, status 'active'|'revoked', created_at, reset_at)` ; `legacy=true` = the seat existed before the master and its password is unknown to the master until a reset.
- `devices(id, company_id, seat_no, token_hash, label, created_at, last_seen_at)`
- `enrol_tokens(token_hash, company_label, expires_at, used_at)` : owner-minted, one use, lets a company be registered.
- `attempts(ip_hash, at, ok)` : redeem rate limit (10 failures / 15 min / ip, then 429).
- `master_log(id, at, company_id, seat_no, action, detail)` : no secrets, ever.
- **Encryption:** `*_enc` columns are AES-256-GCM sealed with a key that lives ONLY in the Edge Function secrets (`MASTER_KEK`), never in the database or in any client. A database dump alone reveals nothing. [A]

## 5. The code and the bundle

- **Seat code:** `Q3C-XXXX-XXXX-XXXX-XXXX`, alphabet A-Z and 2-7 (same family as the license key), the last character is a check character (typos are caught on the device without a network call). 75 bits of randomness (15 random characters + 1 check character; corrected in the Phase 257 freeze, see API_CONTRACTS.md M24-0). Master stores `code_hash` (SHA-256), `code_enc` (so seat 1 can re-show it) and a 4-character hint. **Reusable until reset or regenerated** [A] (a phone reinstall just works); a regenerate/reset invalidates the old code at once.
- **Bundle** returned by `redeem` (all over TLS, never logged): `{ v:1, company:{ id, label }, supabaseUrl, anonKey, license, seat:{ no, email, password }, profile:{ ...}, deviceToken }`. The PWA/desktop writes it straight into its existing vault / secret store, then runs the existing first-sync flow. **No existing sync code is replaced**: the master only supplies what the person used to type.
- **Device token:** 32 random bytes, stored hashed in `devices`, sent as header `x-q3-device`. It is how a device later asks the master for new credentials, and how seat 1's desktop proves it is seat 1 for admin calls.

## 6. Flows

1. **Owner onboards a NEW company (Phase 262 tooling):** owner runs the CLI with the new project's URL, anon key and service_role key. The CLI stores them in the master, applies `supabase/sql/11..21` (see `docs/MASTER_OWNER_SETUP.md`), calls `qt_create_org(label, seats)`, saves license + passwords sealed, and prints the **Seat-1 code**. After that nobody runs SQL again.
2. **Owner LINKS an EXISTING company (no break):** owner mints an enrol token in the CLI. On seat 1's desktop: Settings > Company seats > "Link to master": paste the enrol token, the company label (as in `licenses.label`) and the project's service_role key ONCE. The desktop sends them with its own valid session; the master verifies the session against the company project, checks it is seat 1, registers the company, and the desktop forgets the service_role key. All existing seats are recorded `legacy=true` (their passwords stay untouched, their devices keep working).
3. **Existing devices adopt silently (`adopt`):** on the first start after the update, a device that has a valid company session and whose company is registered calls `adopt` with that session (the master verifies it against the company project and maps it to a seat). It receives a device token. **No password change, no logout, no prompt.**
4. **New device (`redeem`):** the PWA/desktop is not linked, shows ONE field, sends the code, gets the bundle, signs in, first-syncs, resumes.
5. **Seat 1 creates a seat (`seat-create`):** master checks seat 1 + `max_seats` (15), calls `qt_add_seats`, seals the returned password, makes a code, returns it. Seat 1 reads the code out / copies it.
6. **Reset (`seat-reset`):** `qt_reset_seat` -> new password sealed -> that login's sessions end -> every device of that seat gets `auth_failed` on its next call -> it calls `refresh` with its device token -> receives the new password -> signs in silently. A LEGACY seat has no code until its first reset (then `legacy=false` and it gets a code).
7. **Delete (`seat-revoke`):** `qt_revoke_seat`; devices see the seat is gone and show "This seat was removed. Ask the admin for a new code." Bills already synced stay (existing behaviour); the device's local data is NOT wiped [A].
8. **Regenerate code:** new code, old one dead, devices already linked are unaffected (they use device tokens).
9. **Company profile:** seat 1 edits name / contact / address / logo; the master stores it with a `profile_version`. Every device asks `heartbeat` (throttled, at start and on each sync cycle) and downloads the profile when the version moved. A device may override a field locally; the override flag survives later master updates for that field only.
10. **Price rights changes reach live devices:** Phase 256 makes seat 1's save ring the doorbell, and every device re-reads its own flags on start, on each sync and after any refused push.

## 7. Compatibility matrix (what must still work; each execution phase re-proves its row by test)

| Situation | Result |
|---|---|
| Company never linked to master, devices set up the old way | Works exactly as 0.1.55. The master code paths are never entered. |
| Company linked, old device, updated app | `adopt` runs silently; no logout. If the master is unreachable nothing changes (sync does not depend on it). |
| Company linked, old device, NOT updated | Unchanged; it never learns of the master. |
| Master down / paused | Existing devices sync normally. Only: new-code redeem, seat admin, profile refresh and silent re-credential wait ("Master unreachable, try again"). |
| Seat reset while a device is offline | On its next online start: `auth_failed` -> `refresh` -> silent sign-in (or "ask admin" if the seat was removed). |
| Phone linked via the old five fields | Allowed; the one-field screen is the first option, "Advanced: enter details by hand" keeps the old form [A]. |

## 8. Security rules (never loosen)

- No client ever holds a service_role key except for the single moment seat 1 pastes it during "Link to master"; it is sent once and discarded, never saved, never logged, never in a backup or diagnostics file.
- No table of the master is reachable from `anon` / `authenticated`; clients only call Edge Functions.
- Admin functions require `device.seat_no = 1` AND the company/seat active; the check happens in the function, never in the client.
- `redeem` is rate limited and returns the same error for a wrong, revoked or expired code. The code and every `*_enc` value are redacted from logs and from `diagnostics.copy`.
- The master's own Supabase project: "Allow new users to sign up" OFF (it has no end-users at all).
- Honest limit: the master is a single point of compromise for every company's admin key. It is protected by the key-in-secrets rule above, the owner's Supabase account (turn on 2FA) and no client access. The owner must back it up (see 12).

## 9. Limits and defaults

Seats per company 15 (master-enforced; company SQL allows 50). Logo <= 150 KB (resized PNG). Profile text fields <= 200 chars. Code reusable until reset/regenerate. Master function timeouts 10 s; client retries once. No new npm dependency on the desktop or PWA (fetch only) [A]; master functions are Deno/TypeScript files under `supabase/master/functions/`.

## 10. HOW THE WORK IS SPLIT (the owner's rule: one phase = one FREE Claude session, no limit exhaustion)

Every phase below was sized to fit in ONE free-plan session: read at most the files listed, touch at most the files listed, run `npm run typecheck` once plus ONLY the named tests. Where thinking/decisions would be large, the decision work is its own **[D] docs-only phase** and execution phases just implement the frozen contract. Phase types: **[E]** execution (code), **[D]** decision/spec (docs only, no code, no typecheck), **[G]** release gate. Each phase lists its **Steps** (a, b, c): if the session is running out, STOP at a clean step boundary, log which steps are done, re-zip (rule 7).

| Group | Phases | Why it is separate |
|---|---|---|
| Quick fixes (renderer/PWA only) | 251, 252, 253, 254 | Independent of the master and of each other; any order; each ships alone. |
| Price rights | 255 (find + show + refresh), 256 (server doorbell + wording + Release A) | Diagnosis first, so 256 fixes the real cause. |
| Master contract | **257 [D]** | All shapes, errors and the compatibility matrix frozen in `API_CONTRACTS.md` so 258-272 never re-decide. |
| Master server | 258, 259, 260, 261, 262 | SQL / pure core / client functions / admin functions / owner tooling: five small phases. |
| Desktop | 263, 264, 265, 266, 267 | Service (no UI) / link wizard / seats list+create / seat actions / silent re-credential. |
| Phone | 268, 269 | Client (no UI) / one-field screen + silent re-credential. |
| Company profile | 270, 271, 272 | Model + desktop settings / desktop print+header use / phone. |
| Close | 273 [G], 274 | Gate + checklist / fix pack. |

## 11. Open questions for the owner (defaults in brackets are used if unanswered)

1. Seat code reusable until reset? [yes] 2. OK that the master holds each company's service_role key, sealed? [yes; it is the only way to remove hand-run SQL] 3. Master on its own free Supabase project? [yes, plus the keep-alive of Phase 262; paid plan advised] 4. The five Dashboard tiles: Today+This month (one tile) / Last 7 days + monthly graph (one tile) / Recent bills / Top customers / Last backup + sync [yes] 5. AI-off hides the Create-page AI switch AND the billing price strip [AI switch yes; strip: yes only if the owner confirms the strip counts as "price list stuff"]. 6. Keep the old five-field phone form under "Advanced"? [yes]

## 12. Standing gaps and risks (not "verified" by any sandbox)

Nothing in Phases 258-262 can be run against a real Supabase from the sandbox: master SQL, Edge Functions, onboarding CLI and every real company call are tested only against in-memory fakes + static SQL tests; the owner proves them with `docs/M24_OWNER_CHECKLIST.md` (written in Phase 273). `qt_make_login` direct-auth-table writes are the thing to watch on a fresh company project. A free master project pauses after about a week idle (keep-alive in Phase 262, or paid plan). The master has no automatic backups on the free plan: the owner exports the `companies` / `seats` tables (Phase 262 provides the export command). Real Windows, real Android and real Supabase behaviour are never claimed.
