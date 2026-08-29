import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listFilingsForClient, type Filing } from '../lib/queries';

export function ClientFilings() {
  const { id: clientId } = useParams<{ id: string }>();
  const [filings, setFilings] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    listFilingsForClient(clientId)
      .then(setFilings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load filings.'))
      .finally(() => setLoading(false));
  }, [clientId]);

  return (
    <div className="card">
      {error ? (
        <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>
      ) : loading ? (
        <>
          <div className="skeleton-line" style={{ width: '90%' }} />
          <div className="skeleton-line" style={{ width: '75%' }} />
        </>
      ) : filings.length === 0 ? (
        <p className="card__empty">No filings recorded yet.</p>
      ) : (
        <table className="client-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Period</th>
              <th>Due date</th>
              <th>Filed date</th>
              <th>Ack #</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filings.map((f) => (
              <tr key={f.id}>
                <td style={{ textTransform: 'capitalize' }}>{f.filing_type.replace(/_/g, ' ')}</td>
                <td className="mono">{f.period}</td>
                <td className="mono">{new Date(f.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td className="mono">
                  {f.filed_date ? new Date(f.filed_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                </td>
                <td className="mono">{f.ack_number ?? '—'}</td>
                <td>
                  <span
                    className={`filing-timeline__status filing-timeline__status--${
                      f.status === 'filed' || f.status === 'approved' ? 'filed' : 'pending'
                    }`}
                  >
                    {f.status.replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
