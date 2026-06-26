import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: {
      obsidian: fileURLToPath(
        new URL("./src/__tests__/__mocks__/obsidian.ts", import.meta.url),
      ),
    },
  },
});
