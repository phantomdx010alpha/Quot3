# SECURITY_MODEL — Quot3

**Edit in place.** Binding for every phase; Phase 2 implements the shell items, Phases 51–53 the sync items.

## Threat model (realistic for this app)
Single-user Windows desktop app handling business quotations. Main risks: a bug in rendered content (pasted text, imported Excel, theme file, logo image) being turned into code execution; loss of data; leakage of bill data via Supabase; a stolen laptop reading the license key.

## Electron hardening (Phase 2)
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `enableBlinkFeatures` untouched, `devTools` only in dev builds.
- CSP set via response headers/meta: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. The renderer has **no network access**; only main talks to Supabase.
- `will-navigate` and `setWindowOpenHandler` deny everything except internal print/image windows created by main.
- Preload exposes a **named, typed** API; never `ipcRenderer` itself; no generic "invoke any channel".
- Every IPC input is Zod-validated; handlers never trust paths from the renderer (file paths for import/export come from native dialogs opened in main).
- Content from users (pasted HTML, rich text) is never inserted with `innerHTML`; runs are rendered as text nodes with style classes.

## Untrusted inputs
| Input | Handling |
|---|---|
| Theme JSON | token whitelist, value sanitiser (no `url()`/`expression`), clamps (Phase 3/49) |
| Logo image | decode in main, re-encode to PNG, size/dimension limits, never SVG with scripts (SVG rejected in v1) |
| Excel import | ExcelJS in main only; size limit; cell values coerced to strings; no formulas evaluated |
| Clipboard paste | plain text/TSV only; HTML flavour ignored for grid input |
| Backup import | validated as a SQLite file with expected schema + `integrity_check` before use; restore always preceded by a safety backup |
| Postbox rows | authenticated-encryption verified before parsing; schema-validated after decrypt |

## Data at rest
- SQLite in `%LOCALAPPDATA%\Quot3\` is **not encrypted** in v1 (bill data is business data, same exposure class as the owner's current app). Disk encryption (BitLocker) is the recommended control; documented in the owner hand-over notes.
- License key and derived sync key are stored only via Electron `safeStorage` (DPAPI, bound to the Windows user).
- Logs never contain bill content, party details, license keys or passphrases.

## Sync security (Phases 51–60) — see `docs/SYNC_POSTBOX_SPEC.md`
Client-side AES-256-GCM; server sees ciphertext + routing metadata only; RLS on with no direct policies; RPC-only access validating the license; no `service_role` key in the app, the repo or the installer; unacknowledged rows swept after TTL.

**As written in Phase 51 (`supabase/sql/`, run order and self-test in `docs/SUPABASE_MIGRATIONS.md`):**
- *Tables closed.* `licenses`, `branches`, `postbox` have RLS enabled, **zero policies**, and every privilege revoked from `anon` / `authenticated`. Nothing is readable or writable through the REST API.
- *RPC-only.* Six `SECURITY DEFINER` functions (`qt_register_branch`, `qt_list_branches`, `qt_push`, `qt_pull`, `qt_ack`, `qt_touch`) are the only granted entry points. Each has an empty `search_path` (no schema-shadowing), validates the license first, and works only inside the caller's organisation (recipient and sender must belong to it; `qt_ack` deletes only rows addressed to the caller). `qt_auth`, `qt_license_hash` and `qt_sweep` are not executable by the app roles.
- *No oracle.* Malformed, unknown and suspended license keys raise the same `invalid_license`. The key is stored only as `sha256('quot3-license:' + KEY)`.
- *Server sees:* org id, sender / recipient branch ids, bill UUID, op, revision, timestamps, nonce, ciphertext and its size. It never sees a party name, amount, item or any bill text. Branch names and PO prefixes are visible to the server (they are labels, not bill data).
- *Input limits enforced in SQL:* 200 items per push, 1 MB ciphertext, 12-byte nonce, 8 MB JSON per push, about 4 MB per pull, 1000 ids per ack, prefix alphabet / length, name length; one bad item rejects the whole push.
- *Residual risks (accepted, documented):* the 60-bit license key format means a leaked `licenses` table could be brute-forced offline, and there is no server-side lockout for wrong keys (Supabase rate limits only). Neither exposes bill content: that stays behind the org passphrase (PBKDF2 key, AES-256-GCM, bill id + revision as AAD - Phase 53). Branch / license data is metadata the owner already knows. The passphrase never leaves the devices.
- *Client side, as written in Phase 52:* the license key and the org passphrase are encrypted with Electron `safeStorage` (DPAPI) before they reach SQLite, and activation is refused when `safeStorage` is unavailable (no plaintext fallback). The anon key is public by design; the form refuses a `service_role` key (by text and by the JWT role claim). The renderer never receives the key, the anon key or the passphrase back (`license:status` returns only a masked hint), logs and audit rows never contain them, and nothing contacts Supabase until the owner activates a license. The transport uses HTTPS only (http only for localhost), a 15 s timeout, bounded retries for network faults only, and treats the license error (`Q3L01`) as a license problem, never as offline. Registration is all-or-nothing on the device.
- *Client side, Phase 53:* the org passphrase is used once at activation to derive the key (PBKDF2-HMAC-SHA256, 310 000 rounds, org salt) and is then discarded; only the derived key is kept, wrapped by safeStorage. Bills are sealed with AES-256-GCM, AAD = bill id + revision, so a row cannot be moved to another bill or revision; a 4-byte key check separates "wrong passphrase" from "damaged". The key check leaks nothing useful (32 bits of an HMAC of a constant). Inflate is capped at 32 MB against compression bombs.
- *Not yet proven:* none of this SQL has been executed (see Standing gaps in `PHASE_STATUS.md`); the owner's scratch-project run of `90_selftest.sql` is the proof.

## Sync security, Milestone 12 (Phases 128–143) — PLANNED; replaces the encrypted postbox above once Phase 140-142 are done
Full text: `docs/SYNC_SHARED_STORE_SPEC.md` section 11. In short:
- **Trade-off, owner to confirm:** the new engine has no client-side encryption, so readable bills and customers (including real names and phone numbers from the legacy import) are stored on Supabase. Protection is TLS, Supabase Auth (email + generated password per computer), a hashed license key, RLS (select own organisation only), RPC-only writes (empty `search_path`, `auth.uid()` checked, size limits), and **Authentication -> Email -> new sign-ups disabled** (checked by the owner's checklist; a stranger's account would still have no membership row and see nothing).
- No `service_role` key anywhere. The renderer has no network and never receives the license key, password, anon key or tokens; the session and seat password are `safeStorage`-wrapped; activation is refused when `safeStorage` is unavailable.
- The license-and-login generator writes into Supabase's `auth` tables from SQL (unproven until run) and is owner-only (not executable by `anon` / `authenticated`); its output is shown once and never stored in plain text.
- Residual risks: anyone with access to the Supabase project (the owner) can read the data; Free-plan projects have no automatic backups and pause after inactivity (availability, not confidentiality); there is no server-side lockout for wrong passwords beyond Supabase Auth's own rate limits. Removed by Phase 142: passphrase, PBKDF2 key, AES-GCM sealing, key check.

## Updates and distribution (Phases 62–65)
Updates over HTTPS from a configured feed, signature-verified when code signing is configured; updater never replaces the app while an unsaved bill is open.

## Reporting/logging
Errors logged locally; "Copy diagnostics" produces a redacted bundle the owner can send manually. No telemetry is collected or transmitted.
