import { buildColumnResolver, normalizeFormulaInput, compileFormula } from '../src/lib/formula'
import { PrismaClient } from '@prisma/client'
import { mapFieldRow } from '../src/lib/services/fields'
const db = new PrismaClient()
async function main() {
  const rows = await db.misField.findMany({ orderBy: { position: 'asc' } })
  const fields = rows.map(mapFieldRow)
  const r = buildColumnResolver(fields)
  console.log('resolve LoadingRate →', r.resolve('LoadingRate'))
  console.log('resolve loadingRate →', r.resolve('loadingRate'))
  console.log('resolve Loading Rate →', r.resolve('Loading Rate'))
  console.log('resolve Bucket →', r.resolve('Bucket'))
  // check for alias collisions
  const keys: Record<string, string> = {}
  for (const f of fields) {
    if (f.isSystem) continue
    for (const alias of [f.fieldKey, f.displayName, f.fieldName, f.displayName.replace(/\s+/g, ''), f.fieldName.replace(/\s+/g, '')]) {
      const k = alias.trim().toLowerCase()
      if (keys[k] && keys[k] !== f.fieldKey) console.log('COLLISION:', k, '→', keys[k], 'vs', f.fieldKey)
      keys[k] = keys[k] || f.fieldKey
    }
  }
  const norm = normalizeFormulaInput('=Bucket*LoadingRate', fields)
  console.log('normalized:', norm)
  try {
    const c = compileFormula('=Bucket*LoadingRate', fields)
    console.log('compiled OK')
  } catch (e) { console.log('compile error:', (e as Error).message) }
  await db.$disconnect()
}
main()
