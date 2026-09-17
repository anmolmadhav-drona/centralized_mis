// Formula evaluator — evaluates an AST against a reference resolver.
// Errors are VALUES (#REF!, #DIV/0!, …), never exceptions, so a broken
// formula corrupts exactly one cell and is displayed with an explanation.
import type { Ast, CellAddr, CellError, EvalValue } from './ast'
import { cellError } from './ast'

export interface RefResolver {
  /** same-row column value by fieldKey (null when the column is known but empty) */
  columnValue(fieldKey: string, name: string): EvalValue | null
  /** absolute cell value (1-based grid coordinates) */
  cellValue(addr: CellAddr): EvalValue | null
  /** materialize a range into a flat list of values */
  rangeValues(start: CellAddr, end: CellAddr): Array<EvalValue | null> | CellError
}

export type EvalResult = EvalValue | Array<EvalValue | null> | null

export const isErr = (v: unknown): v is CellError =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'err' in v

function toNumber(v: EvalValue | null): number | CellError | null {
  if (v == null) return v // propagate blanks (JS arithmetic coerces null → 0, as before)
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (trimmed === '') return cellError('#VALUE!', 'Empty text where a number is required')
    const n = Number(trimmed.replace(/,/g, ''))
    if (Number.isFinite(n)) return n
    return cellError('#VALUE!', `Text "${v.slice(0, 30)}" cannot be used as a number`)
  }
  return v // propagate error
}

function flatten(args: EvalResult[]): Array<EvalValue | null> {
  const out: Array<EvalValue | null> = []
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a)
    else out.push(a)
  }
  return out
}

function single(v: EvalResult): EvalValue | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/** A range used where a single value is expected → #VALUE! (Excel semantics) */
function scalar(v: EvalResult): EvalValue | null {
  if (Array.isArray(v)) {
    if (v.length === 1) return v[0] ?? null
    return cellError('#VALUE!', 'A cell range was used where a single value is required')
  }
  return v
}

const numbersOf = (args: EvalResult[]): number[] | CellError => {
  const nums: number[] = []
  for (const a of flatten(args)) {
    if (isErr(a)) return a
    if (a == null || a === '') continue // SUM-style: skip blanks & text
    if (typeof a === 'boolean') { nums.push(a ? 1 : 0); continue }
    if (typeof a === 'number') { nums.push(a); continue }
    if (typeof a === 'string') {
      const n = Number(a.trim().replace(/,/g, ''))
      if (Number.isFinite(n)) nums.push(n)
      continue // non-numeric text is skipped, like Excel SUM
    }
  }
  return nums
}

function compareVals(op: string, l: EvalValue | null, r: EvalValue | null): EvalValue {
  if (isErr(l)) return l
  if (isErr(r)) return r
  if (op === '=' || op === '<>') {
    let eq: boolean
    if (typeof l === 'boolean' || typeof r === 'boolean') {
      eq = (typeof l === 'boolean' ? l : l === 'true') === (typeof r === 'boolean' ? r : r === 'true')
    } else if (typeof l === 'string' && typeof r === 'string') {
      eq = l.toLowerCase() === r.toLowerCase()
    } else if (typeof l === 'number' && typeof r === 'number') {
      eq = l === r
    } else {
      eq = String(l) === String(r)
    }
    return op === '=' ? eq : !eq
  }
  // ordering — numeric when both numeric, else case-insensitive text compare
  const bothNum = (typeof l === 'number' || typeof l === 'boolean') && (typeof r === 'number' || typeof r === 'boolean')
  if (bothNum) {
    const ln = typeof l === 'boolean' ? (l ? 1 : 0) : (l as number)
    const rn = typeof r === 'boolean' ? (r ? 1 : 0) : (r as number)
    switch (op) {
      case '<': return ln < rn
      case '>': return ln > rn
      case '<=': return ln <= rn
      case '>=': return ln >= rn
    }
  }
  if (typeof l === 'string' && typeof r === 'string') {
    const cmp = l.toLowerCase().localeCompare(r.toLowerCase())
    switch (op) {
      case '<': return cmp < 0
      case '>': return cmp > 0
      case '<=': return cmp <= 0
      case '>=': return cmp >= 0
    }
  }
  return cellError('#VALUE!', `Cannot compare ${typeof l} with ${typeof r}`)
}

export function evaluate(ast: Ast, R: RefResolver): EvalResult {
  switch (ast.kind) {
    case 'num': return ast.value
    case 'str': return ast.value
    case 'bool': return ast.value
    case 'colref': return R.columnValue(ast.fieldKey, ast.name)
    case 'cellref': return R.cellValue(ast.addr)
    case 'range': return R.rangeValues(ast.start, ast.end)
    case 'paren': return evaluate(ast.inner, R)
    case 'un': {
      const v = scalar(evaluate(ast.operand, R))
      if (isErr(v)) return v
      const n = toNumber(v)
      if (isErr(n)) return n
      const num = n ?? 0 // null (blank operand) coerces to 0, as before
      return ast.op === '-' ? -num : num
    }
    case 'bin': {
      if (ast.op === '&') {
        const l = scalar(evaluate(ast.left, R))
        const r = scalar(evaluate(ast.right, R))
        if (isErr(l)) return l
        if (isErr(r)) return r
        return `${stringOf(l)}${stringOf(r)}`
      }
      const l = scalar(evaluate(ast.left, R))
      const r = scalar(evaluate(ast.right, R))
      if (isErr(l)) return l
      if (isErr(r)) return r
      if (['=', '<>', '<', '>', '<=', '>='].includes(ast.op)) {
        return compareVals(ast.op, l, r)
      }
      const ln = toNumber(l)
      if (isErr(ln)) return ln
      const rn = toNumber(r)
      if (isErr(rn)) return rn
      const lnum = ln ?? 0 // blank operands coerce to 0 (JS arithmetic semantics)
      const rnum = rn ?? 0
      switch (ast.op) {
        case '+': return roundFloat(lnum + rnum)
        case '-': return roundFloat(lnum - rnum)
        case '*': return roundFloat(lnum * rnum)
        case '/':
          if (rnum === 0) return cellError('#DIV/0!', 'Division by zero')
          return roundFloat(lnum / rnum)
        case '^': {
          const p = Math.pow(lnum, rnum)
          if (!Number.isFinite(p)) return cellError('#NUM!', 'Result is not a finite number')
          return roundFloat(p)
        }
        default: return cellError('#VALUE!', `Unsupported operator ${ast.op}`)
      }
    }
    case 'call': return evaluateCall(ast.name, ast.args, R)
  }
}

function truthyOf(cond: EvalValue | null): boolean | CellError {
  if (isErr(cond)) return cond
  if (typeof cond === 'boolean') return cond
  if (typeof cond === 'number') return cond !== 0
  if (typeof cond === 'string') {
    const s = cond.trim().toLowerCase()
    if (s === 'true') return true
    if (s === 'false' || s === '') return false
    const n = Number(s)
    if (Number.isFinite(n)) return n !== 0
    return cellError('#VALUE!', `IF condition is text "${cond.slice(0, 20)}" — expected TRUE/FALSE or a comparison`)
  }
  return false
}

function stringOf(v: EvalValue | null): string {
  if (isErr(v)) return v.code
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(roundFloat(v))
  return v ? 'TRUE' : 'FALSE'
}

function roundFloat(n: number): number {
  // tame IEEE float noise (0.1+0.2 → 0.3)
  if (!Number.isFinite(n)) return n
  const rounded = Math.round(n * 1e10) / 1e10
  return Math.abs(n - rounded) < 1e-12 ? rounded : n
}

function evaluateCall(name: string, args: Ast[], R: RefResolver): EvalResult {
  // ---- lazy functions ----
  if (name === 'IF') {
    if (args.length < 2) return cellError('#VALUE!', 'IF needs 2 or 3 arguments: IF(condition, then, otherwise)')
    const cond = truthyOf(scalar(evaluate(args[0], R)))
    if (isErr(cond)) return cond
    if (cond) return single(evaluate(args[1], R))
    if (args.length >= 3) return single(evaluate(args[2], R))
    return false
  }
  if (name === 'IFERROR') {
    if (args.length < 2) return cellError('#VALUE!', 'IFERROR needs 2 arguments: IFERROR(value, fallback)')
    const v = evaluate(args[0], R)
    if (Array.isArray(v)) {
      const err = v.find((x) => isErr(x))
      if (err !== undefined) return single(evaluate(args[1], R))
      return v
    }
    if (isErr(v)) return single(evaluate(args[1], R))
    return v
  }

  // ---- eager functions ----
  const evaluated: EvalResult[] = args.map((a) => evaluate(a, R))
  const flat = flatten(evaluated)
  if (name !== 'COUNT' && name !== 'COUNTA') {
    const firstErr = flat.find((v) => isErr(v))
    if (firstErr !== undefined) return firstErr
  }

  switch (name) {
    case 'SUM': {
      const nums = numbersOf(evaluated)
      if (isErr(nums)) return nums
      return roundFloat(nums.reduce((s, n) => s + n, 0))
    }
    case 'AVERAGE': {
      const nums = numbersOf(evaluated)
      if (isErr(nums)) return nums
      if (nums.length === 0) return cellError('#DIV/0!', 'AVERAGE of no numeric values')
      return roundFloat(nums.reduce((s, n) => s + n, 0) / nums.length)
    }
    case 'MIN': {
      const nums = numbersOf(evaluated)
      if (isErr(nums)) return nums
      return nums.length === 0 ? 0 : Math.min(...nums)
    }
    case 'MAX': {
      const nums = numbersOf(evaluated)
      if (isErr(nums)) return nums
      return nums.length === 0 ? 0 : Math.max(...nums)
    }
    case 'COUNT': {
      const nums = numbersOf(evaluated)
      if (isErr(nums)) return nums
      return nums.length
    }
    case 'COUNTA': {
      return flat.filter((v) => v !== null && v !== '' && !isErr(v)).length
    }
    case 'ROUND': {
      if (flat.length < 1) return cellError('#VALUE!', 'ROUND needs a number')
      const n = toNumber(flat[0])
      if (isErr(n)) return n
      const digits = flat.length >= 2 ? toNumber(flat[1]) : 0
      if (isErr(digits)) return digits
      const f = Math.pow(10, Math.trunc(digits ?? 0))
      return Math.round((n ?? 0) * f) / f
    }
    case 'ABS': {
      if (flat.length < 1) return cellError('#VALUE!', 'ABS needs a number')
      const n = toNumber(flat[0])
      if (isErr(n)) return n
      return Math.abs(n ?? 0)
    }
    default:
      return cellError('#NAME?', `Unknown function "${name}"`)
  }
}
