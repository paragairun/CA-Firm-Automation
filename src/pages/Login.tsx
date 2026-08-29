import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/auth';

export function Login() {
  const { session } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  if (session) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    setSubmitting(false);
  }

  async function handleResetRequest(e: FormEvent) {
    e.preventDefault();
    setResetSubmitting(true);
    setResetMessage(null);
    // Reuses the accept-invite page's set-password form — clicking the
    // emailed reset link establishes a session there the same way an
    // invite link does, so there's no need for a second, near-identical page.
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}accept-invite`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(resetEmail, { redirectTo });
    setResetSubmitting(false);
    // Supabase deliberately doesn't reveal whether the email exists, to
    // avoid leaking which addresses have accounts — so this message is
    // the same either way, which is expected behavior, not a bug.
    if (resetError) {
      setResetMessage(resetError.message);
    } else {
      setResetMessage("If an account exists for that email, we've sent a reset link.");
    }
  }

  if (showReset) {
    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={handleResetRequest}>
          <h1 className="auth-card__title">Reset password</h1>
          <p className="auth-card__subtitle">We'll email you a link to set a new one</p>

          <label className="auth-field">
            <span>Email</span>
            <input type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} autoFocus />
          </label>

          {resetMessage && <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{resetMessage}</p>}

          <button className="auth-submit" type="submit" disabled={resetSubmitting}>
            {resetSubmitting ? 'Sending…' : 'Send reset link'}
          </button>
          <button
            className="btn-link"
            type="button"
            style={{ marginTop: 'var(--space-2)' }}
            onClick={() => {
              setShowReset(false);
              setResetMessage(null);
            }}
          >
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-card__title">PracticeOS</h1>
        <p className="auth-card__subtitle">Sign in to your firm's workspace</p>

        <label className="auth-field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>

        <label className="auth-field">
          <span>Password</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-submit" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          className="btn-link"
          type="button"
          style={{ marginTop: 'var(--space-2)' }}
          onClick={() => setShowReset(true)}
        >
          Forgot password?
        </button>
      </form>
    </div>
  );
}
