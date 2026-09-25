import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: { include: ['src/engine/**'], exclude: ['**/*.test.ts', 'src/engine/testUtil.ts', 'src/engine/index.ts'] },
  },
})
