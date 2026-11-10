// Deletes stale rows from the Better Auth tables on Neon. Better Auth doesn't
// remove them itself, and on a public URL bots keep adding rate-limit rows
// (one per client IP and endpoint).
//
// - rateLimit: rows untouched for a day (the longest window is 60 s)
// - session: expired sessions
// - verification: expired reset tokens / sign-in state
//
// Safe to run any time. Schedule it daily (cron, Vercel Cron, GitHub Actions).
// Usage: npm run db:cleanup

import { getPool } from "../lib/db/postgres.ts"

const RATE_LIMIT_MAX_AGE_MS = 24 * 60 * 60 * 1000

const STATEMENTS = [
  {
    table: "rateLimit",
    sql: `DELETE FROM "rateLimit" WHERE "lastRequest" < $1`,
    params: [Date.now() - RATE_LIMIT_MAX_AGE_MS],
  },
  {
    table: "session",
    sql: `DELETE FROM "session" WHERE "expiresAt" < now()`,
    params: [],
  },
  {
    table: "verification",
    sql: `DELETE FROM "verification" WHERE "expiresAt" < now()`,
    params: [],
  },
]

let pool: ReturnType<typeof getPool> | undefined
try {
  pool = getPool() // validates DATABASE_URL
  for (const { table, sql, params } of STATEMENTS) {
    const { rowCount } = await pool.query(sql, params)
    console.log(`${table}: deleted ${rowCount ?? 0} row(s)`)
  }
} catch (error) {
  console.error("Cleanup failed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await pool?.end()
}
