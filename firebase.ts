import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

export const EMULATOR_MODE = import.meta.env.VITE_FIREBASE_EMULATOR === 'on';

// In emulator mode only a `demo-` project id is used (the emulators then refuse
// to reach any real project), so a dev server that also loaded .env.local's real
// config still never talks to it.
const EMULATOR_PROJECT_ID = 'demo-ncrp-graph';
const emulatorProjectId = (() => {
  const id = (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim();
  return id.startsWith('demo-') ? id : EMULATOR_PROJECT_ID;
})();

const firebaseConfig = EMULATOR_MODE
  ? {
      apiKey: 'demo-api-key',
      authDomain: `${emulatorProjectId}.firebaseapp.com`,
      projectId: emulatorProjectId,
    }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    };

// Fail loudly (but don't crash the app) when the build was made without config.
const missingEnvVars = ([
  ['VITE_FIREBASE_API_KEY', firebaseConfig.apiKey],
  ['VITE_FIREBASE_PROJECT_ID', firebaseConfig.projectId],
] as const)
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingEnvVars.length > 0) {
  console.error(
    `Firebase config is incomplete: missing ${missingEnvVars.join(', ')}. ` +
    `Set ${missingEnvVars.length > 1 ? 'them' : 'it'} in .env.local at the repo root and restart the dev server.`
  );
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth and Google Provider
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Firestore
export const db = getFirestore(app);

// Dev-only emulator mode (local/graph-demo): VITE_FIREBASE_EMULATOR=on points Auth
// and Firestore at local emulators. vite.config.ts refuses a production build with
// it on. Defaults stay clear of the usual 9099/8080 and of the rules tests (8181).
function emulatorHost(value: string | undefined, fallback: string): { host: string; port: number } {
  const raw = (value ?? '').trim() || fallback;
  const m = /^(?:https?:\/\/)?([^:/]+):(\d+)\/?$/.exec(raw);
  if (!m) {
    console.error(`Invalid emulator address "${raw}", using ${fallback}.`);
    return emulatorHost(fallback, fallback);
  }
  return { host: m[1], port: Number(m[2]) };
}

if (EMULATOR_MODE) {
  const authAt = emulatorHost(import.meta.env.VITE_FIREBASE_EMULATOR_AUTH, '127.0.0.1:9199');
  const fsAt = emulatorHost(import.meta.env.VITE_FIREBASE_EMULATOR_FIRESTORE, '127.0.0.1:8190');
  connectAuthEmulator(auth, `http://${authAt.host}:${authAt.port}`, { disableWarnings: true });
  connectFirestoreEmulator(db, fsAt.host, fsAt.port);
  console.info(
    `Firebase emulator mode is ON (project ${firebaseConfig.projectId}): Auth ${authAt.host}:${authAt.port}, Firestore ${fsAt.host}:${fsAt.port}. No real Firebase project is used.`
  );
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/cancelled-popup-request': 'Sign-in was cancelled.',
  'auth/popup-blocked': 'Your browser blocked the sign-in popup.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-email': 'Enter your email above first.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/network-request-failed': 'Network error. Check your connection.',
  'auth/expired-action-code': 'This reset link has expired. Use "Forgot Password?" on the sign-in page to get a new one.',
  'auth/invalid-action-code': 'This reset link is invalid or has already been used. Use "Forgot Password?" on the sign-in page to get a new one.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/password-does-not-meet-requirements': 'That password does not meet the requirements.',
};

/**
 * Maps a Firebase auth error to friendly copy; never surfaces raw SDK text.
 * Unmapped codes return `fallback`.
 */
export function describeAuthError(err: unknown, fallback = 'Sign-in failed. Please try again.'): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';

  return AUTH_ERROR_MESSAGES[code] ?? fallback;
}
