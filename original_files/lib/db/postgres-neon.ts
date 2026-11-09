// Neon-specific PostgreSQL module — WebSocket transport via
// @neondatabase/serverless (node-postgres-API compatible), for SERVERLESS /
// EDGE deployments (Vercel functions, edge runtimes). For a long-running
// container, prefer lib/postgres.ts — a persistent TCP pool is the better fit
// there. Pick the module by where the code runs.
//
// Two deliberate differences from lib/postgres.ts:
//
//   1. POOLED endpoint. NEON_DATABASE_URL should point at Neon's "-pooler" host
//      (PgBouncer) — the right choice for bursty serverless concurrency. But it
//      is transaction-mode pooling, so per-session `SET statement_timeout` /
//      `idle_in_transaction_session_timeout` do NOT persist. Configure those as
//      Neon role/database defaults instead, e.g.
//      `ALTER ROLE <role> SET statement_timeout = '30s'`. This is the flip side
//      of the direct-endpoint trade-off documented in lib/postgres.ts.
//
//   2. Per-request pool. Per the serverless driver's contract, a WebSocket
//      connection must not outlive a single request. So getConnection() opens a
//      short-lived Pool and tears it down when the client is released — safe in
//      a serverless/edge handler. Server-side connection reuse is the pooler's
//      job. (Consequently there is no singleton getPool() and no SIGINT/SIGTERM
//      drain; there is no long-lived pool to manage.)

import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless"
import { z } from "zod"

// The driver needs a WebSocket constructor only where there is no global one
// (older Node). Node 22+ and edge runtimes expose `globalThis.WebSocket`, so we
// hand it that and avoid the `ws` dependency — which would also break edge
// bundling. useSecureWebSocket (TLS) and pipelineConnect already default
// sensibly for Neon.
if (!neonConfig.webSocketConstructor && typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor =
    WebSocket as unknown as typeof neonConfig.webSocketConstructor
}

const envSchema = z.object({
  // Neon POOLED connection string — hostname CONTAINS "-pooler". Distinct from
  // DATABASE_URL (the direct endpoint used by lib/postgres.ts).
  NEON_DATABASE_URL: z.string().min(1),
})

type Env = z.infer<typeof envSchema>

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid Neon environment configuration:\n${issues}`)
  }
  return parsed.data
}

// Acquire a client over a fresh, per-request WebSocket pool, with an acquire
// timeout so a stalled connection can't hang the request. The returned client's
// release() also ends the pool, so nothing outlives the request.
export async function getConnection(timeoutMs = 5_000): Promise<PoolClient> {
  const { NEON_DATABASE_URL } = parseEnv()
  const pool = new Pool({
    connectionString: NEON_DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    application_name: `next-claude-dev-${process.env.NODE_ENV ?? "unknown"}`,
  })

  const connPromise = pool.connect()
  let timedOut = false

  // If the timer wins the race, still drain the eventual client + pool so the
  // abandoned WebSocket doesn't leak past the request.
  connPromise
    .then((c) => {
      if (timedOut) {
        c.release()
        pool.end().catch(() => {})
      }
    })
    .catch(() => {
      pool.end().catch(() => {})
    })

  let timer: ReturnType<typeof setTimeout> | undefined
  let client: PoolClient
  try {
    client = await Promise.race([
      connPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(
            new Error(`Timed out acquiring Neon connection after ${timeoutMs}ms`)
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }

  // Tear the per-request pool down together with the client.
  const originalRelease = client.release.bind(client)
  client.release = ((err?: Error | boolean) => {
    originalRelease(err)
    pool.end().catch(() => {})
  }) as typeof client.release

  return client
}
