// Public API of the MIS formula engine (shared client + server).
import type { Ast, CellAddr, CellError, EvalValue } from './ast'
import { cellError, extractDeps } from './ast'
import { normalizeFormulaInput, buildColumnResolver, type ColumnResolver } from './resolve'
import { parseFormula, Parser, indexToCol, colToIndex, parseCellRef } from './parser'
import { evaluate, isErr, type EvalResult, type RefResolver } from './evaluate'
import type { FieldDef } from '@/lib/types'

export type { Ast, CellAddr, CellError, EvalValue, EvalResult, RefResolver, ColumnResolver }
export { cellError, extractDeps, isErr, evaluate, indexToCol, colToIndex, parseCellRef }
export { normalizeFormulaInput, buildColumnResolver }
export { FormulaSyntaxError } from './tokenizer'
export { astToA1, normalizeRange } from './translate'

export interface CompiledFormula {
  ast: Ast
  /** normalized formula body (multi-word names → fieldKeys) */
  body: string
}

export class FormulaError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Compile a user formula (with or without the leading '=').
 * Throws FormulaError with a friendly message when the formula is invalid.
 */
/** Maximum accepted formula length in characters (Phase-22 hardening). */
export const MAX_FORMULA_LENGTH = 2_000

export function compileFormula(raw: string, fields: FieldDef[]): CompiledFormula {
  if (raw.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError('#VALUE!', `Formula is too long (${raw.length} characters — the limit is ${MAX_FORMULA_LENGTH.toLocaleString('en-IN')})`)
  }
  const trimmed = raw.trim()
  const body = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed
  if (!body.trim()) throw new FormulaError('#VALUE!', 'The formula is empty')
  const resolver = buildColumnResolver(fields)
  const normalized = normalizeFormulaInput(body, fields)
  const parser = new Parser(normalized, resolver)
  try {
    const ast = parser.parse()
    return { ast, body: normalized }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid formula'
    if (/Unknown column/i.test(msg)) {
      throw new FormulaError('#REF!', msg.replace('Unknown column', '#REF! Unknown column'))
    }
    if (/Unterminated/i.test(msg)) throw new FormulaError('#VALUE!', 'A text value is missing its closing quote')
    if (/Unknown function/i.test(msg)) throw new FormulaError('#NAME?', msg)
    throw new FormulaError('#VALUE!', `The formula could not be read: ${msg}`)
  }
}

/** Evaluate a compiled formula; never throws — errors come back as values. */
export function evalCompiled(compiled: CompiledFormula, R: RefResolver): EvalResult {
  return evaluate(compiled.ast, R)
}

export { parseFormula }

// ------------------------------------------------------------------
// Row-local resolver — evaluates column-name formulas against ONE record
// (used by the API for server-authoritative recalculation).
// A1 refs are not resolvable in row-local context → client value is trusted.
// ------------------------------------------------------------------
export function rowLocalResolver(
  values: Record<string, unknown>,
  fields: FieldDef[]
): RefResolver {
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]))
  return {
    columnValue(fieldKey: string, name: string): EvalValue | null {
      const v = values[fieldKey]
      if (v == null) return fieldByKey.has(fieldKey) ? null : cellError('#REF!', `Unknown column "${name}"`)
      if (typeof v === 'number') return v
      if (typeof v === 'boolean') return v
      return String(v)
    },
    cellValue(): EvalValue {
      return cellError('#N/A', 'Cell references (like B2) only work in the grid or during import')
    },
    rangeValues(): Array<EvalValue | null> | CellError {
      return cellError('#N/A', 'Cell ranges (like B2:B20) only work in the grid or during import')
    },
  }
}

export const FORMULA_FUNCTIONS = [
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'ROUND', 'ABS', 'IFERROR',
] as const
