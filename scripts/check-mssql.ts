// Smoke-check lib/db/mssql.ts against the SQL Server in .env.local.
// Usage: npm run db:check-mssql
import * as db from "../lib/db/mssql.ts"
import { CheckWarning, expect, runChecks } from "./_check-utils.ts"

async function main() {
  const { MSSQL_HOST, MSSQL_PORT, MSSQL_DATABASE } = process.env
  let pool: Awaited<ReturnType<typeof db.getPool>> | undefined

  await runChecks(
    `SQL Server — ${MSSQL_HOST ?? "?"}:${MSSQL_PORT || 1433}/${MSSQL_DATABASE ?? "?"}`,
    [
      {
        // Unlike mysql/postgres, getPool() is async and connects immediately,
        // so env validation and connectivity are one step here.
        name: "Environment valid and pool connected",
        run: async () => {
          pool = await db.getPool()
        },
      },
      {
        name: "Read server info",
        run: async () => {
          const r = await db.runQuery(
            "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version, " +
              "CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition, " +
              "DB_NAME() AS db, SYSDATETIMEOFFSET() AS server_time"
          )
          expect(r.kind === "rows" && r.rowCount === 1, "expected one row")
          const [version, edition, name, time] = r.rows[0]
          return `SQL Server ${version} (${edition}), db=${name}, server time ${time}`
        },
      },
      {
        name: "runQuery returns { kind: 'rows' } with @p0/@p1 params",
        run: async () => {
          const r = await db.runQuery("SELECT @p0 AS a, @p1 AS b", [1, "dos"])
          expect(r.kind === "rows", `got kind=${r.kind}`)
          expect(r.columns.join() === "a,b", `columns: ${r.columns.join()}`)
          expect(r.rows[0].join() === "1,dos", `row: ${r.rows[0].join()}`)
        },
      },
      {
        name: "runQuery returns { kind: 'ok' } for non-row statements",
        run: async () => {
          const r = await db.runQuery("DECLARE @x INT = 1")
          expect(r.kind === "ok", `got kind=${r.kind}`)
        },
      },
      {
        name: "BIGINT keeps full precision (returned as string)",
        run: async () => {
          const result = await (await db.getPool())
            .request()
            .query(
              "SELECT CAST(9223372036854775807 AS BIGINT) AS big, " +
                "CAST(12345678.123456789012 AS DECIMAL(20,12)) AS dec_val"
            )
          const row = result.recordset[0]
          expect(
            row.big === "9223372036854775807",
            `big=${String(row.big)} (${typeof row.big})`
          )
          // The mssql driver returns DECIMAL as a JS number (float), so values
          // beyond ~15 significant digits lose precision. Cast to varchar in
          // SQL when exact decimals matter.
          if (String(row.dec_val) !== "12345678.123456789012")
            throw new CheckWarning(
              `DECIMAL(20,12) came back as ${row.dec_val} — CAST to varchar for exact values`
            )
        },
      },
      {
        name: "APP_NAME() identifies this app",
        run: async () => {
          const r = await db.runQuery("SELECT APP_NAME() AS app")
          const app = r.kind === "rows" ? r.rows[0][0] : null
          expect(app?.startsWith("next-claude-dev-"), `APP_NAME()=${app}`)
          return `APP_NAME()=${app}`
        },
      },
      {
        name: "Pool serves 50 concurrent queries",
        run: async () => {
          const results = await Promise.all(
            Array.from({ length: 50 }, (_, i) =>
              db.runQuery("WAITFOR DELAY '00:00:00.050'; SELECT @p0 AS n", [i])
            )
          )
          const ok = results.every(
            (r, i) => r.kind === "rows" && r.rows[0][0] === String(i)
          )
          expect(ok, "some concurrent results were missing or out of order")
        },
      },
    ],
    async () => {
      await pool?.close()
    }
  )
}

main()
