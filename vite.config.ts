import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // Keep in sync with the port the backend's CORS allow-list trusts and that
    // electron/dev.cjs waits on (dev:ui also pins 5175). Single source of truth.
    port: 5175,
  },
})
