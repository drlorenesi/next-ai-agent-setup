# SQL Server connection module — testing report

**Module under test:** [lib/db/mssql.ts](../../lib/db/mssql.ts)
**Target environment used for testing:** Self-hosted SQL Server (Ubuntu Server, local network, exposed through a firewall port-forward — test database only)
**Date:** 2026-05-20

## Context

Final phase after the MySQL ([Railway](./mysql-testing-report.md)) and Postgres ([Neon](./postgres-testing-report.md)) reports. Differences in scope:

- **The target is self-hosted SQL Server.** No managed-provider proxy layer in the path. We've eliminated the "managed-DB silently disables a thing" category of finding that drove the previous two reports' most interesting moments.
- **Reduced coverage.** We did NOT test against Azure SQL Database, AWS RDS for SQL Server, or GCP Cloud SQL for SQL Server. The findings below are reliable for this self-hosted deployment; behavior on managed offerings is an explicit out-of-scope item.
- **Firewall in the path** (laptop → port-forward → local SQL Server). NAT-table TCP timeouts didn't surface during testing; our 60 s idle timeout is comfortably below the typical 30 min established-TCP NAT TTL.

The exercise found one real characteristic worth documenting (DECIMAL precision) and confirmed that the dual-timeout system in the module (per-request + per-acquire) works as designed.

---

## Module configuration in scope

[lib/db/mssql.ts](../../lib/db/mssql.ts):

- `pool: { max: 3 dev / 10 prod, min: 0, idleTimeoutMillis: 60_000 }`
- `acquireTimeoutMillis: 15_000`, `createTimeoutMillis: 10_000`, `destroyTimeoutMillis: 5_000` — aligned with `requestTimeout`
- `connectionTimeout: 10_000`, `requestTimeout: 15_000`
- `options.appName: next-claude-dev-${NODE_ENV}` — A1 equivalent (visible in `sys.dm_exec_sessions.program_name`)
- TLS via `MSSQL_SSL_CA` (preferred) or `MSSQL_SSL_INSECURE=true` (warned)
- Idempotent SIGINT/SIGTERM handler calling `pool.close()`
- `pool.on("error", ...)` for idle-connection errors that would otherwise crash the event loop
- **Cached-promise-on-error pattern** — `global.__mssqlConnect = undefined` when initial `connect()` rejects, so subsequent requests retry instead of inheriting a poisoned promise. (mssql-specific because `getPool()` returns `Promise<ConnectionPool>` rather than a sync pool — pg/mysql2 don't need this.)
- `getPool()` is **async** (`await getPool()`); callers do `(await getPool()).request().query(...)`. No `getConnection(timeoutMs)` wrapper.

---

## Findings: self-hosted SQL Server

Mostly "no quirks", which is exactly what we'd expect on a vanilla server. The two genuine items below are characteristics of the **mssql npm package**, not the deployment.

| Item | Symptom | Treatment |
| --- | --- | --- |
| **DECIMAL/NUMERIC precision** | mssql returns DECIMAL columns as JS `Number`. Values within ~17 significant digits round-trip exactly; values beyond that get truncated. Verified empirically with `1.2345678901234567890` (20 sig figs) → `1.2345678901234567` (last 3 digits gone). | Documented as a caveat. Workaround for callers who need higher precision: `CAST(col AS NVARCHAR(50))` in SQL. Saved as project memory ([mssql-decimal-precision-caveat.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/mssql-decimal-precision-caveat.md)). We did NOT push this into the module because the mssql package has no global flag for it — per-column type mapping is the only path and the SQL-side `CAST` is far less invasive. |
| **BIGINT precision** | Counter-intuition aside: BIGINT is safe. mssql auto-promotes values > `Number.MAX_SAFE_INTEGER` (2⁵³) to a JS string. Verified with `9223372036854775807` round-tripping exactly as `'9223372036854775807'`. | Safe for *precision*, but the auto-string bites *numeric* code: a `bigint` column treated as a `number` is a string at runtime, so `=== n` / arithmetic / `.toFixed()` silently misbehave (`"1234" + 1 === "12341"`). Coerce with `Number()` on use. See *Dashboard revision — 2026-05-28*. |
| **Dual-timeout system** | `requestTimeout: 15_000` (per-request, mssql client cancels with `code: 'ETIMEOUT'`) and `acquireTimeoutMillis: 15_000` (per-acquire, tarn rejects with "operation timed out for an unknown reason") fire at the same wall-clock budget. When all 3 pool slots are held by a 20 s WAITFOR and a 4th caller queues, slots 1-3 hit `requestTimeout` and slot 4 hits `acquireTimeoutMillis` — *together at ~15 s*. | Working as designed. Both budgets are intentionally aligned (see [the A3 hardening in lib/db/mssql.ts](../../lib/db/mssql.ts) — tarn's defaults would let the acquire timer run to 30 s, twice the budget callers were promised). The mssql package has no per-request `requestTimeout` override above the pool default, so any test that holds connections past `requestTimeout` will see both timeouts fire together. |
| **tempdb diagnostic** | The original dashboard query for tempdb used `sys.dm_db_file_space_usage WHERE database_id = 2`. That DMV is current-database-scoped — the `database_id` filter never matches from outside tempdb, returning NULL. Fixed by switching the "total size" computation to `sys.master_files` (server-scoped, queryable from any DB context) and dropping the used-bytes calculation, which genuinely requires per-file context. | Dashboard now shows total tempdb size correctly; "used" is null with a caption explaining why. Future improvement: a separate request that runs `USE tempdb; SELECT … FROM sys.dm_db_file_space_usage` could surface used bytes too. |
| **Firewall path latency** | First acquire latency was slightly higher than localhost would be (single-digit hundreds of ms vs ms-range for localhost), but no observed dropouts or connection resets. | No action — within the `connectionTimeout: 10_000` budget. If we ever migrate to a higher-latency network path, this would need re-validation. |

What we DIDN'T find (worth recording as null results):
- No `program_name` filtering or rewriting by SQL Server's connection handling — A1 just works.
- No connection-attribute filtering analogous to Neon's `statement_timeout` drop — every Postgres-style "managed provider replaces my session settings" concern is absent.
- No idle-connection drops during a multi-minute test session — keep-alive defaults are sufficient.

---

## Provider-portability

The module is designed for direct connections to a SQL Server endpoint, full session ownership, no proxy. Verified working against the self-hosted Ubuntu Server target. **Not validated** against:

| Provider | Connection pattern | What might change | Recommended re-test |
| --- | --- | --- | --- |
| **Azure SQL Database** | Direct via *.database.windows.net | TLS 1.2 enforced; some DMVs restricted on serverless tiers; connection-init hooks may set role defaults that override our session config; possible idle-timeout enforcement on the server side. | Full smoke test (this report's steps 1-5 plus the dual-timeout exercise). Watch session config via `SELECT @@SPID, current_setting('…')` equivalents. |
| **AWS RDS for SQL Server** | Direct via endpoint | Generally vanilla SQL Server with VPC networking. Minor: requestTimeout interaction with RDS's own deadline-tracking. | Full smoke test. Lower risk than Azure SQL. |
| **GCP Cloud SQL for SQL Server** | Direct or via Cloud SQL Auth Proxy (session-mode) | Lowest risk — proxy is transparent for session semantics. | Pool exhaustion test specifically (proxy may impose its own connection limit). |
| **Self-hosted (different OS / version)** | Direct | SQL Server version differences in DMV columns (we saw this with the original tempdb query). | Just the dashboard smoke test should catch most issues. |

When SHOULD you switch to a hosted SQL Server? Realistically, only if you outgrow self-hosting (managed backups, geo-replication, HA). For our test workload, self-hosted is fine.

---

## Manual tests performed

For each: what we wanted to prove, how we ran it, and what we observed.

### 1. Initial dashboard smoke test

**Procedure:** Click *Ejecutar diagnósticos* on the SQL Server panel.

**Observed (post-fixes):**
- Máx. conexiones (servidor): 32767 — SQL Server's `@@MAX_CONNECTIONS` default
- Sesiones activas: 7 — includes our app's 3 pool sessions + the user's SQL client (TablePlus) + system sessions (SQLServerCEIP, SQLAgent jobs)
- tempdb (total): 32 MB — fixed (was "Sin datos" due to scope bug — see Findings)
- Aciertos buffer cache: 100% — warm cache (small DB)
- Page Life Expectancy: 3,787,307 s (~43 days) — server hasn't restarted recently
- All tables (sesiones, resumen, sesiones bloqueadas, consultas en ejecución, top waits) render without errors

### 2. Bug fix: tempdb query

**Symptom:** "Sin datos" on the tempdb card.

**Root cause:** `sys.dm_db_file_space_usage` is current-database-scoped — the `database_id = 2` filter never matched anything because the query ran from our application's database, not tempdb.

**Fix:** Switched to `sys.master_files WHERE database_id = DB_ID('tempdb') AND type = 0` for total size (server-scoped, queryable from any DB context). Dropped the used-bytes calculation (would require running in tempdb context). Updated the card to display just the total when used is null, with a small caption explaining the limitation.

### 3. A1 — `appName` via `sys.dm_exec_sessions`

**Hypothesis:** mssql sends `options.appName` to the server as `program_name` on the session.

**Procedure:**
- Refresh the dashboard (the app's pool now holds active sessions).
- From a separate SQL client (TablePlus connected as `sa`), run:
  ```sql
  SELECT session_id, login_name, program_name, host_name, login_time, status
  FROM sys.dm_exec_sessions
  WHERE program_name LIKE 'next-claude-dev-%';
  ```

**Observed:** Three rows (sessions 63, 64, 65), all `login_name = sa`, `program_name = next-claude-dev-development`, `host_name = Diegos-M5-MacBook-Air.local`. All three of our pool's physical connections visible.

**Verdict:** A1 confirmed server-side. SQL Server applies the `program_name` from the mssql startup options without any filtering — the kind of "just works" we couldn't get on Railway MySQL (perf_schema OFF) or Neon Postgres (startup-param filter).

**Side note worth recording:** My first version of the verification query also requested `client_net_address`, which doesn't exist on `sys.dm_exec_sessions` — that column lives on `sys.dm_exec_connections`. If we ever want it on the dashboard, we'd JOIN: `LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id` and select `c.client_net_address`.

### 4. A2 — `requestTimeout` via `WAITFOR DELAY`

**Hypothesis:** The mssql client cancels long-running requests after `requestTimeout` (15 s) by sending an Attention packet. The result is a thrown `RequestError` with `code: 'ETIMEOUT'`.

**Procedure:** Server action runs `WAITFOR DELAY '00:00:40'`. Measure elapsed; capture error code + message.

**Observed:** Elapsed 15.14 s. `code = 'ETIMEOUT'`. Message: `Timeout: Request failed to complete in 15000ms`. Resultado: green.

**Verdict:** A2 working. Worth contrasting with the other modules' enforcement mechanisms:
- **MySQL** (`MAX_EXECUTION_TIME`): server-side, kills SELECTs that exceed the budget. `SELECT SLEEP()` interrupted by it returns `1` instead of throwing — quirk specific to SLEEP.
- **Postgres** (`statement_timeout`): server-side, throws SQLSTATE 57014.
- **SQL Server** (`requestTimeout`): **client-side** (mssql sends a cancel after the timer fires). Throws `RequestError` with `code: 'ETIMEOUT'`. Server keeps running the query briefly, then aborts on receiving the cancel.

For runaway-query protection, all three are functionally equivalent; the wire-level mechanism differs.

### 5. BigInt / Decimal precision

**Hypothesis:** Characterize how mssql returns numeric types and find the precision ceiling.

**Procedure:** Server action runs:
```sql
SELECT
  CAST(9223372036854775807 AS BIGINT) AS big,
  CAST(1.234567890123 AS DECIMAL(20, 12)) AS dec_low_precision,
  CAST(1.2345678901234567890 AS DECIMAL(38, 19)) AS dec_high_precision
```
Verdict: pass when all three values round-trip exactly.

**Observed:**
| Field | Sent | Received | typeof | Match? |
| --- | --- | --- | --- | --- |
| BIGINT | `9223372036854775807` | `9223372036854775807` | `string` | ✓ |
| DECIMAL bajo (13 sig figs) | `1.234567890123` | `1.234567890123` | `number` | ✓ |
| DECIMAL alto (20 sig figs) | `1.2345678901234567890` | `1.2345678901234567` | `number` | ✗ — last 3 digits truncated |

**Verdict:** BIGINT and small DECIMALs are safe. DECIMAL beyond JS Number's safe range (~17 sig figs) loses precision silently. Documented as a caveat in [mssql-decimal-precision-caveat.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/mssql-decimal-precision-caveat.md). The pragmatic workaround for callers that need high-precision DECIMAL is `CAST(col AS NVARCHAR(50))` in the SQL — far less invasive than per-column type mapping in the module.

### 6. Pool exhaustion — dual-timeout verification

**Hypothesis:** With `max: 3` and four concurrent acquires, the 4th request queues and is rejected by `acquireTimeoutMillis` (15 s). The in-flight queries that exceed `requestTimeout` (15 s) are also cancelled.

**Procedure:** Server action fires four `(await getPool()).request().query("WAITFOR DELAY '00:00:20'")` via `Promise.allSettled`. Classifies each result as `request-timeout`, `acquire-timeout`, or `completed`.

**First-run observation (instructive false start):** All 4 slots timed out at ~15 s, but my initial verdict regex didn't recognize mssql's `"Timeout: Request failed to complete in 15000ms"` as a timeout, so the verdict reported `0 acquisiciones / 1 timeouts (esperado 3 / 1)`. The actual *system behavior* was correct — I just had a brittle test that didn't classify the result.

**After rebuild — observed:**
- Slot 1: Request timeout (amber), 15.70 s, `Timeout: Request failed to complete in 15000ms`
- Slot 2: Request timeout (amber), 15.70 s, same
- Slot 3: Request timeout (amber), 15.70 s, same
- Slot 4: Acquire timeout (esperado) — green, 15.70 s, `operation timed out for an unknown reason`
- Verdict: `OK — 1 acquire-timeout · 3 request-timeout · 0 completados (total 15.70 s). Ambos timeouts del módulo se aplicaron correctamente.`

**Verdict:** Both timeouts work as designed and both fire at the same 15 s wall-clock budget (the configured value). The 4th slot's `acquire-timeout` is the unique characteristic we wanted to exercise — proving the queued-waiter rejection path works.

**Note on test design:** Because mssql has no per-request `requestTimeout` override above the pool default, there is no clean way to design a pool-exhaustion test that holds connections *past* `requestTimeout` *without* also triggering it. The previous module reports (MySQL, Postgres) didn't hit this because:
- MySQL's pool-exhaustion test used a 5 s `getConnection` wrapper timeout, far below MySQL's `MAX_EXECUTION_TIME` of 30 s.
- Postgres's pool-exhaustion test used the same 5 s wrapper, far below `statement_timeout` of 30 s.
- SQL Server has no equivalent wrapper, and `acquireTimeoutMillis` (15 s) ≡ `requestTimeout` (15 s) by design.

The dual-timeout-fires-together outcome is therefore the canonical correct result for this module's configuration. The verdict logic now reflects that.

---

## Dashboard revision — 2026-05-28

A follow-up pass on the SQL Server diagnostics cards, parallel to the MySQL dashboard revision. All
changes are in [actions.ts](../../app/bds/diagnosticos/actions.ts) and
[diagnostics-mssql.tsx](../../app/bds/diagnosticos/diagnostics-mssql.tsx); no change to
[lib/db/mssql.ts](../../lib/db/mssql.ts).

### BIGINT-as-string — the "auto-string" caveat bites numeric ops, not just precision

The Findings table frames "BIGINT is auto-string" as purely *good* (no precision loss). True for
display, but it has a sharp edge: any **`bigint` column treated as a `number`** is actually a string
at runtime, so `=== n`, arithmetic, and `.toFixed()` silently misbehave (`"1234" + 1 === "12341"`).
Two diagnostics readings hit this:

- **Page Life Expectancy** — `cntr_value` (a `bigint`), typed `number`.
- **Top esperas** — `wait_time_ms` and `waiting_tasks_count` from `dm_os_wait_stats`, both `bigint`,
  typed `number`.

It was **latent, not visibly broken**: PLE happens to be colored with `>=`, which coerces a numeric
string to a number, and the wait-stat values are display-only (that table has no coloring and is
ordered server-side). But the types lied and it was one `===`/arithmetic away from a silent bug —
the same class as the MySQL host-cache `COUNT(*)` card, which *was* visibly broken because it used
strict `===`.

**Fix:** mark the row-interface fields `string` (honest about what the driver returns) and coerce
with `Number()` at the boundary — `pageLifeExpectancy`, `topWaits[].waitTimeMs`,
`topWaits[].waitingTasksCount`.

### "Top esperas" caption — wait stats are cumulative

`sys.dm_os_wait_stats` accumulates since the last server restart (or `DBCC SQLPERF(...,CLEAR)`), so a
large "Tiempo total" is a lifetime sum, not a live spike. Added an optional `note` prop to the shared
[DiagTable](../../app/bds/diagnosticos/diag-table.tsx) and captioned the table:
*"Acumulado desde el arranque del servidor (o el último DBCC SQLPERF CLEAR), no una instantánea."*

### New card — "Tamaño de la BD"

SQL Server was the only dashboard without a user-database-size card (it showed *tempdb* only). Added
one for parity with Postgres (`pg_database_size`) and MySQL. It reports **used data size** (tables +
indexes) of the connected database via
`SELECT SUM(reserved_page_count) * 8192 FROM sys.dm_db_partition_stats` (8-KB pages → bytes;
current-DB-scoped, and the pool connects to `MSSQL_DATABASE`). The aggregate is a `bigint` → coerced
with `Number()` (per the fix above) and formatted with the shared `formatBytes` helper for "X GB"
parity; `"—"` for an empty DB. Chosen over `sys.master_files` allocated-file-size so the three
dashboards' size cards are directly comparable.

---

## Recommended automated tests

Mirroring the MySQL and Postgres groups, with mssql/tedious-specific tweaks.

### Test harness

- **Runner:** Vitest, same as the other modules.
- **DB targets:**
  - **Baseline:** `mcr.microsoft.com/mssql/server:2022-latest` container with default config, in `docker-compose.test.yml`. Most tests run here.
  - **Optional managed-comparison fixtures:** if we ever wire this up against Azure SQL Database for nightly integration, the Group G tests below catch the regressions.
- **Process isolation:** Vitest's `vi.isolate()` per test so the cached `global.__mssqlConnect` promise isn't shared.
- **Fixtures:** seed a small `test_fixtures` table for query-shape tests.

### Group A — env parsing & SSL builder (no DB)

| Test | Asserts |
| --- | --- |
| `parseEnv` throws when `MSSQL_HOST` is missing | Path-aware error message |
| `parseEnv` coerces `MSSQL_PORT` from string | Default `1433` when unset |
| `buildOptions` returns `{ encrypt: true, trustServerCertificate: false, cryptoCredentialsDetails: { ca } }` when `MSSQL_SSL_CA` is set | Shape |
| `buildOptions` returns `{ encrypt: true, trustServerCertificate: true }` when `MSSQL_SSL_INSECURE=true` and warns | Spy on `console.warn` |
| `buildOptions` returns `{ encrypt: true, trustServerCertificate: false }` when neither is set | Shape |
| `buildPoolOptions` always sets `options.appName: next-claude-dev-…` and `pool.acquireTimeoutMillis: 15_000` | Shape |

### Group B — pool lifecycle & helper behavior

| Test | Asserts |
| --- | --- |
| `getPool()` returns the same Promise<ConnectionPool> on repeated calls | Identity |
| HMR-safety: setting `global.__mssqlConnect` to a stubbed promise returns the stub | Stub fixture |
| **Cached-promise-on-error invariant:** if `pool.connect()` rejects, `global.__mssqlConnect` is set back to undefined so the next call retries | Mock `ConnectionPool.prototype.connect` to throw once; assert the second call gets a fresh attempt |
| Once the pool is connected, subsequent `getPool()` calls return the same instance | Identity |
| `pool.close()` is idempotent (cached `closing` promise; double-close doesn't throw) | Direct call sequence |
| SIGINT in a child process → `[mssql] pool closed` logged exactly once, no errors | Spawn a child, send signals |
| SIGINT + SIGTERM both fire → pool closes exactly once (cached promise dedupes) | Same harness |

### Group C — query-shape & type precision

| Test | Asserts |
| --- | --- |
| `SELECT CAST(9223372036854775807 AS BIGINT)` → JS string, exact value | `typeof === 'string'` && exact match |
| `SELECT CAST(1.234567890123 AS DECIMAL(20, 12))` → JS number, value matches | `typeof === 'number'` && value === 1.234567890123 |
| `SELECT CAST(1.2345678901234567890 AS DECIMAL(38, 19))` → JS number with precision loss | Document the lossy round-trip explicitly so a future mssql update that changes this behavior is caught |
| `SELECT CAST(my_decimal_col AS NVARCHAR(50))` workaround preserves full precision | Sanity-check the documented workaround |
| `SELECT GETDATE()` → JS Date | `instanceof Date` |
| Verify `program_name` reaches the server via `sys.dm_exec_sessions WHERE session_id = @@SPID` from inside a pooled request | exact match `next-claude-dev-test` (or the test env name) |

### Group D — functional / behavior

| Test | Asserts |
| --- | --- |
| `WAITFOR DELAY '00:00:40'` is cancelled at ~15 s with `code: 'ETIMEOUT'` | `elapsed >= 14_500 && <= 16_000`, error code match |
| Pool exhaustion: 4 concurrent acquires with `max: 3` running `WAITFOR DELAY '00:00:20'` → at least 1 `acquire-timeout` AND `acquire + request + completed = 4` | The dual-timeout classifier passing test |
| Pool exhaustion (short variant): 4 concurrent with `max: 3` running a 5-second `WAITFOR` → all 4 succeed within ~10 s (no timeouts) — proves queue serving works | Sanity check for the happy path |
| `pool.close()` after in-flight queries waits for them to drain | Functional |

### Group E — error paths & resilience

| Test | Asserts |
| --- | --- |
| Bad credentials → `getPool()` rejects with a useful error | Wrong password, expect ELOGIN or similar |
| Server unreachable on startup → rejects within `connectionTimeout` (10 s) | Point `MSSQL_HOST` at a blackhole, assert elapsed <= 12 s |
| Initial connect fails → cached-promise-on-error wipes the global cache; next call gets a fresh attempt | Combine with a recovering mock server |
| `pool.on("error")` swallows idle-connection errors instead of crashing the host process | Force-kill a session via `KILL <spid>` from another connection, assert host stays alive |

### Group F — diagnostics action shape

For [actions.ts](../../app/bds/diagnosticos/actions.ts) `runMssqlDiagnostics`.

| Test | Asserts |
| --- | --- |
| Returns the top-level shape (`sessions`, `summary`, `blocked`, `requests`, `topWaits`, `stats`) | Type + required keys |
| `stats.tempdbUsedMb === null` is gracefully rendered (we KNOW used is null by design) | Snapshot or render-output test |
| `stats.tempdbTotalMb` is a number > 0 against a real SQL Server | Sanity check |
| `blocked` returns `[]` when no `blocking_session_id > 0` rows exist | Cleanliness |
| `topWaits` excludes harmless idle waits (CHECKPOINT_QUEUE, BROKER_*, etc.) | Filter list shape |
| `stats.pageLifeExpectancy` and `topWaits[].waitTimeMs`/`waitingTasksCount` are JS `number`s, not strings | Regression for the 2026-05-28 BIGINT-as-string coercion |
| `stats.dbSizePretty` is a formatted byte string, `"—"` for an empty DB | Matches `/^[\d.]+ (B\|KB\|MB\|GB\|TB\|PB)$/`; reserved-page sum over no objects → NULL → `"—"` |

### Group G — managed-offering regression guards (aspirational)

These would run only if/when we wire up a nightly Azure SQL Database fixture.

| Test | Asserts |
| --- | --- |
| `program_name` propagation works on Azure SQL Database | Same `sys.dm_exec_sessions` query as in Group C |
| `requestTimeout` (15 s) is enforceable — Azure SQL Database doesn't preempt with its own deadline | Same WAITFOR test |
| DMVs queried by `runMssqlDiagnostics` aren't restricted on the targeted Azure SQL tier (e.g., serverless tier may restrict some DMVs) | Each card / table renders without permission errors |
| TLS handshake succeeds with `encrypt: true, trustServerCertificate: false` and the system CA store | Functional |

---

## Out of scope / future work

- **Managed SQL Server offerings.** Azure SQL Database, AWS RDS for SQL Server, GCP Cloud SQL for SQL Server. The Group G tests above are a starting point if we get an instance to test against.
- **DECIMAL high-precision module fix.** mssql has no global config for this; a per-column type mapping would work but is invasive. Deferred unless a real caller hits the issue.
- **tempdb used-bytes diagnostic.** Currently `null` on the dashboard — would require a separate request executing in tempdb context, or a join against `sys.dm_db_partition_stats` for system tables. Cosmetic, deferred.
- **Connection-level TLS verification with self-hosted CA.** Tested with `MSSQL_SSL_INSECURE=true` (the user's setup); didn't test the `MSSQL_SSL_CA` path end-to-end because the local server doesn't yet have a real cert chain.
- **Always Encrypted / Always Encrypted with Secure Enclaves.** Not in scope for this module — would require a separate hardening pass.

## Sources

- Plan & verification log: [.claude/plans/every-time-i-stop-deep-blanket.md](../../.claude/plans/every-time-i-stop-deep-blanket.md)
- Project memories:
  - [mssql-decimal-precision-caveat.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/mssql-decimal-precision-caveat.md) — the DECIMAL precision behavior
  - [neon-postgres-startup-param-filter.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/neon-postgres-startup-param-filter.md), [railway-mysql-perf-schema-off.md](../../.claude/projects/-Users-diego-Projects-2-next-claude-dev/memory/railway-mysql-perf-schema-off.md) — parallel "managed-DB silently does X" findings from the previous phases
- mssql / tedious packages: `node_modules/mssql/lib/base/connection-pool.js`, `node_modules/mssql/lib/tedious/connection-pool.js`, `node_modules/tedious/lib/connection.d.ts`
- SQL Server DMVs: `sys.dm_exec_sessions`, `sys.dm_exec_connections`, `sys.dm_exec_requests`, `sys.dm_db_file_space_usage`, `sys.dm_db_partition_stats`, `sys.master_files`, `sys.dm_os_performance_counters`, `sys.dm_os_wait_stats`.
- Companion reports: [mysql-testing-report.md](./mysql-testing-report.md), [postgres-testing-report.md](./postgres-testing-report.md).
