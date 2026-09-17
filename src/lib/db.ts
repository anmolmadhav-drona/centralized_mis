import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Production logging: errors + warnings only. Query logging is extremely
// verbose (one line per SQL statement) and can leak row data into logs —
// enable it explicitly for debugging via QUERY_LOG=1.
const logConfig = process.env.QUERY_LOG === '1' ? ['query', 'error', 'warn'] : ['error', 'warn']

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logConfig as ('query' | 'error' | 'warn')[],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Parameterized raw query with portable `?` placeholders.
 *
 * Drop-in for `db.$queryRawUnsafe` — same call convention (`rawQuery<Row[]>(sql, ...params)`)
 * and return type. All hand-written SQL in this codebase binds values as `?`
 * (SQLite style); PostgreSQL requires positional `$1, $2, …` placeholders, so
 * this helper rewrites them in order before executing. Never put user input
 * directly into `sql` — only bound parameters.
 */
export async function rawQuery<T>(sql: string, ...params: unknown[]): Promise<T> {
  let i = 0
  const pgSql = sql.replace(/\?/g, () => `$${++i}`)
  return db.$queryRawUnsafe<T>(pgSql, ...params)
}
