import { defineConfig } from "vite";

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../web-dist',
    rollupOptions: {
      output: {
        manualChunks: {
          sql: ['sql.js'],
        },
      },
    },
  },
  server: {
    port: 6969,
    host: '0.0.0.0',
    strictPort: true,
  },
  optimizeDeps: {
    include: ['sql.js'],
  },
});