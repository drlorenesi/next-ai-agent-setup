// Helpful MySQL commands to check server connections:
// SHOW STATUS WHERE Variable_name = 'Threads_connected';
// SHOW FULL PROCESSLIST;
// SELECT CONNECTION_ID() AS id;
// SHOW STATUS LIKE '%connect%';
// SHOW VARIABLES LIKE 'max_connections';
// FLUSH STATUS;   -- zeros Aborted_clients, Aborted_connects, Slow_queries, Threads_connected_high_water, ...
// FLUSH HOSTS;    -- clears the host cache (it's already 0, this is just for completeness)

import mysql, {
  type FieldPacket,
  type Pool,
  type PoolConnection,
  type PoolOptions,
} from "mysql2/promise"
import { z } from "zod"
import { formatCell, type QueryOutcome } from "./db-types.ts"

declare global {
  var __dbPool: Pool | undefined
}

const isDev = process.env.NODE_ENV === "development"

const envSchema = z.object({
  MYSQL_HOST: z.string().min(1),
  MYSQL_USER: z.string().min(1),
  MYSQL_DATABASE: z.string().min(1),
  MYSQL_PASSWORD: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_SSL_CA: z.string().min(1).optional(),
  MYSQL_SSL_INSECURE: z.enum(["true", "false"]).optional(),
})

type Env = z.infer<typeof envSchema>

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid MySQL environment configuration:\n${issues}`)
  }
  return parsed.data
}

function buildSsl(env: Env): PoolOptions["ssl"] {
  if (env.MYSQL_SSL_CA) return { ca: env.MYSQL_SSL_CA }
  if (env.MYSQL_SSL_INSECURE === "true") {
    console.warn(
      "[db] MYSQL_SSL_INSECURE=true — TLS without certificate verification. " +
        "Provide MYSQL_SSL_CA for MITM protection."
    )
    return { rejectUnauthorized: false }
  }
  return undefined
}

function buildPoolOptions(env: Env): PoolOptions {
  return {
    host: env.MYSQL_HOST,
    user: env.MYSQL_USER,
    database: env.MYSQL_DATABASE,
    password: env.MYSQL_PASSWORD,
    port: env.MYSQL_PORT,
    timezone: "Z",
    waitForConnections: true,
    connectionLimit: isDev ? 3 : 10,
    maxIdle: isDev ? 3 : 5,
    idleTimeout: 60_000,
    queueLimit: 100,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 10_000,
    ssl: buildSsl(env),
    // Return BIGINT values as strings so JS Number precision (53 bits) can't
    // silently corrupt IDs / counters > 2^53. DECIMAL is already a string by default.
    supportBigNumbers: true,
    bigNumberStrings: true,
    // Surface this app in `performance_schema.session_connect_attrs` so a DBA
    // looking at the server can tell which app/env owns a connection.
    connectAttributes: {
      program_name: `next-claude-dev-${process.env.NODE_ENV ?? "unknown"}`,
    },
  }
}

const STATEMENT_TIMEOUT_MS = 30_000

function registerShutdownHandlers(p: Pool) {
  // SIGINT and SIGTERM both fire on dev-server shutdown; cache the in-flight
  // promise so p.end() runs at most once per process.
  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      try {
        await p.end()
        console.log("[db] pool closed")
      } catch (err) {
        console.error("[db] error closing pool:", err)
      }
    })()
    return closing
  }
  process.on("SIGTERM", close)
  process.on("SIGINT", close)
}

function createPool(): Pool {
  const env = parseEnv()
  const p = mysql.createPool(buildPoolOptions(env))

  // Bound SELECTs server-side so a single runaway query can't pin a pool slot.
  // MAX_EXECUTION_TIME is MySQL 5.7.4+ / 8.0+; on MariaDB or older servers the
  // statement errors — swallow it so the pool still works there.
  //
  // mysql2/promise's pool inherits the `connection` event from the underlying
  // callback pool without wrapping the emitted connection (see
  // node_modules/mysql2/lib/promise/pool.js: `inheritEvents(... 'connection' ...)`).
  // The runtime object is the callback PoolConnection — use its `.promise()`
  // upgrade to access promise-style query().
  p.on("connection", (conn) => {
    ;(conn as unknown as { promise(): PoolConnection })
      .promise()
      .query(`SET SESSION MAX_EXECUTION_TIME = ${STATEMENT_TIMEOUT_MS}`)
      .catch((err: Error) =>
        console.warn("[db] could not set MAX_EXECUTION_TIME:", err.message)
      )
  })

  // Close the pool on SIGINT/SIGTERM so MySQL sees a clean COM_QUIT and does
  // not increment Aborted_clients. createPool() is memoized on global.__dbPool,
  // so these handlers are registered exactly once per process — HMR does not
  // accumulate them. Avoid process.exit() so HTTP drain / in-flight work can finish.
  registerShutdownHandlers(p)
  return p
}

let _pool: Pool | undefined

export function getPool(): Pool {
  if (isDev) return (global.__dbPool ??= createPool())
  return (_pool ??= createPool())
}

// Acquire a connection with a timeout so a starved pool can't hang requests.
// If the timeout wins, the eventual connection is still released to prevent leaks.
export async function getConnection(
  timeoutMs = 5_000
): Promise<PoolConnection> {
  const connPromise = getPool().getConnection()
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

// Quote an identifier (table/column name) for safe interpolation into SQL when
// a `?` placeholder can't be used — e.g. `SELECT * FROM ${escapeId(table)}`.
export const escapeId = mysql.escapeId

// Run one SQL statement against the pool and return a normalized result. Owns the
// connection lifecycle so callers never touch acquire/release. The pool has
// multipleStatements off, so exactly one statement runs per call.
export async function runQuery(
  sql: string,
  params?: unknown[]
): Promise<QueryOutcome> {
  const conn = await getConnection()
  const start = Date.now()
  try {
    const [result, fields] = await conn.query(sql, params)
    const durationMs = Date.now() - start

    if (Array.isArray(result)) {
      const columns = ((fields as FieldPacket[] | undefined) ?? []).map(
        (f) => f.name
      )
      const rows = (result as Record<string, unknown>[]).map((row) =>
        columns.map((c) => formatCell(row[c]))
      )
      return { kind: "rows", columns, rows, rowCount: rows.length, durationMs }
    }

    const header = result as { affectedRows?: number; insertId?: number | bigint }
    return {
      kind: "ok",
      affectedRows: header.affectedRows ?? 0,
      insertId: String(header.insertId ?? 0),
      durationMs,
    }
  } finally {
    conn.release()
  }
}
