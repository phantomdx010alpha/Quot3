import { describe, expect, it } from 'vitest'
import {
  buildEntries, buildRollbackOptions, compareVersions, friendlyReleaseListError, parseReleaseList, parseSchemaLine, releaseChannelOf,
  rollbackConfirmText, rollbackDecision, rollbackFeedUrl, versionFromTag, chooseVersionSchema, type RollbackRelease
} from '../rollback'
import { buildUpdaterOptions } from '../updater'

const assets = (v: string, ch = 'latest', state = 'uploaded') => [
  { name: `${ch}.yml`, state }, { name: `Quot3-Setup-${v}.exe`, state }, { name: `Quot3-Setup-${v}.exe.blockmap`, state }
]
const rel = (v: string, extra: Record<string, unknown> = {}) => ({ tag_name: `v${v}`, draft: false, prerelease: false, body: '', published_at: '2026-10-12T10:00:00Z', assets: assets(v), ...extra })

describe('0.1.5 rollback - release list', () => {
  it('schema line: found on its own line, any line ending; junk is null', () => {
    expect(parseSchemaLine('Notes\nschema: 9\nMore')).toBe(9)
    expect(parseSchemaLine('schema:8\r\nx')).toBe(8)
    expect(parseSchemaLine('## What changed\r\n  Schema: 12  \r\n')).toBe(12)
    expect(parseSchemaLine('the schema: 9 changed')).toBeNull()
    expect(parseSchemaLine('schema: nine')).toBeNull()
    expect(parseSchemaLine(null)).toBeNull()
  })

  it('tags and versions', () => {
    expect(versionFromTag('v0.1.4')).toBe('0.1.4')
    expect(versionFromTag('0.1.4')).toBe('0.1.4')
    expect(versionFromTag('latest')).toBe('')
    expect(versionFromTag('v1.2.3; rm -rf')).toBe('')
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBe(1)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBe(1)
    expect(compareVersions('1.0.0-beta.1', '1.0.0-alpha.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(releaseChannelOf('0.2.0')).toBe('latest')
    expect(releaseChannelOf('0.2.0-beta.1')).toBe('beta')
  })

  it('lists only complete, published releases, newest first, with legacy schema 8', () => {
    const json = [
      rel('0.1.2'), rel('0.1.4'), rel('0.1.3'),
      rel('0.1.1'), // older than 0.1.2: those builds cannot update themselves
      { ...rel('0.1.5'), draft: true },
      { ...rel('0.1.6'), assets: [{ name: 'Quot3-Setup-0.1.6.exe.blockmap', state: 'uploaded' }] }, // the 422 race: only the blockmap
      { ...rel('0.1.7'), assets: assets('0.1.7').filter((a) => a.name !== 'latest.yml') },
      { ...rel('0.1.8'), assets: assets('0.1.8', 'latest', 'starter') }, // upload not finished
      rel('0.1.4'), // duplicate
      { tag_name: 'nightly', assets: [] }, 'junk', null
    ]
    const list = parseReleaseList(json, 'stable')
    expect(list.map((r) => r.version)).toEqual(['0.1.4', '0.1.3', '0.1.2'])
    expect(list.every((r) => r.schema === 8)).toBe(true)
    expect(list[0]).toMatchObject({ prerelease: false, publishedAt: '2026-10-12T10:00:00Z' })
  })

  it('schema from the notes wins; a newer release without the line is unknown (null), never guessed', () => {
    const list = parseReleaseList([rel('0.2.0', { body: 'Changes\nschema: 9' }), rel('0.1.9'), rel('0.1.4')], 'stable')
    expect(list.map((r) => [r.version, r.schema])).toEqual([['0.2.0', 9], ['0.1.9', null], ['0.1.4', 8]])
  })

  it('pre-releases only on the beta channel, using their own update file', () => {
    const beta = { ...rel('0.3.0-beta.1'), prerelease: true, assets: assets('0.3.0-beta.1', 'beta'), body: 'schema: 9' }
    expect(parseReleaseList([beta, rel('0.1.4')], 'stable').map((r) => r.version)).toEqual(['0.1.4'])
    expect(parseReleaseList([beta, rel('0.1.4')], 'beta').map((r) => r.version)).toEqual(['0.3.0-beta.1', '0.1.4'])
    // a beta release that only has latest.yml is not installable through the beta file
    expect(parseReleaseList([{ ...beta, assets: assets('0.3.0-beta.1', 'latest') }], 'beta')).toEqual([])
    expect(parseReleaseList({ message: 'API rate limit exceeded' }, 'stable')).toEqual([])
  })
})

describe('0.1.5 rollback - data safety decision', () => {
  const r = (version: string, schema: number | null): RollbackRelease => ({ version, schema, prerelease: false, publishedAt: '' })
  it('blocks a version whose data format is older than the bills in use', () => {
    const v = rollbackDecision({ target: r('0.1.2', 8), currentVersion: '0.2.0', dbSchema: 9 })
    expect(v).toMatchObject({ ok: false, reason: 'schema-older' })
    expect((v as { message: string }).message).toMatch(/unable to save bills/)
  })
  it('allows equal or newer data format; blocks unknown, same version and unlisted', () => {
    expect(rollbackDecision({ target: r('0.1.2', 8), currentVersion: '0.1.4', dbSchema: 8 })).toEqual({ ok: true })
    expect(rollbackDecision({ target: r('0.3.0', 10), currentVersion: '0.1.4', dbSchema: 8 })).toEqual({ ok: true })
    expect(rollbackDecision({ target: r('0.1.9', null), currentVersion: '0.1.4', dbSchema: 8 })).toMatchObject({ ok: false, reason: 'schema-unknown' })
    expect(rollbackDecision({ target: r('0.1.4', 8), currentVersion: '0.1.4', dbSchema: 8 })).toMatchObject({ ok: false, reason: 'same' })
    expect(rollbackDecision({ target: undefined, currentVersion: '0.1.4', dbSchema: 8 })).toMatchObject({ ok: false, reason: 'not-listed' })
  })
  it('list rows: the current one is marked, blocked ones carry the reason', () => {
    const rows = buildEntries([r('0.2.0', 9), r('0.1.4', 8), r('0.1.2', 8)], '0.2.0', 9)
    expect(rows.map((e) => [e.version, e.current, e.allowed])).toEqual([['0.2.0', true, false], ['0.1.4', false, false], ['0.1.2', false, false]])
    expect(rows[0]!.why).toBe('')
    expect(rows[1]!.why).toMatch(/newer format/)
    const ok = buildEntries([r('0.1.4', 8), r('0.1.2', 8)], '0.1.4', 8)
    expect(ok.map((e) => [e.current, e.allowed, e.why])).toEqual([[true, false, ''], [false, true, '']])
  })
})

describe('0.1.5 rollback - address and options', () => {
  it('the address comes only from a clean version', () => {
    expect(rollbackFeedUrl('0.1.2')).toBe('https://github.com/phantomdx010alpha/Quot3/releases/download/v0.1.2/')
    for (const bad of ['', 'v0.1.2', '0.1.2/../../x', '0.1.2?x=1', ' 0.1.2', 'latest', '1.2']) expect(() => rollbackFeedUrl(bad), bad).toThrow()
    expect(chooseVersionSchema.safeParse({ version: '0.1.2', url: 'https://evil' }).success).toBe(false)
  })
  it('rollback options allow a downgrade; the normal options never do', () => {
    expect(buildRollbackOptions('0.1.2')).toEqual({ feed: { kind: 'generic', url: 'https://github.com/phantomdx010alpha/Quot3/releases/download/v0.1.2/' }, channel: 'latest', allowPrerelease: false, allowDowngrade: true })
    expect(buildRollbackOptions('0.3.0-beta.1')).toMatchObject({ channel: 'beta', allowPrerelease: true })
    expect(buildUpdaterOptions({ kind: 'builtin' }, 'stable').allowDowngrade).toBe(false)
  })
  it('plain words', () => {
    expect(rollbackConfirmText('0.1.4', '0.1.2')).toBe('This replaces 0.1.4 with 0.1.2. Your bills are kept. A backup is made first.')
    expect(friendlyReleaseListError(new Error('HTTP 403'))).toMatch(/limiting requests/)
    expect(friendlyReleaseListError(new Error('fetch failed'))).toMatch(/No connection/)
    expect(friendlyReleaseListError(new Error('HTTP 500 at https://x?token=abc'))).not.toMatch(/token/)
  })
})
