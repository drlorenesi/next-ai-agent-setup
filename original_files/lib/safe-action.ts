import { createSafeActionClient } from "next-safe-action"

// For user-facing actions: keep errors generic so internal details aren't leaked.
export const actionClient = createSafeActionClient({
  handleServerError(e) {
    console.error("Action error:", e.message)
    return "Something went wrong. Please try again."
  },
})

// For internal diagnostic actions only: pass through the actual error message.
export const diagnosticActionClient = createSafeActionClient({
  handleServerError(e) {
    console.error("Action error:", e.message)
    return e.message
  },
})
