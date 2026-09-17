// Formula → Excel A1 translation for export.
// Column-name refs (=Bucket*3) become same-row A1 refs (=K7*3) so the
// exported workbook recalculates natively in Excel; A1 refs are row-shifted
// to the sheet layout (row 1 TOTAL, row 2 header, data from row 3).
import type { Ast, CellAddr } from './ast'
import { indexToCol } from './parser'

export interface TranslateOptions {
  /** fieldKey → 1-based sheet column index (registry/export order) */
  columnIndexOf: (fieldKey: string) => number | null
  /** sheet row (1-based) of the record being exported */
  sheetRow: number
  /** row offset added to existing A1 refs (grid row 1 → sheet row 1 + offset) */
  a1RowOffset: number
}

function quoteStr(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

export function astToA1(ast: Ast, opts: TranslateOptions): string {
  switch (ast.kind) {
    case 'num':
      return String(ast.value)
    case 'str':
      return quoteStr(ast.value)
    case 'bool':
      return ast.value ? 'TRUE' : 'FALSE'
    case 'colref': {
      const idx = opts.columnIndexOf(ast.fieldKey)
      if (idx == null) return `"#REF!"` // unknown column — let Excel show it
      return `${indexToCol(idx)}${opts.sheetRow}`
    }
    case 'cellref':
      return `${indexToCol(ast.addr.col)}${ast.addr.row + opts.a1RowOffset}`
    case 'range': {
      const s = normalizeRange(ast.start, ast.end)
      return `${indexToCol(s.start.col)}${s.start.row + opts.a1RowOffset}:${indexToCol(s.end.col)}${s.end.row + opts.a1RowOffset}`
    }
    case 'call':
      return `${ast.name}(${ast.args.map((a) => astToA1(a, opts)).join(',')})`
    case 'bin':
      return `${astToA1(ast.left, opts)}${ast.op}${astToA1(ast.right, opts)}`
    case 'un':
      return `${ast.op}${astToA1(ast.operand, opts)}`
    case 'paren':
      return `(${astToA1(ast.inner, opts)})`
  }
}

export function normalizeRange(start: CellAddr, end: CellAddr): { start: CellAddr; end: CellAddr } {
  return {
    start: { col: Math.min(start.col, end.col), row: Math.min(start.row, end.row) },
    end: { col: Math.max(start.col, end.col), row: Math.max(start.row, end.row) },
  }
}
