import { defineConfig } from "vite";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config();

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  define: {
    'import.meta.env.VITE_TWITCH_KEY': JSON.stringify(process.env.TWITCH_KEY || ''),
    'import.meta.env.VITE_KICK_KEY': JSON.stringify(process.env.KICK_KEY || ''),
    'import.meta.env.VITE_KICK_URL': JSON.stringify(process.env.KICK_STREAM_URL || ''),
    'import.meta.env.VITE_TWITCH_USERNAME': JSON.stringify(process.env.TWITCH_USERNAME || ''),
    'import.meta.env.VITE_KICK_USERNAME': JSON.stringify(process.env.KICK_USERNAME || ''),
    'import.meta.env.VITE_TWITCH_CLIENT_ID': JSON.stringify(process.env.TWITCH_CLIENT_ID || ''),
  },
}));