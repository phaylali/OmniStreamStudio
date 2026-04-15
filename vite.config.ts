import { defineConfig } from "vite";

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../web-dist',
  },
  server: {
    port: 6969,
    host: '0.0.0.0',
    strictPort: true,
  },
});