/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TWITCH_KEY: string;
  readonly VITE_KICK_KEY: string;
  readonly VITE_KICK_URL: string;
  readonly VITE_TWITCH_USERNAME: string;
  readonly VITE_KICK_USERNAME: string;
  readonly VITE_TWITCH_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}