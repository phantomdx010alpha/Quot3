import type { ZodType } from 'zod'
import type { ErrorCode, Result } from '../../shared/ipc'

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(code: ErrorCode, message: string, details?: unknown): Result<never> {
  return details === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, details } }
}

/** Throw this inside a handler to return a specific stable error code. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

/**
 * Wrap a handler: validates the raw (untrusted) input with Zod, runs it, optionally validates the
 * output, and converts every throw into a Result failure. The renderer never receives a thrown error.
 */
export function wrapHandler<I, O>(
  inputSchema: ZodType<I>,
  fn: (input: I) => O | Promise<O>,
  outputSchema?: ZodType<O>
): (raw: unknown) => Promise<Result<O>> {
  return async (raw) => {
    const parsed = inputSchema.safeParse(raw)
    if (!parsed.success) {
      return fail('VALIDATION', 'Invalid request', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message
      })))
    }
    try {
      const out = await fn(parsed.data)
      if (outputSchema) {
        const checked = outputSchema.safeParse(out)
        if (!checked.success) return fail('UNKNOWN', 'Internal error: invalid response')
        return ok(checked.data)
      }
      return ok(out)
    } catch (err) {
      if (err instanceof AppError) return fail(err.code, err.message, err.details)
      return fail('UNKNOWN', 'Unexpected error')
    }
  }
}
