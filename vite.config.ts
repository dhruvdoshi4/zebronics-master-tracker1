import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const buildSha =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  process.env.GITHUB_SHA?.slice(0, 7) ??
  'dev'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
})
