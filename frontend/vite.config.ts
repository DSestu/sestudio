// `vitest/config` re-exports vite's defineConfig with the `test` block typed,
// so one config serves both the build and the test run.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    // The suite covers the pure store logic, so the default node environment is
    // enough — test-setup supplies the one browser API those modules touch.
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
