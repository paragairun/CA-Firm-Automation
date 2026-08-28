import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/auth';

export function AcceptInvite() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    navigate('/', { replace: true });
  }

  if (!session) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-card__title">Invite link expired</h1>
          <p className="auth-card__subtitle">Ask your firm admin to send a new invite.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-card__title">Welcome to PracticeOS</h1>
        <p className="auth-card__subtitle">Set a password for {session.user.email}</p>

        <label className="auth-field">
          <span>Password</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        <label className="auth-field">
          <span>Confirm password</span>
          <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-submit" type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Set password & continue'}
        </button>
      </form>
    </div>
  );
}
