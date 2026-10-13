# Code signing, SmartScreen and the release checklist (Phase 65)

Status: **no certificate has been bought. Nothing is signed yet.** This file says what to buy, how to switch signing on without
touching code, what Windows will show users meanwhile, and the steps to run for every release.
Prices and eligibility below were read from Microsoft's "Code signing options" page and electron-builder's docs on 2026-10-10;
check them again before paying.

## 1. What signing does (and does not do)

- A signature proves **who published** the installer and that it was **not changed** after signing. Windows shows the publisher name
  instead of "Unknown publisher".
- It does **not** make SmartScreen go quiet by itself (section 3), and it does not stop every antivirus false alarm (section 4).
- The installer AND the app (`Quot3.exe`) are signed by electron-builder in one run. The signature is timestamped, so it stays valid
  after the certificate expires.

## 2. Options (pick one; this phase buys none)

| Option | Cost (per Microsoft, Oct 2026) | Notes |
|---|---|---|
| **Azure Artifact Signing** (formerly Trusted Signing) | about $9.99 / month | Cloud signing, no hardware token, works from CI. Identity check takes a few business days. Organisations in USA / Canada / EU / UK; individuals only USA / Canada. |
| **OV certificate** from a CA (DigiCert, Sectigo ...) | about $150-300 / year | Works worldwide. Since June 2023 the private key must live on a hardware token or cloud HSM, so a `.pfx` in CI is usually not possible; use the CA's cloud-signing service or a token on one build machine. |
| **EV certificate** | $400+ / year | Since 2024 EV gets **no** SmartScreen shortcut; it builds reputation like OV. Not worth the premium for this reason alone. |
| **Microsoft Store (MSIX)** | free signing | The Store re-signs and shows no SmartScreen prompt, but it is a different package type from the NSIS installer and the Store is not the plan here. |
| Self-signed | free | Strong SmartScreen block for everyone. Only for your own testing. |

Recommendation: **Azure Artifact Signing** if the owner's country is eligible (cheapest, CI-friendly); otherwise an **OV** certificate
with the CA's cloud signing.

## 3. SmartScreen, in plain words

SmartScreen judges a downloaded installer by **reputation**, not only by signature.
- **Unsigned:** a strong blue "Windows protected your PC" block. The user must click "More info" then "Run anyway". Some company PCs
  forbid this entirely.
- **Signed, brand-new publisher:** the warning can still appear at first, but it names the publisher.
- **Signed, consecutive releases with the SAME identity:** reputation accumulates with downloads, and the warning fades. Keep the same
  certificate subject / account across releases; changing it resets reputation.
- Nobody can buy instant trust (EV no longer does it). Plan for the first weeks of warnings.
- Auto-updates downloaded by the app are checked by `electron-updater` (sha512 from `latest.yml`, and the signer's publisher name once
  `publisherName` is set) and do not show SmartScreen.

What to tell branch users meanwhile: "Windows may warn on the first install. Click More info, then Run anyway. The file is Quot3-Setup-x.y.z.exe
from the owner."

## 4. Antivirus false positives

New, small, unsigned programs are often flagged by heuristics, and per-user installers that write to `%LOCALAPPDATA%` can look
suspicious to them. What reduces it:
1. Sign every release with the same identity (section 2).
2. Do not use packers, obfuscators or "protectors" on the executable.
3. Publish from one stable download address; keep file names consistent.
4. If a vendor flags a build: submit the file as a false positive to that vendor (for Microsoft Defender use the Security Intelligence
   file-submission page, choosing "software developer"). Keep the SHA-256 of the release for the report.
5. Tell customers the SHA-256 of each release (checklist step 9) so they can compare it.

## 5. Turning signing on (no code change)

`electron-builder.yml` already has the hooks (`win.signtoolOptions`: SHA-256, DigiCert RFC 3161 timestamp). Secrets come from environment
variables on the build machine / CI secret store, **never** from files in the repository.

**A. Certificate file or token via signtool**
| Variable | Meaning |
|---|---|
| `CSC_LINK` (or `WIN_CSC_LINK`) | path, https URL or base64 of the `.pfx` |
| `CSC_KEY_PASSWORD` (or `WIN_CSC_KEY_PASSWORD`) | its password |
For a hardware token or HSM use electron-builder's `win.signtoolOptions.certificateSubjectName` / `certificateSha1` (or its `hsm` / `pkcs11`
signing types) and run the build on the machine that holds the token. Check the electron-builder "Windows code signing" page for the
current fields.

**B. Azure Artifact Signing (cloud)**
1. Create the signing account and certificate profile in Azure; validate the identity.
2. Create a service principal and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` in CI.
3. In `electron-builder.yml` replace `signtoolOptions` with `azureSignOptions` (`endpoint`, `codeSigningAccountName`,
   `certificateProfileName`, `publisherName`). The two cannot be used together.

**Then**
- Set `publisherName` (exact certificate subject) so updates are verified against the same publisher. **Do not set it before a
  certificate exists**, or every update check will fail.
- Build with `npm run dist:signed`. It first runs `npm run check:signing` (stops if nothing or only part of the credentials is set, and
  never prints a secret) and then builds with `forceCodeSigning`, so an unsigned installer cannot come out by mistake.
- `npm run dist` still builds unsigned (for your own testing).

## 6. Release checklist (every release)

1. All tests green: `npm run typecheck` and `npm test`.
2. Update `CHANGELOG`-style notes in `PHASE_STATUS.md`; decide the version (`MAJOR.MINOR.PATCH`, `-beta.N` for the beta channel).
3. Bump `version` in `package.json` (the About screen and updater read it). Commit with the lockfile.
4. Build on Windows or CI: `npm run dist:signed` -> `release/Quot3-Setup-<version>.exe` (+ `latest.yml` when a publish target is set).
5. Verify the signature in PowerShell: `Get-AuthenticodeSignature .\\release\\Quot3-Setup-<version>.exe | Format-List` -> `Status: Valid`, the
   expected publisher, a timestamp present. Do the same for `release\\win-unpacked\\Quot3.exe`.
6. Install on a **clean Windows 10 / 11 machine or VM** (no dev tools): no admin prompt, shortcuts appear, the app starts, create / save /
   print a bill, quit and relaunch (data still there).
7. Uninstall: the data question appears, answering No keeps `%LOCALAPPDATA%\\Quot3`, answering Yes removes it.
8. Update test: install the PREVIOUS release, publish this one, run Settings > Updates > Check, download, Restart to update; the bill
   data is intact and an unsaved bill is never interrupted.
9. Record the SHA-256: `Get-FileHash .\\release\\Quot3-Setup-<version>.exe -Algorithm SHA256`. Publish it with the release.
10. Upload the installer and `latest.yml` to the publish target (GitHub release or the https folder in Settings > Updates). Upload
    `latest.yml` **last**, so no one is offered an update whose file is missing.
11. Open the download link from a different PC and note what SmartScreen / the antivirus says (expected on early releases: a warning).
12. Keep the previous release downloadable for one release cycle (rollback).

## 7. Not decided yet (owner)

- Which certificate option, and whose legal name / country the publisher shows.
- The publish target (GitHub or a web address): see Phase 64 notes in `PHASE_STATUS.md`.
- Whether to also offer a Microsoft Store package.
