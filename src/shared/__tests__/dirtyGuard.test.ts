import { describe, expect, it } from 'vitest'
import { choiceFromKey, guardCopy, ignoreEscRepeat, leaveDecision, needsPrompt } from '../dirtyGuard'

describe('dirtyGuard (pure)', () => {
  it('prompts only when dirty', () => {
    expect(needsPrompt({ dirty: true })).toBe(true)
    expect(needsPrompt({ dirty: false })).toBe(false)
  })
  it('copy differs for a never-saved vs saved bill', () => {
    expect(guardCopy(false).title).toBe('Save this bill?')
    expect(guardCopy(true).title).toBe('Save changes?')
  })
  it('S / D / Esc map to choices, case-insensitively; anything else is null', () => {
    expect(choiceFromKey('s')).toBe('save')
    expect(choiceFromKey('S')).toBe('save')
    expect(choiceFromKey('d')).toBe('discard')
    expect(choiceFromKey('D')).toBe('discard')
    expect(choiceFromKey('Escape')).toBe('cancel')
    for (const k of ['x', 'Enter', 'Tab', 'ArrowDown', 'ss', '']) expect(choiceFromKey(k)).toBeNull()
  })
})

describe('Phase 95 - leaveDecision state table', () => {
  const B = 'b1'
  const table: Array<[string, { billId: string | null; dirty: boolean; guardOpen: boolean }, string]> = [
    ['fresh (clean) bill', { billId: B, dirty: false, guardOpen: false }, 'proceed'],
    ['just saved (clean)', { billId: B, dirty: false, guardOpen: false }, 'proceed'],
    ['discarded / cleared (no bill)', { billId: null, dirty: false, guardOpen: false }, 'proceed'],
    ['discarded but flag left over', { billId: null, dirty: true, guardOpen: false }, 'proceed'],
    ['dirty', { billId: B, dirty: true, guardOpen: false }, 'ask'],
    ['resumed draft (dirty)', { billId: B, dirty: true, guardOpen: false }, 'ask'],
    ['dirty, dialog already open', { billId: B, dirty: true, guardOpen: true }, 'ignore'],
    ['clean, dialog open (answered)', { billId: B, dirty: false, guardOpen: true }, 'proceed']
  ]
  for (const [name, st, want] of table) it(name, () => expect(leaveDecision(st)).toBe(want))
  it('a held Esc is ignored, a fresh press is not', () => {
    expect(ignoreEscRepeat({ key: 'Escape', repeat: true })).toBe(true)
    expect(ignoreEscRepeat({ key: 'Escape', repeat: false })).toBe(false)
    expect(ignoreEscRepeat({ key: 'a', repeat: true })).toBe(false)
  })
})
