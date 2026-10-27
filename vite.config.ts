import path from 'path';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  // Only VITE_-prefixed vars: nothing here may reach the client bundle by
  // accident, and GEMINI_API_KEY must never be `define`d into it.
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // A production build must name a public proxy, or say `off` to ship with AI
  // switched off. `.env.local` points at localhost for dev, so a localhost URL is
  // rejected here too: it would call the visitor's own machine.
  if (command === 'build' && mode === 'production') {
    // Emulator mode (local/graph-demo) talks to local Auth/Firestore emulators and
    // must never ship.
    if ((env.VITE_FIREBASE_EMULATOR ?? '').trim().toLowerCase() === 'on') {
      throw new Error(
        'VITE_FIREBASE_EMULATOR=on is dev-only (local emulators); a production build must not use it. Unset it, e.g. VITE_FIREBASE_EMULATOR= VITE_AI_PROXY_URL=off npm run build.'
      );
    }
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
    // Experimental features never ship by accident: VITE_EXPERIMENTAL=on in an env
    // file (the natural place to turn it on for `npm run dev`) must not reach a
    // production build. Typed in the shell it is a deliberate local experimental
    // build (for size measurements), which is never deployed.
    if (env.VITE_EXPERIMENTAL === 'on' && process.env.VITE_EXPERIMENTAL !== 'on') {
      throw new Error(
        "VITE_EXPERIMENTAL=on comes from an env file (.env/.env.local); a production build must not include experimental features. Remove it from the file, or set it in the shell for a deliberate local experimental build that is never deployed."
      );
    }
  }

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    // Scan only the app's own entry: the default scan also picks up .claude/worktrees/*/index.html, which pulled a
    // second React from a worktree's node_modules into the prebundled recharts ("Invalid hook call" on /dashboard in dev).
    // `include`: the semantic worker's dependency is only reached after the toggle is
    // turned on; prebundling it up front stops dev from reloading the page (and
    // dropping a staged dataset) the first time.
    optimizeDeps: { entries: ['index.html'], include: ['@huggingface/transformers'] },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      // Meaning-based search (lib/semantic/): onnxruntime-web's builds for this
      // condition load their .wasm from a configured path (transformers.js points
      // it at the pinned jsDelivr copy of the installed onnxruntime-web version)
      // instead of `new URL('*.wasm', import.meta.url)`, which Vite would emit as a
      // 27 MB asset into dist/. Affects only packages that declare the condition.
      conditions: [...defaultClientConditions, 'onnxruntime-web-use-extern-wasm'],
    },
  };
});
