# Next.js App Setup & AI Agent Guide

## Introduction

This project is a high-performance, mobile-first, responsive web application built with Next.js 16. The design explicitly separates authentication infrastructure from core business application data to optimize security, maintainability, and serverless runtime performance.

### Architecture Principle: Dual-Database Isolation

Better Auth on Neon Postgres manages user identity, authentication tokens, and session persistence **exclusively**. Railway MySQL and/or a local MSSQL database handles all domain business logic (e.g., sales reports, product management, order processing, and invoicing) using optimized custom connection modules. No ORM overhead is introduced.

## Important Notes

- `AGENTS.md` (imported by `CLAUDE.md`) warns that this Next.js version has breaking changes compared with older releases. Read the docs in `node_modules/next/dist/docs/` before you write Next.js code. `next dev` regenerates that block in `AGENTS.md`, so commit it instead of deleting it.
- The entire UI is in Spanish: UI, emails, error messages, and form labels. Route paths must also be in Spanish (ASCII, kebab-case, no accent characters). Code identifiers stay in English.
- The app is **mobile-first and responsive**: it must work well from phone (~360px) to desktop.
  - Write base styles for mobile, then layer larger screens with Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`). Don't write desktop styles and override them downward.
  - No horizontal scrolling at any width. Wide content (e.g., sales report tables) scrolls inside its own container or collapses into a card/stacked layout on small screens.
  - Touch targets are at least 44×44px. Don't rely on hover for essential actions.
  - Check each new page at phone, tablet and desktop widths before considering it done.
- Better Auth is used exclusively for auth and security. The database is hosted on https://neon.com/
- The Better Auth schema is defined in `db/auth_schema.sql`.
- Auto sign-in after email verification is **disabled** — users must log in manually after verifying
- The MySQL connection module in `lib/db/mysql.ts` is used to access the business database
- Forms are built using [React Hook Form](https://ui.shadcn.com/docs/forms/react-hook-form).

## What This Kit Contains

This repository is a guide plus the files to drop into a freshly scaffolded app. Copy them after step 3 of [Project Scaffolding](#project-scaffolding).

| Kit path                                              | Copy to (new project)                                            | Purpose                                                                 |
| :---------------------------------------------------- | :--------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `lib/auth.ts`, `lib/auth-client.ts`, `lib/session.ts` | `lib/`                                                           | Better Auth server/client config and cached `getSession()`              |
| `lib/email.ts`                                        | `lib/`                                                           | Nodemailer transport + Spanish verification/reset emails                |
| `lib/safe-action.ts`                                  | `lib/`                                                           | `actionClient` / `diagnosticActionClient`                               |
| `lib/db/*`                                            | `lib/db/`                                                        | Database connection modules (see [Database modules](#database-modules)) |
| `db/auth_schema.sql`                                  | `db/`                                                            | Better Auth schema for Neon                                             |
| `db/readonly-users.sql`                               | `db/`                                                            | SELECT-only users for the agent's database MCP                          |
| `scripts/*`                                           | `scripts/`                                                       | `db:setup` and the `db:check-*` smoke checks                            |
| `tests/`, `vitest.config.ts`                          | project root                                                     | Unit tests for the db modules                                           |
| `env.example`                                         | project root, then `cp env.example .env.local`                   | All environment variables                                               |
| `templates/AGENTS.md`                                 | append to `AGENTS.md` (below the Next.js block)                  | Always-loaded project rules                                             |
| `templates/CLAUDE.md`                                 | `CLAUDE.md` (if not already importing `AGENTS.md`)               | Claude Code entry point                                                 |
| `templates/mcp.json`                                  | `.mcp.json` (Claude Code) or your agent's MCP config             | Database MCP config                                                     |
| `skills/*`                                            | `.claude/skills/` (Claude Code) or your agent's skills directory | Agent skills                                                            |
| `docs/db-modules/*`                                   | `docs/db-modules/`                                               | Design notes and testing reports for the db modules                     |

```bash
# From the new project's root, with the kit checked out next to it:
KIT=../next-ai-agent-setup
mkdir -p lib/db db scripts tests .claude/skills docs
cp -R $KIT/lib/. lib/ && cp -R $KIT/db/. db/ && cp -R $KIT/scripts/. scripts/
cp -R $KIT/tests/. tests/ && cp $KIT/vitest.config.ts . && cp -R $KIT/docs/. docs/
cp $KIT/env.example . && cp env.example .env.local
cp -R $KIT/skills/. .claude/skills/
cp $KIT/templates/mcp.json .mcp.json
cat $KIT/templates/AGENTS.md >> AGENTS.md
```

## Project Scaffolding

The base app is created with the shadcn preset, which might install a Next.js version behind the official release. Upgrading immediately after scaffolding is standard procedure.

```bash
# 1. Scaffold the base app with the shadcn preset
npx shadcn@latest init --preset b38nGZAAa --template next --pointer

# 2. Add the shadcn/ui form primitives, then install the resolver and schema library
npx shadcn@latest add form input button

# 3. Add dependencies
npm install @hookform/resolvers better-auth zod pg mysql2 mssql next-safe-action nodemailer
npm install -D @types/pg @types/mssql @types/nodemailer tsx vitest

# 4. Copy the kit files (see "What This Kit Contains"), fill in .env.local,
#    add "type", "engines" and the scripts from "Commands" to package.json,
#    then create the auth schema:
npm run db:setup && npm run db:check

# 5. Setup Git
git init
git commit -m "Initial commit."
git remote add origin https://github.com/drlorenesi/project-name.git
git branch -M main
git push -u origin main

# 6. Upgrade Next.js, React, react-dom, and eslint-config-next together.
#    Available since Next.js 16.1 — no @next/codemod needed on this path.
npx next upgrade

# 7. Verify the upgrade
npm run typecheck && npm run build && npm test
```

## Commands

```bash
# Development
npm run dev          # Start dev server with Turbopack
npm run build        # Production build (uses webpack)
npm run start        # Start production server

# Code quality
npm run lint         # ESLint
npm run format       # Prettier (with Tailwind CSS plugin)
npm run typecheck    # TypeScript type checking
npm test             # Vitest unit tests (no database needed)

# Database
npm run db:setup           # Apply db/auth_schema.sql to Neon (idempotent)
npm run db:check           # Smoke-check every configured database
npm run db:check-postgres  # lib/db/postgres.ts (direct Neon endpoint, Better Auth)
npm run db:check-mysql     # lib/db/mysql.ts
npm run db:check-mssql     # lib/db/mssql.ts
```

Add these to `package.json`:

```json
"type": "module",
"engines": { "node": ">=22.18" },
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "db:setup": "node --env-file-if-exists=.env.local scripts/setup-db.ts",
  "db:check": "tsx --env-file-if-exists=.env.local scripts/check-db.ts",
  "db:check-postgres": "tsx --env-file-if-exists=.env.local scripts/check-postgres.ts",
  "db:check-mysql": "tsx --env-file-if-exists=.env.local scripts/check-mysql.ts",
  "db:check-mssql": "tsx --env-file-if-exists=.env.local scripts/check-mssql.ts"
}
```

`"type": "module"` makes every `.js`/`.ts` file an ES module. The shadcn/Next.js scaffold already uses ESM configs (`next.config.ts`, `*.config.mjs`). If you add a config that uses `module.exports`, name it `.cjs`.

### Script conventions

Scripts are TypeScript and use Node's built-in features instead of extra packages:

- **Node runs TypeScript natively** (type stripping, on by default since Node 22.18). Scripts that don't import from `lib/` run with plain `node`, such as `db:setup`. These scripts may only use TypeScript syntax that can simply be deleted: no `enum`, no namespaces, no constructor parameter properties. `erasableSyntaxOnly` in `tsconfig.json` enforces this.
- **Scripts that import `lib/` run with `tsx`.** That covers the `db:check-*` scripts. The `lib/` modules use extensionless relative imports (`from "./db-types"`), the Next.js bundler style, and plain Node can't resolve those. `tsx` can, and it also understands the `@/` alias.
- **`.env.local` is loaded with `--env-file-if-exists`.** Node and `tsx` both accept this flag, so `dotenv` isn't needed. The file loads before any module runs, so scripts can import `lib/db` modules statically.
- **No `.mjs` / `.mts` for scripts.** `"type": "module"` in `package.json` makes plain `.ts`/`.js` files ES modules, so the extension doesn't need to say so. Use `import.meta.dirname` instead of the `fileURLToPath(import.meta.url)` workaround.
- **Node's type stripping doesn't type-check.** `npm run typecheck` covers `scripts/` too.

## Tech Stack

| Area       | Choice                                                                                                                                                                                                                                                                                            |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework  | [Next.js](https://nextjs.org/) 16.4 (App Router, RSC)                                                                                                                                                                                                                                             |
| UI         | React 19.3                                                                                                                                                                                                                                                                                        |
| Styling    | Tailwind CSS v4 (CSS-first config in `app/globals.css`)                                                                                                                                                                                                                                           |
| Components | [shadcn/ui](https://ui.shadcn.com/) (`base-mira` style, built on Base UI)                                                                                                                                                                                                                         |
| Icons      | [lucide-react](https://lucide.dev/)                                                                                                                                                                                                                                                               |
| Theming    | [next-themes](https://github.com/pacocoursey/next-themes) (light / dark / system)                                                                                                                                                                                                                 |
| Tooling    | TypeScript 6, ESLint 9, Prettier (with Tailwind class sorting), Vitest, tsx                                                                                                                                                                                                                       |
| Forms      | **Zod v4** + **react-hook-form** + **next-safe-action** for type-safe server actions and forms. Two action clients in `lib/safe-action.ts`: `actionClient` (user-facing, returns a generic Spanish error) and `diagnosticActionClient` (internal diagnostics only, passes the real error through) |
| Database   | **mysql2**, **pg**, **mssql** for database access — see the Database modules section below                                                                                                                                                                                                        |
| Auth       | https://better-auth.com/ - Custom user fields: `firstName`, `lastName` (set at registration, stored by Better Auth). Admin plugin enabled (`role`, ban fields, impersonation)                                                                                                                     |

### Forms Pattern

Forms live alongside their page as a separate `*-form.tsx` client component. Use `useForm` + Zod schema + `Controller` for complex inputs (date pickers, checkboxes). Validation messages and labels are in Spanish. The full pattern is in the `server-action-form` skill.

### Database modules

Three TCP connection modules in `lib/db/` share the same pattern: lazy singleton pool, HMR-safe global cache in dev (`global.__*` variable), prod-only shutdown handlers, Zod env validation at first use, and `*_SSL_CA` / `*_SSL_INSECURE` env overrides for TLS.

| Module               | Exported API                                                | Env vars                                 |
| :------------------- | :---------------------------------------------------------- | :--------------------------------------- |
| `lib/db/mysql.ts`    | `getPool()`, `getConnection(ms?)`, `runQuery()`, `escapeId` | `MYSQL_HOST/PORT/DATABASE/USER/PASSWORD` |
| `lib/db/postgres.ts` | `getPool()`, `getConnection(ms?)`, `runQuery()`             | `DATABASE_URL`                           |
| `lib/db/mssql.ts`    | `getPool()` **(async — must `await`)**, `runQuery()`        | `MSSQL_HOST/PORT/DATABASE/USER/PASSWORD` |

SQL Server has no `getConnection()` helper — callers use `(await getPool()).request().query(...)` directly. See `env.example` for all required variables and optional SSL overrides.

Every module also exports `runQuery(sql, params?)`, which returns the driver-agnostic `QueryOutcome` defined in `lib/db/db-types.ts` (`kind: "rows"` or `kind: "ok"`, every cell a `string | null`). See [docs/db-modules/query-abstraction.md](docs/db-modules/query-abstraction.md) for the design, and the testing reports in the same folder for each driver's provider quirks.

Better Auth uses the `lib/db/postgres.ts` pool (`database: getPool()` in `lib/auth.ts`), so `DATABASE_URL` must be Neon's **direct** endpoint.

#### Why there is no Neon serverless module

An earlier version of the kit had a fourth module, `lib/db/postgres-neon.ts`. It used `@neondatabase/serverless` over WebSockets, read `NEON_DATABASE_URL` (Neon's pooled `-pooler` endpoint) and opened a new pool for every request, so it could run on serverless and edge runtimes. It was removed because `lib/db/postgres.ts` covers every Neon connection this architecture makes:

- **Postgres only holds auth data.** Business data lives in MySQL / SQL Server, and auth tables are only accessed through Better Auth, which already uses `postgres.ts`. Nothing imported `postgres-neon.ts` except its own smoke check and tests.
- **`postgres.ts` already handles Neon's quirks.** TLS comes from `sslmode` in `DATABASE_URL`. The `SET`-on-connect handler works around Neon dropping timeout startup parameters. The 10 s connect timeout covers compute cold starts, and the idle-error listener survives Neon closing connections when compute suspends. The details are in [docs/db-modules/postgres-testing-report.md](docs/db-modules/postgres-testing-report.md).
- **The serverless module gave up safety guarantees.** On the pooled endpoint, `statement_timeout` and `idle_in_transaction_session_timeout` don't persist, so it needed role-level defaults (`ALTER ROLE … SET …`) to be safe. It also had no `runQuery()`, so it didn't fit the [`QueryOutcome` abstraction](docs/db-modules/query-abstraction.md).
- **The deployment target is a long-running Node server.** A local SQL Server and a persistent TCP pool both point to a container or VM, not edge functions.

`postgres.ts` assumes:

1. **Node.js runtime with TCP sockets.** Don't import it from code that runs on the Edge runtime.
2. **Neon's direct endpoint** (no `-pooler` in the hostname). `npm run db:check-postgres` warns if it sees a pooler host.
3. **A long-lived process** (a container, VM, or a serverless platform that reuses instances, such as Vercel Fluid compute). On per-request serverless, each instance opens its own pool of up to 10 connections. That can exhaust Neon's direct-endpoint connection limit (about 100 on small compute sizes).

If a future deployment breaks one of these assumptions (for example, Postgres queries on edge functions), bring back a WebSocket module with `@neondatabase/serverless`. Point it at the pooled endpoint, set the timeouts as role defaults, and give it `runQuery()` so it matches the other modules.

## Basic Project Structure

```
app/
  layout.tsx          Root layout: fonts (Inter, Geist Mono) and ThemeProvider
  globals.css         Tailwind imports, theme tokens (CSS variables), dark variant
app/(auth)/ — Public auth pages: login, registro, email verification, password reset
app/(main)/ — Protected dashboard and feature modules:
	/admin — User management (admin only)
	/bds — Database tools: explorador (schema browser), consultas (SQL runner), diagnosticos (pool/server health)
app/api/auth/[...all]/ — Better Auth catch-all handler
components/
  theme-provider.tsx  next-themes wrapper and the "d" dark-mode hotkey
  ui/                 shadcn/ui components (generated, safe to edit)
hooks/                Custom React hooks
lib/
  utils.ts            cn() helper for merging class names
  auth.ts, auth-client.ts, session.ts, email.ts, safe-action.ts
  db/                 mysql.ts, postgres.ts, mssql.ts, db-types.ts
db/                   SQL: auth schema, read-only agent users
scripts/              db:setup (plain node) and db:check-* (tsx) scripts
tests/                Vitest unit tests
docs/                 Design notes and testing reports
public/               Static assets
components.json       shadcn/ui configuration
```

Imports use the `@/` alias for the project root, for example `@/components/ui/button`.

## Testing

There are two layers, and they answer different questions:

| Layer               | Command            | Needs a DB?             | Answers                                                                                                                                                                       |
| :------------------ | :----------------- | :---------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (Vitest) | `npm test`         | No — drivers are mocked | Is each module configured correctly? (env validation, TLS options, pool sizing, precision flags, singleton/HMR behavior, timeout and release paths, `runQuery` normalization) |
| Smoke checks        | `npm run db:check` | Yes — uses `.env.local` | Does it work against the real server? (connectivity, server version, BIGINT precision, session timeouts / app name actually applied, pool concurrency, acquire timeout)       |

- Run `npm test` after any change in `lib/`. Run `npm run db:check` on a new machine, after changing `.env.local`, or before debugging "the query is broken" (it's often the connection).
- `db:check` runs only the databases whose variables are set and skips the rest. Each `db:check-*` exits non-zero on failure and prints a hint for common errors (refused connection, bad credentials, untrusted certificate, wrong Neon endpoint).
- Checks that need server introspection or Docker fixtures (SIGINT shutdown, `performance_schema`, killed connections) are documented as future work in the testing reports under `docs/db-modules/`.

## Tooling Philosophy: MCP Servers vs. Skills

The dividing rule:

- **Convention → Skills.** Static patterns, API usage, project rules. Near-zero context cost until a relevant task triggers them.
- **Live data → MCP.** Database schemas, running-server state. Tool definitions load into **every** session, so each MCP server must earn its per-session context cost.
- **One-off facts → look up directly** (bash, CLI, docs). No standing tooling required.

Framework _knowledge_ reaches agents through the auto-managed `AGENTS.md` block pointing at version-matched bundled docs in `node_modules/next/dist/docs/` — no knowledge skills or knowledge-base MCP tools are installed for this. Skills are reserved for multi-step **workflows** and **library conventions**; MCP is reserved for **live tooling** that bash can't cover cleanly.

## Skills & Rule Architecture

Agent instructions live in three layers, from always-loaded to on-demand. Put each rule in the cheapest layer that still gets it applied.

| Layer     | File(s)                                  | Loaded                                        | Holds                                                                                                        |
| :-------- | :--------------------------------------- | :-------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| 1. Rules  | `AGENTS.md` (+ `CLAUDE.md` importing it) | Every session                                 | Short, non-negotiable rules: Spanish UI, mobile-first, auth/business DB split, "run typecheck after changes" |
| 2. Skills | `skills/<name>/SKILL.md`                 | When a task matches the skill's `description` | Step-by-step workflows and library conventions, with code templates and checklists                           |
| 3. MCP    | `.mcp.json`                              | Tool list every session; data on demand       | Live state: database schemas and data                                                                        |

**Rule of thumb:** if a rule matters on every task, it goes in `AGENTS.md` in one line. If it only matters for a kind of task (building a form, writing SQL), it goes in a skill. If `AGENTS.md` grows past ~60 lines, move detail into skills.

### AGENTS.md and CLAUDE.md

- `AGENTS.md` is the tool-agnostic entry point; most coding agents read it. The top block is managed by `next dev` — leave it alone and append the project rules from `templates/AGENTS.md` below it.
- `CLAUDE.md` contains just `@AGENTS.md`, so Claude Code reads the same rules. Don't duplicate rules between the two files.

### Skill format

A skill is a folder with a `SKILL.md` file (the open Agent Skills format):

```markdown
---
name: db-query
description: Write SQL against the app's databases using the lib/db modules ... Use for any server code that reads or writes business data.
---

# Instructions the agent follows once the skill is triggered
```

- The `description` is the only part the agent sees before deciding to load the skill, so it says **what** the skill does and **when** to use it, with the words a request would actually contain ("form", "page", "query", "responsive").
- Keep the body procedural: file layout, a code template, a checklist. Reference project files by path instead of pasting them.
- **Where they go:** Claude Code loads project skills from `.claude/skills/<name>/SKILL.md`. Other agents that support the Agent Skills format have their own skills directory (check their docs). For an agent without skill support, list the skill paths in `AGENTS.md` ("before building a form, read `skills/server-action-form/SKILL.md`").

### Included skills

| Skill                | Triggers on                    | What it enforces                                                                                                                                                                  |
| :------------------- | :----------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server-action-form` | Adding or changing a form      | Shared Zod schema, `*-form.tsx` with react-hook-form + `Controller`, `actionClient` action with session re-check, Spanish messages, pending/error states                          |
| `db-query`           | Any SQL / data access          | Which `lib/db` module to use, placeholder syntax per dialect, `release()` discipline, identifier quoting, string-typed BIGINT/DECIMAL, built-in timeouts; never query auth tables |
| `new-feature-module` | New page, section, or report   | Spanish kebab-case route under `app/(main)/`, session/role guard, file layout, nav entry                                                                                          |
| `responsive-check`   | Before finishing any UI change | 360 / 768 / 1280 px checklist, no horizontal scroll, 44px targets, no hover-only actions, both themes                                                                             |

Add a skill when you notice yourself correcting the agent on the same thing twice. Edit an existing one when its output drifts from what you want.

## MCP Servers

Only one kind of MCP server is recommended: a **read-only database MCP**, so the agent can look at real schemas and sample data instead of guessing column names. Everything else (framework docs, component APIs) is covered by bundled docs, skills, or the CLI.

### Safety rules

1. **Dev/staging databases only.** Never point an agent at production.
2. **Read-only at the database level.** Create the SELECT-only `agent_ro` users from `db/readonly-users.sql`. An MCP server's own "read-only mode" is not enough on its own: several SQL MCP servers have shipped bypasses, such as multi-statement input that commits a write. With a SELECT-only user, a bypass can't change anything.
3. **No auth data.** The Neon auth database holds password hashes and session tokens. The agent doesn't need them, and per the architecture rule it shouldn't query auth tables at all.
4. **Secrets stay in env vars.** Reference them from the MCP config (`${MCP_MYSQL_URL}`) and never commit them.

### Postgres / Neon — official Neon MCP server

`templates/mcp.json` configures Neon's hosted server in read-only mode:

```json
{
  "mcpServers": {
    "neon": { "type": "http", "url": "https://mcp.neon.tech/mcp?readonly=true" }
  }
}
```

- It authenticates with OAuth on first use. In Claude Code, run `/mcp` and choose `neon` to sign in, and pick the read-only scope when asked.
- In read-only mode it can list projects and branches, describe schemas, and run `SELECT`s (`run_sql` in a read-only transaction). Creating branches, migrations, and `get_connection_string` are disabled.
- Its reach is your **Neon account**, not a single database. Use a Neon account or organization that only contains dev projects, or drop the server once the auth schema is stable. The auth DB rarely needs inspection.

Claude Code CLI equivalent: `claude mcp add --transport http --scope project neon "https://mcp.neon.tech/mcp?readonly=true"`.

### MySQL and SQL Server — choosing a server

As of this writing there is no official read-only MCP server from MySQL/Oracle or from Microsoft for SQL Server, only community projects. Pick one that:

- is actively maintained, with recent releases and responses to issues;
- runs locally over stdio, so the connection string never leaves your machine;
- validates SQL (a single statement, SELECT only) **and** recommends a read-only DB user;
- takes its credentials from environment variables.

Then add it to `.mcp.json` next to `neon`, using the `agent_ro` credentials:

```json
"business-db": {
  "command": "npx",
  "args": ["-y", "<chosen-mysql-mcp-package>"],
  "env": { "DATABASE_URL": "${MCP_MYSQL_URL}" }
}
```

Test it before trusting it. Ask the agent to run `INSERT`/`UPDATE` and `SELECT 1; DROP TABLE x` against a scratch table: both must fail with a permission error from the database itself.

### When the MCP is not the right tool

- **"Does my connection work?"** → `npm run db:check`, not the MCP (the MCP uses different credentials).
- **One-off question about a table** → if the MCP isn't configured, the agent can write a throwaway script using `runQuery` from `lib/db` and run it with `npx tsx --env-file=.env.local tmp.ts`. Delete it afterwards.

## Daily Development Session Workflow

A repeatable routine for working with an AI agent. It is written so any agent can follow it; Claude Code specifics are in parentheses.

### 1. Start (≈5 min)

```bash
git switch main && git pull
git switch -c feat/<short-description>      # one branch per task
npm install                                 # if package-lock.json changed
npm run dev
```

- Run `npm run db:check` if anything database-related misbehaved last session or `.env.local` changed.
- Start a **fresh agent session** for each task. Long sessions accumulate stale context, and a clean start with a good prompt beats a long thread.

### 2. Plan

- Describe the task in terms of outcome, Spanish route name, and who uses it, e.g. "Página `reportes-ventas` para admins: ventas por mes con filtro de fechas, tabla que en móvil se vuelve tarjetas."
- For anything beyond a small fix, ask for a **plan first** and review it before any code is written (Claude Code: plan mode, `Shift+Tab`). Check that it:
  - uses the right `lib/db` module and doesn't touch auth tables;
  - puts files where `new-feature-module` says;
  - names the skills it will follow.
- Correct the plan, not the code. A wrong plan is cheap to fix.

### 3. Build

- Let the agent implement in small steps, running `npm run typecheck && npm run lint` after each one (already in `AGENTS.md`).
- When it gets a convention wrong, correct it once in the chat. If it's the second time, update the relevant skill or `AGENTS.md` instead (see step 6).
- Keep the browser open on the page being built and check it at phone width as you go, not only at the end.

### 4. Verify

- `npm test` (when `lib/` changed) and `npm run build` before you push. The production build catches things `dev` doesn't.
- Run the `responsive-check` skill on every page touched: 360 / 768 / 1280 px, both themes.
- Read all new user-facing text: Spanish, consistent tone, no English left in error paths.
- Try the unhappy paths yourself: signed out, non-admin role, invalid form input, empty results.

### 5. Review

- Ask the agent for a review of the full diff against `main` in a **fresh session**, so it isn't reviewing its own reasoning (Claude Code: `/code-review`). Focus it on security (session/role checks in actions, SQL placeholders) and the project rules.
- Then skim the diff yourself: `git diff main --stat`, then the files that matter.

### 6. Wrap up

```bash
git add -A && git commit -m "feat: <what changed>"
git push -u origin HEAD                        # open a PR, merge when green
```

- **Feed lessons back** (2 min, the step that makes tomorrow faster):
  - The agent repeated a mistake → add one line to `AGENTS.md` or fix the skill.
  - You explained a multi-step procedure → it's a candidate for a new skill.
  - A database quirk surprised you → note it in the module's testing report under `docs/db-modules/`.
- Leave a one-line note in the PR or an issue for where to pick up tomorrow.
