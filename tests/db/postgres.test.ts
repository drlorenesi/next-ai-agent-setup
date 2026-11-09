import { beforeEach, describe, expect, it, vi } from "vitest"
import { captureSignalHandlers, deferred, setEnv } from "./_helpers"

// ── Driver mock: capture the options passed to new pg.Pool ──────────────────
const mocks = vi.hoisted(() => ({
  ctor: vi.fn(),
  on: vi.fn(),
  connect: vi.fn(),
}))

vi.mock("pg", () => ({
  Pool: class {
    on = mocks.on
    connect = mocks.connect
    end = vi.fn()
    constructor(opts: unknown) {
      mocks.ctor(opts)
    }
  },
}))

const KEYS = ["DATABASE_URL", "POSTGRES_SSL_CA", "POSTGRES_SSL_INSECURE"] as const
const VALID = { DATABASE_URL: "postgresql://u:p@ep-x.neon.tech/auth?sslmode=verify-full" }

async function load(env: Record<string, string | undefined> = VALID, nodeEnv = "production") {
  setEnv(KEYS, env)
  vi.stubEnv("NODE_ENV", nodeEnv)
  vi.resetModules()
  return import("@/lib/db/postgres")
}

const lastOptions = () => mocks.ctor.mock.lastCall?.[0]

beforeEach(() => {
  mocks.ctor.mockClear()
  mocks.on.mockClear()
  mocks.connect.mockReset()
  globalThis.__pgPool = undefined
  captureSignalHandlers()
})

describe("env validation", () => {
  it("throws naming DATABASE_URL when it is missing", async () => {
    const db = await load({})
    expect(() => db.getPool()).toThrow(/DATABASE_URL/)
    expect(mocks.ctor).not.toHaveBeenCalled()
  })

  it("rejects an invalid POSTGRES_SSL_INSECURE value", async () => {
    const db = await load({ ...VALID, POSTGRES_SSL_INSECURE: "yes" })
    expect(() => db.getPool()).toThrow(/POSTGRES_SSL_INSECURE/)
  })
})

describe("TLS options", () => {
  it("uses the CA bundle when POSTGRES_SSL_CA is set", async () => {
    ;(await load({ ...VALID, POSTGRES_SSL_CA: "PEM" })).getPool()
    expect(lastOptions().ssl).toEqual({ ca: "PEM" })
  })

  it("disables verification and warns when POSTGRES_SSL_INSECURE=true", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    ;(await load({ ...VALID, POSTGRES_SSL_INSECURE: "true" })).getPool()
    expect(lastOptions().ssl).toEqual({ rejectUnauthorized: false })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/POSTGRES_SSL_INSECURE/))
  })

  it("leaves ssl undefined (sslmode in the URL decides) when neither is set", async () => {
    ;(await load()).getPool()
    expect(lastOptions().ssl).toBeUndefined()
  })
})

describe("pool options", () => {
  it("sets server-side timeouts and application_name", async () => {
    ;(await load()).getPool()
    expect(lastOptions()).toMatchObject({
      connectionString: VALID.DATABASE_URL,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 60_000,
      application_name: "next-claude-dev-production",
    })
  })

  it("sizes the pool 3 in development, 10 in production", async () => {
    ;(await load(VALID, "development")).getPool()
    expect(lastOptions().max).toBe(3)
    ;(await load(VALID, "production")).getPool()
    expect(lastOptions().max).toBe(10)
  })

  it("re-applies the timeouts with SET on every new client (Neon drops startup params)", async () => {
    ;(await load()).getPool()
    const onConnect = mocks.on.mock.calls.find((c) => c[0] === "connect")?.[1]
    expect(onConnect).toBeTypeOf("function")

    const client = { query: vi.fn().mockResolvedValue(undefined) }
    onConnect(client)
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET statement_timeout = 30000.*idle_in_transaction_session_timeout = 60000/)
    )
  })

  it("attaches an idle-client error listener", async () => {
    ;(await load()).getPool()
    expect(mocks.on).toHaveBeenCalledWith("error", expect.any(Function))
  })
})

describe("pool lifecycle", () => {
  it("is a singleton in production", async () => {
    const db = await load()
    expect(db.getPool()).toBe(db.getPool())
    expect(mocks.ctor).toHaveBeenCalledTimes(1)
  })

  it("reuses global.__pgPool in development (HMR-safe)", async () => {
    const stub = { stub: true } as unknown as NonNullable<typeof globalThis.__pgPool>
    globalThis.__pgPool = stub
    const db = await load(VALID, "development")
    expect(db.getPool()).toBe(stub)
    expect(mocks.ctor).not.toHaveBeenCalled()
  })
})

describe("getConnection(timeoutMs)", () => {
  it("rejects with a timeout error and releases the late client", async () => {
    const pending = deferred<{ release: () => void }>()
    mocks.connect.mockReturnValue(pending.promise)
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
  function clientReturning(result: unknown) {
    const client = { query: vi.fn().mockResolvedValue(result), release: vi.fn() }
    mocks.connect.mockResolvedValue(client)
    return client
  }

  it("normalizes a row result and releases the client", async () => {
    const client = clientReturning({
      fields: [{ name: "id" }, { name: "creado" }],
      rows: [{ id: "9223372036854775807", creado: new Date("2026-01-01T00:00:00Z") }],
      rowCount: 1,
    })
    const db = await load()

    const r = await db.runQuery("SELECT $1::int", [1])
    expect(r).toMatchObject({
      kind: "rows",
      columns: ["id", "creado"],
      rows: [["9223372036854775807", "2026-01-01T00:00:00.000Z"]],
      rowCount: 1,
    })
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it("normalizes a write result (rowCount → affectedRows, insertId '0')", async () => {
    clientReturning({ fields: [], rows: [], rowCount: 3 })
    const db = await load()
    expect(await db.runQuery("DELETE FROM t")).toMatchObject({
      kind: "ok",
      affectedRows: 3,
      insertId: "0",
    })
  })
})
