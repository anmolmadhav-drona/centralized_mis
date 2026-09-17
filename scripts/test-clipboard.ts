// Unit tests for the Excel clipboard helpers (TSV round-trip, token
// interpretation, series fill, date normalization). Run: bun scripts/test-clipboard.ts
import { buildTsv, parseTsv, interpretToken, fillSeries, normalizeDateToken } from '../src/lib/client/clipboard'

let passed = 0
let failed = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---- TSV round-trip ----
const tsv1 = buildTsv([
  [{ text: '100' }, { text: '300', formula: '=Bucket*3' }],
  [{ text: 'hello' }, { text: '' }],
])
ok('buildTsv basic', tsv1 === '100\t300\nhello\t', JSON.stringify(tsv1))
const p1 = parseTsv(tsv1)
ok('parseTsv shape', p1.length === 2 && p1[0].length === 2 && p1[1].length === 2)
ok('parseTsv values', p1[0][0] === '100' && p1[0][1] === '300' && p1[1][0] === 'hello' && p1[1][1] === '')

// ---- quoting ----
const tsv2 = buildTsv([[{ text: 'a\tb' }, { text: 'say "hi"' }]])
const p2 = parseTsv(tsv2)
ok('quoted tab survives round-trip', p2[0][0] === 'a\tb', JSON.stringify(p2))
ok('quoted quotes survive round-trip', p2[0][1] === 'say "hi"', JSON.stringify(p2))

// ---- parse Excel-style clipboard (CRLF, trailing newline) ----
const p3 = parseTsv('1\t2\r\n3\t4\r\n')
ok('CRLF + trailing newline', p3.length === 2 && p3[1][0] === '3' && p3[1][1] === '4')

// ---- token interpretation ----
ok('= formula token', interpretToken('=Bucket*3').kind === 'formula')
ok('number token', interpretToken('42').kind === 'number')
ok('comma number token', interpretToken('1,234').kind === 'number' && (interpretToken('1,234') as { value: number }).value === 1234)
ok('text token', interpretToken('Sonipat').kind === 'text')
ok('empty token', interpretToken('  ').kind === 'empty')

// ---- fill series ----
ok('copy single value', JSON.stringify(fillSeries(['100'], 3)) === '["100","100","100"]')
ok('arithmetic series', JSON.stringify(fillSeries(['10', '20', '30'], 3)) === '["40","50","60"]')
ok('irregular numbers copy', JSON.stringify(fillSeries(['10', '25', '31'], 3)) === '["10","25","31"]')
ok('text copies verbatim', JSON.stringify(fillSeries(['PTL'], 2)) === '["PTL","PTL"]')
ok('two-cell block tiles', JSON.stringify(fillSeries(['A', 'B'], 5)) === '["A","B","A","B","A"]')
ok('negative delta series', JSON.stringify(fillSeries(['9', '6'], 2)) === '["3","0"]')
ok('two numeric cells continue (Excel)', JSON.stringify(fillSeries(['10', '25'], 2)) === '["40","55"]')

// ---- date normalization ----
ok('2-digit year expands (mm-dd-yy workbook format)', normalizeDateToken('09-01-26') === '2026-09-01')
ok('ISO untouched', normalizeDateToken('2026-09-01') === '2026-09-01')
ok('dd-mm-yyyy untouched (server handles)', normalizeDateToken('07-08-2026') === '07-08-2026')

console.log(`\nCLIPBOARD UNIT: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
