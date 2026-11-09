// Shared, driver-agnostic query result contract used by the MySQL, PostgreSQL,
// and SQL Server modules so the UI can render any database's output uniformly.
// Type-only imports (e.g. QueryCell in a client component) are erased at build;
// formatCell is server-only in practice (it runs inside each driver's runQuery).

export type QueryCell = string | null

// A SELECT/SHOW/etc. yields `rows`; an INSERT/UPDATE/DELETE/DDL yields `ok`.
export type QueryOutcome =
  | {
      kind: "rows"
      columns: string[]
      rows: QueryCell[][]
      rowCount: number
      durationMs: number
    }
  | { kind: "ok"; affectedRows: number; insertId: string; durationMs: number }

// Coerce any driver-returned value into a display string (or null for SQL NULL),
// keeping the action's return value serializable across the server/client boundary.
export function formatCell(v: unknown): QueryCell {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (Buffer.isBuffer(v)) return `0x${v.toString("hex")}`
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}
