import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { auth, describeAuthError } from '../firebase';
import { confirmPasswordReset, signOut, verifyPasswordResetCode } from 'firebase/auth';
import { SESSION_KEY } from '../lib/connectionsStore';

type Status = 'verifying' | 'ready' | 'invalid' | 'done';

const INCOMPLETE_LINK_MESSAGE =
  'This link is invalid or incomplete. Use "Forgot Password?" on the sign-in page to get a new one.';
const UNUSABLE_LINK_MESSAGE =
  'This reset link is invalid or has already been used. Use "Forgot Password?" on the sign-in page to get a new one.';

const ResetPasswordScreen: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Query inside the hash (#/reset-password?...) wins; the real email link puts it before the "#".
  const rootParams = new URLSearchParams(window.location.search);
  const mode = searchParams.get('mode') ?? rootParams.get('mode') ?? '';
  const oobCode = searchParams.get('oobCode') ?? rootParams.get('oobCode') ?? '';

  const [status, setStatus] = useState<Status>('verifying');
  const [invalidMessage, setInvalidMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // No once-only ref guard: verifying does not consume the code, so the StrictMode double-mount is safe.
    let cancelled = false;

    if (mode !== 'resetPassword' || !oobCode) {
      setInvalidMessage(INCOMPLETE_LINK_MESSAGE);
      setStatus('invalid');
      return;
    }

    setStatus('verifying');
    verifyPasswordResetCode(auth, oobCode)
      .then((verifiedEmail) => {
        if (cancelled) return;
        setEmail(verifiedEmail);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setInvalidMessage(describeAuthError(err, UNUSABLE_LINK_MESSAGE));
        setStatus('invalid');
      });

    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  const leaveToLogin = () => {
    // Strip the one-time code from the address bar before leaving.
    if (window.location.search) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
    }
    navigate('/login');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : '';
      if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
        setInvalidMessage(describeAuthError(err));
        setStatus('invalid');
      } else {
        setError(describeAuthError(err, 'Could not reset your password. Please try again.'));
      }
      setLoading(false);
      return;
    }

    setPassword('');
    setConfirmPassword('');

    // The reset revokes the matching account's session, so sign it out the same way the sidebar does.
    // A different signed-in user is left alone.
    const current = auth.currentUser;
    if (current?.email && current.email.toLowerCase() === email.toLowerCase()) {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        // sessionStorage blocked; there is nothing cached to clear.
      }

      try {
        await signOut(auth);
      } catch (err) {
        console.warn('Password was reset, but signing out the old session failed:', err);
      }
    }

    setLoading(false);
    setStatus('done');
  };

  const badgeIcon = status === 'invalid' ? 'link_off' : status === 'done' ? 'check_circle' : 'lock_reset';
  const title =
    status === 'invalid' ? 'Link Unavailable' : status === 'done' ? 'Password Updated' : 'Reset Password';

  const primaryButtonClass =
    'w-full flex items-center justify-center bg-primary hover:bg-primary/90 text-white font-semibold py-3.5 rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 disabled:opacity-50 disabled:hover:bg-primary active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[#101622]';

  return (
    <div className="bg-mesh min-h-screen flex items-center justify-center font-display overflow-y-auto py-8 px-4 sm:px-6">
      <main className="relative z-10 w-full max-w-[420px] animate-fade-in-up">
        <div className="mac-glass rounded-3xl p-6 sm:p-8 flex flex-col items-center transition-all duration-300 hover:border-white/20">

          <div className="mb-6 sm:mb-8 hover:scale-105 transition-transform duration-300">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-2xl">
              <Icon name={badgeIcon} className="text-white text-2xl sm:text-3xl" />
            </div>
          </div>

          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-white text-xl sm:text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-slate-400 text-sm mt-1">
              {status === 'verifying' && 'Checking your reset link…'}
              {status === 'ready' && (
                <>
                  Choose a new password for <span className="text-white font-medium">{email}</span>
                </>
              )}
              {status === 'invalid' && invalidMessage}
              {status === 'done' && 'You can now sign in with your new password.'}
            </p>
          </div>

          {status === 'verifying' && (
            <div className="w-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {status === 'ready' && (
            <>
              {error && (
                <div className="w-full mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-red-400">
                  <Icon name="error_outline" className="text-lg shrink-0 mt-0.5" />
                  <p className="text-xs font-medium leading-relaxed">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="w-full space-y-4">
                <div className="space-y-1.5 group">
                  <label className="text-[10px] font-bold text-slate-500 ml-1 uppercase tracking-widest group-focus-within:text-primary transition-colors">New Password</label>
                  <div className="relative">
                    <Icon name="lock" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-lg group-focus-within:text-primary transition-colors" />
                    <input
                      autoFocus
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="mac-input w-full rounded-xl py-3 pl-11 pr-12 text-white placeholder-slate-600 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label="Toggle password visibility"
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white active:scale-90 transition-all"
                    >
                      <Icon name={showPassword ? "visibility_off" : "visibility"} className="text-lg" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 group">
                  <label className="text-[10px] font-bold text-slate-500 ml-1 uppercase tracking-widest group-focus-within:text-primary transition-colors">Confirm Password</label>
                  <div className="relative">
                    <Icon name="lock" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-lg group-focus-within:text-primary transition-colors" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="mac-input w-full rounded-xl py-3 pl-11 pr-4 text-white placeholder-slate-600 text-sm"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`${primaryButtonClass} mt-6`}
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Update Password'
                  )}
                </button>
              </form>
            </>
          )}

          {(status === 'invalid' || status === 'done') && (
            <button
              type="button"
              onClick={leaveToLogin}
              className={primaryButtonClass}
            >
              Back to Login
            </button>
          )}

        </div>

        {(status === 'verifying' || status === 'ready') && (
          <div className="mt-8 flex justify-center">
            <button type="button" onClick={leaveToLogin} className="flex items-center space-x-3 group text-slate-400 hover:text-white transition-all duration-300">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 group-hover:bg-white/10 border border-white/10 group-active:scale-95 transition-all">
                <Icon name="arrow_back" className="text-xl" />
              </div>
              <span className="text-sm font-medium">Back to Login</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default ResetPasswordScreen;
