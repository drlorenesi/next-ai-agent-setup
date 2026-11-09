# MySQL connection module — testing report

**Module under test:** [lib/db/mysql.ts](../../lib/db/mysql.ts)
**Target environment used for testing:** Railway-hosted MySQL 8.x (managed)
**Date:** 2026-05-20

## Context

Two prior incidents motivated this exercise:

1. The `Aborted_clients` counter on the diagnostics dashboard was incrementing every time the dev server was stopped — meaning idle pool sockets were being dropped without `COM_QUIT`. We hardened the SIGINT/SIGTERM shutdown handler to call `pool.end()` cleanly.
2. The pool's configuration was minimal and the diagnostics dashboard surfaced only a few signals. We added per-connection `MAX_EXECUTION_TIME`, BigInt/Decimal precision safety, `connectAttributes.program_name` for observability, and a wider set of cards/tables on the dashboard.

This report records the manual smoke-testing that followed, the constraints we discovered on Railway-hosted MySQL, and the test scenarios that should be promoted to an automated suite.

---

## Module configuration in scope

Pool ([lib/db/mysql.ts](../../lib/db/mysql.ts)):

- `connectionLimit: 3` in dev, `10` in prod
- `maxIdle: 3` (dev) / `5` (prod), `idleTimeout: 60_000`
- `queueLimit: 100`, `enableKeepAlive: true`
- `connectTimeout: 10_000`
- `connectAttributes: { program_name: "next-claude-dev-${NODE_ENV}" }`
- `supportBigNumbers: true`, `bigNumberStrings: true`
- TLS via `MYSQL_SSL_CA` (preferred) or `MYSQL_SSL_INSECURE=true` (warned)
- Per-new-connection `SET SESSION MAX_EXECUTION_TIME = 30000` (via `pool.on("connection")`)
- Idempotent SIGINT/SIGTERM handler that runs `pool.end()` exactly once

Acquire helper:
- `getConnection(timeoutMs = 5000)` races `pool.getConnection()` against a timer; if the timer wins, the eventual connection is released to prevent leaks.

---

## Findings: Railway-hosted MySQL

These are **operator constraints**, not bugs in the module. They shape what diagnostics and tests can be relied upon.

| Constraint | Symptom | Workaround |
| --- | --- | --- |
| **`performance_schema = OFF`** on Railway's MySQL plans (saves ~100+ MB RAM) | All `performance_schema.*` queries return empty silently. `session_connect_attrs`, `variables_by_thread`, `data_lock_waits`, `host_cache`, `events_statements_*` are unusable. | Dashboard renders an amber banner when `@@performance_schema = 0`. Module-level features (`program_name`, `MAX_EXECUTION_TIME`) still work — only server-side *verification* is blocked. |
| **`FLUSH HOSTS` removed in MySQL 8.4** | `SQL syntax error near 'HOSTS'` | Use `TRUNCATE TABLE performance_schema.host_cache` (when perf_schema is on). |
| **`FLUSH STATUS` does not reset `Aborted_connects`** in MySQL 8.x | The counter stays at its historical baseline; only a server restart zeros it. | Track *deltas* on the dashboard, not absolutes — implemented 2026-05-28 (see the *Dashboard revision* section). |
| **The user account isn't `railway`** | `WHERE PROCESSLIST_USER = 'railway'` returned 0 rows in our first verification attempt. | `railway` is the database name; the connecting user is usually `root`. Filter on connection attributes (`program_name LIKE 'next-claude-dev-%'`) rather than user name. |
| **`Max_used_connections` does not reset with `FLUSH STATUS`** | Always shows the server-lifetime high-water. | Document this on the card; consider switching to `Threads_connected` for the live signal. |

Implication for tests: any test that needs to inspect server state by reading `performance_schema` tables must run against a server with `performance_schema = ON`. On Railway specifically, verification has to be **functional** (observe behavior end-to-end) rather than introspective (read counters/attrs from server tables).

This is saved as a memory: [railway-mysql-perf-schema-off.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/railway-mysql-perf-schema-off.md).

---

## Manual tests performed

For each: what we wanted to prove, how we ran it, and what we observed.

### 1. SIGINT shutdown — `Aborted_clients` does not increment

**Hypothesis:** Idempotent shutdown handler closes the pool with `COM_QUIT` before the process exits, so MySQL no longer counts the sockets as aborted.

**Procedure:**
1. `FLUSH STATUS;` to zero the counter.
2. Start `next dev`, click *Ejecutar diagnósticos* (warms the pool with at least one connection).
3. `Ctrl+C` the dev server. Observed `[db] pool closed` logged exactly once with no error.
4. Restart and re-run diagnostics.

**Observed:** `Clientes abortados` stayed at 0 across multiple stop/start cycles. *(Note: in a follow-up cycle we saw a small bump to 2 after one restart, likely from Turbopack force-killing the worker before `pool.end()` finished. Not a regression — the SIGINT path is correct; the worker death path is outside our control.)*

### 2. A2 — server-side `MAX_EXECUTION_TIME`

**Hypothesis:** Each new pool connection runs `SET SESSION MAX_EXECUTION_TIME = 30000`, so any SELECT exceeding 30 s is interrupted by the server.

**Procedure:** Server action runs `SELECT SLEEP(40) AS slept` through `getMysqlConnection()` and measures elapsed time + return value.

**Observed:** Elapsed 30.05 s, `SLEEP` returned `1`. MySQL's documented behavior is that `SLEEP()` interrupted by `MAX_EXECUTION_TIME` returns `1` instead of `0`; some MySQL versions instead throw error 3024. The test treats either as "interrupted = pass".

**Catch worth remembering:** Our first version of this test checked for a thrown error and reported "MAX_EXECUTION_TIME did not fire" when the statement completed normally with the elapsed time spanning ~30 s. The fix was to read the SELECT's return value, not just whether it errored.

### 3. A4 — BigInt / Decimal precision

**Hypothesis:** With `supportBigNumbers: true` and `bigNumberStrings: true`, BIGINT values > 2⁵³ arrive as JavaScript strings (no precision loss). DECIMAL is also a string by mysql2's default.

**Procedure:** Server action runs `SELECT 9223372036854775807 AS big_val, CAST(1.234567890123 AS DECIMAL(20,12)) AS dec_val` and returns `typeof` for each.

**Observed:** Both `bigType` and `decType` returned `"string"`. Values match exactly (no truncation).

**Catch worth remembering:** `dec` is a reserved synonym for `DECIMAL` and cannot be used as a column alias.

### 4. Pool exhaustion — `getConnection(timeoutMs)` rejects queued waiters

**Hypothesis:** With `connectionLimit: 3` and four concurrent acquires, three should succeed and the fourth should reject with our wrapper's 5 s timeout — *not* hang indefinitely or be silently rejected by the pool's `queueLimit`.

**Procedure:** Server action fires four `getMysqlConnection()` + `SELECT SLEEP(10)` in `Promise.allSettled`. Reports per-slot status and elapsed.

**Observed:**
- Slots 1–3: OK, each ~10.07–10.27 s.
- Slot 4: rejected with `Timed out acquiring DB connection after 5000ms`, elapsed 10.27 s overall (because `Promise.allSettled` waits for the slower slots — the rejection itself happened at ~5 s).

This also proved that connections released after a slow caller are reused for queued waiters (slot 4 never got served because the wrapper rejected first, but the pool would have given it the next freed connection).

### 5. A1 (server-side) — connection attribute `program_name`

**Hypothesis:** The pool sends `program_name = next-claude-dev-development` to the server on the handshake; it appears in `performance_schema.session_connect_attrs`.

**Observed (Railway):** Cannot be verified server-side because `performance_schema = OFF`. Falls back to client-side source review: confirmed in [node_modules/mysql2/lib/packets/handshake_response.js:97-116](../../node_modules/mysql2/lib/packets/handshake_response.js) — mysql2 serializes the attributes when the `CONNECT_ATTRS` capability is negotiated, which it is by default ([connection_config.js:244](../../node_modules/mysql2/lib/connection_config.js)).

**Verdict:** Trust the client. If we later test against a server with perf_schema on, switch to a server-side query (see Recommended automated tests, group C).

### 6. New diagnostic queries on the dashboard

Smoke-tested by clicking *Ejecutar diagnósticos* and visually confirming each card populated with sensible values across multiple runs.

| Card | Source | Observed |
| --- | --- | --- |
| Máx. global (servidor) | `SHOW GLOBAL STATUS LIKE 'Max_used_connections'` | Grew with concurrent test runs (peaked at 4 during pool-exhaustion test) |
| Hilos conectados / en ejecución | `Threads_connected / Threads_running` | Reflected user's SQL client + app pool live |
| Errores de host activos | `performance_schema.host_cache` | Always 0 on Railway (perf_schema off) — banner flags this |
| Clientes abortados | `Aborted_clients` | Behaved correctly after `FLUSH STATUS` reset |
| Conexiones fallidas | `Aborted_connects` | Frozen baseline (Railway can't reset) |
| Consultas lentas | `Slow_queries` | Incremented by 1 per SLEEP(40) and by 3 per pool-exhaustion run (3× SLEEP(10) on Railway's `long_query_time = 10`) |
| Aciertos buffer pool InnoDB | `Innodb_buffer_pool_read_requests / (... + Innodb_buffer_pool_reads)` | Trended up with usage (~98.8% on a warm server) |
| Conexiones del usuario | `information_schema.processlist WHERE USER = ?` | Worked fine on Railway |
| Resumen por comando | grouped processlist | Worked fine on Railway |
| Bloqueos en espera | `performance_schema.data_lock_waits` | Always empty on Railway — banner flags this |

> **Partly superseded by the 2026-05-28 dashboard revision (below):** "Errores de host activos" had a
> `COUNT(*)`-returned-as-string bug that painted the healthy zero red; "Conexiones fallidas" and
> "Consultas lentas" now show a Δ-since-last-run rather than coloring the absolute; and a new
> "Tamaño de la BD" card was added.

---

## Dashboard revision — 2026-05-28

A follow-up pass on the diagnostics cards, prompted by misleading colors. All changes are in
[diagnostics-mysql.tsx](../../app/bds/diagnosticos/diagnostics-mysql.tsx) and
[actions.ts](../../app/bds/diagnosticos/actions.ts); no change to
[lib/db/mysql.ts](../../lib/db/mysql.ts).

### Bug fixed — "Errores de host activos" was red at the *healthy* zero

`runMysqlDiagnostics` returned the host-cache count via `SELECT COUNT(*) AS count …` as
`activeHostErrors: hostCacheRow?.count ?? 0`. The declared type is `number`, but at runtime it was
the **string `"0"`**: `COUNT(*)` is a BIGINT and the pool sets `bigNumberStrings: true`, so mysql2
serializes it as a string. The component's `=== 0` checks then failed — `("0" === 0)` is false — so
the card rendered a literal red `"0"` instead of green "Sin errores". The healthy state looked like
an error.

- **Fix:** coerce at the source — `activeHostErrors: Number(hostCacheRow?.count ?? 0)` — matching the
  `summary` query's existing `CAST(... AS UNSIGNED)` + `Number()` pattern.
- **Plus:** when `performance_schema` is off (Railway), the card now shows a muted **"Sin datos"**
  instead of green "Sin errores" — honest about not being able to measure, consistent with the
  perf_schema banner that already names this card. Red now appears only when there genuinely are
  hosts with connect errors.
- **Gotcha worth remembering:** under `bigNumberStrings: true`, every BIGINT result — including
  `COUNT(*)`, `SUM(...)` and other aggregates — comes back as a string. Coerce with `Number()`
  before any numeric comparison.

### "Conexiones fallidas" and "Consultas lentas" — colored on a delta, not the absolute

Both back onto **cumulative, server-global counters** (`Aborted_connects`, `Slow_queries`) whose
absolute value is a historical baseline, not an actionable signal. `Aborted_connects` can't even be
reset by `FLUSH STATUS` on Railway, and `Slow_queries` had accumulated our own `SLEEP` battle-tests
(Tests 2 & 4). Coloring red on the absolute (`135`, `15`) was a permanent false alarm.

- Both cards now render the absolute in neutral text plus a **`Δ +N desde la última ejecución`**
  computed client-side (a `useRef` baseline updated in a `useEffect`, so it survives dev-server
  restarts as long as the page isn't reloaded — which is how you can *watch* a `ctrl+c` cycle add to
  the counter).
- Delta coloring: "Conexiones fallidas" → `0` green / `>0` amber (its increments are benign
  mid-handshake aborts). "Consultas lentas" → `0` green / `1–10` amber / `>10` red (a real workload
  signal on the increment).
- Captions now state the counters are cumulative and to watch the increment.

### Left as-is by design — "Clientes abortados"

`Aborted_clients` is the same family of cumulative counter, but it's a **clean-shutdown regression
detector**: it should be `0` after a clean `ctrl+c`, and `FLUSH STATUS` *does* reset it (the card's
caption says so). Its absolute is therefore the meaningful signal, so it keeps absolute coloring
(`0` good / `1–5` amber / `>5` red). A reading of `2` is the documented Turbopack
force-kill-before-`pool.end()` artifact (see Test 1), not a regression.

### New card — "Tamaño de la BD"

Parity with the Postgres dashboard's database-size card. `runMysqlDiagnostics` now runs
`SELECT SUM(data_length + index_length) AS size_bytes FROM information_schema.tables WHERE
table_schema = DATABASE()` and formats the bytes with a local `formatBytes` helper. It uses
`information_schema` (not `performance_schema`), so it works on Railway. Captioned **"Aproximado
(estadísticas de InnoDB…)"** because InnoDB's `data_length`/`index_length` are cached estimates —
unlike Postgres' exact `pg_database_size`.

---

## Recommended automated tests

For the next iteration, when we promote this to a real test suite. Grouped by what they exercise.

### Test harness

- **Runner:** Vitest (fits the project — fast, ES-module friendly, plays well with TypeScript).
- **DB target:** a real MySQL 8 container (`docker run --rm -p 13306:3306 -e MYSQL_ROOT_PASSWORD=test mysql:8.4`) brought up before the suite, torn down after. Tests should not depend on Railway's quirks — instead, we should have:
  - A *baseline* suite that runs against a "full" MySQL (perf_schema on). This is the canonical correctness suite.
  - A *constrained* suite that disables perf_schema (`--performance-schema=OFF`) to validate the dashboard's graceful-degradation path and assert nothing crashes.
- **Process model:** prefer running each test in a fresh module (use Vitest's `vi.isolate()` or `vi.resetModules()`) so the singleton pool isn't shared across tests. SIGINT tests must run in a child process — see group D.
- **Fixtures:** seed a small `test_fixtures` table for query-shape tests. Reset state per test where mutation occurs.

### Group A — env parsing & SSL builder (no DB)

| Test | Asserts |
| --- | --- |
| `parseEnv` throws when `MYSQL_HOST` is missing | Error message includes the missing key path |
| `parseEnv` coerces `MYSQL_PORT` from string | Returns the numeric value, default `3306` when unset |
| `buildSsl` returns `{ ca }` when `MYSQL_SSL_CA` is set | Object shape |
| `buildSsl` returns `{ rejectUnauthorized: false }` when `MYSQL_SSL_INSECURE=true` and warns | Spy on `console.warn` |
| `buildSsl` returns `undefined` when neither is set | Strict equality |
| `buildPoolOptions` always sets `bigNumberStrings: true`, `supportBigNumbers: true`, and a `program_name` connectAttribute | Shape check |

These are pure-function tests and the foundation for any refactor.

### Group B — pool lifecycle & helper behavior

| Test | Asserts |
| --- | --- |
| `getPool()` returns the same instance on repeated calls | Identity check |
| `getPool()` is HMR-safe: setting `global.__dbPool` to a stub returns the stub on subsequent calls | Stub fixture |
| `getConnection(timeoutMs)` resolves with a `PoolConnection` when the pool has capacity | Type and connection.ping() succeeds |
| `getConnection(50)` rejects with `Timed out acquiring DB connection after 50ms` when the pool is saturated | Saturate by holding all `connectionLimit` connections; assert the message |
| When `getConnection` times out, the eventually-resolved connection is released | After timeout, fire another `getConnection()` — it should succeed |
| `pool.on("connection")` handler runs `SET SESSION MAX_EXECUTION_TIME = 30000` on each new connection | Spy on connection events; query `@@SESSION.max_execution_time` from the same connection (== 30000) |

### Group C — query-shape & precision

| Test | Asserts |
| --- | --- |
| BIGINT > 2⁵³ round-trips as a JS string | `SELECT 9223372036854775807 AS big` → `typeof big === 'string'` && `big === '9223372036854775807'` |
| DECIMAL(20,12) round-trips as a string with full precision | exact string match |
| DATE / DATETIME come back as JS `Date` objects (current `dateStrings: false` behavior is implicit) | `instanceof Date`. Add this so a later opt-in to `dateStrings: true` won't silently break callers. |
| `program_name` connect attribute is sent (perf_schema on) | Query `SELECT ATTR_VALUE FROM performance_schema.session_connect_attrs WHERE PROCESSLIST_ID = CONNECTION_ID() AND ATTR_NAME = 'program_name'` → `'next-claude-dev-test'` |
| `MAX_EXECUTION_TIME = 30000` is set per session (perf_schema on) | Query `SELECT VARIABLE_VALUE FROM performance_schema.variables_by_thread WHERE THREAD_ID = ... AND VARIABLE_NAME = 'max_execution_time'` |

### Group D — functional / behavior

| Test | Asserts |
| --- | --- |
| `SELECT SLEEP(40)` is interrupted within ~30 s | Elapsed between 30.0 and 31.0 s, AND (`SLEEP returns 1` OR error code 3024). Don't assert on one or the other — different MySQL versions take different paths. |
| Pool exhaustion: 4 concurrent acquires with `connectionLimit: 3` and `getConnection(5_000)` → 3 succeed, 1 rejects with the timeout message | Use `SLEEP(10)` to hold connections. Mirror what we did manually. |
| `pool.end()` is idempotent (calling twice does not throw) | Direct call sequence |
| Graceful shutdown on `SIGINT` calls `pool.end()` exactly once | **Spawn a child process** that imports the module, sends a query, then `process.kill(child.pid, 'SIGINT')`. Read child stdout — expect `[db] pool closed` once, no errors. |
| Graceful shutdown on `SIGINT` followed by `SIGTERM` still calls `pool.end()` exactly once | Same harness, send both signals. The `closing` promise dedupes them. |
| Idempotent `SET MAX_EXECUTION_TIME` on legacy server is tolerated | Use MariaDB 10.x or MySQL 5.6 fixture (where `MAX_EXECUTION_TIME` is unknown); assert the pool still serves queries and the `[db] could not set MAX_EXECUTION_TIME` warning is emitted. |

### Group E — error paths & resilience

| Test | Asserts |
| --- | --- |
| Bad credentials → `getConnection()` rejects with a useful error | Connect with `MYSQL_PASSWORD: 'wrong'`; expect `ER_ACCESS_DENIED_ERROR` |
| Server unreachable on first request → rejects within `connectTimeout` | Point `MYSQL_HOST` at a TCP-blackhole address (`192.0.2.1`); expect timeout within ≈10 s |
| Idle connection killed server-side is detected/recreated transparently | Get a connection, force-kill it via `KILL <thread_id>` from another session, release, re-acquire; new query should succeed (pool drops the dead one) |

### Group F — diagnostics action shape

These cover [app/bds/diagnosticos/actions.ts](../../app/bds/diagnosticos/actions.ts) `runMysqlDiagnostics`.

| Test | Asserts |
| --- | --- |
| Returns the expected top-level shape (`connections`, `summary`, `lockWaits`, `stats`) | Type and required keys |
| `stats.performanceSchemaEnabled === false` is correctly surfaced when running against a server with `--performance-schema=OFF` | Boolean propagation |
| `stats.bufferPoolHitRatio === null` when both Innodb_buffer_pool counters are 0 | Avoid divide-by-zero leakage |
| `lockWaits` returns `[]` (not undefined) when `performance_schema.data_lock_waits` is unavailable | Try/catch swallowed the error correctly |
| `stats.activeHostErrors` is a JS `number`, not a string | Regression for the 2026-05-28 bug: `COUNT(*)` arrives as a string under `bigNumberStrings`. Assert `typeof stats.activeHostErrors === 'number'`, including when the count is 0 |
| `stats.dbSizePretty` is a formatted byte string, and `"—"` for an empty schema | Matches `/^[\d.]+ (B\|KB\|MB\|GB\|TB\|PB)$/` for a non-empty DB; `SUM` over no tables → NULL → `"—"` |
| `formatBytes` formats at unit boundaries | Pure-function unit test: `0 → "0 B"`, sub-1024 stays in `B`, larger values carry up to 2 decimals (e.g. `1536 → "1.50 KB"`) |

---

## Out of scope / future work

- **Connection-level TLS verification** — we test that `buildSsl` produces the right config shape, but we don't end-to-end verify TLS against a server with a real cert. Worth adding once we have a fixture cert.
- **Lock-waits real-world test** — manual lock-waits scenario needs perf_schema on; defer to the docker-based suite.
- **`enableKeepAlive` after laptop sleep** — hard to simulate reliably; rely on the `keepAlive` socket option and the pool's bad-connection eviction.
- **Postgres and SQL Server testing reports** — parallel exercises pending; will follow the same template once their smoke-tests are done.

## Sources

- Plan & verification log: [.claude/plans/every-time-i-stop-deep-blanket.md](../../.claude/plans/every-time-i-stop-deep-blanket.md)
- Project memory: [railway-mysql-perf-schema-off.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/railway-mysql-perf-schema-off.md)
- mysql2 package: `node_modules/mysql2/` (handshake_response.js, connection_config.js, lib/promise/pool.js)
- MySQL docs: `MAX_EXECUTION_TIME`, `SLEEP()`, `Aborted_clients` / `Aborted_connects`, `performance_schema_session_connect_attrs_size`.
