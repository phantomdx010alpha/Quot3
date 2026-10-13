import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..', '..')
const script = join(root, 'scripts', 'signing-env.mjs')
const run = (env: Record<string, string>, args: string[] = []): { code: number; out: string } => {
  const r = spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env['PATH'] ?? '', ...env }, encoding: 'utf8' })
  return { code: r.status ?? -1, out: r.stdout }
}

describe('Phase 65 - signing environment check', () => {
  it('nothing set: refuses (exit 1), unless unsigned is allowed', () => {
    const r = run({})
    expect(r.code).toBe(1)
    expect(r.out).toContain('UNSIGNED')
    expect(run({}, ['--allow-unsigned']).code).toBe(0)
  })
  it('certificate file needs its password; either variable spelling counts', () => {
    expect(run({ CSC_LINK: 'x.pfx' }).code).toBe(1)
    expect(run({ CSC_LINK: 'x.pfx' }).out).toContain('password')
    expect(run({ CSC_LINK: 'x.pfx', CSC_KEY_PASSWORD: 'p' }).code).toBe(0)
    expect(run({ WIN_CSC_LINK: 'x.pfx', WIN_CSC_KEY_PASSWORD: 'p' }).code).toBe(0)
    expect(run({ CSC_LINK: '   ', CSC_KEY_PASSWORD: 'p' }).code).toBe(1)
  })
  it('Azure needs all three variables', () => {
    expect(run({ AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c' }).code).toBe(1)
    expect(run({ AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' }).code).toBe(0)
  })
  it('never prints a secret value', () => {
    const r = run({ CSC_LINK: 'SECRETLINK', CSC_KEY_PASSWORD: 'SECRETPASS', AZURE_CLIENT_SECRET: 'SECRETAZ' })
    expect(r.out).not.toMatch(/SECRET/)
  })
  it('the script parses as plain Node', () => {
    expect(() => execFileSync(process.execPath, ['--check', script])).not.toThrow()
  })
})

describe('Phase 65 - config hooks and docs', () => {
  const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  it('signtool hooks are present, secrets and a premature publisherName are not', () => {
    expect(yml).toMatch(/^\s+signtoolOptions:/m)
    expect(yml).toMatch(/signingHashAlgorithms: \[sha256\]/)
    expect(yml).toMatch(/rfc3161TimeStampServer: https?:\/\//)
    expect(yml).not.toMatch(/^\s*(cscLink|cscKeyPassword|certificatePassword|certificateFile):/m)
    expect(yml).not.toMatch(/^\s*publisherName:/m) // only the commented example exists until a real certificate does
  })
  it('dist:signed checks the environment first and forces signing', () => {
    const s = pkg.scripts['dist:signed']!
    expect(s.startsWith('node scripts/signing-env.mjs && ')).toBe(true)
    expect(s).toContain('-c.forceCodeSigning=true')
    expect(pkg.scripts['dist']).not.toContain('forceCodeSigning')
    expect(pkg.scripts['check:signing']).toBe('node scripts/signing-env.mjs')
  })
  it('the guide covers options, SmartScreen, antivirus, hooks and the checklist', () => {
    const doc = readFileSync(join(root, 'docs', 'RELEASE_SIGNING.md'), 'utf8')
    for (const h of ['SmartScreen', 'Antivirus false positives', 'Turning signing on', 'Release checklist', 'CSC_LINK', 'Get-AuthenticodeSignature', 'latest.yml']) expect(doc, h).toContain(h)
  })
})
