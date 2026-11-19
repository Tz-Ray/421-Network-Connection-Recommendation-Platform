import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { auth, googleProvider, describeAuthError } from '../firebase';
import { sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';

import '../styles/auth.css';

const LoginScreen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [forgot, setForgot] = useState(!!location.state?.forgot);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // The reset link only helps after a wrong email or password, not after a form or network problem.
  const [offerReset, setOfferReset] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<{ email?: string; password?: string }>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const switched = useRef(false);
  useEffect(() => {
    document.title = `${forgot ? 'Reset your password' : 'Sign in'} · Connection Recommender`;
    if (switched.current || forgot) heading.current?.focus();
    switched.current = true;
    setFields({});
  }, [forgot]);
  useEffect(() => {
    if (error && !loading) alert.current?.focus();
  }, [error, loading]);
  const validate = (withPassword: boolean) => {
    const next = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Enter a valid email address.',
      password: withPassword && !password ? 'Enter your password.' : undefined,
    };
    setFields(next);
    if (next.email || next.password) {
      setError('There is a problem. Check the fields below.');
      return false;
    }
    return true;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setOfferReset(false);
    setResetNotice('');
    if (!validate(true)) return;
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const code = String((err as { code?: unknown } | null)?.code ?? '');
      const credentials = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(
        code,
      );
      setOfferReset(credentials || code === 'auth/too-many-requests');
      setError(describeAuthError(err));
      if (credentials)
        setFields({ email: 'Check your email and password.', password: 'Check your email and password.' });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    setOfferReset(false);
    setResetNotice('');

    const target = email.trim();
    if (!validate(false)) return;

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, target);
      // Neutral copy on purpose: email-enumeration protection means Firebase
      // does not tell us whether the address exists, and we must not either.
      setResetNotice(
        `If an account exists for ${target}, a reset link has been sent. Check your spam folder if it does not arrive.`,
      );
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setOfferReset(false);
    setResetNotice('');
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login">
      <section className="login-card" aria-labelledby="login-title">
        <span className="logo" aria-hidden="true">
          <Icon name="network" />
        </span>
        <h1 id="login-title" ref={heading} tabIndex={-1}>
          {forgot ? 'Reset your password' : 'Sign in to Connection Recommender'}
        </h1>
        <p className="sub">
          {forgot ? 'We email you a link to reset your password.' : 'Find who in your network can help.'}
        </p>
        {error && (
          <div className="note bad" role="alert" ref={alert} tabIndex={-1}>
            <Icon name="alert" />
            <div>
              {error}{' '}
              {!forgot && offerReset && (
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    setForgot(true);
                    setError('');
                  }}
                >
                  Reset your password
                </button>
              )}
            </div>
          </div>
        )}
        {resetNotice && (
          <p className="note ok" role="status">
            <Icon name="check" />
            <span>{resetNotice}</span>
          </p>
        )}
        <form
          noValidate
          onSubmit={
            forgot
              ? (e) => {
                  e.preventDefault();
                  void handleForgotPassword();
                }
              : handleLogin
          }
        >
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              className="input"
              id="login-email"
              data-testid="login-email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={!!fields.email}
              aria-describedby={fields.email ? 'login-email-error' : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {fields.email && (
              <p className="err" id="login-email-error">
                {fields.email}
              </p>
            )}
          </div>
          {!forgot && (
            <div className="field">
              <div className="row2">
                <label htmlFor="login-password">Password</label>
                <button
                  type="button"
                  className="linkbtn"
                  data-testid="forgot-link"
                  disabled={loading}
                  onClick={() => {
                    setForgot(true);
                    setError('');
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <div className="pw">
                <input
                  className="input"
                  id="login-password"
                  data-testid="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  aria-invalid={!!fields.password}
                  aria-describedby={fields.password ? 'login-password-error' : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  className="linkbtn"
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-controls="login-password"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {fields.password && (
                <p className="err" id="login-password-error">
                  {fields.password}
                </p>
              )}
            </div>
          )}
          <button className="btn primary" type="submit" data-testid="login-submit" disabled={loading}>
            {loading ? 'Please wait…' : forgot ? 'Send reset link' : 'Sign in'}
          </button>
          {forgot ? (
            <p className="auth-link">
              <button
                className="linkbtn"
                type="button"
                onClick={() => {
                  setForgot(false);
                  setError('');
                  setResetNotice('');
                }}
              >
                Back to sign in
              </button>
            </p>
          ) : (
            <>
              <div className="or">or</div>
              <button
                className="btn"
                type="button"
                data-testid="login-google"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <Icon name="user" />
                Continue with Google
              </button>
              <p className="auth-link">
                New here? <Link to="/register">Create an account</Link>
              </p>
            </>
          )}
        </form>
      </section>
    </main>
  );
};
export default LoginScreen;
