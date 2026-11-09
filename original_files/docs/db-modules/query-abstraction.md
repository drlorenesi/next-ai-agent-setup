# Unified query abstraction — `runQuery` / `QueryOutcome`

**Modules:** [lib/db-types.ts](../../lib/db-types.ts), [lib/mysql.ts](../../lib/mysql.ts), [lib/postgres.ts](../../lib/postgres.ts), [lib/mssql.ts](../../lib/mssql.ts)
**Consumers:** [app/bds/explorador/providers.ts](../../app/bds/explorador/providers.ts), [app/bds/explorador/actions.ts](../../app/bds/explorador/actions.ts), [app/bds/consultas/actions.ts](../../app/bds/consultas/actions.ts), [app/bds/_components/results-table.tsx](../../app/bds/_components/results-table.tsx)
**Date:** 2026-06-03

## Context

The app talks to three databases through three drivers — `mysql2`, `pg`, and `mssql` — each of
which returns query results in a different shape. The `/bds/explorador` (schema browser) and
`/bds/consultas` (SQL runner) features need to run arbitrary statements and render the results
uniformly, regardless of which database produced them.

Rather than let each driver's quirks leak upward into the providers, server actions, and UI, we
**normalize at the driver boundary**: every driver module exposes one `runQuery` with an identical
signature and return type, and all the driver-specific handling is hidden inside it. Everything
above the driver is database-agnostic.

The "common query function" is therefore **a shared contract plus three thin adapters** — *not* a
single dispatcher function. Dispatch-by-database happens one layer up, in a provider registry.

---

## 1. The shared contract — [lib/db-types.ts](../../lib/db-types.ts)

```ts
export type QueryCell = string | null

export type QueryOutcome =
  | { kind: "rows"; columns: string[]; rows: QueryCell[][]; rowCount: number; durationMs: number }
  | { kind: "ok"; affectedRows: number; insertId: string; durationMs: number }

export function formatCell(v: unknown): QueryCell { … }
```

Three deliberate choices:

- **Discriminated union (`kind`).** A `SELECT`/`SHOW`/`DESCRIBE` yields `rows`; an
  `INSERT`/`UPDATE`/`DELETE`/DDL yields `ok`. The UI switches on `kind` and never needs to know
  which driver produced the result.
- **Every cell is `string | null`.** Results cross the server → client boundary (a server action
  returns them to a client component), so they must be JSON-serializable. `formatCell` collapses
  every driver value into a display string: `Date → toISOString()`, `Buffer → "0x"+hex`,
  `object → JSON.stringify`, `null/undefined → null`, otherwise `String(v)`. This also sidesteps
  precision traps (mssql returns `BIGINT` as a string; pg returns `bigint`/`numeric` as strings),
  so large integer keys survive intact.
- **Timing baked in** (`durationMs`), because every caller wanted it.

## 2. Three adapters with one signature

Each driver module exports `runQuery(sql, params?): Promise<QueryOutcome>`. The signature is
identical; the bodies absorb the differences:

| Concern              | MySQL ([lib/mysql.ts](../../lib/mysql.ts)) | PostgreSQL ([lib/postgres.ts](../../lib/postgres.ts)) | SQL Server ([lib/mssql.ts](../../lib/mssql.ts)) |
| -------------------- | ------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------- |
| Raw driver return    | `[rows, fields]` tuple                     | `{ rows, fields, rowCount }`                          | `{ recordset, rowsAffected }`                   |
| "Is it a row set?"   | `Array.isArray(result)`                    | `result.fields?.length`                               | `result.recordset` exists                       |
| Column names         | `fields[].name`                            | `fields[].name`                                       | `Object.keys(recordset[0])`                     |
| Placeholder syntax   | `?`                                        | `$1`, `$2`, …                                         | `@p0`, `@p1`, … (bound via `request.input`)     |
| Connection lifecycle | acquire → `finally release()`              | acquire → `finally release()`                         | `request()` off the pool (no release)           |
| Write-result count   | `ResultSetHeader.affectedRows`             | `result.rowCount`                                     | `result.rowsAffected[0]`                        |

All three funnel row values through the same `formatCell`, so the **output** is uniform even though
the **input** APIs are not.

## 3. What was deliberately NOT abstracted

- **Placeholder translation.** There is no attempt to convert `?` ↔ `$1` ↔ `@p0`. It's brittle, and
  the layer that writes SQL is dialect-aware anyway.
- **Identifier quoting.** Kept per-dialect: MySQL `escapeId` (backticks), pg `"…"` (double-quote,
  `"`→`""`), mssql `[…]` (`]`→`]]`). These can't be folded into one safe helper.
- **A single `runQuery(db, sql)` dispatcher.** `runQuery` lives *next to each pool*, because
  connection lifecycle and the driver import belong with that driver. Dispatch-by-database happens
  one level up, in the provider registry:

  ```ts
  // app/bds/explorador/providers.ts
  export const providers: Record<Db, ExplorerProvider> = { mysql, postgres, mssql }
  ```

  So the server actions just call `providers[db].previewRows(table)` and never touch a driver
  directly.

## 4. Payoff and consumers

Because the result shape is standardized, the upper layers are thin and database-blind:

- **Providers** ([providers.ts](../../app/bds/explorador/providers.ts)) reuse `runQuery` for
  `describeColumns`/`previewRows`; only the per-dialect `listTables` SQL is hand-written.
- **Actions** ([explorador](../../app/bds/explorador/actions.ts),
  [consultas](../../app/bds/consultas/actions.ts)) are a few lines each.
- **The UI** ([results-table.tsx](../../app/bds/_components/results-table.tsx)) takes
  `columns: string[]` + `rows: QueryCell[][]` and renders — it has no idea which database it is
  showing.

Adding a fourth database later means writing **one more `runQuery`** (conforming to `QueryOutcome`)
and **one more provider entry** — nothing above changes.

## 5. Known limitation

The `ok` branch sets `insertId: "0"` for PostgreSQL and SQL Server. `insertId` is a MySQL concept
(`LAST_INSERT_ID()` via the `ResultSetHeader`); pg/mssql have no direct equivalent, so it's a
lowest-common-denominator field that is only meaningful for MySQL. Callers that need a
server-generated key on pg should use `INSERT … RETURNING` (which comes back through the `rows`
branch instead).
