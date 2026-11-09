import { config } from "dotenv"
config({ path: ".env.local" })

import type { RowDataPacket } from "mysql2"

async function run() {
  // Dynamic import so lib/mysql.ts is evaluated AFTER config() has set the env vars.
  // A static import is hoisted before any code runs, meaning the pool would be
  // created with undefined env vars and mysql2 would fall back to 127.0.0.1.
  const { pool } = await import("../lib/mysql.js")

  console.log(
    `\n🔌 Connecting to MySQL at ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306} → ${process.env.MYSQL_DATABASE}`
  )

  try {
    // 1. Basic connectivity
    await pool.query("SELECT 1")
    console.log("✅ Connection successful")

    // 2. Server info
    const [infoRows] = await pool.query<RowDataPacket[]>(
      "SELECT VERSION() AS version, NOW() AS server_time"
    )
    const info = infoRows[0]
    console.log(`✅ MySQL version : ${info.version}`)
    console.log(
      `✅ Server time   : ${new Date(info.server_time).toISOString()}`
    )

    // 3. Confirm target database is accessible
    const [dbRows] = await pool.query<RowDataPacket[]>(
      "SELECT DATABASE() AS name"
    )
    console.log(`✅ Database      : ${dbRows[0].name}`)

    // 4. Pool stress — x concurrent queries to verify the pool manages multiple connections
    const x: number = 100

    console.log(
      `\n⚙️  Running ${x} concurrent queries to verify pool behaviour...`
    )
    const results = await Promise.all(
      Array.from({ length: x }, (_, i) =>
        pool.query<RowDataPacket[]>("SELECT ? AS n, SLEEP(0.05) AS waited", [
          i + 1,
        ])
      )
    )
    const nums = results.map(([rows]) => rows[0].n)
    console.log(`✅ Pool handled concurrent queries: [${nums.join(", ")}]`)

    console.log("\n🎉 All checks passed — MySQL pool is working correctly.\n")
  } catch (err: unknown) {
    const e = err as { code?: string }
    console.error("\n❌ Check failed:")
    if (e.code === "ECONNREFUSED") {
      console.error(
        `  TCP connection refused at ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306}`
      )
      console.error("  Possible causes:")
      console.error(
        "  → The MySQL service is stopped or paused (check Railway dashboard)"
      )
      console.error("  → The host/port in .env.local is incorrect")
      console.error(
        "  → The server requires SSL — try setting MYSQL_SSL=true in .env.local"
      )
    } else {
      console.error(err)
    }
    process.exit(1)
  } finally {
    await pool.end()
    console.log("🔌 Pool closed")
  }
}

run()
