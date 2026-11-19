import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { auth, googleProvider, describeAuthError } from '../firebase';
import { createUserWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth';

import '../styles/auth.css';

const RegisterScreen: React.FC = () => {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  // Sign-in and reset links only help when the email already has an account.
  const [accountExists, setAccountExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<{ name?: string; email?: string; password?: string }>({});
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error && !loading) alert.current?.focus();
  }, [error, loading]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAccountExists(false);
    const next = {
      name: name.trim() ? undefined : 'Enter your name.',
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Enter a valid email address.',
      password: password.length >= 6 ? undefined : 'Use at least 6 characters.',
    };
    setFields(next);
    if (Object.values(next).some(Boolean)) {
      setError('There is a problem. Check the fields below.');
      return;
    }
    setLoading(true);

    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const code = String((err as { code?: unknown } | null)?.code ?? '');
      setAccountExists(code === 'auth/email-already-in-use');
      setError(describeAuthError(err));
      if (code === 'auth/email-already-in-use' || code === 'auth/invalid-email')
        setFields({ email: 'Check this email address, or sign in if you already have an account.' });
      else if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements')
        setFields({ password: describeAuthError(err) });
      setLoading(false);
      return;
    }

    // The account exists from here on: a failed display-name update must not be
    // reported as a failed signup.
    try {
      if (userCredential.user) {
        await updateProfile(userCredential.user, { displayName: name.trim() });
      }
    } catch (err) {
      console.warn('Account created, but setting the display name failed:', err);
    }

    setLoading(false);
    navigate('/dashboard', { replace: true });
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setAccountExists(false);
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
      <section className="login-card" aria-labelledby="register-title">
        <span className="logo" aria-hidden="true">
          <Icon name="network" />
        </span>
        <h1 id="register-title">Create your account</h1>
        <p className="sub">Free. You add your LinkedIn export after signing in.</p>
        {error && (
          <div className="note bad" role="alert" ref={alert} tabIndex={-1}>
            <Icon name="alert" />
            <div>
              {error}
              {accountExists && (
                <>
                  {' '}
                  <Link to="/login">Sign in</Link> or{' '}
                  <Link to="/login" state={{ forgot: true }}>
                    reset your password
                  </Link>
                  .
                </>
              )}
            </div>
          </div>
        )}
        <form noValidate onSubmit={handleRegister}>
          <div className="field">
            <label htmlFor="register-name">Your name</label>
            <input
              className="input"
              id="register-name"
              aria-invalid={!!fields.name}
              aria-describedby={fields.name ? 'register-name-error' : undefined}
              data-testid="register-name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {fields.name && (
              <p className="err" id="register-name-error">
                {fields.name}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="register-email">Email</label>
            <input
              className="input"
              id="register-email"
              aria-invalid={!!fields.email}
              aria-describedby={fields.email ? 'register-email-error' : undefined}
              data-testid="register-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {fields.email && (
              <p className="err" id="register-email-error">
                {fields.email}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="register-password">Password</label>
            <div className="pw">
              <input
                className="input"
                id="register-password"
                data-testid="register-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={6}
                aria-invalid={!!fields.password}
                aria-describedby={fields.password ? 'register-password-error password-hint' : 'password-hint'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                className="linkbtn"
                type="button"
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-controls="register-password"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {fields.password && (
              <p className="err" id="register-password-error">
                {fields.password}
              </p>
            )}
            <span className="hint" id="password-hint">
              At least 6 characters.
            </span>
          </div>
          <button className="btn primary" type="submit" data-testid="register-submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
          <div className="or">or</div>
          <button
            className="btn"
            type="button"
            data-testid="register-google"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <Icon name="user" />
            Continue with Google
          </button>
          <p className="auth-link">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </section>
    </main>
  );
};
export default RegisterScreen;
