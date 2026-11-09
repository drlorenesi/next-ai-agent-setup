// Run every db:check-* script whose env vars are configured in .env.local.
// Each check runs in its own process so pools and signal handlers stay isolated.
// Usage: npm run db:check
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { bold, dim, green, missingEnv, red } from "./_check-utils.ts"

// `env` = the vars that signal "this database is in use". HOST/PORT are left out
// because .env.example pre-fills them with defaults.
const CHECKS = [
  { script: "check-postgres.ts", label: "PostgreSQL (direct)", env: ["DATABASE_URL"] },
  { script: "check-mysql.ts", label: "MySQL", env: ["MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"] },
  { script: "check-mssql.ts", label: "SQL Server", env: ["MSSQL_DATABASE", "MSSQL_USER", "MSSQL_PASSWORD"] },
]

const summary: { label: string; status: "pass" | "fail" | "skip" }[] = []

for (const check of CHECKS) {
  const missing = missingEnv(check.env)
  if (missing.length === check.env.length) {
    summary.push({ label: check.label, status: "skip" })
    continue
  }
  // Partially configured: run anyway so the module reports exactly what's missing.
  // Same Node binary as this process; .env.local is already in process.env.
  const result = spawnSync(process.execPath, [join("scripts", check.script)], {
    stdio: "inherit",
    env: process.env,
  })
  summary.push({ label: check.label, status: result.status === 0 ? "pass" : "fail" })
}

console.log(bold("Summary"))
for (const s of summary) {
  const icon = s.status === "pass" ? green("✔") : s.status === "fail" ? red("✘") : dim("–")
  const note = s.status === "skip" ? dim(" (not configured, skipped)") : ""
  console.log(`  ${icon} ${s.label}${note}`)
}

if (summary.every((s) => s.status === "skip")) {
  console.log(red("\nNo databases configured in .env.local (see .env.example)."))
  process.exitCode = 1
} else if (summary.some((s) => s.status === "fail")) {
  process.exitCode = 1
}
