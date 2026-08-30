// lib/AuthContext.tsx
//
// One app-wide onAuthStateChanged subscription. The route guards and the header
// read this context instead of each opening their own listener, so `loading` is
// true only while the very first auth resolution is pending -- navigating
// between protected screens no longer re-enters "Verifying Session...".

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';

export type AuthState = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ user: null, loading: true });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // If Firebase has already resolved a user (e.g. a provider remount), skip the
  // loading state entirely; otherwise wait for the first callback.
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState<boolean>(auth.currentUser === null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const value = useMemo<AuthState>(() => ({ user, loading }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
