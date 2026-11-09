// Creates the Better Auth schema (db/auth_schema.sql) on the Neon Postgres
// database pointed to by DATABASE_URL. The schema is idempotent
// (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS), so re-running
// this script is safe.
//
// Runs on plain Node (built-in type stripping, Node >= 22.18), so it may only
// use erasable TypeScript syntax.
// `.env.local` is loaded by `node --env-file-if-exists` in the npm script.
//
// Usage: npm run db:setup

import { readFileSync } from "node:fs"
import { join } from "node:path"
import pg from "pg"

const SCHEMA_PATH = join(import.meta.dirname, "..", "db", "auth_schema.sql")

async function setupDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set in .env.local")
    console.log("💡 Use Neon's DIRECT (non -pooler) connection string, e.g.:")
    console.log(
      '   DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=verify-full"'
    )
    process.exit(1)
  }

  // TLS is driven by `sslmode` in the connection string (Neon requires it).
  // Don't disable certificate verification here.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

  try {
    console.log("🔌 Connecting to database...")
    await client.connect()
    console.log("✅ Connected")

    console.log(`📖 Reading ${SCHEMA_PATH}`)
    const schema = readFileSync(SCHEMA_PATH, "utf-8")

    console.log("🚀 Creating tables, indexes and triggers...")
    await client.query(schema)

    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('user', 'session', 'account', 'verification', 'rateLimit')
       ORDER BY table_name`
    )
    console.log("✅ Schema applied. Tables present:")
    for (const r of rows) console.log(`   - ${r.table_name}`)
  } catch (error) {
    console.error(
      "❌ Error applying schema:",
      error instanceof Error ? error.message : error
    )
    console.error("\nFull error details:", error)
    process.exitCode = 1
  } finally {
    await client.end()
    console.log("🔌 Connection closed")
  }
}

await setupDatabase()
