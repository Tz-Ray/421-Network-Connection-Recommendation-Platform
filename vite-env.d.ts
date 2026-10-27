/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_MEASUREMENT_ID: string
  readonly VITE_AI_PROXY_URL?: string
  readonly VITE_CONNECTIONS_BACKEND?: 'firestore' | 'local'
  /** 'on' = experimental features of other branches (dev only; vite.config.ts refuses it from an env file in a production build). */
  readonly VITE_EXPERIMENTAL?: string
  /** 'on' = dev-only Auth/Firestore emulator mode (local/graph-demo); a production build rejects it. */
  readonly VITE_FIREBASE_EMULATOR?: string
  /** host:port of the Auth emulator (default 127.0.0.1:9199). */
  readonly VITE_FIREBASE_EMULATOR_AUTH?: string
  /** host:port of the Firestore emulator (default 127.0.0.1:8190). */
  readonly VITE_FIREBASE_EMULATOR_FIRESTORE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
