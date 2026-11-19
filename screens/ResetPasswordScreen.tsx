import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { auth, describeAuthError } from '../firebase';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { signOutOfAccount } from '../lib/session';
import '../styles/auth.css';

type Status = 'verifying' | 'ready' | 'invalid' | 'done';

const INCOMPLETE_LINK_MESSAGE =
  'This link is invalid or incomplete. Use "Forgot password?" on the sign-in page to get a new one.';
const UNUSABLE_LINK_MESSAGE =
  'This reset link is invalid or has already been used. Use "Forgot password?" on the sign-in page to get a new one.';
const EXPIRED_LINK_MESSAGE =
  'This reset link has expired. Use "Forgot password?" on the sign-in page to get a new one.';
const errorCode = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code ?? '')
    : '';
/** Link problems in this page's own wording (the shared auth copy spells the link "Forgot Password?"). */
const linkMessage = (err: unknown) =>
  errorCode(err) === 'auth/expired-action-code'
    ? EXPIRED_LINK_MESSAGE
    : errorCode(err) === 'auth/invalid-action-code'
      ? UNUSABLE_LINK_MESSAGE
      : describeAuthError(err, UNUSABLE_LINK_MESSAGE);

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
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error && !loading) alert.current?.focus();
  }, [error, loading]);

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
        setInvalidMessage(linkMessage(err));
        setStatus('invalid');
      });

    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  const leaveToLogin = (forgot = false) => {
    // Strip the one-time code from the address bar before leaving.
    if (window.location.search) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
    }
    navigate('/login', { replace: true, state: { forgot } });
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
      const code = errorCode(err);
      if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
        setInvalidMessage(linkMessage(err));
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
        await signOutOfAccount();
      } catch (err) {
        console.warn('Password was reset, but signing out the old session failed:', err);
      }
    }

    setLoading(false);
    setStatus('done');
  };

  return (
    <main className="login">
      <section className="login-card" aria-labelledby="reset-title">
        <span className="logo" aria-hidden="true">
          <Icon name="lock" />
        </span>
        <h1 id="reset-title">
          {status === 'invalid'
            ? 'Link unavailable'
            : status === 'done'
              ? 'Password updated'
              : 'Reset your password'}
        </h1>
        <p
          className={status === 'invalid' ? 'note bad' : status === 'done' ? 'note ok' : 'sub'}
          role={status === 'invalid' ? 'alert' : 'status'}
        >
          {(status === 'invalid' || status === 'done') && (
            <Icon name={status === 'invalid' ? 'alert' : 'check'} />
          )}
          <span>
            {status === 'verifying' ? (
              'Checking your reset link…'
            ) : status === 'invalid' ? (
              invalidMessage
            ) : status === 'done' ? (
              'You can now sign in with your new password.'
            ) : (
              <>
                Choose a new password for <b className="auth-email">{email}</b>
              </>
            )}
          </span>
        </p>
        {error && (
          <p className="note bad" role="alert" ref={alert} tabIndex={-1}>
            <Icon name="alert" />
            <span>{error}</span>
          </p>
        )}
        {status === 'ready' && (
          <form noValidate onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="reset-password">New password</label>
              <div className="pw">
                <input
                  className="input"
                  id="reset-password"
                  aria-invalid={!!error}
                  autoFocus
                  required
                  autoComplete="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  className="linkbtn"
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                  aria-controls="reset-password reset-confirm"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <span className="hint">At least 6 characters.</span>
            </div>
            <div className="field">
              <label htmlFor="reset-confirm">Confirm password</label>
              <input
                className="input"
                id="reset-confirm"
                aria-invalid={!!error}
                required
                autoComplete="new-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <button className="btn primary" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
        {status === 'invalid' && (
          <button className="btn primary" onClick={() => leaveToLogin(true)}>
            Send a new link
          </button>
        )}
        <button
          className={status === 'done' ? 'btn primary' : 'linkbtn auth-link'}
          type="button"
          onClick={() => leaveToLogin()}
        >
          {auth.currentUser ? 'Back to the app' : status === 'done' ? 'Sign in' : 'Back to sign in'}
        </button>
      </section>
    </main>
  );
};
export default ResetPasswordScreen;
