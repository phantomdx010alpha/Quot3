// Phase 65 - "is code signing configured?" check for release builds. Prints WHICH method is set up, never a value.
//   node scripts/signing-env.mjs                 exit 0 when a method is complete, 1 when nothing / something half-set
//   node scripts/signing-env.mjs --allow-unsigned  always exit 0 (prints the same status line)
// Used by `npm run dist:signed` so a release can never silently come out unsigned.
const env = process.env
const has = (k) => typeof env[k] === 'string' && env[k].trim() !== ''
const allowUnsigned = process.argv.includes('--allow-unsigned')

const link = has('CSC_LINK') || has('WIN_CSC_LINK')
const pass = has('CSC_KEY_PASSWORD') || has('WIN_CSC_KEY_PASSWORD')
const azureVars = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']
const azureSet = azureVars.filter(has)

let status
if (link && pass) status = { ok: true, line: 'signing: certificate file (CSC_LINK + password) is set' }
else if (azureSet.length === azureVars.length) status = { ok: true, line: 'signing: Azure signing account credentials are set (win.azureSignOptions must also be filled in electron-builder.yml)' }
else if (link && !pass) status = { ok: false, line: 'signing: CSC_LINK is set but the certificate password (CSC_KEY_PASSWORD) is missing' }
else if (azureSet.length > 0) status = { ok: false, line: `signing: only ${azureSet.length} of 3 Azure variables are set (need ${azureVars.join(', ')})` }
else status = { ok: false, line: 'signing: nothing is configured - the installer would be UNSIGNED (see docs/RELEASE_SIGNING.md)' }

console.log(status.line)
process.exit(status.ok || allowUnsigned ? 0 : 1)
