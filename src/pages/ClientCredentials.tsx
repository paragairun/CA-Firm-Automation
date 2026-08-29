import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listCredentialMetaForClient, type CredentialMeta } from '../lib/queries';

const portalLabels: Record<string, string> = {
  income_tax: 'Income Tax Portal',
  gst: 'GST Portal',
  mca: 'MCA',
  udyam: 'UDYAM',
  fssai: 'FSSAI',
};

export function ClientCredentials() {
  const { id: clientId } = useParams<{ id: string }>();
  const [creds, setCreds] = useState<CredentialMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    listCredentialMetaForClient(clientId)
      .then(setCreds)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load credentials.'))
      .finally(() => setLoading(false));
  }, [clientId]);

  return (
    <>
      <div className="card" style={{ borderColor: 'var(--gold-soft)', marginBottom: 'var(--space-4)' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
          This tab shows which portal logins are on file — it never displays the stored username or
          password, and adding new credentials isn't enabled yet. The schema stores them encrypted, but
          the actual encryption (a KMS-backed key, per the spec) isn't wired up, so entering real
          credentials through this UI would put them at risk. That has to be built before this becomes
          a write-capable form.
        </p>
      </div>

      <div className="card">
        {error ? (
          <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>
        ) : loading ? (
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
              </tr>
            </thead>
            <tbody>
              {creds.map((c) => (
                <tr key={c.id}>
                  <td>{portalLabels[c.portal_type] ?? c.portal_type}</td>
                  <td className="mono">
                    {c.last_verified_at
                      ? new Date(c.last_verified_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                      : 'never verified'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{c.access_scope.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
