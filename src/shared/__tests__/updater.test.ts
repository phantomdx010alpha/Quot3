import { describe, expect, it } from 'vitest'
import {
  buildUpdaterOptions, cleanVersion, clampPercent, describeUpdate, friendlyUpdateError, initialUpdateState, installGate, isNewer, parseChannel, parseFeed
} from '../updater'

describe('Phase 62 - updater rules', () => {
  it('feed address: built-in, GitHub, https; refuses http, credentials, junk', () => {
    expect(parseFeed('')).toEqual({ ok: true, feed: { kind: 'builtin' } })
    expect(parseFeed('  github:acme/quot3 ')).toEqual({ ok: true, feed: { kind: 'github', owner: 'acme', repo: 'quot3' } })
    expect(parseFeed('https://updates.example.com/quot3/')).toEqual({ ok: true, feed: { kind: 'generic', url: 'https://updates.example.com/quot3/' } })
    for (const bad of ['http://updates.example.com', 'https://u:p@example.com/x', 'ftp://x.com', 'not a url', 'github:acme', `https://x.com/${'a'.repeat(400)}`]) {
      expect(parseFeed(bad).ok, bad).toBe(false)
    }
    expect(parseFeed(42)).toEqual({ ok: true, feed: { kind: 'builtin' } })
  })

  it('channel options never allow a downgrade', () => {
    expect(parseChannel('beta')).toBe('beta')
    expect(parseChannel('anything')).toBe('stable')
    expect(buildUpdaterOptions({ kind: 'builtin' }, 'stable')).toEqual({ feed: { kind: 'builtin' }, channel: 'latest', allowPrerelease: false, allowDowngrade: false })
    expect(buildUpdaterOptions({ kind: 'builtin' }, 'beta')).toMatchObject({ channel: 'beta', allowPrerelease: true, allowDowngrade: false })
  })

  it('versions: strict compare, cleaned input', () => {
    expect(isNewer('1.2.0', '1.1.9')).toBe(true)
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('0.9.9', '1.0.0')).toBe(false)
    expect(isNewer('1.0.1-beta.1', '1.0.0')).toBe(true)
    expect(cleanVersion(' 1.2.3 ')).toBe('1.2.3')
    expect(cleanVersion('1.2.3-beta.2')).toBe('1.2.3-beta.2')
    expect(cleanVersion('<script>')).toBe('')
    expect(cleanVersion(undefined)).toBe('')
    expect(clampPercent(140)).toBe(100)
    expect(clampPercent(-3)).toBe(0)
    expect(clampPercent(NaN)).toBe(0)
    expect(clampPercent(41.6)).toBe(42)
  })

  it('install gate: only a downloaded update, and never while a bill is unsaved', () => {
    expect(installGate({ phase: 'idle', busy: false })).toBe('not-ready')
    expect(installGate({ phase: 'downloading', busy: false })).toBe('not-ready')
    expect(installGate({ phase: 'ready', busy: true })).toBe('busy')
    expect(installGate({ phase: 'ready', busy: false })).toBe('ok')
  })

  it('copy and friendly errors carry no raw detail', () => {
    const s = { ...initialUpdateState('1.0.0'), phase: 'ready' as const, version: '1.1.0' }
    expect(describeUpdate(s).detail).toContain('Restart Quot3')
    expect(describeUpdate({ ...s, busy: true }).detail).toContain('open bill is saved')
    expect(describeUpdate({ ...s, phase: 'downloading', percent: 40 }).detail).toContain('40%')
    expect(friendlyUpdateError(new Error('getaddrinfo ENOTFOUND github.com token=abc'))).not.toContain('github.com')
    expect(friendlyUpdateError(new Error('sha512 checksum mismatch'))).toContain('safety check')
    expect(friendlyUpdateError(new Error('HTTP 404 latest.yml'))).toContain('No update information')
    expect(friendlyUpdateError('weird')).toContain('did not finish')
  })
})
