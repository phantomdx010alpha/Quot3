import { describe, expect, it } from 'vitest'
import { APP_NAME } from '../constants'

describe('toolchain smoke', () => {
  it('runs a trivial test and resolves shared code', () => {
    expect(APP_NAME).toBe('Quot3')
  })
})
