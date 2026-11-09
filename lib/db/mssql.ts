import sql from "mssql"
import { z } from "zod"
import { formatCell, type QueryOutcome } from "./db-types"

// mssql is a CommonJS package without named ESM exports. Under native ESM
// ("type": "module", e.g. the tsx-run db:check scripts) only the default import
// resolves; `import { ConnectionPool } from "mssql"` throws at load time.
const { ConnectionPool } = sql
type ConnectionPool = sql.ConnectionPool
type MssqlConfig = sql.config

declare global {
  var __mssqlConnect: Promise<ConnectionPool> | undefined
}

const isDev = process.env.NODE_ENV === "development"

const envSchema = z.object({
  MSSQL_HOST: z.string().min(1),
  MSSQL_PORT: z.coerce.number().int().positive().default(1433),
  MSSQL_DATABASE: z.string().min(1),
  MSSQL_USER: z.string().min(1),
  MSSQL_PASSWORD: z.string().min(1),
  MSSQL_SSL_CA: z.string().min(1).optional(),
  MSSQL_SSL_INSECURE: z.enum(["true", "false"]).optional(),
})

type Env = z.infer<typeof envSchema>

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid SQL Server environment configuration:\n${issues}`)
  }
  return parsed.data
}

function buildOptions(env: Env): MssqlConfig["options"] {
  if (env.MSSQL_SSL_CA) {
    return {
      encrypt: true,
      trustServerCertificate: false,
      cryptoCredentialsDetails: { ca: env.MSSQL_SSL_CA },
    }
  }
  if (env.MSSQL_SSL_INSECURE === "true") {
    console.warn(
      "[mssql] MSSQL_SSL_INSECURE=true — TLS without certificate verification. " +
        "Provide MSSQL_SSL_CA for MITM protection."
    )
    return { encrypt: true, trustServerCertificate: true }
  }
  return { encrypt: true, trustServerCertificate: false }
}

function buildPoolOptions(env: Env): MssqlConfig {
  const appName = `next-claude-dev-${process.env.NODE_ENV ?? "unknown"}`
  return {
    server: env.MSSQL_HOST,
    port: env.MSSQL_PORT,
    database: env.MSSQL_DATABASE,
    user: env.MSSQL_USER,
    password: env.MSSQL_PASSWORD,
    pool: {
      max: isDev ? 3 : 10,
      min: 0,
      idleTimeoutMillis: 60_000,
      // Bound pool acquire/create/destroy in line with our request timeout —
      // tarn's defaults (30s / 30s / 5s) let callers wait longer than they were
      // promised by requestTimeout (15s).
      acquireTimeoutMillis: 15_000,
      createTimeoutMillis: 10_000,
      destroyTimeoutMillis: 5_000,
    },
    options: {
      ...buildOptions(env),
      // Surface this app in `sys.dm_exec_sessions.program_name` so a DBA can
      // tell which app/env owns a session. Also fills the column we already
      // render in the diagnostics page.
      appName,
    },
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
  }
}

function registerShutdownHandlers(p: ConnectionPool) {
  // SIGINT and SIGTERM both fire on dev-server shutdown; cache the in-flight
  // promise so p.close() runs at most once per process.
  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      try {
        await p.close()
        console.log("[mssql] pool closed")
      } catch (err) {
        console.error("[mssql] error closing pool:", err)
      }
    })()
    return closing
  }
  process.on("SIGTERM", close)
  process.on("SIGINT", close)
}

let _connect: Promise<ConnectionPool> | undefined

function createConnectPromise(): Promise<ConnectionPool> {
  const env = parseEnv()
  const p = new ConnectionPool(buildPoolOptions(env))

  // Without this listener, an error on an idle connection (e.g., the server
  // dropping it mid-idle) is thrown on the event loop and can crash the process.
  p.on("error", (err) => {
    console.error("[mssql] pool error:", err)
  })

  // Close the pool on SIGINT/SIGTERM so connections shut down cleanly.
  // createConnectPromise() is memoized on global.__mssqlConnect, so these
  // handlers are registered exactly once per process — HMR does not accumulate
  // them. Avoid process.exit() so HTTP drain / in-flight work can finish.
  registerShutdownHandlers(p)

  return p.connect().catch((err) => {
    // Clear the cached promise so the next caller retries after the config is
    // fixed; otherwise a single bad startup connect would poison this module
    // for the life of the dev server.
    if (isDev) global.__mssqlConnect = undefined
    else _connect = undefined
    throw err
  })
}

export function getPool(): Promise<ConnectionPool> {
  if (isDev) return (global.__mssqlConnect ??= createConnectPromise())
  return (_connect ??= createConnectPromise())
}

// Run one SQL statement against the pool and return a normalized result. Positional
// `params` are bound as `@p0`, `@p1`, … — reference them that way in `sql`.
export async function runQuery(
  sql: string,
  params?: unknown[]
): Promise<QueryOutcome> {
  const request = (await getPool()).request()
  params?.forEach((value, i) => request.input(`p${i}`, value))

  const start = Date.now()
  const result = await request.query(sql)
  const durationMs = Date.now() - start

  // A row-returning statement populates `recordset`; a write reports counts in
  // `rowsAffected` (one entry per statement).
  if (result.recordset) {
    const columns = result.recordset.length
      ? Object.keys(result.recordset[0])
      : Object.keys(result.recordset.columns ?? {})
    const rows = (result.recordset as Record<string, unknown>[]).map((row) =>
      columns.map((c) => formatCell(row[c]))
    )
    return { kind: "rows", columns, rows, rowCount: rows.length, durationMs }
  }

  return {
    kind: "ok",
    affectedRows: result.rowsAffected?.[0] ?? 0,
    insertId: "0",
    durationMs,
  }
}
