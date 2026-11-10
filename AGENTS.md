# next-ai-agent-setup

This repo is a **kit**, not an app: an architecture blueprint plus drop-in files that are copied into a new Next.js app. It has two audiences, kept in separate files:
- **Users** set up an app: `README.md`, `kit/`, `merge/`.
- **Maintainers** change this repo and publish versions: `MAINTAINING.md` (file ownership, responsibilities, release steps), the root tooling and this file.

Read both guides before changing anything.

## Layout: know which project a file is for
- `kit/` mirrors the new app's root exactly; users download it with one `giget` command and nothing in it may overwrite a file the scaffold creates. Every path inside it is the path it will have in the app.
- `merge/` holds files the scaffold already has (`AGENTS.md`, `next.config.ts`, `package.json`); users merge them by hand.
- `kit/AGENTS.md` doesn't exist on purpose: the app's rules are `merge/AGENTS.md`. Those rules, `kit/CLAUDE.md` and `kit/.claude/skills/` are for the *new app*. Don't follow them when working on this repo.
- The repo root (`package.json`, `tsconfig.json`, `vitest.config.ts`, `tests/`, `docs/`, this file) is for maintaining the kit, not part of it. Root configs point at `kit/` (`@/` = `kit/`). Unit tests (`tests/`) and the db-module design notes (`docs/`) are never shipped: apps verify with `npm run db:check`.
- A new kit file goes at its final app path inside `kit/`. If it replaces or extends a scaffold file, it goes in `merge/` instead, unless the change is a single setting the README's setup steps can state directly (like `allowImportingTsExtensions` in `tsconfig.json`). Don't ship files users don't need.

## Keep the docs in sync, each for its audience
- Changing a script, skill, `merge/` file, `kit/lib/` module, env var or setup step means updating the README section that describes it (kit layout, setup steps, per-database files, commands, skills, MCP).
- The README is for users only. Repo tooling, release steps and maintainer duties go in `MAINTAINING.md`; a new root file or workflow gets a row in its "Who needs what" table.
- Nothing maintainer-only goes inside `kit/` or `merge/`: users download those folders whole.
- `package.json` `version`, the README's "Version" line and its `#v…` download tags change together (see "Releasing a version" in `MAINTAINING.md`).
- The README's audience is a developer setting up a new app with an AI agent. Keep its stance: no MCP servers by default, skills over MCP, vendor skills before custom ones.

## Node and TypeScript conventions
- Scripts run on plain `node` (Node ≥ 22.18 type stripping). No `tsx`, `ts-node` or `dotenv`; env files load with `--env-file-if-exists=.env.local`.
- Relative imports include the `.ts` extension (`./db-types.ts`). Code that scripts import can't use the `@/` alias.
- Only erasable TypeScript (no `enum`, namespaces or parameter properties). `erasableSyntaxOnly` enforces it.
- ES modules only. Use `import.meta.dirname`, never `.mjs` / `.cjs` scripts.

## Checks
- After changes run `npm run typecheck && npm test`. Neither needs a database.
- `kit/lib/auth.ts`, `auth-client.ts`, `email.ts`, `safe-action.ts` and `session.ts` are excluded from the type check: they import Next.js, Better Auth, React and Nodemailer, which aren't installed here. Review changes to them by reading carefully.
- `npm run db:check*` connects to real databases with credentials from `.env.local`. Run it only when asked.

## Settled decisions (ask before reversing)
- Auth schema lives in `kit/db/auth_schema.sql`, applied with `npm run db:setup`. Not the Better Auth CLI `migrate`.
- Auth data in Neon Postgres via `kit/lib/db/postgres.ts` (direct endpoint); business data in MySQL / SQL Server. No ORM, no Neon serverless module.
- User-facing strings in kit code (emails, action errors) are Spanish; identifiers, comments and docs are English.

## Never
- Read, print or edit `.env.local`. New variables go in `kit/.env.example` with a comment.
- Commit or push unless asked.
