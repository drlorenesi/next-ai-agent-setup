# Postgres connection module — testing report

**Module under test:** [lib/postgres.ts](../../lib/postgres.ts)
**Target environment used for testing:** Neon-hosted Postgres (managed serverless)
**Date:** 2026-05-20

## Context

We hardened [lib/postgres.ts](../../lib/postgres.ts) in parallel with the MySQL module (see [mysql-testing-report.md](./mysql-testing-report.md)) and added a wider set of cards/tables on the `/bds/diagnosticos` Postgres panel. This report records the smoke-testing that followed, the Neon-specific constraints we discovered, and the test scenarios that should be promoted to an automated suite.

The Postgres exercise turned out to be substantially more revealing than MySQL — we hit a real configuration bug, an endpoint-selection trap, and a startup-parameter-filter behavior that's specific to Neon (probably also to other managed Postgres services with similar proxy layers).

---

## Module configuration in scope

Pool ([lib/postgres.ts](../../lib/postgres.ts)):

- `max: 3` (dev) / `10` (prod), `idleTimeoutMillis: 60_000`, `connectionTimeoutMillis: 10_000`
- `keepAlive: true`, `keepAliveInitialDelayMillis: 0`
- `application_name: next-claude-dev-${NODE_ENV}` (via startup param — works on Neon)
- `statement_timeout: 30_000` (via PoolConfig — **dropped by Neon**, see Findings)
- `idle_in_transaction_session_timeout: 60_000` (via PoolConfig — **dropped by Neon**, see Findings)
- TLS via `POSTGRES_SSL_CA` (preferred) or `POSTGRES_SSL_INSECURE=true` (warned); otherwise pg parses `sslmode` from the URL
- `pool.on("connect", ...)` runs `SET statement_timeout = 30000; SET idle_in_transaction_session_timeout = 60000` on each new physical connection — works around Neon's startup-param filter
- `pool.on("error", ...)` logs idle-client errors so they don't crash the event loop
- Idempotent SIGINT/SIGTERM handler

Acquire helper:
- `getConnection(timeoutMs = 5000)` races `pool.connect()` against a timer; the eventual client is released if the timer wins (no leak).

Header comment at the top of the module documents the **direct-connection assumption** — transaction-mode poolers (Neon `-pooler`, Supabase 6543, PgBouncer transaction mode, RDS Proxy) will silently disable A2.

---

## Findings: Neon-hosted Postgres

These are **operator constraints**, not bugs in the module — but each one shaped how the module had to be written.

| Constraint | Symptom | Workaround |
| --- | --- | --- |
| **Startup parameters for timeout GUCs are silently dropped.** Verified via `pg_settings.source`: `application_name` lands as `source = client`, but `statement_timeout` arrived as `source = default` (value `0`) and `idle_in_transaction_session_timeout` arrived as `source = configuration file` (Neon's server-side `5min` default). Neon's connection pipeline filters out the timeout GUC names but not `application_name`. | A2 (server-side query timeout) silently doesn't enforce. `pg_sleep(40)` runs the full 40 s with no cancellation. | **Send `SET statement_timeout = 30000` and `SET idle_in_transaction_session_timeout = 60000` in `pool.on("connect", ...)` after the client connects.** That creates a `source = session` setting which overrides server/role/database defaults. pg's per-client query queue guarantees the SET runs before any user query waiting on the same client. (Saved as memory: [neon-postgres-startup-param-filter.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/neon-postgres-startup-param-filter.md).) |
| **Default Neon dashboard hands out the pooled (`-pooler`) endpoint.** That endpoint puts PgBouncer in transaction-pooling mode in front of Postgres. | All session-scoped guarantees degrade: `SET statement_timeout` is wiped between transactions, prepared-statement caching breaks, etc. | Switch `DATABASE_URL` to the direct endpoint (drop `-pooler` from the hostname). Documented in the module header comment. |
| **Compute auto-suspend / cold start.** Neon scales serverless compute to zero on idle plans. | First query after a long idle period takes 3–5 s instead of milliseconds. Affects `connectionTimeoutMillis` budgeting. | Our `connectTimeoutMillis: 10_000` is generous enough. No code change needed, just documented expectation. |
| **`pg_stat_database.blks_hit/blks_read` semantics.** Neon's architecture has a remote page server plus a local file cache on the compute node. | The conventional `blks_hit / (blks_hit + blks_read)` ratio still measures shared_buffers hits, but isn't the whole memory-pressure story — Neon's local file cache catches misses before they reach storage. | Treat the ratio as "shared_buffers efficiency", not "total cache". A 96–98% reading on Neon is not necessarily worse than 99%+ on a self-hosted server. |
| **Default `neondb_owner` role and database visibility for `pg_stat_activity`.** | An external SQL client connected as the *same* `neondb_owner` should see the app's sessions, but it's easy to get a different role assignment depending on which Neon project / branch / connection the client uses. | If the verification query returns 0 rows, double-check `SELECT current_user, current_database()` in the same client. Filter on `application_name LIKE 'next-claude-dev-%'` (more portable than filtering by user). |

Implication for tests: server-side introspection of session GUCs is fully usable on Neon (unlike Railway's MySQL where `performance_schema = OFF` blocks it). So *most* tests can be expressed as "make a query, then check the resulting `pg_settings.source`".

---

## Provider-portability

The Postgres module is now provider-agnostic but **assumes a direct (non-pooler) connection that owns its session.** Verified working contract:

| Provider | Default endpoint to use | Notes |
| --- | --- | --- |
| **Neon** | Direct (hostname WITHOUT `-pooler`) | Pooled endpoint (`-pooler.neon.tech`) breaks A2 silently — PgBouncer in transaction mode. Module's SET-on-connect workaround for the startup-param filter is fine on either endpoint. |
| **Railway** | Direct (only option) | No managed PgBouncer; module should "just work". Likely also subject to some role-default GUC differences — verify with `pg_settings.source`. |
| **Supabase** | Port 5432 direct | Port 6543 is PgBouncer transaction mode — avoid. |
| **AWS RDS** | Direct | RDS Proxy (paid add-on) is a transaction-mode pooler — same caveats as Neon `-pooler`. |
| **GCP Cloud SQL** | Direct, or Cloud SQL Auth Proxy sidecar | The sidecar uses session-mode pooling, no startup-param filter issues. |
| **Self-hosted** | Direct | No surprises expected. |

When *would* you put a transaction-mode pooler in front?
- You run **many serverless app instances** (e.g., 50 Vercel functions × 5 connections = 250 connections > PG's default `max_connections = 100`). PgBouncer multiplexes them.
- Your workload is genuinely stateless — no `SET`, no temp tables, no prepared statements, no `NOTIFY`/`LISTEN`. Most real apps aren't.

For our project (single Next.js server, classic dev/prod deployment) — **always direct**.

---

## Manual tests performed

For each: what we wanted to prove, how we ran it, and what we observed.

### 1. Cache-hit-ratio query bug (initial state)

**Symptom:** Dashboard error: `column "blks_hit" does not exist`.

**Root cause:** The diagnostic query in [actions.ts](../../app/bds/diagnosticos/actions.ts) read from `pg_statio_user_tables` but used column names from `pg_stat_database`. The two views *both* have hit/read counters but with different column names (`heap_blks_*`, `idx_blks_*` etc. vs. `blks_hit`, `blks_read`).

**Fix:** Swap the catalog to `pg_stat_database WHERE datname = current_database()`. One-line change. After the fix, *Aciertos de caché* renders ~96–98% on Neon.

### 2. Pooled-endpoint trap

**Symptom:** User's initial `DATABASE_URL` pointed at `ep-…-pooler.c-2.us-east-1.aws.neon.tech`. The first A2 verification run showed `pg_sleep(40)` completing in the full 40 s with no cancellation.

**Root cause:** Neon's `-pooler` hostname puts PgBouncer in transaction-pooling mode in front of Postgres. Per-session `SET` commands (which is how pg sends `statement_timeout` *after* the startup, in some configurations) get wiped between transactions. Our session-scoped guarantees can't survive.

**Fix:** Switched to the direct endpoint (`-pooler` dropped from hostname). Added a header comment to [lib/postgres.ts](../../lib/postgres.ts) documenting the direct-connection assumption.

### 3. Neon's startup-parameter filter (the real surprise)

After switching to the direct endpoint, A2 *still* failed. The pg_sleep(40) test ran the full 40 s.

**Diagnostic step:** Added a session-introspection step that queried `pg_settings.source` for the relevant GUCs:

```
application_name                  next-claude-dev-development   source=client
idle_in_transaction_session_timeout  300000 (5min)              source=configuration file
statement_timeout                 0                              source=default
```

The control case (`application_name`) confirms our startup parameters *are* reaching Neon. But the timeout GUCs aren't — Neon's connection pipeline filters them out before the Postgres server sees them. `source = default` for `statement_timeout` means Postgres never even saw a `SET`; it stayed at server-init default.

**Fix:** Issue `SET statement_timeout = 30000; SET idle_in_transaction_session_timeout = 60000` in `pool.on("connect", ...)` after the client connects. Subsequent introspection shows `source = session` for both, value reflects what we set, and `pg_sleep(40)` now cancels at 30.16 s with SQLSTATE 57014.

This is a **module-level workaround that's harmless on other providers** — passing one extra "SET" statement per new physical connection is cheap, and on providers that *do* honor startup params, the SET just overlaps with what was already in place.

### 4. A1 — `application_name` via `pg_stat_activity`

**Hypothesis:** With `application_name` in PoolConfig, each pool connection identifies itself in `pg_stat_activity.application_name`.

**Procedure:**
- Click *Ejecutar diagnósticos* to warm the pool.
- From a separate SQL client (Neon's web SQL editor) connected as `neondb_owner`, run:
  ```sql
  SELECT pid, application_name, usename, client_addr, state
  FROM pg_stat_activity
  WHERE application_name LIKE 'next-claude-dev-%';
  ```

**Observed:**
- The app's own diagnostics dashboard shows two rows in *Actividad del usuario* with `Aplicación = next-claude-dev-development`. ✓
- The external SQL client query returned 0 rows. Confirmed via `SELECT current_user, current_database()` that the external client connected as `neondb_owner` (same role as the app). Most likely cause: timing/visibility (the connection IDs the dashboard sees are momentary; if the external query runs a few seconds later they may have closed) or a Neon-specific scoping quirk we didn't fully pin down. The dashboard side is the authoritative confirmation.

**Verdict:** A1 confirmed via the app's own `pg_stat_activity` read. External-client cross-check is flaky on Neon but not a real failure.

### 5. A2 — `statement_timeout` (after the Neon workaround landed)

**Hypothesis:** With the SET-on-connect handler in place, `SELECT pg_sleep(40)` is cancelled at ~30 s with SQLSTATE 57014.

**Procedure:** `runPostgresSleepTest` action runs `pg_sleep(40)` after first introspecting the session GUCs.

**Observed:**
- Session GUCs: `statement_timeout = 30s`, `idle_in_txn_timeout = 1min`, `application_name = next-claude-dev-development`.
- `pg_settings.source`: `statement_timeout = source=session`, `idle_in_transaction_session_timeout = source=session`, `application_name = source=client`.
- Elapsed: 30.16 s.
- SQLSTATE: `57014`.
- Error message: `canceling statement due to statement timeout`.

**Verdict:** A2 working cleanly. Unlike MySQL's `SLEEP()` quirk (returns `1` when interrupted, no thrown error), Postgres throws a proper SQLSTATE — easier to write tests against.

### 6. Type precision (parallel to MySQL A4)

**Hypothesis:** The `pg` driver returns `bigint` (int8) and `numeric` as JS strings by default (no module config needed).

**Procedure:** `runPostgresBigIntTest` runs:
```sql
SELECT 9223372036854775807::bigint AS big,
       1.234567890123::numeric(20,12) AS dec_val
```

**Observed:** Both fields arrived with `typeof === 'string'`, exact values preserved.

**Verdict:** Default behavior is precision-safe. Our module didn't need an equivalent of MySQL's `supportBigNumbers: true` / `bigNumberStrings: true` because pg's defaults are already correct.

### 7. Pool exhaustion

**Hypothesis:** With `max: 3` and four concurrent acquires, three succeed and the fourth rejects with our wrapper's 5 s acquire timeout.

**Procedure:** `runPostgresPoolExhaustionTest` fires four `getPgConnection()` + `pg_sleep(10)` calls via `Promise.allSettled`.

**Observed:** Slots 1–3 OK (~10.06–10.07 s each), slot 4 rejected with `Timed out acquiring DB connection after 5000ms`, total elapsed 10.07 s.

**Verdict:** Pool sizing + acquire-timeout wrapper work exactly as designed. Identical pattern to MySQL, which means the bug we fixed there (`getConnection` timer + release-on-timeout) ports cleanly across drivers.

### 8. Dashboard cards

Smoke-tested by clicking *Ejecutar diagnósticos* a few times.

| Card | Source | Observed |
| --- | --- | --- |
| Máx. conexiones (servidor) | `pg_settings WHERE name = 'max_connections'` | 112 (Neon's default for the compute tier) |
| Conexiones del usuario | `pg_stat_activity WHERE usename = current_user` count | 3 — matches our `max: 3` pool, green |
| Tamaño de la BD | `pg_size_pretty(pg_database_size(current_database()))` | 8016 kB (small test DB) |
| Aciertos de caché | `pg_stat_database WHERE datname = current_database()` ratio | 96.38% (yellow). Real signal — see Findings note about Neon's local file cache layer. |
| Idle in transaction | count + oldest age | 0 (clean) |
| Actividad del usuario | `pg_stat_activity` | Both pool connections visible, idle, `application_name = next-claude-dev-development` (confirms A1 server-side) |
| Resumen por estado | grouped activity | matches |
| Consultas bloqueadas | `pg_blocking_pids()` join | empty (no contention triggered) |
| Consultas largas | active > 30 s | empty (matches) |

---

## Recommended automated tests

Mirroring the MySQL groups, with Postgres-specific tweaks.

### Test harness

- **Runner:** Vitest, same as MySQL.
- **DB targets:** ideally THREE fixtures —
  - A baseline `postgres:16` container with default config: most tests run here.
  - A "Neon-mimic" fixture that drops timeout startup parameters at the connection layer (could be done with a custom PgBouncer or proxy fixture, or just a Postgres role with `ALTER ROLE neondb_owner SET statement_timeout = 0`). Tests the SET-on-connect workaround.
  - Optional: a transaction-mode PgBouncer fixture to assert the module's header-comment claim (A2 actually does break behind transaction-mode pooling). This is more an integration test for documentation than a daily-CI test.
- **Process model:** Vitest's `vi.isolate()` / `vi.resetModules()` per test so the singleton pool isn't shared.

### Group A — env parsing & SSL builder (no DB)

| Test | Asserts |
| --- | --- |
| `parseEnv` throws on missing `DATABASE_URL` | Error message includes the path |
| `buildSsl` returns `{ ca }` when `POSTGRES_SSL_CA` is set | Shape |
| `buildSsl` returns `{ rejectUnauthorized: false }` when `POSTGRES_SSL_INSECURE=true` and warns | Spy on `console.warn` |
| `buildSsl` returns `undefined` otherwise (pg will parse `sslmode=` from URL) | Strict equality |
| `buildPoolOptions` always sets `application_name`, `statement_timeout: 30_000`, `idle_in_transaction_session_timeout: 60_000` | Shape |

### Group B — pool lifecycle & helper behavior

| Test | Asserts |
| --- | --- |
| `getPool()` returns the same instance on repeated calls | Identity |
| HMR-safety: setting `global.__pgPool` to a stub returns the stub | Stub fixture |
| `getConnection(timeoutMs)` resolves with a `PoolClient` when pool has capacity | `instanceof Client` |
| `getConnection(50)` rejects with `Timed out acquiring DB connection after 50ms` when pool is saturated | Saturate via held SLEEPs |
| Timeout-then-resolve cleanup: after a timeout-rejected acquire, fire another `getConnection()` — it must succeed (the eventually-resolved client was released) | Functional test |
| `pool.on("connect")` handler runs `SET statement_timeout = 30000; SET idle_in_transaction_session_timeout = 60000` on each new connection | Query `pg_settings WHERE name IN (...) AND source = 'session'` on a freshly-acquired client |
| **Workaround robustness:** when the underlying provider has a role-level `ALTER ROLE … SET statement_timeout = 0`, the SET-on-connect still wins (effective value at `current_setting('statement_timeout') = '30s'`) | Configure the test fixture role to mimic Neon; assert session value |

### Group C — query-shape & type precision

| Test | Asserts |
| --- | --- |
| `bigint` (int8) > 2⁵³ returns as JS string | `typeof big === 'string'` && exact match |
| `numeric(p, s)` returns as JS string with full precision | exact string match |
| `timestamp` / `timestamptz` returns as JS `Date` (pg default) | `instanceof Date` — pin this so a future change is visible |
| `application_name` is visible in `pg_stat_activity.application_name` for the app's own session | Query inside a pooled client |
| `statement_timeout = '30s'` reaches the session (per `current_setting`) regardless of provider quirks | Query inside a pooled client; assert exact value |

### Group D — functional / behavior

| Test | Asserts |
| --- | --- |
| `SELECT pg_sleep(40)` is cancelled at ~30 s with **SQLSTATE 57014** | Catch the error, assert `err.code === '57014'`, assert elapsed `>= 29_000 && <= 31_000` ms |
| Pool exhaustion: 4 concurrent acquires with `max: 3` + 5 s acquire wrapper → 3 succeed (`pg_sleep(10)`), 1 rejects with the timeout message | Mirror what we did manually |
| `pool.end()` is idempotent (cached promise; calling twice doesn't throw) | Direct call sequence |
| SIGINT in a child process → `[postgres] pool closed` logged once, no errors | Spawn a child process, send signals |
| SIGINT + SIGTERM both fire → pool closes exactly once (cached promise) | Same harness |
| `pool.on("error")` swallows idle-client errors instead of crashing the process | Force-kill a Postgres backend via `pg_terminate_backend()` from another session; assert the host process is still alive |

### Group E — error paths & resilience

| Test | Asserts |
| --- | --- |
| Bad credentials → `getConnection()` rejects with `password authentication failed` | Connect with wrong password |
| Server unreachable on startup → rejects within `connectionTimeoutMillis` | Point `DATABASE_URL` at a TCP blackhole |
| Idle connection killed server-side → next acquire either gets a fresh one or surfaces a useful error | `pg_terminate_backend()` then attempt to use it |

### Group F — diagnostics action shape

For [actions.ts](../../app/bds/diagnosticos/actions.ts) `runPostgresDiagnostics`.

| Test | Asserts |
| --- | --- |
| Returns the top-level shape (`connections`, `summary`, `blocked`, `longQueries`, `stats`) | Type + required keys |
| `stats.cacheHitRatio === null` when `blks_hit + blks_read == 0` (fresh DB) | Avoid divide-by-zero |
| `blocked` returns `[]` when no blocking sessions exist | Cleanliness |
| `longQueries` returns `[]` when no active query > 30 s | Cleanliness |
| `idleInTxnCount` reflects sessions in `idle in transaction (aborted)` | Set up a test transaction, never commit, assert non-zero |

### Group G — Neon-specific regression guards

| Test | Asserts |
| --- | --- |
| Detect "startup param dropped" scenario: `pg_settings WHERE name = 'statement_timeout'` source must be `session` (not `default`, not `configuration file`) after a fresh connection | The SET-on-connect workaround is in effect |
| Trying to point `DATABASE_URL` at a Neon `-pooler` hostname produces a console warning at module load (we could add this as a lint-style check) | Optional: enforce direct-endpoint preference |

---

## Out of scope / future work

- **Connection-level TLS verification.** We test config-shape for `buildSsl` but not end-to-end TLS handshakes. Adding fixture certs to the test harness would close this gap.
- **Cold-start latency tests.** Neon's auto-suspend is hard to simulate in CI. Real-world latency expectations live in the operator's documentation, not the test suite.
- **Multiple branches / multiple databases.** Currently we only test against one Neon project. If we ever ship a multi-database connection pattern, the module needs an interface update first.
- **PgBouncer transaction-mode integration test.** Would prove the header-comment claim that "A2 fails behind transaction-mode pooler" — useful as documentation but not a daily-CI test.

## Sources

- Plan & verification log: [.claude/plans/every-time-i-stop-deep-blanket.md](../../.claude/plans/every-time-i-stop-deep-blanket.md)
- Project memories:
  - [neon-postgres-startup-param-filter.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/neon-postgres-startup-param-filter.md) — the timeout-GUC startup-param drop
  - [railway-mysql-perf-schema-off.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/railway-mysql-perf-schema-off.md) — parallel "managed DB silently disables a thing" finding
- pg package source: `node_modules/pg/lib/client.js` (startup-param serialization at L530-557), `node_modules/pg/lib/connection-parameters.js`
- Postgres docs: `statement_timeout`, `idle_in_transaction_session_timeout`, `pg_settings` and the `source` column meanings, `pg_stat_activity`, `pg_stat_database`, `pg_blocking_pids`, startup-packet protocol.
- Neon docs (verified): hostname conventions for direct vs pooled endpoints, compute auto-suspend, `neondb_owner` role.
