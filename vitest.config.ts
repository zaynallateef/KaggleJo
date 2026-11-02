import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.tsx'],
    // Transport tests select their own mode; local deployment settings must not
    // change mocked API tests into requests to the configured community service.
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_API_URL: '', VITE_DATA_MODE: '' },
  },
})
