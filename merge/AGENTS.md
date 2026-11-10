<!--
  Template: copy into the new project's AGENTS.md BELOW the block that
  `next dev` manages (the "nextjs-agent-rules" section). Don't edit or delete
  that block — Next.js regenerates it. Keep this file short: every line is
  loaded into every agent session. Details belong in skills.
-->

## Project rules

### Language and routes
- Every user-facing string is **Spanish**: UI, emails, validation and error messages, toasts, form labels.
- Route paths are Spanish, ASCII, kebab-case, no accents (`reportes-ventas`, not `sales-reports` or `facturación`).
- Auth pages: `/iniciar-sesion`, `/registro`, `/verificar-correo`, `/recuperar-contrasena`, `/restablecer-contrasena`. The email links in `lib/auth.ts` point at the last two pages' paths. Better Auth's `/api/auth/*` endpoints stay in English.
- Code identifiers, comments and commit messages stay in English.

### Mobile-first
- Base styles target a ~360px phone; add `sm:`/`md:`/`lg:` for larger screens. Never write desktop styles and override them downward.
- No horizontal page scroll at any width. Touch targets ≥ 44×44px. No hover-only actions.
- A UI change is not done until checked at phone, tablet and desktop widths (skill: `responsive-check`).

### Architecture
- Better Auth on Neon Postgres owns identity, sessions and tokens **only**. Don't query auth tables directly; use `auth.api.*` / `getSession()` from `lib/session.ts`. Server code imports `@/lib/auth`; client components import `@/lib/auth-client`.
- Sign-in, sign-up, password reset and verification emails always go through `authClient` (the `/api/auth` route), never a server action calling `auth.api.*`: server-side calls skip rate limiting.
- Business data lives in MySQL (`lib/db/mysql.ts`) and/or SQL Server (`lib/db/mssql.ts`). No ORM. Always use placeholders (skill: `db-query`).
- Forms: Zod v4 schema + react-hook-form + next-safe-action `actionClient` (skill: `server-action-form`). `diagnosticActionClient` is admin-only, for internal diagnostics.
- Every server action re-checks the session/role.
- Never cache business data: no `"use cache"` or static rendering for pages or functions that read it.
- Self-registration is limited to `AUTH_ALLOWED_EMAIL_DOMAINS` (hook in `lib/auth.ts`). Adding a social provider or email change must extend that check.
- Imports use the `@/` alias.

### Workflow
- After changes run `npm run typecheck && npm run lint`; run `npm run db:check` after touching `lib/db/`.
- `npm run db:check` diagnoses database connectivity before you debug query code.
- Never edit `.env.local` or print secrets; add new variables to `.env.example` with a comment.
- Ask before adding a dependency, changing `lib/db/*` pool settings, or touching `db/auth_schema.sql`.
- Auth schema changes go into `db/auth_schema.sql` and are applied with `npm run db:setup`. Never run `npx auth migrate` (the Better Auth skills suggest it); use `npx auth generate` only to see the SQL a plugin needs.
