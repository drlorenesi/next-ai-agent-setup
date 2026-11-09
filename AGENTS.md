# next-ai-agent-setup

This repo is a **kit**, not an app: an architecture blueprint plus drop-in files that are copied into a new Next.js app. `README.md` is the guide. Read it before changing anything.

## Know which project a file is for
- `templates/AGENTS.md` and `templates/CLAUDE.md` are rules for the *new app*. Don't follow them when working on this repo.
- `skills/` are the new app's project skills (copied to `.claude/skills/` there), not skills for working on this repo.
- `original_files/` is an archived earlier version. Ignore it unless asked.

## Keep the README in sync
- Changing a script, skill, template, `lib/` module, env var or setup step means updating the README section that describes it (kit table, setup steps, commands, skills, MCP).
- The README's audience is a developer setting up a new app with an AI agent. Keep its stance: no MCP servers by default, skills over MCP, vendor skills before custom ones.

## Node and TypeScript conventions
- Scripts run on plain `node` (Node ≥ 22.18 type stripping). No `tsx`, `ts-node` or `dotenv`; env files load with `--env-file-if-exists=.env.local`.
- Relative imports include the `.ts` extension (`./db-types.ts`). Code that scripts import can't use the `@/` alias.
- Only erasable TypeScript (no `enum`, namespaces or parameter properties). `erasableSyntaxOnly` enforces it.
- ES modules only. Use `import.meta.dirname`, never `.mjs` / `.cjs` scripts.

## Checks
- After changes run `npm run typecheck && npm test`. Neither needs a database.
- `lib/auth.ts`, `lib/auth-client.ts`, `lib/email.ts`, `lib/safe-action.ts` and `lib/session.ts` are excluded from the type check: they import Next.js, Better Auth, React and Nodemailer, which aren't installed here. Review changes to them by reading carefully.
- `npm run db:check*` connects to real databases with credentials from `.env.local`. Run it only when asked.

## Settled decisions (ask before reversing)
- Auth schema lives in `db/auth_schema.sql`, applied with `npm run db:setup`. Not the Better Auth CLI `migrate`.
- Auth data in Neon Postgres via `lib/db/postgres.ts` (direct endpoint); business data in MySQL / SQL Server. No ORM, no Neon serverless module.
- User-facing strings in kit code (emails, action errors) are Spanish; identifiers, comments and docs are English.

## Never
- Read, print or edit `.env.local`. New variables go in `.env.example` with a comment.
- Commit or push unless asked.
