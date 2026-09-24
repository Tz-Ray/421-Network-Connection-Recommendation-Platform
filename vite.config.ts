import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  // Only VITE_-prefixed vars: nothing here may reach the client bundle by
  // accident, and GEMINI_API_KEY must never be `define`d into it.
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // A production build must name a public proxy, or say `off` to ship with AI
  // switched off. `.env.local` points at localhost for dev, so a localhost URL is
  // rejected here too: it would call the visitor's own machine.
  if (command === 'build' && mode === 'production') {
    const proxy = (env.VITE_AI_PROXY_URL ?? '').trim();
    if (!proxy) {
      throw new Error(
        "VITE_AI_PROXY_URL must be set for a production build (a public proxy URL, or 'off' to ship without AI); a build without it would call http://localhost:8787 from the visitor's own machine."
      );
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(proxy)) {
      throw new Error(
        `VITE_AI_PROXY_URL is ${proxy} (probably from .env.local); a production build needs a public proxy URL, or 'off' to ship without AI. Override it in the shell, e.g. VITE_AI_PROXY_URL=off npm run build.`
      );
    }
  }

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
