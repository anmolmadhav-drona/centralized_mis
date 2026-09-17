// Unit tests for the formula engine (user scenarios T1-T5 + errors + functions)
import {
  compileFormula, evalCompiled, rowLocalResolver, buildColumnResolver,
  normalizeFormulaInput, extractDeps, astToA1, isErr,
  type FieldDef,
} from '../src/lib/formula'

const mkField = (key: string, displayName: string, type = 'DECIMAL'): FieldDef => ({
  id: key, fieldKey: key, fieldName: displayName.toUpperCase(), displayName,
  dataType: type as FieldDef['dataType'], required: false, defaultValue: null, options: null,
  position: 0, isCore: true, isSystem: false, active: true, width: null,
})

const FIELDS: FieldDef[] = [
  mkField('srNo', 'Sr. No.', 'INTEGER'),
  mkField('bucket', 'Bucket', 'INTEGER'),
  mkField('loadingCharges', 'Loading Charges'),
  mkField('loadingRate', 'Loading Rate'),
  mkField('transportCharges', 'Transport Charges'),
  mkField('totalCharges', 'Total Charges'),
  mkField('status', 'Delivery Status', 'DROPDOWN'),
]

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`) }
}

console.log('— parse & eval basics —')
{
  const values = { bucket: 100 }
  const r = evalCompiled(compileFormula('=Bucket*3', FIELDS), rowLocalResolver(values, FIELDS))
  check('T1: =Bucket*3 with Bucket=100 → 300', r, 300)
}
{
  const values = { bucket: 200 }
  check('T2: =Bucket*3 with Bucket=200 → 600', evalCompiled(compileFormula('=Bucket*3', FIELDS), rowLocalResolver(values, FIELDS)), 600)
}
{
  const values = { bucket: 200, loadingRate: 4 }
  check('T3: =Bucket*LoadingRate → 800', evalCompiled(compileFormula('=Bucket*LoadingRate', FIELDS), rowLocalResolver(values, FIELDS)), 800)
}
{
  const values = { loadingCharges: 800, transportCharges: 500 }
  check('T4: =LoadingCharges+TransportCharges → 1300', evalCompiled(compileFormula('=LoadingCharges+TransportCharges', FIELDS), rowLocalResolver(values, FIELDS)), 1300)
}
{
  const values = { bucket: 200, loadingRate: 5 }
  check('T5a: =Bucket*LoadingRate → 1000', evalCompiled(compileFormula('=Bucket*LoadingRate', FIELDS), rowLocalResolver(values, FIELDS)), 1000)
  const t = evalCompiled(compileFormula('=LoadingCharges+TransportCharges', FIELDS), rowLocalResolver({ loadingCharges: 1000, transportCharges: 500 }, FIELDS))
  check('T5b: Total → 1500', t, 1500)
}

console.log('— name resolution variants —')
{
  const values = { loadingCharges: 7 }
  check('display name with space: =Loading Charges*2', evalCompiled(compileFormula('=Loading Charges*2', FIELDS), rowLocalResolver(values, FIELDS)), 14)
  check('Excel header lower: =loading charges*2', evalCompiled(compileFormula('=loading charges*2', FIELDS), rowLocalResolver(values, FIELDS)), 14)
  check('no space: =LOADINGCHARGES*2', evalCompiled(compileFormula('=LOADINGCHARGES*2', FIELDS), rowLocalResolver(values, FIELDS)), 14)
  check('case: =bucket', evalCompiled(compileFormula('=bucket', FIELDS), rowLocalResolver({ bucket: 5 }, FIELDS)), 5)
}

console.log('— functions —')
{
  const R = rowLocalResolver({ bucket: 10, loadingRate: 3 }, FIELDS)
  check('ROUND(Bucket*LoadingRate,2)', evalCompiled(compileFormula('=ROUND(Bucket*LoadingRate,2)', FIELDS), R), 30)
  check('IF Status="Delivered"', evalCompiled(compileFormula('=IF(Status="Delivered",1,0)', FIELDS), rowLocalResolver({ status: 'Delivered' }, FIELDS)), 1)
  check('IF Status<>"Delivered"', evalCompiled(compileFormula('=IF(Status<>"Delivered",1,0)', FIELDS), rowLocalResolver({ status: 'Pending' }, FIELDS)), 1)
  check('IFERROR(1/0,9)', evalCompiled(compileFormula('=IFERROR(1/0,9)', FIELDS), R), 9)
  check('IFERROR(4/2,9)', evalCompiled(compileFormula('=IFERROR(4/2,9)', FIELDS), R), 2)
  check('ABS(-5)', evalCompiled(compileFormula('=ABS(-5)', FIELDS), R), 5)
  check('AVERAGE(2,4,6)', evalCompiled(compileFormula('=AVERAGE(2,4,6)', FIELDS), R), 4)
  check('MIN(3,1,2)', evalCompiled(compileFormula('=MIN(3,1,2)', FIELDS), R), 1)
  check('MAX(3,1,2)', evalCompiled(compileFormula('=MAX(3,1,2)', FIELDS), R), 3)
  check('COUNT(1,"a",2)', evalCompiled(compileFormula('=COUNT(1,"a",2)', FIELDS), R), 2)
  check('COUNTA(1,"a",2,"")', evalCompiled(compileFormula('=COUNTA(1,"a",2,"")', FIELDS), R), 3)
  check('SUM(1,2,3)', evalCompiled(compileFormula('=SUM(1,2,3)', FIELDS), R), 6)
  check('parentheses 2*(3+4)', evalCompiled(compileFormula('=2*(3+4)', FIELDS), R), 14)
  check('unary -Bucket', evalCompiled(compileFormula('=-Bucket', FIELDS), rowLocalResolver({ bucket: 8 }, FIELDS)), -8)
  check('^ power', evalCompiled(compileFormula('=2^10', FIELDS), R), 1024)
  check('& concat', evalCompiled(compileFormula('="a"&"b"', FIELDS), R), 'ab')
  check('numeric string coercion "3"*2', evalCompiled(compileFormula('="3"*2', FIELDS), R), 6)
  check('true=1 comparison', evalCompiled(compileFormula('=IF(TRUE,1,2)', FIELDS), R), 1)
}

console.log('— errors —')
{
  const R = rowLocalResolver({ bucket: 10 }, FIELDS)
  const bad = (() => { try { return evalCompiled(compileFormula('=Bucket*ABC', FIELDS), R) } catch (e) { return e as { code: string; message: string } } })()
  check('=Bucket*ABC → #REF! Unknown column "ABC"', bad.code === '#REF!' && /Unknown column "ABC"/.test(bad.message), true)

  const div = evalCompiled(compileFormula('=1/0', FIELDS), R)
  check('1/0 → #DIV/0!', isErr(div) && div.code === '#DIV/0!', true)

  const val = evalCompiled(compileFormula('="abc"*2', FIELDS), R)
  check('"abc"*2 → #VALUE!', isErr(val) && val.code === '#VALUE!', true)

  const missing = evalCompiled(compileFormula('=Bucket', FIELDS), rowLocalResolver({}, FIELDS))
  check('missing value → null', missing, null)

  const unknownFn = evalCompiled(compileFormula('=FOO(1)', FIELDS), R)
  check('FOO(1) → #NAME?', isErr(unknownFn) && unknownFn.code === '#NAME?', true)

  // empty column treated as 0 in arithmetic
  const emptyArith = evalCompiled(compileFormula('=Bucket+LoadingRate', FIELDS), rowLocalResolver({ bucket: 10 }, FIELDS))
  check('null + number → number (blank=0-like in sums)', emptyArith, 10)

  let threw = ''
  try { compileFormula('=Bucket*(3', FIELDS) } catch (e) { threw = (e as { code: string }).code }
  check('unbalanced paren → #VALUE!', threw, '#VALUE!')
}

console.log('— deps extraction —')
{
  const compiled = compileFormula('=SUM(Bucket,B2:B20)', FIELDS)
  const deps = extractDeps(compiled.ast)
  check('column deps', deps.columns, ['bucket'])
  check('cell deps', deps.cells, [])
  check('range deps', deps.ranges, [{ start: { col: 2, row: 2 }, end: { col: 2, row: 20 } }])
}

console.log('— A1 translation for export —')
{
  const compiled = compileFormula('=Bucket*3', FIELDS)
  const idx = (k: string) => FIELDS.findIndex((f) => f.fieldKey === k) + 1
  const out = astToA1(compiled.ast, { columnIndexOf: idx, sheetRow: 7, a1RowOffset: 2 })
  check('=Bucket*3 @ sheet row 7 → =B7*3', out, 'B7*3')

  const c2 = compileFormula('=LoadingCharges+TransportCharges', FIELDS)
  const out2 = astToA1(c2.ast, { columnIndexOf: idx, sheetRow: 9, a1RowOffset: 2 })
  check('=LoadingCharges+TransportCharges → =C9+E9', out2, 'C9+E9')

  const c3 = compileFormula('=SUM(B2:B20)', FIELDS)
  const out3 = astToA1(c3.ast, { columnIndexOf: idx, sheetRow: 9, a1RowOffset: 2 })
  check('SUM(B2:B20) row-shifted +2 → SUM(B4:B22)', out3, 'SUM(B4:B22)')
}

console.log('— normalization safety —')
{
  const normalized = normalizeFormulaInput('=IF(Status="Loading Charges",Loading Charges,1)', FIELDS)
  // string literal must NOT be replaced; bare name must be replaced
  check('string literals preserved', normalized.includes('"Loading Charges"'), true)
  check('bare column name normalized', normalized.includes('loadingCharges'), true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
