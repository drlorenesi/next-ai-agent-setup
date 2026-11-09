---
name: db-query
description: Write SQL against the app's databases using the lib/db modules (mysql.ts, postgres.ts, mssql.ts) — choosing the right module, placeholder syntax, connection lifecycle, identifier quoting and types. Use for any server code that reads or writes business data or queries a database directly. There is no ORM.
---

# Querying the databases

## Which module?

| Data | Module | Notes |
| --- | --- | --- |
| Business data (sales, products, orders, invoices) on MySQL | `@/lib/db/mysql` | Default for business logic |
| Business data on SQL Server | `@/lib/db/mssql` | `getPool()` is **async** |
| Auth data (users, sessions) | **Don't query it.** Use Better Auth APIs (`auth.api.*`, `getSession()`) | `lib/db/postgres.ts` exists for Better Auth |

Never import a db module into a client component or a file without `"use server"` / server-only usage. Queries belong in server actions, route handlers, or Server Components.

## Two ways to query

**`runQuery(sql, params?)`** — preferred for single statements. Owns acquire/release and returns the normalized `QueryOutcome` from `lib/db/db-types.ts` (`kind: "rows"` with string/null cells, or `kind: "ok"` with `affectedRows`). Good for display and for generic tooling.

**Driver API** — when you need typed rows, numbers, or transactions:

```ts
// MySQL
const conn = await getConnection()        // acquire timeout: 5 s MySQL, 12 s Postgres (Neon cold start)
try {
  await conn.beginTransaction()
  await conn.query("UPDATE ... WHERE id = ?", [id])
  await conn.commit()
} catch (e) { await conn.rollback(); throw e }
finally { conn.release() }                // ALWAYS release

// Postgres: same shape — client.query("BEGIN") ... "COMMIT"/"ROLLBACK", finally client.release()

// SQL Server: no getConnection(); use a transaction object or a single request
const pool = await getPool()
const r = await pool.request().input("id", id).query("SELECT ... WHERE id = @id")
```

## Placeholders — never interpolate values

| DB | Syntax |
| --- | --- |
| MySQL | `?` |
| Postgres | `$1`, `$2`, … |
| SQL Server | `@name` via `request.input("name", v)`; with `runQuery` positional `@p0`, `@p1`, … |

Identifiers (table/column names from user choice) can't be parameters: whitelist them, then quote — MySQL `escapeId()` from `lib/db/mysql`, Postgres `"..."` (double any `"`), SQL Server `[...]` (double any `]`).

## Types you will get back

- MySQL: BIGINT and DECIMAL arrive as **strings** (`bigNumberStrings`). `COUNT(*)` is BIGINT → string. Convert with `Number()` only when the value is known to be small.
- Postgres: `bigint`/`numeric` are strings; `count(*)` is bigint → string.
- SQL Server: BIGINT is a string; DECIMAL is a JS **float** (precision loss beyond ~15 digits) — `CAST(... AS varchar)` when exact.
- Dates: MySQL pool uses `timezone: "Z"` — store and compare in UTC; format for display in the UI.

## Limits built into the modules

Statements are capped at ~30 s (MySQL `MAX_EXECUTION_TIME`, Postgres `statement_timeout`) and 15 s on SQL Server (`requestTimeout`). Long reports must be paginated or pre-aggregated, not run as one huge query. `multipleStatements` is off on MySQL: one statement per call.

## Verify

`npm run db:check` confirms connectivity and pool behavior; `npm test` covers module config.
