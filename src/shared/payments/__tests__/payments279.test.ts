import { describe, expect, it } from 'vitest'
import {
  seedList, amountText, buildUpiUrl, validatePayee, validateBody, validateRecipient, normalizeList, addPayee, editPayee, removePayee,
  movePayee, setDefault, setRecipient, visiblePayees, pickPayee, hasAccountMode, newPayeeId, PAYMENTS_WORDS as W, MAX_PAYEES
} from '../index'
import type { PayeeAccount } from '../index'
import { redactSecrets, REDACTED } from '../../master/redact'

const seed = seedList()
const P = (id: string): PayeeAccount => seed.accounts.find((a) => a.id === id)!
const am = (s: string): string => { const r = amountText(s); if (!r.ok) throw new Error(r.words); return r.value }
const url = (id: string, acct: boolean, amount = ''): string | null => buildUpiUrl(P(id), seed.recipient, acct, am(amount))
const MERCH = 'upi://pay?ver=01&mode=02&orgId=00079&tid=&tr=3373252A&tn=&pa=0798048A0284669.bqr@kotak&pn=Meenakshi%20Buttons&mc=5949&am=%AM%&mid=0798048A0284669&mtid=3373252A&qrMedium=04'

describe('T1 seed', () => {
  it('equals the contract and is a fresh copy', () => {
    expect(seed.recipient).toBe('Meenakshi Buttons')
    expect(seed.defaultId).toBe('kotak-merchant')
    expect(seed.version).toBe(0)
    expect(seed.accounts.map((a) => [a.id, a.name, a.kind])).toEqual([
      ['kotak-merchant', 'Kotak Mahindra (Merchant)', 'merchant'], ['sbi', 'SBI', 'upi'], ['kotak-basic', 'Kotak Mahindra (Basic)', 'upi']])
    expect(P('kotak-merchant').account).toEqual({ number: '112011011564', ifsc: 'KKBK0008048' })
    expect(P('sbi').account).toEqual({ number: '54047475538', ifsc: 'SBIN0040015' })
    expect(P('kotak-basic').account).toBeUndefined()
    seedList().accounts[0]!.name = 'x'
    expect(seedList().accounts[0]!.name).toBe('Kotak Mahindra (Merchant)')
  })
  it('every seed payee validates', () => {
    expect(validateBody({ recipient: seed.recipient, defaultId: seed.defaultId, accounts: seed.accounts }).ok).toBe(true)
  })
})

describe('T2-T4 URLs equal the original', () => {
  it('no amount', () => {
    expect(url('kotak-merchant', false)).toBe(MERCH.replace('%AM%', ''))
    expect(url('sbi', false)).toBe('upi://pay?pa=meenakshibuttons@sbi&pn=Meenakshi%20Buttons')
    expect(url('kotak-basic', false)).toBe('upi://pay?pa=9448366753@KAYPAY&pn=Meenakshi%20Buttons')
  })
  it('integer amount', () => {
    expect(url('kotak-merchant', false, '500')).toBe(MERCH.replace('%AM%', '500'))
    expect(url('sbi', false, '500')).toBe('upi://pay?pa=meenakshibuttons@sbi&pn=Meenakshi%20Buttons&am=500')
    expect(url('kotak-basic', false, '500')).toBe('upi://pay?pa=9448366753@KAYPAY&pn=Meenakshi%20Buttons&am=500')
  })
  it('decimal amount', () => {
    expect(url('kotak-merchant', false, '1250.50')).toBe(MERCH.replace('%AM%', '1250.5'))
    expect(url('sbi', false, '1250.50')).toBe('upi://pay?pa=meenakshibuttons@sbi&pn=Meenakshi%20Buttons&am=1250.5')
  })
})

describe('T5 bank-account mode', () => {
  it('urls and visibility', () => {
    expect(url('kotak-merchant', true)).toBe('upi://pay?pa=112011011564@KKBK0008048.ifsc.npci&pn=Meenakshi%20Buttons&cu=INR')
    expect(url('kotak-merchant', true, '500')).toBe('upi://pay?pa=112011011564@KKBK0008048.ifsc.npci&pn=Meenakshi%20Buttons&am=500&cu=INR')
    expect(url('sbi', true)).toBe('upi://pay?pa=54047475538@SBIN0040015.ifsc.npci&pn=Meenakshi%20Buttons&cu=INR')
    expect(url('kotak-basic', true)).toBeNull()
    expect(visiblePayees(seed, true).map((a) => a.id)).toEqual(['kotak-merchant', 'sbi'])
    expect(visiblePayees(seed, false).map((a) => a.id)).toEqual(['kotak-merchant', 'sbi', 'kotak-basic'])
    expect(hasAccountMode(seed)).toBe(true)
  })
  it('pickPayee falls back', () => {
    expect(pickPayee(seed, true, 'kotak-basic')?.id).toBe('kotak-merchant')
    expect(pickPayee(seed, false, 'sbi')?.id).toBe('sbi')
    expect(pickPayee(seed, false, null)?.id).toBe('kotak-merchant')
  })
})

describe('T6 amount rule', () => {
  it('cases', () => {
    expect(am('')).toBe(''); expect(am('  ')).toBe('')
    for (const bad of ['0', '-1', 'abc', '1,000', '0.001', '0.00', '12345678901', '1e3', '+5', '.5'])
      expect(amountText(bad).ok, bad).toBe(false)
    expect(amountText('0')).toEqual({ ok: false, words: W.amountZero })
    expect(amountText('abc')).toEqual({ ok: false, words: W.amountFormat })
    expect(am('100.001')).toBe('100'); expect(am('10.50')).toBe('10.5'); expect(am('10.25')).toBe('10.25')
    expect(am('500.00')).toBe('500'); expect(am('1.005')).toBe('1.01'); expect(am(' 1250.50 ')).toBe('1250.5')
    expect(am('0.005')).toBe('0.01'); expect(am('9999999999.99')).toBe('9999999999.99')
  })
})

describe('T7 validation', () => {
  const base = (): any => JSON.parse(JSON.stringify(P('kotak-merchant')))
  const words = (p: unknown, others: string[] = []): string | null => { const r = validatePayee(p, others); return r.ok ? null : r.words }
  it('recipient', () => {
    expect(validateRecipient('').ok).toBe(false)
    expect(validateRecipient('x'.repeat(61))).toEqual({ ok: false, words: W.recipient })
    expect(validateRecipient('a\u0000b').ok).toBe(false)
    expect(validateRecipient('  Shop  ')).toEqual({ ok: true, value: 'Shop' })
  })
  it('name', () => {
    expect(words({ ...base(), name: '' })).toBe(W.name)
    expect(words({ ...base(), name: 'x'.repeat(41) })).toBe(W.name)
    expect(words(base(), ['kotak mahindra (merchant)'])).toBe(W.name)
  })
  it('upi id, ifsc, account', () => {
    expect(words({ id: 'a', name: 'A', kind: 'upi', upiId: 'nobank' })).toBe(W.upiId)
    expect(words({ id: 'a', name: 'A', kind: 'upi', upiId: 'ok@sbi', account: { number: '12345678', ifsc: 'SBIN0040015' } })).toBe(W.accountNumber)
    expect(words({ id: 'a', name: 'A', kind: 'upi', upiId: 'ok@sbi', account: { number: '123456789', ifsc: 'SBIN1040015' } })).toBe(W.ifsc)
    const lower = validatePayee({ id: 'a', name: 'A', kind: 'account', account: { number: '123456789', ifsc: 'sbin0040015' } })
    expect(lower.ok && lower.value.account?.ifsc).toBe('SBIN0040015')
  })
  it('merchant fields', () => {
    const t = (k: string, v: string): string | null => { const b = base(); b.merchant[k] = v; return words(b) }
    expect(t('ver', '1')).toBe(W.twoDigits); expect(t('mode', 'ab')).toBe(W.twoDigits); expect(t('qrMedium', '123')).toBe(W.twoDigits)
    expect(t('orgId', '12a')).toBe(W.orgId); expect(t('mc', '594')).toBe(W.mc)
    expect(t('tr', 'a&b')).toBe(W.alnum); expect(t('mid', '')).toBe(W.alnum); expect(t('mtid', 'x'.repeat(36))).toBe(W.alnum)
    expect(t('pa', 'bad')).toBe(W.upiId)
  })
  it('kind vs fields; unknown keys dropped', () => {
    expect(words({ id: 'a', name: 'A', kind: 'merchant' })).toBe(W.missing)
    expect(words({ id: 'a', name: 'A', kind: 'upi' })).toBe(W.missing)
    expect(words({ id: 'a', name: 'A', kind: 'account' })).toBe(W.missing)
    expect(words({ id: 'a', name: 'A', kind: 'weird' })).toBe(W.missing)
    expect(words({ id: 'Bad Id', name: 'A', kind: 'upi', upiId: 'ok@sbi' })).toBe(W.missing)
    expect(words('str')).toBe(W.missing)
    const r = validatePayee({ id: 'a', name: 'A', kind: 'upi', upiId: 'ok@sbi', extra: 1, merchant: { pa: 'x' } })
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['id', 'kind', 'name', 'upiId'])
  })
  it('count, default, size', () => {
    expect(validateBody({ recipient: 'R', accounts: [] })).toEqual({ ok: false, words: W.count })
    const many = Array.from({ length: MAX_PAYEES + 1 }, (_, i) => ({ id: `p${i}`, name: `N${i}`, kind: 'upi', upiId: 'ok@sbi' }))
    expect(validateBody({ recipient: 'R', accounts: many })).toEqual({ ok: false, words: W.count })
    const one = validateBody({ recipient: 'R', defaultId: 'nope', accounts: [many[0]] })
    expect(one.ok && one.value.defaultId).toBe('p0')
    expect(validateBody(null).ok).toBe(false)
  })
})

describe('T8 list operations', () => {
  const nu = { name: 'HDFC', kind: 'upi', upiId: 'shop@hdfcbank' }
  it('add / edit / remove / reorder / default', () => {
    const a = addPayee(seed, nu, () => 0.5)
    expect(a.ok).toBe(true); if (!a.ok) return
    const added = a.value.accounts[3]!
    expect(added.id).toBe(newPayeeId(() => 0.5)); expect(added.id).toMatch(/^p[a-z0-9]{10}$/)
    expect(a.value.version).toBe(seed.version)
    expect(seed.accounts).toHaveLength(3)
    expect(addPayee(a.value, { ...nu, upiId: 'o@sbi', name: 'hdfc' }).ok).toBe(false)
    const e = editPayee(a.value, added.id, { name: 'HDFC 2', kind: 'upi', upiId: 'new@hdfcbank', id: 'ignored' })
    expect(e.ok && e.value.accounts[3]).toEqual({ id: added.id, name: 'HDFC 2', kind: 'upi', upiId: 'new@hdfcbank' })
    expect(editPayee(seed, 'zzz', nu).ok).toBe(false)
    const m = movePayee(seed, 'kotak-basic', 0)
    expect(m.ok && m.value.accounts.map((x) => x.id)).toEqual(['kotak-basic', 'kotak-merchant', 'sbi'])
    const m2 = movePayee(seed, 'kotak-merchant', 99)
    expect(m2.ok && m2.value.accounts.map((x) => x.id)).toEqual(['sbi', 'kotak-basic', 'kotak-merchant'])
    const d = setDefault(seed, 'sbi'); expect(d.ok && d.value.defaultId).toBe('sbi')
    expect(setDefault(seed, 'zzz').ok).toBe(false)
    const rm = removePayee(seed, 'kotak-merchant')
    expect(rm.ok && rm.value.defaultId).toBe('sbi')
    expect(rm.ok && rm.value.accounts).toHaveLength(2)
    let cur = seed
    for (const id of ['sbi', 'kotak-basic']) { const r = removePayee(cur, id); if (r.ok) cur = r.value }
    expect(cur.accounts.map((x) => x.id)).toEqual(['kotak-merchant'])
    expect(removePayee(cur, 'kotak-merchant')).toEqual({ ok: false, words: W.lastPayee })
    expect(setRecipient(seed, '').ok).toBe(false)
    const sr = setRecipient(seed, ' New Name '); expect(sr.ok && sr.value.recipient).toBe('New Name')
  })
  it('add refuses past the maximum', () => {
    let cur = seed
    for (let i = 0; cur.accounts.length < MAX_PAYEES; i++) { const r = addPayee(cur, { name: `N${i}`, kind: 'upi', upiId: 'ok@sbi' }, () => (((i * 7 + 1) % 36) / 36) + 0.001); if (!r.ok) throw new Error(r.words); cur = r.value }
    expect(addPayee(cur, { name: 'Over', kind: 'upi', upiId: 'ok@sbi' })).toEqual({ ok: false, words: W.count })
  })
})

describe('T9 hostile input', () => {
  const hostile = ['a&b', 'a?b', 'a#b', 'a%b', 'a b', 'a+b', 'a=b', 'a\nb', 'a\u0000b', '__proto__', 'x'.repeat(10240)]
  it('never reaches a URL through a validated field', () => {
    for (const h of hostile) {
      if (h !== '__proto__') { // '__proto__@sbi' is a plain valid id: it has no URL-special character
        expect(validatePayee({ id: 'a', name: 'A', kind: 'upi', upiId: `${h}@sbi` }).ok, h).toBe(false)
        expect(validatePayee({ id: 'a', name: 'A', kind: 'upi', upiId: `ok@${h}` }).ok, h).toBe(false)
      }
      expect(validatePayee({ id: 'a', name: 'A', kind: 'account', account: { number: h, ifsc: 'SBIN0040015' } }).ok, h).toBe(false)
      expect(validatePayee({ id: 'a', name: 'A', kind: 'account', account: { number: '123456789', ifsc: h } }).ok, h).toBe(false)
      expect(amountText(h).ok, h).toBe(false)
    }
  })
  it('recipient is escaped, never raw', () => {
    const u = buildUpiUrl(P('sbi'), 'A&B C#1?', false, '')!
    expect(u).toBe('upi://pay?pa=meenakshibuttons@sbi&pn=A%26B%20C%231%3F')
  })
  it('normalizeList never throws and drops bad input', () => {
    for (const raw of [null, undefined, 5, 'x', [], {}, { accounts: 'no' }, { accounts: [null, 7, 'x'] }]) expect(normalizeList(raw).accounts).toEqual(seed.accounts)
    const proto = JSON.parse('{"__proto__":{"x":1},"constructor":{"y":1},"recipient":"R","defaultId":"gone","version":3,"accounts":[{"id":"a","name":"A","kind":"upi","upiId":"ok@sbi","__proto__":{"z":1}},{"id":"b","name":"a","kind":"upi","upiId":"ok@sbi"},{"id":"c","name":"C","kind":"upi","upiId":"bad"}]}')
    const n = normalizeList(proto)
    expect(n.accounts.map((x) => x.id)).toEqual(['a'])
    expect(n.defaultId).toBe('a'); expect(n.version).toBe(3); expect(n.recipient).toBe('R')
    expect(({} as any).x).toBeUndefined(); expect(({} as any).z).toBeUndefined()
    expect(normalizeList({ ...seed, version: -2 }).version).toBe(0)
    expect(normalizeList({ ...seed, version: 1.5 }).version).toBe(0)
    expect(normalizeList({ ...seed, recipient: '' }).recipient).toBe('Meenakshi Buttons')
    expect(normalizeList({ ...seed, version: 7 })).toEqual({ ...seed, version: 7 })
  })
})

describe('T10 redaction', () => {
  it('hides bank and payee detail keys', () => {
    const out = JSON.stringify(redactSecrets({ payments: seed, pa: 'a@b', upiId: 'x@sbi', ifsc: 'SBIN0040015', number: '123456789', account: { number: '1' }, mid: 'M1', mtid: 'M2', tr: 'T', label: 'ok' }))
    for (const bad of ['meenakshibuttons@sbi', 'SBIN0040015', '123456789', 'M1', 'M2', '112011011564', '54047475538']) expect(out).not.toContain(bad)
    expect(out).toContain(REDACTED); expect(out).toContain('"label":"ok"')
    const seedOut = JSON.stringify(redactSecrets({ list: seed }))
    expect(seedOut).not.toContain('112011011564'); expect(seedOut).not.toContain('KAYPAY')
  })
})
