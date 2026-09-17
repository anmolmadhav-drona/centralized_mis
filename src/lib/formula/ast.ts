// Formula AST — shared between client and server evaluation contexts.
// Supports: literals, column-name refs (=Bucket*3), A1 cell refs (=B2*3),
// ranges (=SUM(B2:B20)), function calls, comparison/arith/concat operators.

export type BinOp =
  | '+' | '-' | '*' | '/' | '^'
  | '=' | '<>' | '<' | '>' | '<=' | '>='
  | '&'

export interface CellAddr {
  /** 1-based column index (A=1) */
  col: number
  /** 1-based row index (as displayed in the grid) */
  row: number
}

export type Ast =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'colref'; name: string; fieldKey: string }
  | { kind: 'cellref'; addr: CellAddr }
  | { kind: 'range'; start: CellAddr; end: CellAddr }
  | { kind: 'call'; name: string; args: Ast[] }
  | { kind: 'bin'; op: BinOp; left: Ast; right: Ast }
  | { kind: 'un'; op: '-' | '+'; operand: Ast }
  | { kind: 'paren'; inner: Ast }

/** Spreadsheet error value (rendered in the cell, explained on hover) */
export interface CellError {
  err: true
  code: string // '#REF!' | '#NAME?' | '#DIV/0!' | '#VALUE!' | '#CYCLE!' | '#N/A' | '#NUM!'
  message: string
}

export function cellError(code: string, message: string): CellError {
  return { err: true, code, message }
}

export type EvalValue = number | string | boolean | CellError

export interface FormulaDeps {
  /** same-row column references (fieldKeys) */
  columns: string[]
  /** absolute cell references (grid coordinates) */
  cells: CellAddr[]
  /** range references */
  ranges: Array<{ start: CellAddr; end: CellAddr }>
}

/** Walk an AST collecting all references (for dependency graphs). */
export function extractDeps(ast: Ast): FormulaDeps {
  const columns: string[] = []
  const cells: CellAddr[] = []
  const ranges: FormulaDeps['ranges'] = []
  const walk = (node: Ast) => {
    switch (node.kind) {
      case 'colref':
        columns.push(node.fieldKey)
        break
      case 'cellref':
        cells.push(node.addr)
        break
      case 'range':
        ranges.push({ start: node.start, end: node.end })
        break
      case 'call':
        node.args.forEach(walk)
        break
      case 'bin':
        walk(node.left)
        walk(node.right)
        break
      case 'un':
        walk(node.operand)
        break
      case 'paren':
        walk(node.inner)
        break
      default:
        break
    }
  }
  walk(ast)
  return { columns, cells, ranges }
}
