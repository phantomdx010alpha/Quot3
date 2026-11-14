import { describe, expect, it } from 'vitest'
import { MASTER_ERRORS } from '../errors'
import {
  AdoptResponseSchema, BundleSchema, EnrolRequestSchema, ErrorBodySchema, HeartbeatResponseSchema, MASTER_FUNCTIONS,
  ProfileSetRequestSchema, ProfileViewSchema, RedeemRequestSchema, SeatCreateRequestSchema, SeatListResponseSchema,
  SeatRenameRequestSchema, SeatResetRequestSchema, SeatViewSchema, base64DecodedLength, parseBundle, parseErrorBody,
  parseRequest, profileTooLarge
} from '../schemas'
import { MASTER_FUNCTION_NAMES, isMasterConfigured, masterFunctionUrl, masterHeaders } from '../config'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'
const UUID = '3f2b8c1e-5d4a-4b7e-9a1c-2d6e8f0a1b3c'
const profile = { version: 3, name: 'Shop A', phone: '123', address: 'Street 1', logo: null }
const bundle = {
  v: 1, company: { id: 'c1', label: 'Shop A' }, supabaseUrl: 'https://abcd.supabase.co', anonKey: 'anon-key-value',
  license: 'Q3-ABCD-EFGH-IJKL', seat: { no: 2, email: 'seat2@shop.invalid', password: 'pw-1234' }, profile, deviceToken: TOKEN
}
const seat = {
  no: 2, label: 'Counter', email: null, status: 'active', legacy: false, code: 'Q3C-ABCD-EFGH-IJKL-MNOE', codeHint: 'MNOE',
  createdAt: '2026-11-13T10:00:00Z', resetAt: null, devices: 1, lastSeenAt: null
}

describe('schemas', () => {
  it('registry has F1..F13 in order, each with request and response', () => {
    expect(Object.keys(MASTER_FUNCTIONS)).toEqual([...MASTER_FUNCTION_NAMES])
    Object.values(MASTER_FUNCTIONS).forEach((f, i) => expect(f.n).toBe(i + 1))
  })

  it('bundle: good one parses; wrong version -> Q3M92; broken -> Q3M93 (T31)', () => {
    expect(BundleSchema.safeParse(bundle).success).toBe(true)
    expect(parseBundle(bundle)).toEqual({ ok: true, bundle })
    expect(parseBundle({ ...bundle, v: 2 })).toEqual({ ok: false, code: 'Q3M92' })
    expect(parseBundle({ ...bundle, v: 0 })).toEqual({ ok: false, code: 'Q3M92' })
    expect(parseBundle({ ...bundle, seat: { no: 99, email: 'a@b.c', password: 'p' } })).toEqual({ ok: false, code: 'Q3M93' })
    expect(parseBundle({ ...bundle, deviceToken: 'short' })).toEqual({ ok: false, code: 'Q3M93' })
    expect(parseBundle({ ...bundle, license: 'not-a-key' })).toEqual({ ok: false, code: 'Q3M93' })
    expect(parseBundle({ ...bundle, supabaseUrl: 'ftp://x' })).toEqual({ ok: false, code: 'Q3M93' })
    expect(parseBundle(null)).toEqual({ ok: false, code: 'Q3M93' })
    expect(parseBundle('x')).toEqual({ ok: false, code: 'Q3M93' })
    expect(parseBundle({ ...bundle, v: undefined })).toEqual({ ok: false, code: 'Q3M93' })
    const { profile: _p, ...noProfile } = bundle
    expect(parseBundle(noProfile).ok).toBe(false)
    expect(parseBundle({ ...bundle, profile: null }).ok).toBe(true)
  })

  it('profile: limits on text and logo', () => {
    expect(ProfileViewSchema.safeParse(profile).success).toBe(true)
    expect(ProfileViewSchema.safeParse({ ...profile, name: 'x'.repeat(201) }).success).toBe(false)
    expect(ProfileViewSchema.safeParse({ ...profile, logo: 'data:image/png;base64,AAAA' }).success).toBe(false)
    const big = 'A'.repeat(Math.ceil((150 * 1024 + 10) / 3) * 4)
    expect(ProfileViewSchema.safeParse({ ...profile, logo: big }).success).toBe(false)
    expect(ProfileViewSchema.safeParse({ ...profile, logo: 'iVBORw0KGgo=' }).success).toBe(true)
    expect(base64DecodedLength('iVBORw0KGgo=')).toBe(8)
    expect(base64DecodedLength('QUJD')).toBe(3)
    expect(base64DecodedLength('QUI=')).toBe(2)
  })

  it('profileTooLarge: text over 200, logo over 150 KB or not base64 (T17 -> Q3M18)', () => {
    const base = { name: 'a', phone: 'b', address: 'c' }
    expect(profileTooLarge(base)).toBe(false)
    expect(profileTooLarge({ ...base, name: 'x'.repeat(200) })).toBe(false)
    expect(profileTooLarge({ ...base, address: 'x'.repeat(201) })).toBe(true)
    expect(profileTooLarge({ ...base, logo: null })).toBe(false)
    expect(profileTooLarge({ ...base, logo: 'A'.repeat(Math.ceil((150 * 1024 + 10) / 3) * 4) })).toBe(true)
    expect(profileTooLarge({ ...base, logo: 'not base64!' })).toBe(true)
  })

  it('seat view never has a password field and parses', () => {
    expect(SeatViewSchema.safeParse(seat).success).toBe(true)
    expect('password' in SeatViewSchema.shape).toBe(false)
    expect(SeatViewSchema.safeParse({ ...seat, status: 'gone' }).success).toBe(false)
    expect(SeatListResponseSchema.safeParse({
      ok: true, company: { id: 'c1', label: 'Shop A', maxSeats: 15, status: 'active' }, seats: [seat]
    }).success).toBe(true)
  })

  it('requests: parseRequest answers Q3M19 for another version and Q3M03 for a bad shape', () => {
    const good = { v: 1, code: 'Q3C-ABCD', platform: 'phone', appVersion: '0.1.56' }
    expect(parseRequest(RedeemRequestSchema, good)).toEqual({ ok: true, value: good })
    expect(parseRequest(RedeemRequestSchema, { ...good, v: 2 })).toEqual({ ok: false, code: 'Q3M19' })
    expect(parseRequest(RedeemRequestSchema, { code: 'x' })).toEqual({ ok: false, code: 'Q3M03' })
    expect(parseRequest(RedeemRequestSchema, { ...good, platform: 'tv' })).toEqual({ ok: false, code: 'Q3M03' })
    for (const bad of [null, 'x', 5, [], undefined]) expect(parseRequest(RedeemRequestSchema, bad)).toEqual({ ok: false, code: 'Q3M03' })
  })

  it('seat requests: label 1-40 (trimmed), seatNo 1..15, reqId uuid (T15)', () => {
    const p = (s: any, b: any) => parseRequest(s, { v: 1, ...b }).ok
    expect(p(SeatCreateRequestSchema, { reqId: UUID, label: 'Counter' })).toBe(true)
    expect(p(SeatCreateRequestSchema, { reqId: UUID, label: '' })).toBe(false)
    expect(p(SeatCreateRequestSchema, { reqId: UUID, label: '   ' })).toBe(false)
    expect(p(SeatCreateRequestSchema, { reqId: UUID, label: 'x'.repeat(40) })).toBe(true)
    expect(p(SeatCreateRequestSchema, { reqId: UUID, label: 'x'.repeat(41) })).toBe(false)
    expect(p(SeatCreateRequestSchema, { reqId: 'not-a-uuid', label: 'a' })).toBe(false)
    expect(p(SeatResetRequestSchema, { reqId: UUID, seatNo: 15 })).toBe(true)
    expect(p(SeatResetRequestSchema, { reqId: UUID, seatNo: 16 })).toBe(false)
    expect(p(SeatResetRequestSchema, { reqId: UUID, seatNo: 0 })).toBe(false)
    expect(p(SeatResetRequestSchema, { reqId: UUID, seatNo: 1.5 })).toBe(false)
    expect(p(SeatRenameRequestSchema, { seatNo: 1, label: 'x'.repeat(41) })).toBe(false)
    expect(p(SeatRenameRequestSchema, { seatNo: 1, label: 'Boss' })).toBe(true)
  })

  it('profile-set request lets over-size through to the size check (not "bad request")', () => {
    const body = { v: 1, reqId: UUID, name: 'x'.repeat(500), phone: '', address: '' }
    const r = parseRequest(ProfileSetRequestSchema, body)
    expect(r.ok).toBe(true)
    expect(parseRequest(ProfileSetRequestSchema, { ...body, name: 5 }).ok).toBe(false)
    expect(parseRequest(ProfileSetRequestSchema, { ...body, name: 'a', logo: null, expectVersion: 2 }).ok).toBe(true)
  })

  it('enrol request needs the license shape and an https url', () => {
    const good = {
      v: 1, enrolToken: 't', label: 'Shop A', supabaseUrl: 'https://abcd.supabase.co', anonKey: 'k', license: 'Q3-ABCD-EFGH-IJKL',
      accessToken: 'jwt', serviceRoleKey: 'srk', platform: 'desktop', appVersion: '0.1.56'
    }
    expect(EnrolRequestSchema.safeParse(good).success).toBe(true)
    expect(EnrolRequestSchema.safeParse({ ...good, license: 'bad' }).success).toBe(false)
    expect(EnrolRequestSchema.safeParse({ ...good, supabaseUrl: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('responses: adopt (existing -> null token), heartbeat, error body', () => {
    expect(AdoptResponseSchema.safeParse({
      ok: true, deviceToken: null, existing: true, company: { id: 'c1', label: 'A' }, seat: { no: 1, label: 'Boss' }, profile: null
    }).success).toBe(true)
    expect(HeartbeatResponseSchema.safeParse({
      ok: true, profileVersion: 3, profileChanged: false, seat: { no: 2, label: 'C', status: 'revoked' },
      company: { status: 'suspended' }, serverTime: '2026-11-13T10:00:00Z'
    }).success).toBe(true)
    for (const code of Object.keys(MASTER_ERRORS)) {
      const body = { ok: false, code, error: 'x', message: 'Words.' }
      expect(ErrorBodySchema.safeParse(body).success).toBe(true)
      expect(parseErrorBody(body)?.code).toBe(code)
    }
    expect(ErrorBodySchema.safeParse({ ok: false, code: 'Q3M77', error: 'x', message: 'w' }).success).toBe(false)
    expect(parseErrorBody({ ok: true })).toBeNull()
  })

  it('config helpers', () => {
    expect(isMasterConfigured()).toBe(false) // empty on purpose until the owner sets the build constants [A]
    expect(isMasterConfigured('https://m.supabase.co', 'x'.repeat(30))).toBe(true)
    expect(isMasterConfigured('http://m.supabase.co', 'x'.repeat(30))).toBe(false)
    expect(masterFunctionUrl('https://m.supabase.co/', 'profile-get')).toBe('https://m.supabase.co/functions/v1/profile-get')
    expect(masterHeaders('anon')).toEqual({ 'content-type': 'application/json', apikey: 'anon', authorization: 'Bearer anon' })
    expect(masterHeaders('anon', 'dev')['x-q3-device']).toBe('dev')
  })
})
