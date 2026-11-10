import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // The kit's unit tests (tests/) import kit modules as `@/lib/...`.
    // `@/` = kit/, as in tsconfig.json. Tests are not shipped to apps.
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./kit/", import.meta.url)) },
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
