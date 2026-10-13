import { describe, expect, it } from 'vitest'
import { CUTOVER_STEPS, CUTOVER_WORDS, backupSentence, cutoverCompareNote, cutoverNeeded, cutoverStep, stepNumber, type CutoverFacts } from '../cutover'

const base: CutoverFacts = { v1Active: true, backupDone: false, v2Active: false, compareDone: false, unifyDone: false, finished: false }
const f = (o: Partial<CutoverFacts>): CutoverFacts => ({ ...base, ...o })

describe('cutoverStep: derived from what is stored, so an interrupted wizard resumes', () => {
  it('walks backup -> signin -> compare -> unify -> done', () => {
    expect(cutoverStep(base)).toBe('backup')
    expect(cutoverStep(f({ backupDone: true }))).toBe('signin')
    expect(cutoverStep(f({ backupDone: true, v2Active: true }))).toBe('compare')
    expect(cutoverStep(f({ backupDone: true, v2Active: true, compareDone: true }))).toBe('unify')
    expect(cutoverStep(f({ backupDone: true, v2Active: true, compareDone: true, unifyDone: true }))).toBe('done')
  })
  it('a later step never shows before an earlier one is done (no sign-in before the backup)', () => {
    expect(cutoverStep(f({ v2Active: true, compareDone: true }))).toBe('backup')
    expect(cutoverStep(f({ backupDone: true, compareDone: true }))).toBe('signin')
  })
  it('finished always means done', () => { expect(cutoverStep(f({ finished: true }))).toBe('done') })
})

describe('cutoverNeeded', () => {
  it('is offered to a v1 computer, and to one that is mid-way, but never to a fresh install or after finishing', () => {
    expect(cutoverNeeded(base)).toBe(true)
    expect(cutoverNeeded(f({ v1Active: false, backupDone: true }))).toBe(true)
    expect(cutoverNeeded(f({ v1Active: false }))).toBe(false)
    expect(cutoverNeeded(f({ finished: true }))).toBe(false)
  })
})

describe('words', () => {
  it('every step has a title, body and action, and numbers 1..4', () => {
    for (const s of CUTOVER_STEPS) { const w = CUTOVER_WORDS[s]; expect(w.title).not.toBe(''); expect(w.body).not.toBe(''); expect(w.action).not.toBe('') }
    expect(CUTOVER_STEPS.map(stepNumber)).toEqual([1, 2, 3, 4, 4])
  })
  it('the backup step says why (no server backups on the Free plan); no passphrase and no emoji anywhere', () => {
    expect(CUTOVER_WORDS.backup.body).toMatch(/no backups/i)
    const all = JSON.stringify(CUTOVER_WORDS)
    expect(all.toLowerCase()).not.toContain('passphrase')
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all)).toBe(false)
  })
  it('compare sentences: counts only', () => {
    expect(cutoverCompareNote({ state: 'done', upload: 0, download: 0, conflict: 0, skip: 1927 })).toContain('1927')
    expect(cutoverCompareNote({ state: 'done', upload: 761, download: 1166, conflict: 2, skip: 5 })).toMatch(/761 to send, 1166 to fetch, 2 different/)
    expect(cutoverCompareNote({ state: 'paused', upload: 0, download: 0, conflict: 0, skip: 0 })).toMatch(/carries on/)
    expect(cutoverCompareNote({ state: 'done', upload: 0, download: 0, conflict: 0, skip: 0, already: true })).toMatch(/already finished/)
    expect(backupSentence('')).toMatch(/No backup/)
    expect(backupSentence('manual-1.db')).toContain('manual-1.db')
  })
})
