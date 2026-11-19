import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { SESSION_KEY, CONTEXT_SESSION_KEY } from './connectionsStore';

/** Every sign-out entry point clears both tab caches before ending the session. */
export async function signOutOfAccount() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(CONTEXT_SESSION_KEY);
  } catch {
    /* Storage may be blocked. */
  }
  window.dispatchEvent(new Event('ncrp-sign-out'));
  await signOut(auth);
}
