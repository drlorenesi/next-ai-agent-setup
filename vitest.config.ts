import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/` path alias (project root).
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Undo vi.spyOn / vi.stubEnv / vi.stubGlobal after every test.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
})
