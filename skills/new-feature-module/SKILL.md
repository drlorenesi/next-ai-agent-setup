---
name: new-feature-module
description: Scaffold a new feature area or page in the protected app — Spanish kebab-case route under app/(main)/, session and role guard, page/form/actions layout, navigation entry. Use when the user asks for a new page, section, module, report or screen.
---

# New feature module

## 1. Route

- Lives under `app/(main)/` (protected area). Path segments in **Spanish, ASCII, kebab-case, no accents**: `reportes-ventas`, `ordenes/[id]`, `facturacion/nueva` — never `sales-reports` or `facturación`.
- Code identifiers stay in English (`SalesReportTable`, `getOrders`).
- Admin-only areas go under `app/(main)/admin/`.

## 2. Files

```
app/(main)/<ruta>/
  page.tsx            Server Component — data loading + layout
  loading.tsx         Skeleton (mobile layout first)
  <name>-form.tsx     only if the page has a form (see server-action-form skill)
  actions.ts          server actions for this feature
  schema.ts           Zod schemas shared by form + actions
  _components/        components used only by this feature
```

Read `node_modules/next/dist/docs/` for the current conventions of any file you add (params are async, caching rules, etc.) — this Next.js version differs from older training data.

## 3. Guard

At the top of `page.tsx`:

```ts
const session = await getSession()          // from @/lib/session
if (!session) redirect("/login")
// role-restricted:
if (session.user.role !== "admin") notFound()
```

Repeat the check inside every server action (pages and actions are separate entry points).

## 4. Data

- Fetch in the Server Component through `lib/db` (see the db-query skill); pass plain serializable props down.
- Wide tables (reports): wrap in `overflow-x-auto` **inside** their own container, or render cards on mobile (`md:hidden` / `hidden md:table`). The page itself never scrolls horizontally.

## 5. Finish

- [ ] Add the entry to the main navigation (Spanish label, lucide icon)
- [ ] All visible text in Spanish
- [ ] `npm run typecheck && npm run lint`
- [ ] Run the responsive-check skill on the new page
