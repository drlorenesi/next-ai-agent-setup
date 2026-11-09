// Shared helpers for the `npm run db:check-*` smoke-check scripts.
//
// `.env.local` is loaded by the npm script (`tsx --env-file-if-exists=.env.local`)
// before any module is evaluated, so the check scripts can import their lib/db
// module statically.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (s: string) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s
export const green = paint(32)
export const red = paint(31)
export const yellow = paint(33)
export const dim = paint(2)
export const bold = paint(1)

/** Thrown by a step to report a non-fatal problem (yellow, does not fail the run). */
export class CheckWarning extends Error {}

export type Step = {
  name: string
  /** Return a short detail string to print next to the step, or nothing. */
  run: () => Promise<string | void>
}

/** Assert helper — throws with `message` when `cond` is false. */
export function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

/** Returns the names of required env vars that are missing or empty. */
export function missingEnv(keys: string[]): string[] {
  return keys.filter((k) => !process.env[k]?.trim())
}

/**
 * Runs steps in order and stops at the first failure (later steps almost always
 * depend on earlier ones, e.g. nothing works without connectivity). `cleanup`
 * always runs. Sets process.exitCode instead of calling process.exit() so the
 * pool's own close/log output can flush.
 */
export async function runChecks(
  title: string,
  steps: Step[],
  cleanup?: () => Promise<void>
): Promise<boolean> {
  console.log(`\n${bold(title)}`)
  let ok = true
  let warnings = 0

  for (const step of steps) {
    const start = Date.now()
    try {
      const detail = await step.run()
      const ms = dim(`(${Date.now() - start} ms)`)
      console.log(`  ${green("✔")} ${step.name}${detail ? ` — ${detail}` : ""} ${ms}`)
    } catch (err) {
      if (err instanceof CheckWarning) {
        warnings++
        console.log(`  ${yellow("⚠")} ${step.name} — ${err.message}`)
        continue
      }
      ok = false
      console.log(`  ${red("✘")} ${step.name}`)
      console.log(indent(describeError(err)))
      const hint = hintFor(err)
      if (hint) console.log(indent(yellow(`→ ${hint}`)))
      break
    }
  }

  if (cleanup) {
    try {
      await cleanup()
    } catch (err) {
      console.log(red(`  error closing pool: ${describeError(err)}`))
    }
  }

  if (ok) {
    const suffix = warnings ? yellow(` with ${warnings} warning(s)`) : ""
    console.log(`${green("All checks passed")}${suffix}\n`)
  } else {
    console.log(`${red("Check failed")}\n`)
    process.exitCode = 1
  }
  return ok
}

/** Resolves after `ms` milliseconds. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Exercise the acquire timeout of a `getConnection(timeoutMs)` helper:
 * keep acquiring (without releasing) until one call times out, verify the
 * error message, release everything, then confirm a fresh acquire succeeds
 * (i.e. the timed-out acquire did not leak a pool slot).
 */
export async function checkAcquireTimeout<C extends { release: () => void }>(
  getConnection: (timeoutMs?: number) => Promise<C>,
  maxAttempts = 30
): Promise<string> {
  const held: C[] = []
  let timeoutMessage: string | undefined
  try {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        held.push(await getConnection(300))
      } catch (err) {
        timeoutMessage = (err as Error).message
        break
      }
    }
  } finally {
    held.forEach((c) => c.release())
  }

  expect(
    timeoutMessage,
    `acquired ${held.length} connections without hitting the pool limit`
  )
  expect(
    /Timed out acquiring/.test(timeoutMessage),
    `unexpected error instead of acquire timeout: ${timeoutMessage}`
  )

  // Give the late-arriving connection a moment to be released back to the pool.
  await sleep(100)
  const again = await getConnection(2_000)
  again.release()
  return `pool limit ${held.length}, waiter rejected after 300 ms, no leaked slot`
}

function indent(s: string) {
  return s
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n")
}

function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length) {
    return err.errors.map(describeError).join("\n")
  }
  if (err instanceof Error) {
    const code = (err as { code?: string }).code
    return code ? `[${code}] ${err.message}` : err.message
  }
  const e = err as { message?: string } | null
  if (e && typeof e === "object" && e.message) return e.message
  return String(err)
}

function hintFor(err: unknown): string | undefined {
  const e = err as { code?: string; message?: string }
  const msg = e?.message ?? ""
  if (/environment configuration/.test(msg))
    return "Fill in the missing variables in .env.local (see env.example)."
  switch (e?.code) {
    case "ECONNREFUSED":
      return "Nothing is listening at that host/port: is the server running (or paused on Railway)? Check HOST/PORT."
    case "ENOTFOUND":
      return "Hostname does not resolve — check the HOST / connection string for typos."
    case "ETIMEDOUT":
    case "ETIMEOUT":
      return "Connection timed out — firewall/IP allow-list, VPN, or wrong port."
    case "ER_ACCESS_DENIED_ERROR":
    case "28P01":
    case "ELOGIN":
      return "Authentication failed — check USER/PASSWORD."
    case "ER_BAD_DB_ERROR":
    case "3D000":
      return "Database does not exist — check the DATABASE name."
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "Server certificate is not trusted — set *_SSL_CA (preferred) or *_SSL_INSECURE=true (dev only)."
    case "ESOCKET":
      if (/Could not connect/i.test(msg))
        return "Nothing reachable at that host/port: is SQL Server running with TCP/IP enabled? Check MSSQL_HOST/PORT."
      return "Socket/TLS error — for a local SQL Server with a self-signed cert, try MSSQL_SSL_INSECURE=true (dev only)."
  }
  if (/self[- ]signed certificate/i.test(msg))
    return "Server certificate is not trusted — set *_SSL_CA (preferred) or *_SSL_INSECURE=true (dev only)."
  return undefined
}
