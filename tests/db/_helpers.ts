import { vi } from "vitest"

/**
 * Replace the given env keys for this test: every key in `clear` is removed
 * first (so a developer's real .env / shell vars can't leak in), then `values`
 * are applied. `unstubEnvs: true` in vitest.config.ts restores everything.
 */
export function setEnv(
  clear: readonly string[],
  values: Record<string, string | undefined>
) {
  for (const key of clear) vi.stubEnv(key, undefined)
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value)
}

/**
 * The db modules register SIGINT/SIGTERM handlers when a pool is created.
 * Swallow those registrations so repeated pool creation across tests doesn't
 * attach real handlers (and trigger MaxListenersExceededWarning).
 */
export function captureSignalHandlers() {
  return vi
    .spyOn(process, "on")
    .mockImplementation((() => process) as unknown as typeof process.on)
}

/** A promise you can resolve/reject from the outside. */
export function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
