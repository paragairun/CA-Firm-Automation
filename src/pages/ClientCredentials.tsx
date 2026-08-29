import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { listCredentialMetaForClient, type CredentialMeta } from '../lib/queries';
import { saveCredential, revealCredential, type PortalType, type RevealedCredential } from '../lib/credentials';

const portalLabels: Record<string, string> = {
  income_tax: 'Income Tax Portal',
  gst: 'GST Portal',
  mca: 'MCA',
  udyam: 'UDYAM',
  fssai: 'FSSAI',
};

const REVEAL_TIMEOUT_MS = 30_000;

export function ClientCredentials() {
  const { id: clientId } = useParams<{ id: string }>();
  const { staff } = useAuth();
  const [creds, setCreds] = useState<CredentialMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [portalType, setPortalType] = useState<PortalType>('gst');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedCredential | null>(null);
  const [revealBusyId, setRevealBusyId] = useState<string | null>(null);

  function load() {
    if (!clientId) return;
    setLoading(true);
    listCredentialMetaForClient(clientId)
      .then(setCreds)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load credentials.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [clientId]);

  // Auto-clear whatever's revealed after a short window, and always on
  // unmount — a decrypted secret shouldn't linger in memory or on screen
  // longer than the person is actively looking at it.
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => {
      setRevealed(null);
      setRevealedId(null);
    }, REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  const canManage = staff && ['admin', 'partner'].includes(staff.role);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setSaving(true);
    setError(null);
    try {
      await saveCredential({
        client_id: clientId,
        portal_type: portalType,
        username,
        password,
        otp_secret: otpSecret || undefined,
      });
      setUsername('');
      setPassword('');
      setOtpSecret('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReveal(cred: CredentialMeta) {
    setRevealBusyId(cred.id);
    setError(null);
    try {
      const result = await revealCredential(cred.id);
      setRevealed(result);
      setRevealedId(cred.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reveal credential.');
    } finally {
      setRevealBusyId(null);
    }
  }

  function hideRevealed() {
    setRevealed(null);
    setRevealedId(null);
  }

  return (
    <>
      <div className="card" style={{ borderColor: 'var(--gold-soft)', marginBottom: 'var(--space-4)' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
          Credentials are encrypted server-side before storage and only ever decrypted on an explicit
          "Reveal" — never sent back as part of the normal list. Every reveal is logged. Note: this uses a
          single shared encryption key (an Edge Function secret), not the per-firm KMS key separation the
          full spec calls for — see README for what that means in practice.
        </p>
      </div>

      {canManage && (
        <form className="card invite-form" onSubmit={handleSave}>
          <h2 className="card__title" style={{ marginBottom: 'var(--space-3)', fontSize: 14 }}>
            Add or update a credential
          </h2>
          <div className="invite-form__row">
            <select className="search-input" value={portalType} onChange={(e) => setPortalType(e.target.value as PortalType)}>
              {Object.entries(portalLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="search-input"
              style={{ width: 160 }}
              placeholder="Username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className="search-input"
              style={{ width: 160 }}
              type="password"
              placeholder="Password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              className="search-input"
              style={{ width: 140 }}
              placeholder="OTP secret (optional)"
              value={otpSecret}
              onChange={(e) => setOtpSecret(e.target.value)}
            />
            <button className="btn-link" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--bad)', marginBottom: 'var(--space-4)' }}>
          <p style={{ margin: 0, color: 'var(--bad)', fontSize: 13 }}>{error}</p>
        </div>
      )}

      {revealed && revealedId && (
        <div className="card" style={{ borderColor: 'var(--gold)', marginBottom: 'var(--space-4)' }}>
          <div className="card__header">
            <h2 className="card__title" style={{ fontSize: 14 }}>
              {portalLabels[revealed.portal_type] ?? revealed.portal_type} — revealed
            </h2>
            <button className="btn-link" type="button" onClick={hideRevealed}>
              Hide now
            </button>
          </div>
          <p style={{ fontSize: 13, margin: '4px 0' }}>
            Username: <span className="mono">{revealed.username}</span>
          </p>
          <p style={{ fontSize: 13, margin: '4px 0' }}>
            Password: <span className="mono">{revealed.password}</span>
          </p>
          {revealed.otp_secret && (
            <p style={{ fontSize: 13, margin: '4px 0' }}>
              OTP secret: <span className="mono">{revealed.otp_secret}</span>
            </p>
          )}
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '8px 0 0' }}>Auto-hides in 30 seconds.</p>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="skeleton-line" style={{ width: '70%' }} />
        ) : creds.length === 0 ? (
          <p className="card__empty">No portal credentials on file for this client.</p>
        ) : (
          <table className="client-table">
            <thead>
              <tr>
                <th>Portal</th>
                <th>Last verified</th>
                <th>Visible to</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {creds.map((c) => {
                const canReveal = staff && c.access_scope.includes(staff.role);
                return (
                  <tr key={c.id}>
                    <td>{portalLabels[c.portal_type] ?? c.portal_type}</td>
                    <td className="mono">
                      {c.last_verified_at
                        ? new Date(c.last_verified_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                        : 'never verified'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{c.access_scope.join(', ')}</td>
                    <td>
                      {canReveal && (
                        <button
                          className="btn-link"
                          type="button"
                          disabled={revealBusyId === c.id}
                          onClick={() => handleReveal(c)}
                        >
                          {revealBusyId === c.id ? 'Revealing…' : 'Reveal'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
