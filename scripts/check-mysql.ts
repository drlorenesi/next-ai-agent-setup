// Smoke-check lib/db/mysql.ts against the database in .env.local.
// Usage: npm run db:check-mysql
import * as db from "../lib/db/mysql"
import {
  CheckWarning,
  checkAcquireTimeout,
  expect,
  runChecks,
} from "./_check-utils"

async function main() {
  const { MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE } = process.env
  let pool: ReturnType<typeof db.getPool> | undefined

  await runChecks(
    `MySQL — ${MYSQL_HOST ?? "?"}:${MYSQL_PORT || 3306}/${MYSQL_DATABASE ?? "?"}`,
    [
      {
        name: "Environment variables valid",
        // getPool() validates env with Zod and creates the pool (no connection yet).
        run: async () => {
          pool = db.getPool()
        },
      },
      {
        name: "Connect and read server info",
        run: async () => {
          const r = await db.runQuery(
            "SELECT VERSION() AS version, NOW() AS server_time, DATABASE() AS db"
          )
          expect(r.kind === "rows" && r.rowCount === 1, "expected one row")
          const [version, time, name] = r.rows[0]
          return `MySQL ${version}, db=${name}, server time ${time}`
        },
      },
      {
        name: "runQuery returns { kind: 'rows' } for SELECT",
        run: async () => {
          const r = await db.runQuery("SELECT ? AS a, ? AS b", [1, "dos"])
          expect(r.kind === "rows", `got kind=${r.kind}`)
          expect(r.columns.join() === "a,b", `columns: ${r.columns.join()}`)
          expect(r.rows[0].join() === "1,dos", `row: ${r.rows[0].join()}`)
        },
      },
      {
        name: "runQuery returns { kind: 'ok' } for non-row statements",
        run: async () => {
          const r = await db.runQuery("DO 1")
          expect(r.kind === "ok", `got kind=${r.kind}`)
        },
      },
      {
        name: "BIGINT / DECIMAL keep full precision (returned as strings)",
        run: async () => {
          const [rows] = await db
            .getPool()
            .query(
              "SELECT CAST(9223372036854775807 AS SIGNED) AS big, " +
                "CAST(12345678.123456789012 AS DECIMAL(20,12)) AS dec_val"
            )
          const row = (rows as Record<string, unknown>[])[0]
          expect(
            row.big === "9223372036854775807",
            `big=${String(row.big)} (${typeof row.big}) — bigNumberStrings not applied?`
          )
          expect(
            row.dec_val === "12345678.123456789012",
            `dec=${String(row.dec_val)}`
          )
        },
      },
      {
        name: "Session MAX_EXECUTION_TIME = 30000 ms",
        run: async () => {
          const r = await db.runQuery(
            "SELECT @@SESSION.max_execution_time AS met"
          )
          const met = r.kind === "rows" ? Number(r.rows[0][0]) : NaN
          if (met !== 30000)
            // MariaDB / MySQL < 5.7.4 has no MAX_EXECUTION_TIME; the module
            // tolerates that, so this is a warning, not a failure.
            throw new CheckWarning(`got ${met}; per-statement timeout not active`)
        },
      },
      {
        name: "Pool serves 50 concurrent queries",
        run: async () => {
          const n = 50
          const results = await Promise.all(
            Array.from({ length: n }, (_, i) =>
              db.runQuery("SELECT ? AS n, SLEEP(0.05) AS waited", [i])
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
