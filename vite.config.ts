/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works at a custom domain root and under /<repo>/ on github.io.
  base: './',
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', ...(process.env.LIVE ? ['tests/live/**/*.test.ts'] : [])],
    environment: 'node',
    testTimeout: process.env.LIVE ? 60_000 : 5_000,
  },
})
