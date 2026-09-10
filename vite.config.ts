import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  // Only VITE_-prefixed vars: nothing here may reach the client bundle by
  // accident, and GEMINI_API_KEY must never be `define`d into it.
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  if (command === 'build' && mode === 'production' && !env.VITE_AI_PROXY_URL) {
    throw new Error(
      "VITE_AI_PROXY_URL must be set for a production build; a build without it would call http://localhost:8787 from the visitor's own machine."
    );
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
