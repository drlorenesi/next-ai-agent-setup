// This module assumes a DIRECT Postgres connection that owns its session.
// Transaction-mode poolers (Neon "-pooler" endpoint, Supabase port 6543,
// stand-alone PgBouncer in transaction mode, AWS RDS Proxy) silently break the
// guarantees this module is built around — `statement_timeout` and
// `idle_in_transaction_session_timeout` get wiped between transactions, and
// pg's implicit prepared-statement caching degrades.
//
// Configure DATABASE_URL to point at the direct endpoint. If you need a
// transaction-mode pooler in front of the app for scale reasons, consider
// pushing the relevant timeouts into the server-side defaults instead of
// relying on per-session SET. See docs/db-modules/postgres-testing-report.md
// for the trade-off table.

import { Pool, type PoolClient, type PoolConfig } from "pg"
import { z } from "zod"
import { formatCell, type QueryOutcome } from "./db-types"

declare global {
  var __pgPool: Pool | undefined
}

const isDev = process.env.NODE_ENV === "development"

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  POSTGRES_SSL_CA: z.string().min(1).optional(),
  POSTGRES_SSL_INSECURE: z.enum(["true", "false"]).optional(),
})

type Env = z.infer<typeof envSchema>

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid PostgreSQL environment configuration:\n${issues}`)
  }
  return parsed.data
}

function buildSsl(env: Env): PoolConfig["ssl"] {
  if (env.POSTGRES_SSL_CA) return { ca: env.POSTGRES_SSL_CA }
  if (env.POSTGRES_SSL_INSECURE === "true") {
    console.warn(
      "[postgres] POSTGRES_SSL_INSECURE=true — TLS without certificate verification. " +
        "Provide POSTGRES_SSL_CA for MITM protection."
    )
    return { rejectUnauthorized: false }
  }
  return undefined
}

function buildPoolOptions(env: Env): PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    max: isDev ? 3 : 10,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 0,
    ssl: buildSsl(env),
    // Surface this app in `pg_stat_activity.application_name` so a DBA can tell
    // which app/env owns a connection. Also fills the column we already render
    // in the diagnostics page.
    application_name: `next-claude-dev-${process.env.NODE_ENV ?? "unknown"}`,
    // Server-side bounds so a runaway query / abandoned transaction can't pin
    // a pool slot or block autovacuum.
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
  }
}

function registerShutdownHandlers(p: Pool) {
  // SIGINT and SIGTERM both fire on dev-server shutdown; cache the in-flight
  // promise so p.end() runs at most once per process.
  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      try {
        await p.end()
        console.log("[postgres] pool closed")
      } catch (err) {
        console.error("[postgres] error closing pool:", err)
      }
    })()
    return closing
  }
  process.on("SIGTERM", close)
  process.on("SIGINT", close)
}

function createPool(): Pool {
  const env = parseEnv()
  const p = new Pool(buildPoolOptions(env))

  // Belt-and-suspenders for the timeouts: pg sends `statement_timeout` and
  // `idle_in_transaction_session_timeout` from `buildPoolOptions` as startup
  // parameters in the connection packet, but **Neon silently drops them** (we
  // verified this with `pg_settings.source` — application_name comes through
  // with source=client, the timeouts don't). Issuing `SET` here, in the
  // `connect` handler, creates a session-level override that no
  // server/role/database default can shadow.
  //
  // The fire-and-forget pattern is safe because pg's per-client query queue
  // serializes all calls on a given client — any caller's first query after
  // the connect event will queue *behind* this SET and only run once it
  // commits.
  p.on("connect", (client) => {
    client
      .query(
        "SET statement_timeout = 30000; SET idle_in_transaction_session_timeout = 60000"
      )
      .catch((err: Error) =>
        console.error("[postgres] failed to apply session timeouts:", err.message)
      )
  })

  // Without this listener, an error on an idle client (e.g., the DB closing a
  // connection mid-idle) is thrown on the event loop and can crash the process.
  p.on("error", (err) => {
    console.error("[postgres] idle client error:", err)
  })

  // Close the pool on SIGINT/SIGTERM so connections shut down cleanly.
  // createPool() is memoized on global.__pgPool, so these handlers are
  // registered exactly once per process — HMR does not accumulate them.
  // Avoid process.exit() so HTTP drain / in-flight work can finish.
  registerShutdownHandlers(p)
  return p
}

let _pool: Pool | undefined

export function getPool(): Pool {
  if (isDev) return (global.__pgPool ??= createPool())
  return (_pool ??= createPool())
}

// Acquire a client with a timeout so a starved pool can't hang requests.
// If the timeout wins, the eventual client is still released to prevent leaks.
export async function getConnection(timeoutMs = 5_000): Promise<PoolClient> {
  const connPromise = getPool().connect()
  let timedOut = false

  connPromise
    .then((c) => {
      if (timedOut) c.release()
    })
    .catch(() => {})

  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      connPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(
            new Error(`Timed out acquiring DB connection after ${timeoutMs}ms`)
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Run one SQL statement against the pool and return a normalized result. Owns the
// connection lifecycle so callers never touch acquire/release. Uses `$1` placeholders.
export async function runQuery(
  sql: string,
  params?: unknown[]
): Promise<QueryOutcome> {
  const client = await getConnection()
  const start = Date.now()
  try {
    const result = await client.query(sql, params)
    const durationMs = Date.now() - start

    // A row-returning statement (SELECT, or INSERT … RETURNING) exposes column
    // metadata in `fields`; a plain write reports affected rows via `rowCount`.
    if (result.fields?.length) {
      const columns = result.fields.map((f) => f.name)
      const rows = (result.rows as Record<string, unknown>[]).map((row) =>
        columns.map((c) => formatCell(row[c]))
      )
      return { kind: "rows", columns, rows, rowCount: rows.length, durationMs }
    }

    return {
      kind: "ok",
      affectedRows: result.rowCount ?? 0,
      insertId: "0",
      durationMs,
    }
  } finally {
    client.release()
  }
}
