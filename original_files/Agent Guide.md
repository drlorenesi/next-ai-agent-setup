# Next.js App Setup & AI Agent Guide

**Version 1** — Architecture Blueprint, MCP Configuration, and Claude Code Skill Specifications

- **Primary Editor:** VS Code
- **AI Assistant:** Claude Code CLI
- **Framework:** Next.js 16.4 (App Router)
- **Last Update:** October 7th 2026

---

## 1. Executive Architecture Summary

This project is a high-performance web application built with Next.js 16.4. The design explicitly separates authentication infrastructure from core business application data to optimize security, maintainability, and serverless runtime performance.

### Architecture Principle: Dual-Database Isolation

Better Auth on Neon Postgres manages user identity, authentication tokens, and session persistence **exclusively**. Railway MySQL handles all domain business logic (e.g., sales reports, product management, order processing, and invoicing) using optimized custom connection modules. No ORM overhead is introduced. NOTE: The business database schema will be in Spanish while the Better Auth schema should be in english.

**Isolation corollary:** because Better Auth owns the Neon schema (created and migrated via its own CLI), no agent tooling is granted standing access to that database. Ad-hoc verification goes through `psql` when needed — see Section 4.

---

## 2. Project Scaffolding & Upgrade Procedure

The base app is created with the shadcn preset, which installs a Next.js version **behind** the official release. Upgrading immediately after scaffolding is standard procedure.

```bash
# 1. Scaffold the base app with the shadcn preset
npx shadcn@latest init --preset b38nGZAAa --template next --pointer

# 2. Setup Git
git remote add origin https://github.com/drlorenesi/project-name.git
git branch -M main
git push -u origin main

# 3. Upgrade Next.js, React, react-dom, and eslint-config-next together.
#    Available since Next.js 16.1 — no @next/codemod needed on this path.
npx next upgrade

# 4. Verify the upgrade
npm run typecheck && npm run build

# 5. Boot the dev server once — `next dev` writes/updates the managed
#    AGENTS.md docs-pointer block (see Section 6). Commit it.
npm run dev
```

**Notes:**

- `next upgrade` may prompt for which codemods to apply. When invoked by an AI agent or in CI (anywhere stdin isn't a TTY), it runs non-interactively and accepts every default.
- The command handles React version pairing automatically — prefer it over hand-editing `package.json`.
- Manual fallback: `npm i next@latest react@latest react-dom@latest eslint-config-next@latest`
- Projects on Next.js **< 16.1.0** must use `npx @next/codemod@canary upgrade latest` instead.
- Ongoing updates: re-run `npx next upgrade` when new releases land. Commit before upgrading, review the diff after.

---

## 3. Tooling Philosophy: MCP Servers vs. Skills

The dividing rule:

- **Convention → Skills.** Static patterns, API usage, project rules. Near-zero context cost until a relevant task triggers them.
- **Live data → MCP.** Database schemas, running-server state. Tool definitions load into **every** session, so each MCP server must earn its per-session context cost.
- **One-off facts → look up directly** (bash, CLI, docs). No standing tooling required.
- git remote add origin https://github.com/drlorenesi/project-name.git
  git branch -M main
  git push -u origin main

Framework *knowledge* reaches agents through the auto-managed `AGENTS.md` block pointing at version-matched bundled docs in `node_modules/next/dist/docs/` — no knowledge skills or knowledge-base MCP tools are installed for this. Skills are reserved for multi-step **workflows** and **library conventions**; MCP is reserved for **live tooling** that bash can't cover cleanly.

| Domain / Layer       | Technology Choice                   | Hosting / Provider               | Agent Integration                                            |
| -------------------- | ----------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| Framework & Core     | Next.js 16.4 (App Router)           | Vercel / Node.js Runtime         | Async request APIs, RSC, auto-managed AGENTS.md block.       |
| UI & Styling         | shadcn/ui + Tailwind CSS            | Local Project Component Registry | Official shadcn **skill** (project-aware via `shadcn info --json`); semantic CSS tokens; react-hook-form + Zod. |
| Authentication       | Better Auth Framework               | Neon Serverless Postgres         | Isolated. No standing MCP — Better Auth CLI owns migrations; `psql` for ad-hoc checks. |
| Application Data     | MySQL (Raw SQL Modules)             | Railway.com                      | MySQL **MCP** for live schema discovery. No ORMs; raw SQL via `lib/db/`. |
| Compilation Checks   | Next.js DevTools MCP                | Local (`next dev`)               | `compile_route` / `get_compilation_issues` from the running dev server. |
| Runtime Verification | agent-browser + next-dev-loop skill | Local (global npm install)       | Agent drives a real browser: DOM, console, network, React tree. |

---

## 4. Configured MCP Servers

Two MCP servers are standing project tooling. Both are registered with `--scope project` so they land in the shared `.mcp.json`:

```bash
# 1. Railway MySQL MCP (core: raw SQL inspection & live schema discovery —
#    prevents hallucinated table/column names in lib/db/ wrappers)
claude mcp add mysql --scope project \
  -e MYSQL_HOST="your-railway-host.railway.app" \
  -e MYSQL_PORT="3306" \
  -e MYSQL_USER="root" \
  -e MYSQL_PASS="your-password" \
  -e MYSQL_DB="your-app-db" \
  -- npx -y @benborla29/mcp-server-mysql

# 2. Next.js DevTools MCP (compilation checks from the running dev server;
#    auto-discovers `next dev`. Much faster than `next build` while editing.)
claude mcp add next-devtools --scope project -- npx -y next-devtools-mcp
```

### Deliberately NOT installed as standing MCPs

- **Neon Postgres MCP.** Better Auth owns the Neon schema and migrates it via its own CLI. A full project-management MCP server to occasionally verify auth tables is a poor context trade. Ad-hoc verification instead:

  ```bash
  psql "$DATABASE_URL" -c '\dt'   # list tables; confirm Better Auth migration ran
  ```

  If deep Neon work ever becomes routine (branching workflows, etc.), revisit: `claude mcp add neon --scope project -- npx -y @neondatabase/mcp-server-neon start $NEON_API_KEY`

- **shadcn MCP.** The official shadcn **skill** (Section 5) covers conventions and falls back to CLI commands (`npx shadcn@latest search / view / add --dry-run --diff`) for live registry data. The MCP adds natural-language registry browsing across multiple sources — valuable during heavy component-shopping phases, redundant in steady-state development. Enable temporarily when scaffolding UI-heavy features: `claude mcp add shadcn --scope project -- npx -y shadcn@latest mcp`

**Note on `next-dev-loop`:** the skill calls the underlying `/_next/mcp` endpoints directly and works without the `next-devtools` MCP registration. The explicit registration exists so Claude can use the compilation tools *outside* the skill (e.g., quick compile checks while iterating on `lib/db/` wrappers).

---

## 5. Skills & Rule Architecture

### A. Vendor Skills

```bash
# shadcn/ui official skill — project-aware component conventions.
# Activates on components.json; runs `shadcn info --json` each interaction
# to learn framework, Tailwind version, aliases, base library (Base UI vs
# Radix — critical for correct imports/APIs), and installed components.
npx skills add shadcn/ui

# Prerequisite for next-dev-loop: agent-browser v0.27+
# (v0.27 adds React DevTools introspection: react tree / inspect /
#  renders / suspense. The skill launches it with --enable react-devtools.)
npm install -g agent-browser@^0.27

# next-dev-loop — the core verification workflow skill. The agent drives
# the browser, reads the console, follows network requests, and inspects
# the React tree via /_next/mcp + agent-browser.
npx skills add vercel/next.js --skill next-dev-loop

# Optional general-purpose community skills
npx skills add vercel-labs/agent-skills@vercel-react-best-practices
npx skills add vercel-labs/agent-skills@web-design-guidelines
```

Run `npx skills update` periodically — it upgrades installed skills and prunes retired ones (Vercel's old Next.js *knowledge* skills are retired in favor of the bundled docs; do not reinstall them).

### B. Conditional Vendor Skills — install only when the trigger applies

**When adopting Cache Components / Partial Prefetching** (migration tools, not daily drivers):

```bash
npx skills add vercel/next.js --skill next-cache-components-adoption    # feature-by-feature adoption
npx skills add vercel/next.js --skill next-cache-components-optimizer   # instant navigations + regression tests
npx skills add vercel/next.js --skill next-partial-prefetching-adoption # shared loading shells for every link
```

**When adopting next-safe-action** (typed Server Action clients with middleware):

Decision rule: plain Server Actions + Zod + a small hand-rolled `withAuth()` wrapper is the default. Adopt next-safe-action when the same session-check + Zod-parse + error-shape boilerplate appears in a third action. Its Better Auth adapter (typed session context, `authorize` callbacks) and React Hook Form adapter align directly with this stack.

```bash
npx skills add next-safe-action/skills
```

Relevant skills for this stack: `safe-action-client`, `safe-action-middleware`, `safe-action-forms`, `safe-action-validation-errors`, `safe-action-better-auth`. Skip `safe-action-tanstack-query` unless TanStack Query enters the stack.

### C. Custom Local Project Skills

**1. Raw MySQL Standards** (`.claude/skills/mysql-raw/SKILL.md`)

```markdown
---
name: mysql-raw
description: Guidelines for raw SQL queries via custom database modules
---

- Zero ORMs: Do NOT install or generate code for Drizzle, Prisma, or Kysely.
- Parametrized Queries: ALWAYS use positional placeholders (`?`) in `lib/db/mysql.ts`.
- Type Safety: Write explicit TypeScript interfaces for all query result rows.
- Transactions: Wrap multi-table updates (e.g., Orders + Order Items) in explicit SQL transactions.
```

**2. Better Auth & Neon Isolation** (`.claude/skills/better-auth/SKILL.md`)

```markdown
---
name: better-auth
description: Rules for Better Auth and Neon Postgres isolation
---

- Strict Isolation: Neon Postgres is reserved strictly for Better Auth tables.
- Client Imports: Client-side code must strictly import `@/lib/auth-client`.
- Server Imports: Server Actions & Route Handlers must strictly import `@/lib/auth`.
- Schema Changes: Only via the Better Auth CLI migration flow — never hand-written SQL against Neon.
```

---

## 6. Root Context Configuration (`CLAUDE.md` + `AGENTS.md`)

Two files, two owners:

**`AGENTS.md` — owned by Next.js.** `next dev` automatically writes and maintains a managed block (between `<!-- BEGIN:nextjs-agent-rules -->` / `<!-- END:nextjs-agent-rules -->` markers) pointing agents at version-matched bundled docs in `node_modules/next/dist/docs/`. Rules:

- The block is only written when `next dev` detects an AI coding agent and the markers aren't already present.
- Anything outside the markers is preserved — agent-neutral content can be added freely.
- **Commit the block as-is**, even when it appears as an uncommitted change. Removing it from a diff only re-creates it on the next run.
- Opt out (if ever needed) with `agentRules: false` in `next.config.ts`.

**`CLAUDE.md` — owned by you.** Claude Code reads `CLAUDE.md`, *not* `AGENTS.md`. The documented pattern is a one-line `@AGENTS.md` import at the top (loaded at session start), followed by Claude-specific project directives. The scaffold does **not** create this file:

```bash
# 1. Create CLAUDE.md importing AGENTS.md.
#    Do NOT write Next.js docs pointers manually — `next dev` manages
#    the AGENTS.md block automatically.
echo "@AGENTS.md" > CLAUDE.md

# 2. Append project core rules
cat << 'EOF' >> CLAUDE.md

## Application Directives
- **Database Architecture:**
  - Business Data: Railway MySQL using raw SQL via `lib/db/`.
  - Auth Data: Better Auth on Neon Postgres (`lib/auth.ts`). No direct SQL.
- **UI:** Custom components powered by shadcn/ui and semantic tokens.
- **Runtime Verification:** After changes to routes or `lib/db/` wrappers,
  verify at runtime with the `next-dev-loop` skill before code review.
EOF
```

> A symlink (`ln -s AGENTS.md CLAUDE.md`) is a documented alternative, but only viable with zero Claude-specific content. This project has Claude-specific directives, so the `@AGENTS.md` import is the correct choice.

---

## 7. Actionable Errors & Instant Insights

With Cache Components enabled, an uncached `await` on the server surfaces as an **Instant Insight** with three labeled fixes — a product decision, not just an error:

- **[stream]** — wrap the data access in `<Suspense fallback={...}>`
- **[cache]** — cache it with `"use cache"` (does not apply to `connection()`)
- **[block]** — `export const instant = false` to allow a blocking route

Workflow integration:

- The dev overlay's **Copy prompt** button packages the chosen fix into a paste-ready agent prompt (identifies the failing code, reads the per-error docs page, applies the canonical pattern, verifies at runtime via `next-dev-loop`).
- The same fix menu appears in **structured terminal output** during `next dev` and `next build` — agents reading CI logs get identical labeled fixes with doc links.
- Per-error docs live under `nextjs.org/docs/messages/*`, written for agents: canonical **Patterns**, **Trade-offs**, and **Gotchas** per fix.
- Any Next.js docs URL returns plain Markdown by appending `.md` (or sending `Accept: text/markdown`). Full index: `/docs/llms.txt`; single-file bundle: `/docs/llms-full.txt`.

---

## 8. Daily Development Session Workflow

### Standard Iteration Cycle in VS Code

1. **Launch Agent:** Open the VS Code integrated terminal and run `claude`.
2. **Verify Setup:** Run `/mcp` inside Claude Code to confirm the MySQL and next-devtools servers are connected. Confirm `next dev` is running (required for `/_next/mcp` and the compilation tools).
3. **Plan Feature:** Run `/plan <feature-name>` before building complex reports or raw database queries to review execution steps.
4. **Build & Execute:** Let Claude leverage the MySQL MCP to inspect Railway tables and generate raw SQL query wrappers in `lib/db/`. Use `compile_route` for fast per-route compile checks instead of full builds.
5. **Runtime Verification:** Prompt: *"After every edit, verify the page still works at runtime using the next-dev-loop skill."* The agent reloads the route, checks the console/network, and inspects the React tree — a green compile is not a working page.
6. **Code & Security Review:** Run `/code-review` and `/security-review` before submitting pull requests or committing code.

### Maintenance

- **Framework updates:** `npx next upgrade` (commit first, review the diff, commit any AGENTS.md block update).
- **Skills updates:** `npx skills update` (upgrades installed skills, prunes retired ones).
- **agent-browser updates:** `npm install -g agent-browser@latest` (keep ≥ 0.27 for React introspection).
- **Tooling audit:** when adding an MCP server, ask whether a skill + CLI fallback covers it — every MCP's tool definitions cost context in every session; skills only cost context when triggered.