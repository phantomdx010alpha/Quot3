import { describe, expect, it } from 'vitest'
import { cleanName, isProtectedToken, itemKey, normaliseItem, sameItemKey, splitNotes, NON_PRODUCT_RULES } from '../normalise'

describe('Phase 107 - clean (step 1)', () => {
  it('uppercases, collapses spaces, unifies separators', () => {
    expect(cleanName('  ameto   small ')).toBe('AMETO SMALL')
    expect(cleanName('fancy-button')).toBe('FANCY BUTTON')
    expect(cleanName('fancy_button, big.')).toBe('FANCY BUTTON BIG')
    expect(cleanName('A / B')).toBe('A B')
  })
  it('joins sizes: 32 x 50 = 32*50 = 32X50 = 32 X 50', () => {
    for (const s of ['ARIHANT 32 x 50', 'ARIHANT 32*50', 'ARIHANT 32X50', 'arihant 32 X 50', 'ARIHANT 32\u00D750']) expect(cleanName(s)).toBe('ARIHANT 32X50')
    expect(cleanName('TAPE 2 x 3 x 4')).toBe('TAPE 2X3X4')
    expect(cleanName('LACE 2.5 x 10')).toBe('LACE 2.5X10')
  })
  it('keeps fractions and decimals, drops stray dots', () => {
    expect(cleanName('NEEDLE 1 / 2')).toBe('NEEDLE 1/2')
    expect(cleanName('ZIP 2.5 INCH')).toBe('ZIP 2.5 INCH')
    expect(cleanName('S.K. BUTTON')).toBe('S K BUTTON')
  })
  it('turns inch marks into INCH', () => {
    expect(cleanName('ZIP 12"')).toBe('ZIP 12 INCH')
  })
  it('keeps percent signs on numbers', () => { expect(cleanName('GST 18%')).toBe('GST 18%') })
  it('never throws on odd input', () => {
    expect(normaliseItem('').empty).toBe(true)
    expect(normaliseItem('   ').empty).toBe(true)
    expect(normaliseItem('---').empty).toBe(true)
    expect(normaliseItem(undefined as unknown as string).key).toBe('')
  })
})

describe('Phase 107 - bracket notes', () => {
  it('splits notes off and keeps them out of the key', () => {
    const n = normaliseItem('SPADE CHAIN (ADVANCE ORDER, 7 DAYS WAITING)')
    expect(n.cleaned).toBe('SPADE CHAIN')
    expect(n.note).toBe('ADVANCE ORDER, 7 DAYS WAITING')
    expect(n.nonProduct).toBeNull()
    expect(n.key).toBe(itemKey('CHAIN SPADE'))
  })
  it('handles square brackets, several notes and nesting', () => {
    expect(splitNotes('A (x) B [y]').note).toBe('X | Y')
    expect(normaliseItem('BELT (TO BE COURIERED)').cleaned).toBe('BELT')
    expect(normaliseItem('BELT (A (B)) 2').cleaned).toBe('BELT 2')
  })
  it('an unclosed bracket keeps its text (nothing lost)', () => {
    const n = normaliseItem('BELT (TO BE COURIERED')
    expect(n.cleaned).toBe('BELT TO BE COURIERED')
    expect(n.note).toBe('')
  })
  it('a name that is only a note is empty with a note', () => {
    const n = normaliseItem('(ADVANCE ORDER)')
    expect(n.empty).toBe(true)
    expect(n.note).toBe('ADVANCE ORDER')
  })
})

describe('Phase 107 - order-insensitive key (step 3)', () => {
  it('TALCO 2044 = 2044 TALCO', () => { expect(sameItemKey('TALCO 2044', '2044 TALCO')).toBe(true) })
  it('FANCY BUTTON = BUTTON FANCY', () => { expect(sameItemKey('FANCY BUTTON', 'button  fancy')).toBe(true) })
  it('every ordering of ARIHANT GRIPPER WHITE has one key', () => {
    const words = ['ARIHANT', 'GRIPPER', 'WHITE']
    const perms: string[][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((p) => p.map((i) => words[i] as string))
    expect(new Set(perms.map((p) => itemKey(p.join(' ')))).size).toBe(1)
  })
  it('case, dashes and spacing do not matter', () => { expect(sameItemKey('Fancy-Button  Big', 'BIG FANCY BUTTON')).toBe(true) })
  it('different words are different keys', () => { expect(sameItemKey('FANCY BUTTON', 'FANCY BUTTONS')).toBe(false) })
  it('duplicate words are kept (not the same as one)', () => { expect(sameItemKey('BUTTON BUTTON', 'BUTTON')).toBe(false) })
  it('an empty name has no key and is never "the same" as another empty name', () => {
    expect(itemKey('')).toBe('')
    expect(sameItemKey('', '')).toBe(false)
  })
  it('the key does not depend on the locale', () => { expect(itemKey('B A \u00C4')).toBe('A B \u00C4') })
})

describe('Phase 107 - protected tokens (step 4)', () => {
  it('ARIHANT 32X50 != ARIHANT 25X50', () => { expect(sameItemKey('ARIHANT 32X50', 'ARIHANT 25X50')).toBe(false) })
  it('MILTON 505 != MILTON D7', () => { expect(sameItemKey('MILTON 505', 'MILTON D7')).toBe(false) })
  it('ARIHANT 32X50 = 32 x 50 ARIHANT', () => { expect(sameItemKey('ARIHANT 32X50', '32 x 50 ARIHANT')).toBe(true) })
  it('lists digit, size, fraction and unit tokens as protected, words as word tokens', () => {
    const n = normaliseItem('zip 12 inch 1/2 32 x 50 black D7')
    expect(n.protectedTokens).toEqual(['12', 'INCH', '1/2', '32X50', 'D7'])
    expect(n.wordTokens).toEqual(['ZIP', 'BLACK'])
  })
  it('isProtectedToken', () => {
    for (const t of ['505', 'D7', '32X50', '1/2', '2.5', '18%', 'INCH', 'MTR', 'KG']) expect(isProtectedToken(t)).toBe(true)
    for (const t of ['ZIP', 'BLACK', 'BOX', 'SET', 'TALCO']) expect(isProtectedToken(t)).toBe(false)
  })
  it('units stay exact: 12 INCH vs 12 MTR', () => { expect(sameItemKey('TAPE 12 INCH', 'TAPE 12 MTR')).toBe(false) })
})

describe('Phase 107 - non-product lines (step 2)', () => {
  const NOT = ['GST EXTRA - 18%', 'COOLIE AND GST', 'LESS - PAYMENT', 'Less payment', 'ADVANCE', 'advance payment', 'DYING CHARGE + GST', 'PACKING CHARGES', 'GST 18%', 'GST', 'ROUND OFF', 'DISCOUNT', 'COURIER', 'FREIGHT']
  it.each(NOT)('%s is filtered', (name) => { expect(normaliseItem(name).nonProduct).not.toBeNull() })
  const GOODS = ['AMETO SMALL', 'ADVANCE ZIP', 'ARIHANT GRIPPER WHITE', 'CHARGER CABLE', 'LESSER BUTTON', 'GSTAR BUTTON', 'PACKING TAPE', 'PAYMENT SLIP BOOK', 'MILTON 505']
  it.each(GOODS)('%s is kept', (name) => { expect(normaliseItem(name).nonProduct).toBeNull() })
  it('reports which rule matched', () => {
    expect(normaliseItem('COOLIE AND GST').nonProduct).toEqual({ ruleId: 'gst-line', label: 'GST line' }) // first matching rule in list order
    expect(normaliseItem('COOLIE').nonProduct?.ruleId).toBe('coolie')
    expect(normaliseItem('DYING CHARGE + GST').nonProduct?.ruleId).toBe('charge')
    expect(normaliseItem('DYING CHARGE').nonProduct?.ruleId).toBe('charge')
  })
  it('a note never makes a product a charge, and a charge keeps its tokens', () => {
    expect(normaliseItem('BELT (ADVANCE)').nonProduct).toBeNull()
    expect(normaliseItem('LESS - PAYMENT').tokens).toEqual(['LESS', 'PAYMENT'])
  })
  it('rule ids are unique', () => { expect(new Set(NON_PRODUCT_RULES.map((r) => r.id)).size).toBe(NON_PRODUCT_RULES.length) })
  it('an empty name is empty, not a non-product', () => { expect(normaliseItem('').nonProduct).toBeNull() })
})

describe('Phase 107 - determinism', () => {
  it('same input, same output, and the key is stable under re-normalising the cleaned name', () => {
    for (const s of ['TALCO 2044', 'fancy - button (x)', 'ARIHANT 32 x 50', 'zip 1 / 2 inch']) {
      const a = normaliseItem(s)
      expect(normaliseItem(s)).toEqual(a)
      expect(normaliseItem(a.cleaned).key).toBe(a.key)
    }
  })
})
