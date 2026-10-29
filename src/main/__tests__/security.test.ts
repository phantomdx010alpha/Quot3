import { describe, expect, it } from 'vitest'
import { buildCsp, isTrustedUrl, PROD_CSP } from '../security'

const trust = { devUrl: undefined, rendererDir: '/app/out/renderer' }

describe('security', () => {
  it('production CSP is strict', () => {
    expect(buildCsp(false)).toBe(PROD_CSP)
    expect(PROD_CSP).toContain("default-src 'self'")
    expect(PROD_CSP).toContain("script-src 'self'")
    expect(PROD_CSP).not.toMatch(/script-src[^;]*unsafe/)
    expect(PROD_CSP).toContain("object-src 'none'")
    expect(PROD_CSP).toContain("connect-src 'self'")
    expect(PROD_CSP).toContain("frame-ancestors 'none'")
  })

  it('Phase 198: the games frame is the only CSP addition (frame-src q3game:, in both strings); nothing else loosened', () => {
    for (const csp of [PROD_CSP, buildCsp(true)]) {
      expect(csp).toContain('frame-src q3game:')
      expect(csp.split('; ').filter((d) => d.startsWith('frame-src'))).toEqual(['frame-src q3game:'])
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("frame-ancestors 'none'")
      expect(csp).toContain("form-action 'none'")
      expect(csp).not.toContain('unsafe-eval')
    }
    // Same directives as before, plus exactly the frame-src one.
    expect(PROD_CSP.split('; ').filter((d) => !d.startsWith('frame-src'))).toEqual([
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
      "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"
    ])
  })

  it('dev CSP is only relaxed for scripts/websocket, and only in dev', () => {
    expect(buildCsp(true)).toContain('ws://localhost')
    expect(PROD_CSP).not.toContain('localhost')
  })

  it('trusts only our renderer files', () => {
    expect(isTrustedUrl('file:///app/out/renderer/index.html', trust)).toBe(true)
    expect(isTrustedUrl('file:///app/out/renderer-evil/index.html', trust)).toBe(false)
    expect(isTrustedUrl('file:///etc/passwd', trust)).toBe(false)
    expect(isTrustedUrl('https://example.com/', trust)).toBe(false)
    expect(isTrustedUrl('not a url', trust)).toBe(false)
    expect(isTrustedUrl('', trust)).toBe(false)
  })

  it('trusts the dev server origin only when configured', () => {
    const dev = { devUrl: 'http://localhost:5173/', rendererDir: '/app/out/renderer' }
    expect(isTrustedUrl('http://localhost:5173/#/x', dev)).toBe(true)
    expect(isTrustedUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isTrustedUrl('http://localhost:5173/', trust)).toBe(false)
  })
})
