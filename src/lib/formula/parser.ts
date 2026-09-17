// Recursive-descent parser: formula text → AST.
// Reference resolution order for a bare identifier:
//   1. known column name (case-insensitive, via the column resolver)
//   2. function name (must be followed by '(')
//   3. A1-style cell reference (e.g. B2, AA17)
//   4. TRUE / FALSE literals
//   5. otherwise → #NAME? error node kept as an 'colref' with unknown flag via parse error
import type { Ast, BinOp, CellAddr } from './ast'
import { tokenize, FormulaSyntaxError } from './tokenizer'
import type { ColumnResolver } from './resolve'

/** Computational limits (Phase-22 hardening) — generous for real MIS
 *  formulas, but bound parser recursion and range materialization. */
const MAX_AST_DEPTH = 64
const MAX_RANGE_CELLS = 100_000

const A1_RE = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/

export function colToIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

export function indexToCol(index: number): string {
  let s = ''
  let n = index
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function parseCellRef(ident: string): CellAddr | null {
  const m = ident.match(A1_RE)
  if (!m) return null
  return { col: colToIndex(m[1]), row: Number(m[2]) }
}

export interface ParseResult {
  ast: Ast
  error?: string
}

const KNOWN_FUNCTIONS = new Set([
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'ROUND', 'ABS', 'IFERROR',
])

export class Parser {
  private toks: ReturnType<typeof tokenize>
  private pos = 0
  private resolver: ColumnResolver
  private depth = 0
  public warning: string | null = null

  constructor(input: string, resolver: ColumnResolver) {
    this.toks = tokenize(input)
    this.resolver = resolver
  }

  private peek() { return this.toks[this.pos] }
  private next() { return this.toks[this.pos++] }

  parse(): Ast {
    const ast = this.parseExpr()
    const t = this.peek()
    if (t.t !== 'eof') throw new FormulaSyntaxError(`Unexpected "${t.t === 'str' || t.t === 'ident' ? t.v : t.t}" after expression`, this.pos)
    return ast
  }

  private parseExpr(): Ast {
    if (++this.depth > MAX_AST_DEPTH) {
      throw new FormulaSyntaxError(`Formula is nested too deeply (limit ${MAX_AST_DEPTH} levels)`, this.pos)
    }
    try {
      return this.parseComparison()
    } finally {
      this.depth--
    }
  }

  private parseComparison(): Ast {
    let left = this.parseConcat()
    while (true) {
      const t = this.peek()
      if (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        this.next()
        const right = this.parseConcat()
        left = { kind: 'bin', op: t.v as BinOp, left, right }
      } else return left
    }
  }

  private parseConcat(): Ast {
    let left = this.parseAdditive()
    while (true) {
      const t = this.peek()
      if (t.t === 'op' && t.v === '&') {
        this.next()
        const right = this.parseAdditive()
        left = { kind: 'bin', op: '&', left, right }
      } else return left
    }
  }

  private parseAdditive(): Ast {
    let left = this.parseMultiplicative()
    while (true) {
      const t = this.peek()
      if (t.t === 'op' && (t.v === '+' || t.v === '-')) {
        this.next()
        const right = this.parseMultiplicative()
        left = { kind: 'bin', op: t.v as BinOp, left, right }
      } else return left
    }
  }

  private parseMultiplicative(): Ast {
    let left = this.parsePower()
    while (true) {
      const t = this.peek()
      if (t.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.next()
        const right = this.parsePower()
        left = { kind: 'bin', op: t.v as BinOp, left, right }
      } else return left
    }
  }

  private parsePower(): Ast {
    const left = this.parseUnary()
    const t = this.peek()
    if (t.t === 'op' && t.v === '^') {
      this.next()
      const right = this.parsePower() // right-associative
      return { kind: 'bin', op: '^', left, right }
    }
    return left
  }

  private parseUnary(): Ast {
    const t = this.peek()
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.next()
      const operand = this.parseUnary()
      return { kind: 'un', op: t.v as '-' | '+', operand }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Ast {
    const t = this.next()
    if (t.t === 'num') return { kind: 'num', value: t.v }
    if (t.t === 'str') return { kind: 'str', value: t.v }
    if (t.t === 'lp') {
      const inner = this.parseExpr()
      const close = this.next()
      if (close.t !== 'rp') throw new FormulaSyntaxError('Missing ")"', this.pos)
      return { kind: 'paren', inner }
    }
    if (t.t === 'ident') {
      const upper = t.v.toUpperCase()
      if (upper === 'TRUE') return { kind: 'bool', value: true }
      if (upper === 'FALSE') return { kind: 'bool', value: false }

      // function call?
      if (this.peek().t === 'lp') {
        this.next() // consume '('
        const args: Ast[] = []
        if (this.peek().t !== 'rp') {
          args.push(this.parseExpr())
          while (this.peek().t === 'comma') {
            this.next()
            args.push(this.parseExpr())
          }
        }
        const close = this.next()
        if (close.t !== 'rp') throw new FormulaSyntaxError(`Missing ")" after ${upper}(…)`, this.pos)
        if (!KNOWN_FUNCTIONS.has(upper)) {
          this.warning = `Unknown function "${upper}" — it will evaluate to #NAME?`
        }
        return { kind: 'call', name: upper, args }
      }

      // range?  cellref : cellref
      if (this.peek().t === 'colon') {
        const start = parseCellRef(t.v)
        if (start) {
          this.next() // consume ':'
          const endTok = this.next()
          if (endTok.t !== 'ident') throw new FormulaSyntaxError('Invalid range — expected a cell like B20', this.pos)
          const end = parseCellRef(endTok.v)
          if (!end) throw new FormulaSyntaxError(`Invalid range end "${endTok.v}"`, this.pos)
          const cells = (Math.abs(end.col - start.col) + 1) * (Math.abs(end.row - start.row) + 1)
          if (cells > MAX_RANGE_CELLS) {
            throw new FormulaSyntaxError(`Range is too large (${cells.toLocaleString('en-IN')} cells — the limit is ${MAX_RANGE_CELLS.toLocaleString('en-IN')})`, this.pos)
          }
          return { kind: 'range', start, end }
        }
      }

      // column name?
      const fieldKey = this.resolver.resolve(t.v)
      if (fieldKey) return { kind: 'colref', name: t.v, fieldKey }

      // A1 cell reference?
      const cell = parseCellRef(t.v)
      if (cell) return { kind: 'cellref', addr: cell }

      throw new FormulaSyntaxError(`Unknown column "${t.v}"`, this.pos)
    }
    throw new FormulaSyntaxError(t.t === 'eof' ? 'Unexpected end of formula' : 'Unexpected token', this.pos)
  }
}

export function parseFormula(body: string, resolver: ColumnResolver): Ast {
  return new Parser(body, resolver).parse()
}
