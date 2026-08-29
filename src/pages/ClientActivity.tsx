import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listActivityForClient, type ActivityLogRow } from '../lib/queries';

const actionLabels: Record<string, string> = {
  filing_status_changed: 'Filing',
  task_status_changed: 'Task',
  document_uploaded: 'Document',
  reconciliation_resolved: 'Reconciliation',
  reconciliation_escalated: 'Reconciliation',
};

export function ClientActivity() {
  const { id: clientId } = useParams<{ id: string }>();
  const [entries, setEntries] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    listActivityForClient(clientId)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load activity.'))
      .finally(() => setLoading(false));
  }, [clientId]);

  return (
    <>
      <div className="card" style={{ borderColor: 'var(--gold-soft)', marginBottom: 'var(--space-4)' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
          This covers filing status changes, task status changes, document uploads, and reconciliation
          resolutions — not every action taken on this client. It's a scoped timeline, not a full audit trail.
        </p>
      </div>

      <div className="card">
        {error ? (
          <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>
        ) : loading ? (
          <div className="skeleton-line" style={{ width: '80%' }} />
        ) : entries.length === 0 ? (
          <p className="card__empty">No recorded activity yet.</p>
        ) : (
          <ul className="mini-list">
            {entries.map((e) => (
              <li key={e.id} className="mini-list__item">
                <span className="deadline-item__filing">{actionLabels[e.action] ?? e.action}</span>
                {e.summary}
                <span className="mono" style={{ float: 'right', color: 'var(--ink-faint)', fontSize: 12 }}>
                  {new Date(e.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
