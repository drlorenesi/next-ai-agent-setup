import { beforeEach, describe, expect, it, vi } from "vitest"
import { captureSignalHandlers, deferred, setEnv } from "./_helpers.ts"

// ── Driver mock: capture the options passed to mysql.createPool ─────────────
const mocks = vi.hoisted(() => ({
  createPool: vi.fn(),
  getConnection: vi.fn(),
}))

vi.mock("mysql2/promise", () => {
  const createPool = (opts: unknown) => {
    mocks.createPool(opts)
    return { on: vi.fn(), end: vi.fn(), getConnection: mocks.getConnection }
  }
  return { default: { createPool, escapeId: (s: string) => `\`${s}\`` } }
})

const KEYS = [
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_SSL_CA",
  "MYSQL_SSL_INSECURE",
] as const

const VALID = {
  MYSQL_HOST: "db.local",
  MYSQL_DATABASE: "ventas",
  MYSQL_USER: "app",
  MYSQL_PASSWORD: "secret",
}

/** Import a fresh copy of the module (isDev and the singleton are module-level). */
async function load(env: Record<string, string | undefined> = VALID, nodeEnv = "production") {
  setEnv(KEYS, env)
  vi.stubEnv("NODE_ENV", nodeEnv)
  vi.resetModules()
  return import("@/lib/db/mysql")
}

/** Options passed to createPool on the most recent call. */
const lastOptions = () => mocks.createPool.mock.lastCall?.[0]

beforeEach(() => {
  mocks.createPool.mockClear()
  mocks.getConnection.mockReset()
  globalThis.__dbPool = undefined
  captureSignalHandlers()
})

describe("env validation", () => {
  it.each(["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"])(
    "throws naming %s when it is missing",
    async (key) => {
      const db = await load({ ...VALID, [key]: undefined })
      expect(() => db.getPool()).toThrow(new RegExp(key))
      expect(mocks.createPool).not.toHaveBeenCalled()
    }
  )

  it("defaults MYSQL_PORT to 3306 and coerces a string port", async () => {
    ;(await load()).getPool()
    expect(lastOptions().port).toBe(3306)
    ;(await load({ ...VALID, MYSQL_PORT: "3307" })).getPool()
    expect(lastOptions().port).toBe(3307)
  })

  it("rejects a non-numeric MYSQL_PORT", async () => {
    const db = await load({ ...VALID, MYSQL_PORT: "abc" })
    expect(() => db.getPool()).toThrow(/MYSQL_PORT/)
  })
})

describe("TLS options", () => {
  it("uses the CA bundle when MYSQL_SSL_CA is set (wins over INSECURE)", async () => {
    ;(await load({ ...VALID, MYSQL_SSL_CA: "PEM", MYSQL_SSL_INSECURE: "true" })).getPool()
    expect(lastOptions().ssl).toEqual({ ca: "PEM" })
  })

  it("disables verification and warns when MYSQL_SSL_INSECURE=true", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    ;(await load({ ...VALID, MYSQL_SSL_INSECURE: "true" })).getPool()
    expect(lastOptions().ssl).toEqual({ rejectUnauthorized: false })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/MYSQL_SSL_INSECURE/))
  })

  it("leaves ssl undefined when neither is set", async () => {
    ;(await load()).getPool()
    expect(lastOptions().ssl).toBeUndefined()
  })
})

describe("pool options", () => {
  it("keeps BIGINT/DECIMAL precision, UTC timezone and identifies the app", async () => {
    ;(await load()).getPool()
    expect(lastOptions()).toMatchObject({
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: "Z",
      connectAttributes: { program_name: "next-claude-dev-production" },
    })
  })

  it("sizes the pool 3 in development, 10 in production", async () => {
    ;(await load(VALID, "development")).getPool()
    expect(lastOptions().connectionLimit).toBe(3)
    ;(await load(VALID, "production")).getPool()
    expect(lastOptions().connectionLimit).toBe(10)
  })
})

describe("pool lifecycle", () => {
  it("is a singleton in production", async () => {
    const db = await load()
    expect(db.getPool()).toBe(db.getPool())
    expect(mocks.createPool).toHaveBeenCalledTimes(1)
  })

  it("reuses global.__dbPool in development (HMR-safe)", async () => {
    const stub = { stub: true } as unknown as NonNullable<typeof globalThis.__dbPool>
    globalThis.__dbPool = stub
    const db = await load(VALID, "development")
    expect(db.getPool()).toBe(stub)
    expect(mocks.createPool).not.toHaveBeenCalled()
  })

  it("registers SIGINT and SIGTERM shutdown handlers", async () => {
    ;(await load()).getPool()
    const events = vi.mocked(process.on).mock.calls.map((c) => c[0])
    expect(events).toEqual(expect.arrayContaining(["SIGINT", "SIGTERM"]))
  })
})

describe("getConnection(timeoutMs)", () => {
  it("rejects with a timeout error and releases the late connection", async () => {
    const pending = deferred<{ release: () => void }>()
    mocks.getConnection.mockReturnValue(pending.promise)
    const db = await load()

    await expect(db.getConnection(20)).rejects.toThrow(
      "Timed out acquiring DB connection after 20ms"
    )

    const late = { release: vi.fn() }
    pending.resolve(late)
    await vi.waitFor(() => expect(late.release).toHaveBeenCalledTimes(1))
  })
})

describe("runQuery", () => {
  function connReturning(result: unknown) {
    const conn = { query: vi.fn().mockResolvedValue(result), release: vi.fn() }
    mocks.getConnection.mockResolvedValue(conn)
    return conn
  }

  it("normalizes a row result and releases the connection", async () => {
    const conn = connReturning([[{ a: 1, b: null }], [{ name: "a" }, { name: "b" }]])
    const db = await load()

    const r = await db.runQuery("SELECT ? AS a", [1])
    expect(r).toMatchObject({ kind: "rows", columns: ["a", "b"], rows: [["1", null]], rowCount: 1 })
    expect(conn.query).toHaveBeenCalledWith("SELECT ? AS a", [1])
    expect(conn.release).toHaveBeenCalledTimes(1)
  })

  it("normalizes a write result (affectedRows, insertId as string)", async () => {
    connReturning([{ affectedRows: 2, insertId: 99 }, undefined])
    const db = await load()
    expect(await db.runQuery("UPDATE t SET x = 1")).toMatchObject({
      kind: "ok",
      affectedRows: 2,
      insertId: "99",
    })
  })

  it("releases the connection when the query throws", async () => {
    const conn = { query: vi.fn().mockRejectedValue(new Error("boom")), release: vi.fn() }
    mocks.getConnection.mockResolvedValue(conn)
    const db = await load()
    await expect(db.runQuery("SELECT 1")).rejects.toThrow("boom")
    expect(conn.release).toHaveBeenCalledTimes(1)
  })
})
