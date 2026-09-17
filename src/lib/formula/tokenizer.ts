// Tokenizer for MIS formulas. Idents cover column names, function names and
// A1-style cell references; multi-word column names ("Loading Charges") are
// normalized to fieldKeys BEFORE tokenization (see resolve.ts).

export type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' }
  | { t: 'colon' }
  | { t: 'eof' }

export class FormulaSyntaxError extends Error {
  pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.pos = pos
  }
}

/** Computational limits — reject pathological formulas with friendly errors
 *  instead of stalling the request (see Phase-22 hardening). */
export const MAX_FORMULA_TOKENS = 500

const NUM_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/
const OPS = ['<=', '>=', '<>', '=', '<', '>', '+', '-', '*', '/', '^', '&']

export function tokenize(input: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const s = input
  while (i < s.length) {
    const ch = s[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (toks.length >= MAX_FORMULA_TOKENS) {
      throw new FormulaSyntaxError(`Formula has too many tokens (limit ${MAX_FORMULA_TOKENS})`, i)
    }
    if (ch === '(') { toks.push({ t: 'lp' }); i++; continue }
    if (ch === ')') { toks.push({ t: 'rp' }); i++; continue }
    if (ch === ',') { toks.push({ t: 'comma' }); i++; continue }
    if (ch === ':') { toks.push({ t: 'colon' }); i++; continue }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      let out = ''
      let closed = false
      while (i < s.length) {
        if (s[i] === quote) {
          if (i + 1 < s.length && s[i + 1] === quote) { out += quote; i += 2; continue }
          i++; closed = true; break
        }
        out += s[i]; i++
      }
      if (!closed) throw new FormulaSyntaxError('Unterminated text value', i)
      toks.push({ t: 'str', v: out })
      continue
    }
    const rest = s.slice(i)
    const num = rest.match(NUM_RE)
    if (num && (/\d/.test(ch))) {
      toks.push({ t: 'num', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const id = rest.match(IDENT_RE)
      if (!id) throw new FormulaSyntaxError(`Unexpected character "${ch}"`, i)
      toks.push({ t: 'ident', v: id[0] })
      i += id[0].length
      continue
    }
    const op = OPS.find((o) => rest.startsWith(o))
    if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue }
    throw new FormulaSyntaxError(`Unexpected character "${ch}"`, i)
  }
  toks.push({ t: 'eof' })
  return toks
}
