// Smoke-check lib/db/postgres.ts (direct TCP pool, DATABASE_URL) against the
// database in .env.local. This is the pool Better Auth uses.
// Usage: npm run db:check-postgres
import * as db from "../lib/db/postgres.ts"
import {
  CheckWarning,
  checkAcquireTimeout,
  expect,
  runChecks,
} from "./_check-utils.ts"

function describeUrl(url: string | undefined) {
  try {
    const u = new URL(url ?? "")
    return { host: u.hostname, db: u.pathname.slice(1) }
  } catch {
    return { host: "?", db: "?" }
  }
}

async function main() {
  const { host, db: dbName } = describeUrl(process.env.DATABASE_URL)
  let pool: ReturnType<typeof db.getPool> | undefined

  await runChecks(
    `PostgreSQL — ${host}/${dbName}`,
    [
      {
        name: "Environment variables valid",
        run: async () => {
          pool = db.getPool()
        },
      },
      {
        name: "DATABASE_URL points at a direct (non-pooler) endpoint",
        run: async () => {
          // Transaction-mode poolers discard the per-session SETs this module
          // relies on. See the header comment in lib/db/postgres.ts.
          if (host.includes("-pooler"))
            throw new CheckWarning(
              "hostname contains '-pooler' — statement_timeout will not stick; use Neon's direct endpoint"
            )
        },
      },
      {
        name: "Connect and read server info",
        run: async () => {
          const r = await db.runQuery(
            "SELECT split_part(version(), ' ', 2) AS version, now() AS server_time, current_database() AS db"
          )
          expect(r.kind === "rows" && r.rowCount === 1, "expected one row")
          const [version, time, name] = r.rows[0]
          return `PostgreSQL ${version}, db=${name}, server time ${time}`
        },
      },
      {
        name: "runQuery returns { kind: 'rows' } for SELECT",
        run: async () => {
          const r = await db.runQuery("SELECT $1::int AS a, $2::text AS b", [
            1,
            "dos",
          ])
          expect(r.kind === "rows", `got kind=${r.kind}`)
          expect(r.columns.join() === "a,b", `columns: ${r.columns.join()}`)
          expect(r.rows[0].join() === "1,dos", `row: ${r.rows[0].join()}`)
        },
      },
      {
        name: "runQuery returns { kind: 'ok' } for non-row statements",
        run: async () => {
          const r = await db.runQuery("DO $$ BEGIN END $$")
          expect(r.kind === "ok", `got kind=${r.kind}`)
        },
      },
      {
        name: "BIGINT / NUMERIC keep full precision (returned as strings)",
        run: async () => {
          const { rows } = await db
            .getPool()
            .query(
              "SELECT 9223372036854775807::bigint AS big, 12345678.123456789012::numeric(20,12) AS dec_val"
            )
          expect(
            rows[0].big === "9223372036854775807",
            `big=${String(rows[0].big)} (${typeof rows[0].big}) — a pg type parser override?`
          )
          expect(
            rows[0].dec_val === "12345678.123456789012",
            `dec=${String(rows[0].dec_val)}`
          )
        },
      },
      {
        name: "Session settings applied (timeouts, application_name)",
        run: async () => {
          const r = await db.runQuery(
            "SELECT current_setting('statement_timeout') AS st, " +
              "current_setting('idle_in_transaction_session_timeout') AS iit, " +
              "current_setting('application_name') AS app"
          )
          expect(r.kind === "rows", "expected rows")
          const [st, iit, app] = r.rows[0]
          expect(st === "30s", `statement_timeout=${st}, expected 30s`)
          expect(iit === "1min", `idle_in_transaction_session_timeout=${iit}, expected 1min`)
          expect(
            app?.startsWith("next-claude-dev-"),
            `application_name=${app}`
          )
          return `statement_timeout=${st}, idle_in_tx=${iit}, app=${app}`
        },
      },
      {
        name: "Pool serves 50 concurrent queries",
        run: async () => {
          const n = 50
          const results = await Promise.all(
            Array.from({ length: n }, (_, i) =>
              db.runQuery("SELECT $1::int AS n, pg_sleep(0.05)", [i])
            )
          )
          const ok = results.every(
            (r, i) => r.kind === "rows" && r.rows[0][0] === String(i)
          )
          expect(ok, "some concurrent results were missing or out of order")
        },
      },
      {
        name: "getConnection(ms) times out when the pool is exhausted",
        run: () => checkAcquireTimeout(db.getConnection),
      },
    ],
    async () => {
      await pool?.end()
    }
  )
}

main()
