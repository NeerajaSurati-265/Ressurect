import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@contracts': path.resolve(here, '../contracts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // keep every chunk well under 100 KB gzip
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'motion'
          if (id.includes('react-router')) return 'router'
          if (id.includes('react-dom') || id.includes('scheduler') || /node_modules\/react\//.test(id)) return 'react'
          return 'vendor'
        },
      },
    },
  },
  server: {
    fs: { allow: [path.resolve(here, '..')] },
  },
})
