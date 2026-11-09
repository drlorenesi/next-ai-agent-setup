# Next.js App Setup & AI Agent Guide

- **Primary editor:** VS Code
- **AI assistant:** Claude Code (the rules and skills also work with other agents that read `AGENTS.md` and the Agent Skills format)
- **Framework:** Next.js 16.4 (App Router)
- **Last update:** November 8, 2026

This repository is a blueprint plus drop-in files for a new Next.js app built with an AI coding agent. It gives you three things:

1. **An architecture** to build on: auth isolated on Neon Postgres, business data in MySQL and/or SQL Server through raw SQL modules, and a Spanish, mobile-first UI.
2. **The agent skills** that matter for this stack: which vendor skills to install, which to add only when a trigger applies, and the project skills this kit ships.
3. **MCP configuration, only if necessary.** The default is no MCP servers. Section 7 explains when one is worth its cost and how to add it safely.

---

## 1. Architecture

This is a high-performance, mobile-first, responsive web application built with Next.js 16. The design separates authentication infrastructure from business data to improve security and maintainability and to keep the server runtime simple.

### Principle: dual-database isolation

- **Better Auth on Neon Postgres** manages user identity, authentication tokens and sessions, and nothing else.
- **Railway MySQL and/or a local SQL Server** hold all business data (sales reports, products, orders, invoices) and are accessed through custom connection modules in `lib/db/`. There is no ORM: no Drizzle, Prisma or Kysely.
- **Schema language:** the business database schema is in Spanish. The Better Auth schema stays in English.

**Isolation corollary:** application code never queries auth tables directly. It goes through Better Auth (`auth.api.*`, `getSession()`). No agent tooling gets standing access to the auth database either. See [Section 7](#7-mcp-servers-only-if-necessary).

### Product rules

- **Spanish UI.** All user-facing text is Spanish: UI, emails, error messages, form labels. Route paths are Spanish too (ASCII, kebab-case, no accents, e.g. `reportes-ventas`). Code identifiers stay in English.
- **Mobile-first and responsive**, from phone (~360px) to desktop:
  - Write base styles for mobile, then add larger screens with Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`). Don't write desktop styles and override them downward.
  - No horizontal page scroll at any width. Wide content, such as sales report tables, scrolls inside its own container or turns into stacked cards on small screens.
  - Touch targets are at least 44×44px. Don't rely on hover for essential actions.
  - Check each new page at phone, tablet and desktop widths before calling it done.
- **Auth behavior.** Auto sign-in after email verification is **disabled**: users log in manually after verifying. Custom user fields `firstName` and `lastName` are required at registration (and when an admin creates a user); a database trigger keeps `name` set to "firstName lastName". The admin plugin is enabled (`role`, ban fields, impersonation). Only email domains listed in `AUTH_ALLOWED_EMAIL_DOMAINS` can self-register; admins can create any user.

### Security

The app runs on a public URL and reads business data, so the kit ships these defaults:

- **No indexing.** `next.config.ts` sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on every response, and `app/robots.ts` serves `Disallow: /`. Both only stop well-behaved crawlers. Scanners and credential-stuffing bots ignore them, so they are not protection.
- **Sign-up allowlist.** A Better Auth `before` hook in `lib/auth.ts` rejects `/sign-up/email` unless the email's domain exactly matches an entry in `AUTH_ALLOWED_EMAIL_DOMAINS` (parsed by `lib/auth-allowlist.ts`). An empty list means nobody can self-register. Don't add public providers like `@gmail.com`: that opens sign-up to anyone. Adding social providers or `user.changeEmail` means extending the check.
- **Rate limiting** (`lib/auth.ts`). Better Auth counts requests per client IP and endpoint, stored in the `rateLimit` table: 100 per minute by default, 5 for sign-in, and 3 for sign-up and for each endpoint that sends an email (password reset, verification). Only requests through the `/api/auth` route count, so sign-in, sign-up and reset forms must use `authClient`, never a server action calling `auth.api.*` (a rule in `AGENTS.md`). `npm run db:cleanup` deletes stale rate-limit rows and expired sessions and verification tokens; schedule it daily.
- **Security headers** (`next.config.ts`): HSTS, `Referrer-Policy: no-referrer` (verification and reset links carry tokens), `X-Frame-Options: DENY`, `nosniff`, a restrictive `Permissions-Policy`, a CSP without `script-src` (`frame-ancestors`, `base-uri`, `form-action`, `object-src`), and `poweredByHeader: false`. A nonce-based script CSP is left out because it makes every page render dynamically.
- **No caching of business data.** Pages that call `getSession()` render dynamically and are sent with `no-store`. Don't put business data behind `"use cache"` or static rendering.
- **Diagnostics are admin-only.** `diagnosticActionClient` rejects non-admin sessions and returns raw error text only outside production.

Not covered by the kit, and worth doing before going live:

- A network gate in front of the app (Cloudflare Access, a VPN or Tailscale, or at least a WAF with bot protection). Rate limiting reads the client IP from `x-forwarded-for`, which is only trustworthy when a proxy overwrites it (Vercel does). Behind another proxy, uncomment `advanced.ipAddress.ipAddressHeaders` in `lib/auth.ts` and name the header it sets (e.g. `cf-connecting-ip`). On a server exposed directly, clients can fake the header and skip the limits.
- A least-privilege business database user for the app (SELECT on the tables or views it needs), and database ports firewalled to the app server.
- Logging and alerts on failed sign-ins.

### Tech stack

| Layer                | Technology                                                                            | Hosting / provider                                       | Agent integration                                                      |
| :------------------- | :------------------------------------------------------------------------------------ | :------------------------------------------------------- | :--------------------------------------------------------------------- |
| Framework            | Next.js 16.4 (App Router, RSC), React 19.3                                            | Node.js runtime (container, VM, or Vercel Fluid compute) | Version-matched docs via the `AGENTS.md` block that `next dev` manages |
| UI & styling         | shadcn/ui (`base-mira` style, on Base UI), Tailwind CSS v4, lucide-react, next-themes | Local component registry                                 | Official shadcn **skill**; semantic CSS tokens                         |
| Forms                | Zod v4 + react-hook-form + next-safe-action                                           | n/a                                                      | next-safe-action **skills** + the kit's `server-action-form` skill     |
| Authentication       | Better Auth                                                                           | Neon Postgres (direct endpoint)                          | Better Auth **skills**. Isolated: no MCP; `npm run db:check-postgres` or `psql` for checks |
| Business data        | Raw SQL via `mysql2` / `mssql`                                                        | Railway MySQL and/or local SQL Server                    | Kit's `db-query` **skill**; optional read-only database **MCP**        |
| Compilation checks   | Next.js dev server (`/_next/mcp`)                                                     | Local (`next dev`)                                       | Used by the `next-dev-loop` skill; optional Next.js DevTools **MCP**   |
| Runtime verification | agent-browser + `next-dev-loop`                                                       | Local (global npm install)                               | The agent drives a real browser: DOM, console, network, React tree     |
| Tooling              | TypeScript, ESLint, Prettier (Tailwind class sorting), Vitest                         | Local                                                    | `npm run typecheck`, `lint`, `test` after each change                  |

### Project structure

```
app/
  layout.tsx          Root layout: fonts (Inter, Geist Mono) and ThemeProvider
  globals.css         Tailwind imports, theme tokens (CSS variables), dark variant
  (auth)/             Public auth pages: iniciar-sesion, registro, verificar-correo,
                      recuperar-contrasena, restablecer-contrasena (see Routes)
  (main)/             Protected dashboard and feature modules
    admin/            User management (admin only)
    bds/              Database tools: explorador (schema browser), consultas (SQL runner),
                      diagnosticos (pool/server health)
  api/auth/[...all]/  Better Auth catch-all handler
components/
  theme-provider.tsx  next-themes wrapper and the "d" dark-mode hotkey
  ui/                 shadcn/ui components (generated, safe to edit)
hooks/                Custom React hooks
lib/
  utils.ts            cn() helper for merging class names
  auth.ts             Better Auth server config (server actions, route handlers)
  auth-client.ts      Better Auth client (client components only)
  session.ts          Cached getSession()
  email.ts            Nodemailer transport + Spanish verification/reset emails
  auth-allowlist.ts   Sign-up email-domain allowlist
  safe-action.ts      actionClient / diagnosticActionClient (admin-only)
  db/                 mysql.ts, postgres.ts, mssql.ts, db-types.ts
db/                   SQL: auth schema, read-only agent users
scripts/              db:setup, db:cleanup and db:check-* (plain node)
tests/                Vitest unit tests
docs/                 Design notes and testing reports
```

App code imports with the `@/` alias, e.g. `@/components/ui/button`. Server code imports `@/lib/auth`; client code imports `@/lib/auth-client`, never the other way round.

### Routes

Page URLs are Spanish, ASCII and kebab-case. `ñ` becomes `n` and accents are dropped, as in `contrasena`. The auth pages live in `app/(auth)/`:

| Route                               | Page                                     | Reached from                                                          |
| :---------------------------------- | :--------------------------------------- | :-------------------------------------------------------------------- |
| `/iniciar-sesion`                   | Sign in                                  | Guards in protected pages: `redirect("/iniciar-sesion")`              |
| `/registro`                         | Self-registration (allowlisted domains)  | Link from `/iniciar-sesion`                                           |
| `/verificar-correo?token=…`         | Confirms the email address               | Verification email (`sendVerificationEmail` in `lib/auth.ts`)         |
| `/recuperar-contrasena`             | Asks for a password-reset email          | "¿Olvidaste tu contraseña?" link on `/iniciar-sesion`                 |
| `/restablecer-contrasena?token=…`   | Sets a new password                      | Password-reset email (`sendResetPassword` in `lib/auth.ts`)           |

- **The email links are built in `lib/auth.ts`**, from `NEXT_PUBLIC_APP_URL`, the page path and the token. If you rename `verificar-correo` or `restablecer-contrasena`, change the link there too, or the emails will point to a 404.
- **`/verificar-correo`** reads `token` and calls `authClient.verifyEmail({ query: { token } })`. Auto sign-in is off, so on success it links to `/iniciar-sesion`.
- **`/restablecer-contrasena`** reads `token` and calls `authClient.resetPassword({ newPassword, token })`. An invalid or expired token only shows up when the form is submitted, so show Better Auth's error and link back to `/recuperar-contrasena`.
- **Better Auth's own endpoints keep their English paths** under `/api/auth/*` (`/sign-in/email`, `/request-password-reset`, …). They are API routes, not pages, and the rate-limit rules and sign-up hook in `lib/auth.ts` match those exact paths, so don't translate them.

### Forms

Forms live next to their page as a separate `*-form.tsx` client component: a shared Zod schema, `useForm` with `Controller` for complex inputs (date pickers, checkboxes), and an action built on `actionClient` from `lib/safe-action.ts` that re-checks the session. Labels and validation messages are in Spanish. `lib/safe-action.ts` has two clients:

- `actionClient`: user-facing. It returns a generic Spanish error.
- `diagnosticActionClient`: internal diagnostics only. Admin-only; it passes the real error through outside production and the generic message in production.

The full pattern is in the `server-action-form` skill.

### Database modules

Three TCP connection modules in `lib/db/` share one pattern: a lazy singleton pool, an HMR-safe global cache in dev, shutdown handlers in production, Zod validation of env vars on first use, and `*_SSL_CA` / `*_SSL_INSECURE` overrides for TLS.

| Module               | Exported API                                                | Env vars                                 |
| :------------------- | :---------------------------------------------------------- | :--------------------------------------- |
| `lib/db/mysql.ts`    | `getPool()`, `getConnection(ms?)`, `runQuery()`, `escapeId` | `MYSQL_HOST/PORT/DATABASE/USER/PASSWORD` |
| `lib/db/postgres.ts` | `getPool()`, `getConnection(ms?)`, `runQuery()`             | `DATABASE_URL`                           |
| `lib/db/mssql.ts`    | `getPool()` **(async: must `await`)**, `runQuery()`         | `MSSQL_HOST/PORT/DATABASE/USER/PASSWORD` |

- `runQuery(sql, params?)` returns the driver-agnostic `QueryOutcome` from `lib/db/db-types.ts`: `kind: "rows"` or `kind: "ok"`, with every cell a `string | null`. See [docs/db-modules/query-abstraction.md](docs/db-modules/query-abstraction.md).
- SQL Server has no `getConnection()` helper. Callers use `(await getPool()).request().query(...)`.
- Better Auth uses the `postgres.ts` pool (`database: getPool()` in `lib/auth.ts`), so `DATABASE_URL` must be Neon's **direct** endpoint, with no `-pooler` in the hostname.
- The testing reports in [docs/db-modules/](docs/db-modules/) record each driver's provider quirks.

**Why there's no Neon serverless module.** An earlier version had `lib/db/postgres-neon.ts` (`@neondatabase/serverless` over WebSockets, pooled endpoint). It was removed because Postgres only holds auth data, Better Auth already uses `postgres.ts`, and the pooled endpoint drops the session timeouts the modules rely on. `postgres.ts` therefore assumes:

1. **A Node.js runtime with TCP sockets.** Don't import it from Edge runtime code.
2. **Neon's direct endpoint.** `npm run db:check-postgres` warns if it sees a pooler host.
3. **A long-lived process**: a container, a VM, or a platform that reuses instances, such as Vercel Fluid compute. On per-request serverless, every instance opens a pool of up to 10 connections and can exhaust Neon's direct-endpoint limit (about 100 on small compute sizes).

If a deployment ever breaks one of these, bring back a WebSocket module on the pooled endpoint. Set the timeouts as role defaults (`ALTER ROLE … SET …`) and give it `runQuery()` so it matches the other modules.

---

## 2. What this kit contains

| Kit path                                              | Copy to (new project)                                                         | Purpose                                                    |
| :---------------------------------------------------- | :---------------------------------------------------------------------------- | :--------------------------------------------------------- |
| `lib/auth.ts`, `lib/auth-client.ts`, `lib/session.ts` | `lib/`                                                                        | Better Auth server/client config and cached `getSession()` |
| `lib/email.ts`                                        | `lib/`                                                                        | Nodemailer transport + Spanish verification/reset emails   |
| `lib/auth-allowlist.ts`                               | `lib/`                                                                        | Sign-up email-domain allowlist (used by `lib/auth.ts`)     |
| `lib/safe-action.ts`                                  | `lib/`                                                                        | `actionClient` / `diagnosticActionClient`                  |
| `app/robots.ts`                                       | `app/`                                                                        | `robots.txt` asking all crawlers to stay out               |
| `templates/next.config.ts`                            | `next.config.ts` (replaces the scaffold's)                                    | Security headers, `X-Robots-Tag`, `poweredByHeader: false` |
| `lib/db/*`                                            | `lib/db/`                                                                     | Database connection modules                                |
| `db/auth_schema.sql`                                  | `db/`                                                                         | Better Auth schema for Neon                                |
| `db/readonly-users.sql`                               | `db/`                                                                         | SELECT-only users, only needed if you add a database MCP   |
| `scripts/*`                                           | `scripts/`                                                                    | `db:setup`, `db:cleanup` and the `db:check-*` smoke checks  |
| `tests/`, `vitest.config.ts`                          | project root                                                                  | Unit tests for the db modules and the sign-up allowlist    |
| `.env.example`                                        | project root, then `cp .env.example .env.local`                               | All environment variables                                  |
| `templates/AGENTS.md`                                 | append to `AGENTS.md`, below the Next.js block                                | Always-loaded project rules                                |
| `templates/CLAUDE.md`                                 | `CLAUDE.md`                                                                   | Claude Code entry point (`@AGENTS.md`)                     |
| `skills/*`                                            | `.claude/skills/` (Claude Code) or your agent's skills directory              | Project skills                                             |
| `docs/db-modules/*`                                   | `docs/db-modules/`                                                            | Design notes and testing reports for the db modules        |

---

## 3. Project setup

The shadcn preset can install a Next.js version **behind** the official release, so upgrade right after scaffolding.

```bash
# 1. Scaffold the base app with the shadcn preset
npx shadcn@latest init --preset b38nGZAAa --template next --pointer

# 2. Upgrade Next.js, React, react-dom and eslint-config-next together
#    (available since Next.js 16.1; no @next/codemod needed), then verify
npx next upgrade
npm run typecheck && npm run build

# 3. Add the form primitives and dependencies
npx shadcn@latest add form input button
npm install @hookform/resolvers better-auth zod pg mysql2 mssql next-safe-action nodemailer
npm install -D @types/pg @types/mssql @types/nodemailer vitest

# 4. Boot the dev server once so `next dev` writes the managed block in
#    AGENTS.md (see Section 5). Stop it with Ctrl+C.
npm run dev

# 5. Copy the kit files (from the new project's root, kit checked out next to it)
KIT=../next-ai-agent-setup
mkdir -p lib/db db scripts tests .claude/skills docs
cp -R $KIT/lib/. lib/ && cp -R $KIT/db/. db/ && cp -R $KIT/scripts/. scripts/
cp -R $KIT/tests/. tests/ && cp $KIT/vitest.config.ts . && cp -R $KIT/docs/. docs/
cp $KIT/.env.example . && cp .env.example .env.local
cp $KIT/app/robots.ts app/ && cp $KIT/templates/next.config.ts next.config.ts
cp -R $KIT/skills/. .claude/skills/
cat $KIT/templates/AGENTS.md >> AGENTS.md
cp $KIT/templates/CLAUDE.md CLAUDE.md

# 6. Fill in .env.local, add the package.json and tsconfig.json settings
#    below, then create the auth schema and check every configured database
npm run db:setup && npm run db:check

# 7. Verify, then put it under Git
npm run typecheck && npm run build && npm test
git init && git add . && git commit -m "Initial commit."
git remote add origin https://github.com/<you>/<project-name>.git
git branch -M main
git push -u origin main
```

Upgrade notes:

- `next upgrade` may ask which codemods to apply. When an agent or CI runs it (no TTY), it runs non-interactively and accepts every default.
- It pairs React versions for you, so prefer it over editing `package.json` by hand. Manual fallback: `npm i next@latest react@latest react-dom@latest eslint-config-next@latest`.
- Projects on Next.js **< 16.1.0** use `npx @next/codemod@canary upgrade latest` instead.
- For later releases, commit first, re-run `npx next upgrade`, review the diff, and commit any `AGENTS.md` block update.

### package.json and tsconfig.json

Add to `package.json`:

```json
"type": "module",
"engines": { "node": ">=22.18" },
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "db:setup": "node --env-file-if-exists=.env.local scripts/setup-db.ts",
  "db:cleanup": "node --env-file-if-exists=.env.local scripts/cleanup-auth.ts",
  "db:check": "node --env-file-if-exists=.env.local scripts/check-db.ts",
  "db:check-postgres": "node --env-file-if-exists=.env.local scripts/check-postgres.ts",
  "db:check-mysql": "node --env-file-if-exists=.env.local scripts/check-mysql.ts",
  "db:check-mssql": "node --env-file-if-exists=.env.local scripts/check-mssql.ts"
}
```

Add `"allowImportingTsExtensions": true` to `compilerOptions` in `tsconfig.json`.

`"type": "module"` makes every `.js`/`.ts` file an ES module. The scaffold already uses ESM configs. If you add a config that uses `module.exports`, name it `.cjs`.

### Script conventions

Scripts are TypeScript and use Node's built-in features instead of extra packages:

- **Node runs TypeScript natively** (type stripping, on by default since Node 22.18). Every script runs with plain `node`: no `tsx`, no `ts-node`. Scripts, and the `lib/` modules they import, may only use TypeScript syntax that can simply be deleted: no `enum`, no namespaces, no constructor parameter properties. `erasableSyntaxOnly` in `tsconfig.json` enforces this.
- **Relative imports include the `.ts` extension** (`from "./db-types.ts"`). Node doesn't guess extensions, which is why `allowImportingTsExtensions` is needed. Next.js already sets `noEmit`, which that option requires. Plain Node doesn't understand the `@/` alias, so code that scripts import uses relative paths.
- **`.env.local` is loaded with `--env-file-if-exists`.** It's built into Node, so `dotenv` isn't needed.
- **Use `import.meta.dirname`** instead of the `fileURLToPath(import.meta.url)` workaround.
- **Type stripping doesn't type-check.** `npm run typecheck` covers `scripts/` too.

### Commands

```bash
npm run dev                # Dev server (Turbopack)
npm run build              # Production build
npm run start              # Production server
npm run lint               # ESLint
npm run format             # Prettier (with Tailwind CSS plugin)
npm run typecheck          # TypeScript
npm test                   # Vitest unit tests (no database needed)
npm run db:setup           # Apply db/auth_schema.sql to Neon (idempotent)
npm run db:cleanup         # Delete stale rate-limit rows, expired sessions/tokens (run daily)
npm run db:check           # Smoke-check every configured database
npm run db:check-postgres  # lib/db/postgres.ts (direct Neon endpoint, Better Auth)
npm run db:check-mysql     # lib/db/mysql.ts
npm run db:check-mssql     # lib/db/mssql.ts
```

---

## 4. Tooling philosophy: skills vs. MCP

Every piece of agent tooling has a context cost. Pick the cheapest one that does the job:

- **Conventions → skills.** Static patterns, library usage, project rules. They cost almost nothing until a matching task loads them.
- **Live data → MCP.** Database schemas, running-server state. Tool definitions load into **every** session, so each MCP server has to earn that cost.
- **One-off facts → look them up directly** with bash, a CLI or the docs. No standing tooling.

Framework _knowledge_ reaches the agent through the `AGENTS.md` block that `next dev` manages, which points at version-matched docs in `node_modules/next/dist/docs/`. Don't install knowledge skills or knowledge-base MCP servers for Next.js. Vercel's old Next.js knowledge skills are retired in favor of those bundled docs.

Agent instructions sit in three layers. Put each rule in the cheapest layer that still gets it applied:

| Layer     | File(s)                                  | Loaded                                        | Holds                                                                         |
| :-------- | :--------------------------------------- | :-------------------------------------------- | :---------------------------------------------------------------------------- |
| 1. Rules  | `AGENTS.md` (+ `CLAUDE.md` importing it) | Every session                                 | Short, non-negotiable rules: Spanish UI, mobile-first, database split, checks |
| 2. Skills | `.claude/skills/<name>/SKILL.md`         | When a task matches the skill's `description` | Step-by-step workflows and library conventions, with templates and checklists |
| 3. MCP    | `.mcp.json`                              | Tool list every session; data on demand       | Live state that bash can't cover cleanly                                      |

**Rule of thumb:** a rule that matters on every task goes in `AGENTS.md`, in one line. A rule that matters for one kind of task (a form, a query) goes in a skill. If `AGENTS.md` grows past ~60 lines, move detail into skills.

---

## 5. Root context: AGENTS.md and CLAUDE.md

Two files, two owners.

**`AGENTS.md` is owned by Next.js.** `next dev` writes and maintains a managed block between `<!-- BEGIN:nextjs-agent-rules -->` and `<!-- END:nextjs-agent-rules -->`. It warns that this Next.js version has breaking changes and points the agent at the bundled docs.

- The block is only written when `next dev` detects an AI coding agent and the markers aren't already there.
- Everything outside the markers is preserved, so the project rules from `templates/AGENTS.md` go **below** the block.
- **Commit the block as-is**, even when it shows up as an uncommitted change. Removing it only makes `next dev` write it again.
- To opt out, set `agentRules: false` in `next.config.ts`.

**`CLAUDE.md` is owned by you.** Claude Code reads `CLAUDE.md`, not `AGENTS.md`, and the scaffold doesn't create it. `templates/CLAUDE.md` is a single `@AGENTS.md` import, so Claude Code loads the same rules as every other agent. Don't duplicate rules between the two files. If you ever need Claude-only directives, add them below the import.

> A symlink (`ln -s AGENTS.md CLAUDE.md`) also works, but only while `CLAUDE.md` has no Claude-specific content. The import keeps that option open.

---

## 6. Skills

Install the skills in group A for every project, add group B only when its trigger applies, and copy the kit's own skills (group C). Run `npx skills update` from time to time: it upgrades installed skills and prunes retired ones.

### A. Vendor skills: install for every project

```bash
# shadcn/ui official skill: project-aware component conventions.
# Activates on components.json and runs `shadcn info --json` to learn the
# framework, Tailwind version, aliases, base library (Base UI vs Radix, which
# changes imports and APIs) and installed components.
npx skills add shadcn/ui

# Prerequisite for next-dev-loop: agent-browser v0.27+
# (v0.27 adds React DevTools introspection: tree, inspect, renders, suspense.)
npm install -g agent-browser@^0.27

# next-dev-loop: the core runtime-verification workflow. The agent drives the
# browser, reads the console, follows network requests and inspects the React
# tree through /_next/mcp + agent-browser.
npx skills add vercel/next.js --skill next-dev-loop

# next-safe-action: typed server action clients (this stack uses it in
# lib/safe-action.ts).
npx skills add next-safe-action/skills

# Better Auth official skills: server/client config, sessions, plugins,
# email verification and security (https://better-auth.com/docs/ai-resources/skills)
npx skills add better-auth/skills
```

From the next-safe-action pack, the relevant skills are `safe-action-client`, `safe-action-middleware`, `safe-action-forms`, `safe-action-validation-errors` and `safe-action-better-auth`. Skip `safe-action-tanstack-query` unless TanStack Query joins the stack.

From the Better Auth pack:

- **Relevant every day:** `better-auth-best-practices` (config, sessions, plugins, env vars), `email-and-password-best-practices` (verification, password reset, hashing) and `better-auth-security-best-practices` (rate limiting, trusted origins, cookies, secrets).
- **Only if you adopt the plugin:** `organization-best-practices` and `two-factor-authentication-best-practices`. They stay idle until a task mentions organizations or 2FA.
- **Not for this kit:** `create-auth` scaffolds a new auth setup and writes its own `lib/auth.ts`. The kit already ships one, so reject any plan from it that replaces `lib/auth.ts`.
- **Schema changes:** these skills tell the agent to run `npx auth@latest migrate` after config or plugin changes. In this kit the auth schema lives in `db/auth_schema.sql` and is applied with `npm run db:setup`, and the rule in `AGENTS.md` makes the agent follow that path instead. To find the SQL a new plugin needs, run `npx auth@latest generate` and copy its output into `db/auth_schema.sql`, rather than migrating directly.

Optional general-purpose skills:

```bash
npx skills add vercel-labs/agent-skills@vercel-react-best-practices
npx skills add vercel-labs/agent-skills@web-design-guidelines
```

### B. Conditional vendor skills: install only when the trigger applies

**When adopting Cache Components or Partial Prefetching.** These are migration tools, not daily drivers:

```bash
npx skills add vercel/next.js --skill next-cache-components-adoption    # feature-by-feature adoption
npx skills add vercel/next.js --skill next-cache-components-optimizer   # instant navigations + regression tests
npx skills add vercel/next.js --skill next-partial-prefetching-adoption # shared loading shells for every link
```

### C. Project skills included in this kit

Copied to `.claude/skills/` in step 5 of the setup:

| Skill                | Triggers on                    | What it enforces                                                                                                                                                                                      |
| :------------------- | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-query`           | Any SQL / data access          | No ORM; which `lib/db` module to use; placeholders (`?`, `$1`, `@p0`) for every value; `release()` discipline; identifier quoting; string-typed BIGINT/DECIMAL; transactions; never query auth tables |
| `server-action-form` | Adding or changing a form      | Shared Zod schema, `*-form.tsx` with react-hook-form + `Controller`, `actionClient` action with session re-check, Spanish messages, pending/error states                                              |
| `new-feature-module` | New page, section, or report   | Spanish kebab-case route under `app/(main)/`, session/role guard, file layout, nav entry                                                                                                              |
| `responsive-check`   | Before finishing any UI change | 360 / 768 / 1280 px checklist, no horizontal scroll, 44px targets, no hover-only actions, both themes                                                                                                 |

The Better Auth isolation rules (no direct queries against auth tables, `@/lib/auth` on the server, `@/lib/auth-client` on the client, ask before touching `db/auth_schema.sql`) apply to every task, so they live in `AGENTS.md` rather than in a skill.

### Writing your own skills

A skill is a folder with a `SKILL.md` file (the open Agent Skills format):

```markdown
---
name: db-query
description: Write SQL against the app's databases using the lib/db modules ... Use for any server code that reads or writes business data.
---

# Instructions the agent follows once the skill is triggered
```

- The `description` is all the agent sees before deciding to load the skill. Say **what** it does and **when** to use it, in the words a request would actually contain ("form", "page", "query", "responsive").
- Keep the body procedural: file layout, a code template, a checklist. Reference project files by path instead of pasting them.
- Claude Code loads project skills from `.claude/skills/<name>/SKILL.md`. Other agents have their own skills directory. For an agent without skill support, list the skill paths in `AGENTS.md` ("before building a form, read `skills/server-action-form/SKILL.md`").
- Add a skill when you catch yourself correcting the agent on the same thing twice. Edit one when its output drifts from what you want.

---

## 7. MCP servers (only if necessary)

**The default is no MCP servers.** Skills, the bundled Next.js docs, the CLI and the `db:check` scripts cover day-to-day work. Add a server only when the agent keeps needing live data that those can't give it, and remove it again when that phase is over.

| Server                | Add it when                                                                            | Default           |
| :-------------------- | :------------------------------------------------------------------------------------- | :---------------- |
| Read-only business DB | The agent writes queries against tables it hasn't seen and keeps guessing column names | Not installed     |
| Next.js DevTools      | You want quick compile checks _outside_ the `next-dev-loop` skill                      | Not installed     |
| shadcn                | Temporarily, during UI-heavy phases with a lot of component shopping                   | Not installed     |
| Neon                  | Practically never; see below                                                           | **Don't install** |
| Better Auth docs      | Rarely: the Better Auth skills cover conventions, and `better-auth.com/llms.txt` covers lookups | Not installed |

### Business database (MySQL / SQL Server), read-only

This is the one MCP server likely to earn its cost: the agent can look at the real schema and sample rows instead of guessing names in `lib/db` code.

**Safety rules:**

1. **Dev/staging databases only.** Never point an agent at production.
2. **Read-only at the database level.** Create the SELECT-only `agent_ro` users from `db/readonly-users.sql`. A server's own "read-only mode" isn't enough: several SQL MCP servers have shipped bypasses, such as multi-statement input that commits a write. With a SELECT-only user, a bypass can't change anything.
3. **Secrets stay out of Git.** Pass credentials with `--scope local` (stored in your own Claude Code config, not in the repo), or reference environment variables from `.mcp.json` (`${MCP_MYSQL_URL}`). Claude Code expands those from your shell environment, not from `.env.local`.

There is no official read-only MCP server from MySQL/Oracle or Microsoft, only community projects. Pick one that:

- is actively maintained, with recent releases and answered issues;
- runs locally over stdio, so the connection string never leaves your machine;
- validates SQL (a single statement, SELECT only) **and** recommends a read-only DB user;
- takes its credentials from environment variables.

Example with a community MySQL server, using the `agent_ro` user:

```bash
claude mcp add business-db --scope local \
  -e MYSQL_HOST="your-railway-host.railway.app" \
  -e MYSQL_PORT="3306" \
  -e MYSQL_USER="agent_ro" \
  -e MYSQL_PASS="..." \
  -e MYSQL_DB="your-app-db" \
  -- npx -y @benborla29/mcp-server-mysql
```

Test it before trusting it: ask the agent to run an `INSERT`/`UPDATE`, and `SELECT 1; DROP TABLE x`, against a scratch table. Both must fail with a permission error from the database itself.

### Next.js DevTools

```bash
claude mcp add next-devtools --scope project -- npx -y next-devtools-mcp
```

It finds the running `next dev` server and exposes `compile_route` / `get_compilation_issues`, which are much faster than `next build` while you edit. The `next-dev-loop` skill calls the same `/_next/mcp` endpoints directly, so you only need this registration for compile checks outside the skill.

### shadcn

The shadcn **skill** covers conventions and falls back to the CLI for live registry data (`npx shadcn@latest search / view / add --dry-run --diff`). The MCP server adds natural-language browsing across registries. That's useful while scaffolding UI-heavy features and redundant otherwise. Enable it for that phase, then remove it:

```bash
claude mcp add shadcn --scope project -- npx -y shadcn@latest mcp
```

### Why not Neon

Better Auth owns the Neon schema, and the auth database holds password hashes and session tokens. The agent doesn't need either, and the architecture rule says nothing queries auth tables directly. Neon's MCP also reaches your whole **Neon account**, not one database. A server that loads into every session just to look at auth tables now and then is a poor trade. Instead:

```bash
npm run db:check-postgres      # connectivity, server version, session settings
psql "$DATABASE_URL" -c '\dt'  # list tables to confirm the schema was applied
```

If deep Neon work ever becomes routine (branching workflows, for example), use the hosted server in read-only mode, from a Neon account or organization that only holds dev projects:

```bash
claude mcp add --transport http --scope project neon "https://mcp.neon.tech/mcp?readonly=true"
```

### When MCP is the wrong tool

- **"Does my connection work?"** Run `npm run db:check`, not the MCP. The MCP uses different credentials.
- **A one-off question about a table.** Without an MCP, the agent can write a throwaway script that uses `runQuery` from `lib/db`, run it with `node --env-file=.env.local tmp.ts` (relative `.ts` imports, no `@/` alias), and delete it afterwards.

---

## 8. Actionable errors and Instant Insights

With Cache Components enabled, an uncached `await` on the server shows up as an **Instant Insight** with three labeled fixes. Choosing one is a product decision, not just an error fix:

- **[stream]**: wrap the data access in `<Suspense fallback={...}>`.
- **[cache]**: cache it with `"use cache"` (doesn't apply to `connection()`).
- **[block]**: `export const instant = false` to allow a blocking route.

How this fits the agent workflow:

- The dev overlay's **Copy prompt** button turns the chosen fix into a ready-to-paste agent prompt: it identifies the failing code, points to the error's docs page, applies the standard pattern and verifies at runtime with `next-dev-loop`.
- The same fix menu appears in the **terminal output** of `next dev` and `next build`, so an agent reading CI logs gets the same labeled fixes and doc links.
- Each error has a docs page under `nextjs.org/docs/messages/*`, written for agents, with **Patterns**, **Trade-offs** and **Gotchas** for each fix.
- Any Next.js docs URL returns plain Markdown if you append `.md` (or send `Accept: text/markdown`). Full index: `/docs/llms.txt`. Everything in one file: `/docs/llms-full.txt`.

---

## 9. Testing

Two layers answer different questions:

| Layer               | Command            | Needs a DB?            | Answers                                                                                                                                                         |
| :------------------ | :----------------- | :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (Vitest) | `npm test`         | No: drivers are mocked | Is each module configured correctly? (env validation, TLS options, pool sizing, precision flags, singleton/HMR behavior, timeout and release paths, `runQuery`, sign-up allowlist) |
| Smoke checks        | `npm run db:check` | Yes: uses `.env.local` | Does it work against the real server? (connectivity, version, BIGINT precision, session timeouts and app name, pool concurrency, acquire timeout)               |

- Run `npm test` after any change in `lib/`. Run `npm run db:check` on a new machine, after changing `.env.local`, or before debugging "the query is broken", because the cause is often the connection.
- `db:check` runs only the databases whose variables are set and skips the rest. Each `db:check-*` exits non-zero on failure and prints a hint for common errors (refused connection, bad credentials, untrusted certificate, wrong Neon endpoint).
- Checks that need server introspection or Docker fixtures (SIGINT shutdown, `performance_schema`, killed connections) are listed as future work in the testing reports under `docs/db-modules/`.

---

## 10. Daily development workflow

A repeatable routine for working with an AI agent. Claude Code specifics are in parentheses.

### 1. Start

```bash
git switch main && git pull
git switch -c feat/<short-description>      # one branch per task
npm install                                 # if package-lock.json changed
npm run dev                                 # needed for next-dev-loop and /_next/mcp
```

- Open the VS Code integrated terminal and start a **fresh agent session** for each task (`claude`). Long sessions pile up stale context, and a clean start with a good prompt beats a long thread.
- If you configured MCP servers, confirm they're connected (`/mcp`).
- Run `npm run db:check` if something database-related misbehaved last session or `.env.local` changed.

### 2. Plan

- Describe the task as an outcome, with the Spanish route name and who uses it, e.g. "Página `reportes-ventas` para admins: ventas por mes con filtro de fechas, tabla que en móvil se vuelve tarjetas."
- For anything beyond a small fix, ask for a **plan first** and review it before any code is written (plan mode: `Shift+Tab`). Check that it:
  - uses the right `lib/db` module and doesn't touch auth tables;
  - puts files where `new-feature-module` says;
  - names the skills it will follow.
- Correct the plan, not the code. A wrong plan is cheap to fix.

### 3. Build

- Let the agent work in small steps and run `npm run typecheck && npm run lint` after each one (already in `AGENTS.md`).
- When it gets a convention wrong, correct it once in the chat. The second time, update the skill or `AGENTS.md` instead (see step 6).
- Keep the browser open on the page being built and check it at phone width as you go, not only at the end.

### 4. Verify

- **Runtime:** ask the agent to verify each change with the `next-dev-loop` skill: reload the route, check the console and network, inspect the React tree. A green compile isn't a working page.
- **Layout:** run the `responsive-check` skill on every page touched (360 / 768 / 1280 px, both themes).
- **Build:** `npm test` (when `lib/` changed) and `npm run build` before you push. The production build catches things `dev` doesn't.
- **By hand:** read all new user-facing text (Spanish, consistent tone, no English left in error paths), and try the unhappy paths: signed out, non-admin role, invalid input, empty results.

### 5. Review

- Ask for a review of the full diff against `main` in a **fresh session**, so the agent isn't reviewing its own reasoning (`/code-review` and `/security-review`). Focus it on session/role checks in actions, SQL placeholders and the project rules.
- Then skim the diff yourself: `git diff main --stat`, then the files that matter.

### 6. Wrap up

```bash
git add -A && git commit -m "feat: <what changed>"
git push -u origin HEAD                        # open a PR, merge when green
```

- **Feed lessons back.** This takes two minutes and makes the next session faster:
  - The agent repeated a mistake → add one line to `AGENTS.md` or fix the skill.
  - You explained a multi-step procedure → it's a candidate for a new skill.
  - A database quirk surprised you → note it in the module's testing report under `docs/db-modules/`.
- Leave a one-line note in the PR or an issue saying where to pick up next time.

### Maintenance

- **Framework:** `npx next upgrade`. Commit first, review the diff, and commit any `AGENTS.md` block update.
- **Skills:** `npx skills update` upgrades installed skills and prunes retired ones.
- **agent-browser:** `npm install -g agent-browser@latest` (stay on 0.27 or later for React introspection).
- **Tooling audit:** before adding an MCP server, ask whether a skill plus a CLI command covers it. MCP tool definitions cost context in every session; skills cost context only when they're triggered.
