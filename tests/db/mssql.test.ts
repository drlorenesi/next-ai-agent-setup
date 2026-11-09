import { beforeEach, describe, expect, it, vi } from "vitest"
import { captureSignalHandlers, setEnv } from "./_helpers"

// ── Driver mock: capture the config passed to new ConnectionPool ────────────
const mocks = vi.hoisted(() => ({
  ctor: vi.fn(),
  connect: vi.fn(),
  request: vi.fn(),
}))

// lib/db/mssql.ts uses the default import (mssql has no named ESM exports).
vi.mock("mssql", () => ({
  default: {
    ConnectionPool: class {
      on = vi.fn()
      close = vi.fn()
      request = mocks.request
      constructor(config: unknown) {
        mocks.ctor(config)
      }
      connect() {
        return mocks.connect(this)
      }
    },
  },
}))

const KEYS = [
  "MSSQL_HOST",
  "MSSQL_PORT",
  "MSSQL_DATABASE",
  "MSSQL_USER",
  "MSSQL_PASSWORD",
  "MSSQL_SSL_CA",
  "MSSQL_SSL_INSECURE",
] as const

const VALID = {
  MSSQL_HOST: "sql.local",
  MSSQL_DATABASE: "Facturacion",
  MSSQL_USER: "app",
  MSSQL_PASSWORD: "secret",
}

async function load(env: Record<string, string | undefined> = VALID, nodeEnv = "production") {
  setEnv(KEYS, env)
  vi.stubEnv("NODE_ENV", nodeEnv)
  vi.resetModules()
  return import("@/lib/db/mssql")
}

const lastConfig = () => mocks.ctor.mock.lastCall?.[0]

beforeEach(() => {
  mocks.ctor.mockClear()
  mocks.request.mockReset()
  // By default connect() succeeds and resolves to the pool itself (like mssql).
  mocks.connect.mockReset().mockImplementation((pool: unknown) => Promise.resolve(pool))
  globalThis.__mssqlConnect = undefined
  captureSignalHandlers()
})

describe("env validation", () => {
  it.each(["MSSQL_HOST", "MSSQL_DATABASE", "MSSQL_USER", "MSSQL_PASSWORD"])(
    "fails naming %s when it is missing",
    async (key) => {
      const db = await load({ ...VALID, [key]: undefined })
      // getPool() throws synchronously here; wrapping in async covers both a
      // sync throw and a rejected promise.
      await expect(async () => db.getPool()).rejects.toThrow(new RegExp(key))
    }
  )

  it("defaults MSSQL_PORT to 1433", async () => {
    await (await load()).getPool()
    expect(lastConfig().port).toBe(1433)
  })
})

describe("TLS options (encryption is always on)", () => {
  it("verifies against the CA bundle when MSSQL_SSL_CA is set", async () => {
    await (await load({ ...VALID, MSSQL_SSL_CA: "PEM" })).getPool()
    expect(lastConfig().options).toMatchObject({
      encrypt: true,
      trustServerCertificate: false,
      cryptoCredentialsDetails: { ca: "PEM" },
    })
  })

  it("trusts any certificate and warns when MSSQL_SSL_INSECURE=true", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await (await load({ ...VALID, MSSQL_SSL_INSECURE: "true" })).getPool()
    expect(lastConfig().options).toMatchObject({ encrypt: true, trustServerCertificate: true })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/MSSQL_SSL_INSECURE/))
  })

  it("encrypts and verifies by default", async () => {
    await (await load()).getPool()
    expect(lastConfig().options).toMatchObject({ encrypt: true, trustServerCertificate: false })
  })
})

describe("pool options", () => {
  it("aligns acquire and request timeouts and sets appName", async () => {
    await (await load()).getPool()
    expect(lastConfig()).toMatchObject({
      requestTimeout: 15_000,
      connectionTimeout: 10_000,
      pool: { acquireTimeoutMillis: 15_000, max: 10 },
      options: { appName: "next-claude-dev-production" },
    })
  })

  it("sizes the pool 3 in development", async () => {
    await (await load(VALID, "development")).getPool()
    expect(lastConfig().pool.max).toBe(3)
  })
})

describe("pool lifecycle", () => {
  it("is a singleton in production", async () => {
    const db = await load()
    expect(await db.getPool()).toBe(await db.getPool())
    expect(mocks.ctor).toHaveBeenCalledTimes(1)
  })

  it("does not cache a failed connect — the next call retries", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("login failed"))
    const db = await load()

    await expect(db.getPool()).rejects.toThrow("login failed")
    await expect(db.getPool()).resolves.toBeDefined()
    expect(mocks.ctor).toHaveBeenCalledTimes(2)
  })
})

describe("runQuery", () => {
  function requestReturning(result: unknown) {
    const request = { input: vi.fn(), query: vi.fn().mockResolvedValue(result) }
    mocks.request.mockReturnValue(request)
    return request
  }

  it("binds positional params as @p0, @p1, …", async () => {
    const request = requestReturning({ recordset: [{ n: 1 }], rowsAffected: [1] })
    const db = await load()
    await db.runQuery("SELECT @p0 AS n, @p1 AS s", [1, "dos"])
    expect(request.input).toHaveBeenNthCalledWith(1, "p0", 1)
    expect(request.input).toHaveBeenNthCalledWith(2, "p1", "dos")
  })

  it("normalizes a recordset into rows", async () => {
    requestReturning({ recordset: [{ id: "9223372036854775807", nombre: null }], rowsAffected: [1] })
    const db = await load()
    expect(await db.runQuery("SELECT 1")).toMatchObject({
      kind: "rows",
      columns: ["id", "nombre"],
      rows: [["9223372036854775807", null]],
      rowCount: 1,
    })
  })

  it("normalizes a write (no recordset) into ok", async () => {
    requestReturning({ recordset: undefined, rowsAffected: [4] })
    const db = await load()
    expect(await db.runQuery("UPDATE t SET x = 1")).toMatchObject({
      kind: "ok",
      affectedRows: 4,
      insertId: "0",
    })
  })
})
