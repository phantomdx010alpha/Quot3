/**
 * Phase 82 - the calculator panel's expression engine (pure; CALCULATOR_PANEL_RULES section 2). Hand-written tokenizer +
 * recursive-descent parser, decimal.js through `money.ts` only: no `eval`, no `Function`, no JS-number arithmetic. Never
 * throws: malformed input, divide by zero and absurd sizes come back as `{ ok: false, error }`.
 *
 * Grammar (lowest precedence first):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := ('-' | '+') unary | postfix
 *   postfix := atom '%'*            atom := number | '(' expr ')'
 * Accepted spellings: `x` `X` `×` for `*`; `÷` for `/`; `−` `–` for `-`; thousands commas and spaces are ignored.
 *
 * `%` (Tally / phone style):  a + b%  = a + a*b/100      a - b%  = a - a*b/100
 *                             a * b%  = a*b/100          a / b%  = a/(b/100)       b% alone = b/100
 * "b%" is relative to the running left value only when it is the WHOLE right-hand term of a + or - (so `100 + 2*10%` is
 * 100 + 0.2, because the term is `2 * (10%)`). Evaluation is left to right: `100 + 10% + 10%` = 121.
 */
import { D, toDec, type Decimal } from '../money'

export type CalcResult = { ok: true; value: string; text: string } | { ok: false; error: string; pos: number }

export const CALC_MAX_INPUT = 200
export const CALC_MAX_DEPTH = 40
/** Display text keeps at most this many decimals (the value itself keeps full decimal.js precision). */
export const CALC_TEXT_DP = 10
const LIMIT = D('1000000000000000000000000')

type Tok = { k: 'num'; v: string; pos: number } | { k: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')' | '%'; pos: number }

class CalcError extends Error {
  constructor(message: string, readonly pos: number) { super(message) }
}

type OpChar = Extract<Tok, { k: 'op' }>['v']
const OPS: Record<string, OpChar> = {
  '+': '+', '-': '-', '\u2212': '-', '\u2013': '-', '*': '*', x: '*', X: '*', '\u00D7': '*', '/': '/', '\u00F7': '/', '(': '(', ')': ')', '%': '%'
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src.charAt(i)
    if (ch === ' ' || ch === '\t' || ch === ',' || ch === '\u00A0') { i++; continue }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const start = i
      let text = ''
      let dots = 0
      while (i < src.length) {
        const c = src.charAt(i)
        if (c >= '0' && c <= '9') text += c
        else if (c === '.') { dots++; text += c }
        else if (c === ',') { /* thousands separator */ }
        else break
        i++
      }
      if (dots > 1) throw new CalcError('Too many decimal points', start)
      if (text === '.') throw new CalcError('Incomplete number', start)
      if (text.replace('.', '').length > 30) throw new CalcError('Number too long', start)
      if ((text.split('.')[0] ?? '').replace(/^0+/, '').length > 24) throw new CalcError('Number is too large', start)
      out.push({ k: 'num', v: text, pos: start })
      continue
    }
    const op = OPS[ch]
    if (op === undefined) throw new CalcError(`Unexpected "${ch}"`, i)
    out.push({ k: 'op', v: op, pos: i })
    i++
  }
  return out
}

type Node =
  | { t: 'num'; v: string }
  | { t: 'neg'; a: Node }
  | { t: 'pct'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node; pos: number }

class Parser {
  private i = 0
  constructor(private readonly toks: Tok[], private readonly end: number) {}
  private peek(): Tok | undefined { return this.toks[this.i] }
  private isOp(v: string): boolean { const t = this.peek(); return t?.k === 'op' && t.v === v }

  parse(): Node {
    if (this.toks.length === 0) throw new CalcError('Empty', 0)
    const n = this.expr(0)
    const t = this.peek()
    if (t) throw new CalcError(t.k === 'op' && t.v === ')' ? 'Unmatched ")"' : 'Unexpected input', t.pos)
    return n
  }
  private expr(depth: number): Node {
    let a = this.term(depth)
    for (;;) {
      const t = this.peek()
      if (!(t?.k === 'op' && (t.v === '+' || t.v === '-'))) return a
      this.i++
      a = { t: 'bin', op: t.v, a, b: this.term(depth), pos: t.pos }
    }
  }
  private term(depth: number): Node {
    let a = this.unary(depth)
    for (;;) {
      const t = this.peek()
      if (!(t?.k === 'op' && (t.v === '*' || t.v === '/'))) return a
      this.i++
      a = { t: 'bin', op: t.v, a, b: this.unary(depth), pos: t.pos }
    }
  }
  private unary(depth: number): Node {
    if (depth > CALC_MAX_DEPTH) throw new CalcError('Too deeply nested', this.peek()?.pos ?? this.end)
    const t = this.peek()
    if (t?.k === 'op' && (t.v === '-' || t.v === '+')) {
      this.i++
      const a = this.unary(depth + 1)
      return t.v === '-' ? { t: 'neg', a } : a
    }
    return this.postfix(depth)
  }
  private postfix(depth: number): Node {
    let a = this.atom(depth)
    while (this.isOp('%')) { this.i++; a = { t: 'pct', a } }
    return a
  }
  private atom(depth: number): Node {
    const t = this.peek()
    if (!t) throw new CalcError('Expression is incomplete', this.end)
    if (t.k === 'num') { this.i++; return { t: 'num', v: t.v } }
    if (t.v === '(') {
      this.i++
      const n = this.expr(depth + 1)
      if (!this.isOp(')')) throw new CalcError('Missing ")"', this.peek()?.pos ?? this.end)
      this.i++
      return n
    }
    throw new CalcError(`Unexpected "${t.v}"`, t.pos)
  }
}

const HUNDRED = D('100')

function guard(d: Decimal, pos: number): Decimal {
  if (d.abs().gte(LIMIT)) throw new CalcError('Result is too large', pos)
  return d
}

function evalNode(n: Node): Decimal {
  switch (n.t) {
    case 'num': return D(n.v)
    case 'neg': return evalNode(n.a).negated()
    case 'pct': return evalNode(n.a).div(HUNDRED)
    case 'bin': {
      const a = evalNode(n.a)
      if ((n.op === '+' || n.op === '-') && n.b.t === 'pct') {
        const delta = guard(a.times(evalNode(n.b.a)).div(HUNDRED), n.pos) // the right side is "b%" of the left value; chained % (b%%) is handled by evalNode on the inner node
        return guard(n.op === '+' ? a.plus(delta) : a.minus(delta), n.pos)
      }
      const b = evalNode(n.b)
      switch (n.op) {
        case '+': return guard(a.plus(b), n.pos)
        case '-': return guard(a.minus(b), n.pos)
        case '*': return guard(a.times(b), n.pos)
        default:
          if (b.isZero()) throw new CalcError('Cannot divide by zero', n.pos)
          return guard(a.div(b), n.pos)
      }
    }
  }
}

/** Canonical text for a result: at most `CALC_TEXT_DP` decimals (HALF_UP), plain notation, no trailing zeros, no "-0". */
export function formatCalcValue(d: Decimal): string {
  const r = d.toDecimalPlaces(CALC_TEXT_DP, 4 /* ROUND_HALF_UP */)
  return toDec(r)
}

export function evaluateExpression(input: string): CalcResult {
  if (typeof input !== 'string') return { ok: false, error: 'Empty', pos: 0 }
  if (input.length > CALC_MAX_INPUT) return { ok: false, error: 'Expression is too long', pos: CALC_MAX_INPUT }
  try {
    const ast = new Parser(tokenize(input), input.length).parse()
    const v = evalNode(ast)
    return { ok: true, value: toDec(v), text: formatCalcValue(v) }
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.message, pos: e.pos }
    return { ok: false, error: 'Cannot calculate this', pos: 0 }
  }
}

/** Result of `value` as the next expression after Enter (`=` semantics): the shortened display text, ready to keep typing on. */
export const continueFrom = (r: CalcResult): string => (r.ok ? r.text : '')
