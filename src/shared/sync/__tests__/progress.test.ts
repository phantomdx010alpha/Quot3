import { describe, expect, it } from 'vitest'
import { createProgressTracker, isProgress, progressLabel, progressPercent, type SyncProgress } from '../progress'

describe('sync progress (Phase 89)', () => {
  it('labels and percentages', () => {
    expect(progressLabel({ direction: 'send', done: 120, total: 768 })).toBe('Sending 120 of 768')
    expect(progressLabel({ direction: 'receive', done: 300, total: 768 })).toBe('Receiving 300 of 768')
    expect(progressLabel({ direction: 'send', done: 900, total: 768 })).toBe('Sending 768 of 768')
    expect(progressPercent({ done: 384, total: 768 })).toBe(50)
    expect(progressPercent({ done: 0, total: 0 })).toBe(0)
  })
  it('tracker: nothing for an empty run, grows when more turns up, closes once', () => {
    const ev: SyncProgress[] = []
    const t = createProgressTracker('receive', (p) => ev.push(p))
    t.begin(0); t.end()
    expect(ev).toEqual([])
    t.begin(2); t.advance(1); t.advance(3, 10); t.advance(6); t.end(); t.end()
    expect(ev.map((e) => `${e.done}/${e.total}/${e.active}`)).toEqual(['0/2/true', '1/2/true', '4/10/true', '10/10/true', '10/10/false'])
  })
  it('tracker: an unknown count (0 at start) still shows what arrives', () => {
    const ev: SyncProgress[] = []
    const t = createProgressTracker('receive', (p) => ev.push(p))
    t.begin(0); t.advance(1); t.advance(1); t.end()
    expect(ev.at(-1)).toEqual({ direction: 'receive', done: 2, total: 2, active: false })
  })
  it('isProgress guards the event payload', () => {
    expect(isProgress({ direction: 'send', done: 1, total: 2, active: true })).toBe(true)
    expect(isProgress({ direction: 'x', done: 1, total: 2, active: true })).toBe(false)
    expect(isProgress(null)).toBe(false)
  })
})
