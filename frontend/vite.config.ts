// `vitest/config` re-exports vite's defineConfig with the `test` block typed,
// so one config serves both the build and the test run.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // SESTUDIO_API: the live-preview skill points a worktree's dev server at
      // the live server (https, self-signed) or at the worktree's own backend.
      '/api': { target: process.env.SESTUDIO_API ?? 'http://localhost:8080', secure: false, changeOrigin: true },
    },
    // /mnt/* (drvfs) sends no inotify events to WSL, so edits there need polling.
    watch: process.env.VITE_POLL ? { usePolling: true } : undefined,
  },
  test: {
    // The suite covers the pure store logic, so the default node environment is
    // enough — test-setup supplies the one browser API those modules touch.
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
