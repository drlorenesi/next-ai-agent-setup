---
name: server-action-form
description: Build or change a form that submits to a server action — Zod v4 schema, react-hook-form client component (`*-form.tsx`), and a next-safe-action action using `actionClient` from lib/safe-action.ts. Use whenever adding a form, editing form fields/validation, or wiring a form to the server.
---

# Server action + form

Every form in this app is three pieces that live next to the page that uses them:

```
app/(main)/<ruta>/
  page.tsx          Server Component: loads data, renders <XxxForm />
  xxx-form.tsx      "use client": react-hook-form UI
  actions.ts        "use server": next-safe-action action(s)
  schema.ts         Zod schema shared by form and action
```

## 1. Schema (`schema.ts`)

- Zod v4 (`import { z } from "zod"`). One schema, imported by **both** the form and the action, so client and server validate identically.
- Validation messages in **Spanish**, written in the schema (`z.string().min(1, "El nombre es obligatorio")`).
- Export the inferred type: `export type XxxInput = z.infer<typeof xxxSchema>`.
- Keep it free of server-only imports — it is bundled into the client.

## 2. Action (`actions.ts`)

```ts
"use server"
import { actionClient } from "@/lib/safe-action"
import { getSession } from "@/lib/session"
import { xxxSchema } from "./schema"

export const saveXxx = actionClient
  .inputSchema(xxxSchema)
  .action(async ({ parsedInput }) => {
    const session = await getSession()
    if (!session) throw new Error("No autenticado") // logged server-side; user sees the generic message
    // ...db work via lib/db (see the db-query skill)
    return { ok: true }
  })
```

- Use `actionClient` (generic Spanish error to the user). `diagnosticActionClient` passes raw error text through — **only** for internal diagnostics pages.
- Re-check auth/role inside every action. Never trust that the page guarded it.
- After a mutation, `revalidatePath(...)` / `revalidateTag(...)` for any page that shows the changed data.
- For field-level server errors (e.g. "ese correo ya existe"), use `returnValidationErrors(xxxSchema, { email: { _errors: ["..."] } })` from `next-safe-action`.

## 3. Form (`xxx-form.tsx`)

- `"use client"`; `useForm<XxxInput>({ resolver: zodResolver(xxxSchema), defaultValues })` with `zodResolver` from `@hookform/resolvers/zod`.
- `useAction(saveXxx, { onSuccess, onError })` from `next-safe-action/hooks`; submit with `form.handleSubmit((values) => execute(values))`.
- Use the shadcn form primitives already in `components/ui/` (follow the shadcn react-hook-form guide). Use `Controller` for anything that isn't a native input: date pickers, checkboxes, selects, comboboxes.
- Disable the submit button while `isPending`; show server errors (`result.serverError`, `result.validationErrors`) near the form.
- All labels, placeholders, buttons and toasts in Spanish.
- Mobile-first: fields stack in one column by default, `md:grid-cols-2` only where it helps; inputs and buttons ≥ 44px tall.

## Checklist before finishing

- [ ] Schema shared, messages in Spanish
- [ ] Action re-checks the session/role
- [ ] Pending state and both error kinds handled in the UI
- [ ] Revalidation after mutation
- [ ] `npm run typecheck && npm run lint` pass
