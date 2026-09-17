// Safe arithmetic expression evaluator — tokenizer + shunting-yard.
// No eval(), no Function(). Supports + - * / % ( ), unary +/-, decimals.

type Token =
  | { t: 'num'; v: number }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '%' | '(' | ')' | 'u-' | 'u+' }

const PRECEDENCE: Record<string, number> = {
  'u+': 4, 'u-': 4,
  '%': 3,
  '*': 2, '/': 2,
  '+': 1, '-': 1,
}

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  const s = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '')
  let prev: Token | null = null
  while (i < s.length) {
    const c = s[i]
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const numStr = s.slice(i, j)
      if ((numStr.match(/\./g) || []).length > 1) return null
      tokens.push({ t: 'num', v: parseFloat(numStr) })
      i = j
    } else if ('+-*/%()'.includes(c)) {
      if (c === '(' || !prev || (prev.t === 'op' && prev.v !== ')')) {
        // unary context
        if (c === '-') tokens.push({ t: 'op', v: 'u-' })
        else if (c === '+') tokens.push({ t: 'op', v: 'u+' })
        else if (c === '(') tokens.push({ t: 'op', v: '(' })
        else return null
      } else {
        tokens.push({ t: 'op', v: c as Token extends { t: 'op'; v: infer V } ? V : never })
      }
      i++
    } else {
      return null
    }
    prev = tokens[tokens.length - 1] ?? null
  }
  return tokens.length > 0 ? tokens : null
}

export interface EvalResult {
  ok: boolean
  value?: number
  error?: string
}

export function evaluateExpression(input: string): EvalResult {
  const tokens = tokenize(input)
  if (!tokens) return { ok: false, error: 'Invalid expression' }

  // shunting-yard to RPN
  const output: Token[] = []
  const stack: Token[] = []
  for (const tok of tokens) {
    if (tok.t === 'num') {
      output.push(tok)
    } else if (tok.v === '(') {
      stack.push(tok)
    } else if (tok.v === ')') {
      while (stack.length > 0 && stack[stack.length - 1]!.v !== '(') output.push(stack.pop()!)
      if (stack.length === 0) return { ok: false, error: 'Unbalanced parentheses' }
      stack.pop()
    } else {
      const p = PRECEDENCE[tok.v]
      while (
        stack.length > 0 &&
        stack[stack.length - 1]!.t === 'op' &&
        stack[stack.length - 1]!.v !== '(' &&
        PRECEDENCE[stack[stack.length - 1]!.v] >= p
      ) {
        output.push(stack.pop()!)
      }
      stack.push(tok)
    }
  }
  while (stack.length > 0) {
    const top = stack.pop()!
    if (top.v === '(') return { ok: false, error: 'Unbalanced parentheses' }
    output.push(top)
  }

  // evaluate RPN
  const vals: number[] = []
  for (const tok of output) {
    if (tok.t === 'num') {
      vals.push(tok.v)
    } else if (tok.v === 'u-') {
      const a = vals.pop()
      if (a === undefined) return { ok: false, error: 'Invalid expression' }
      vals.push(-a)
    } else if (tok.v === 'u+') {
      // no-op
    } else {
      const b = vals.pop()
      const a = vals.pop()
      if (a === undefined || b === undefined) return { ok: false, error: 'Invalid expression' }
      switch (tok.v) {
        case '+': vals.push(a + b); break
        case '-': vals.push(a - b); break
        case '*': vals.push(a * b); break
        case '/':
          if (b === 0) return { ok: false, error: 'Division by zero' }
          vals.push(a / b)
          break
        case '%':
          if (b === 0) return { ok: false, error: 'Division by zero' }
          vals.push(a % b)
          break
        default: return { ok: false, error: 'Invalid expression' }
      }
    }
  }
  if (vals.length !== 1 || !Number.isFinite(vals[0])) {
    return { ok: false, error: Number.isFinite(vals[0]) ? 'Invalid expression' : 'Result is not a finite number' }
  }
  return { ok: true, value: vals[0] }
}

/** Pretty print a result (up to 10 significant decimals, Indian grouping optional) */
export function formatResult(v: number): string {
  const rounded = Math.round(v * 1e10) / 1e10
  if (Number.isInteger(rounded)) return rounded.toLocaleString('en-IN')
  return rounded.toPrecision(12).replace(/\.?0+$/, '')
}
