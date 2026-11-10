import { createSafeActionClient } from "next-safe-action"
import { getSession } from "@/lib/session"

const GENERIC_ERROR = "Algo salió mal. Inténtalo de nuevo."

// For user-facing actions: keep errors generic so internal details aren't leaked.
export const actionClient = createSafeActionClient({
  handleServerError(e) {
    console.error("Action error:", e.message)
    return GENERIC_ERROR
  },
})

// For internal diagnostic actions only (database tools, health checks).
// Admin-only: the middleware rejects any session without the "admin" role.
// Raw error messages (SQL, table names, hosts) reach the client only outside
// production; in production the user sees the generic message.
export const diagnosticActionClient = createSafeActionClient({
  handleServerError(e) {
    console.error("Action error:", e.message)
    return process.env.NODE_ENV === "production" ? GENERIC_ERROR : e.message
  },
}).use(async ({ next }) => {
  const session = await getSession()
  if (session?.user.role !== "admin") throw new Error("No autorizado")
  return next({ ctx: { session } })
})
