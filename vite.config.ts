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
    'TWITCH_KEY': JSON.stringify(process.env.TWITCH_KEY || ''),
    'KICK_KEY': JSON.stringify(process.env.KICK_KEY || ''),
    'TWITCH_USERNAME': JSON.stringify(process.env.TWITCH_USERNAME || ''),
    'TWITCH_CLIENT_ID': JSON.stringify(process.env.TWITCH_CLIENT_ID || ''),
  },
}));