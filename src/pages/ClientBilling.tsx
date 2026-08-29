import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listInvoicesForClient, listTimeEntriesForClient, type InvoiceRow, type TimeEntrySummary } from '../lib/queries';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function ClientBilling() {
  const { id: clientId } = useParams<{ id: string }>();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    Promise.all([listInvoicesForClient(clientId), listTimeEntriesForClient(clientId)])
      .then(([inv, entries]) => {
        setInvoices(inv);
        setTimeEntries(entries);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load billing data.'))
      .finally(() => setLoading(false));
  }, [clientId]);

  const hoursByStaff = timeEntries.reduce<Record<string, number>>((acc, e) => {
    acc[e.staff_name] = (acc[e.staff_name] ?? 0) + e.minutes_logged;
    return acc;
  }, {});

  if (error) {
    return (
      <div className="card" style={{ borderColor: 'var(--bad)' }}>
        <p style={{ margin: 0, color: 'var(--bad)' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="detail-grid">
      <section className="card">
        <div className="card__header">
          <h2 className="card__title">Invoices</h2>
        </div>
        {loading ? (
          <div className="skeleton-line" style={{ width: '80%' }} />
        ) : invoices.length === 0 ? (
          <p className="card__empty">No invoices yet.</p>
        ) : (
          <table className="client-table">
            <thead>
              <tr>
                <th>Issued</th>
                <th>Due</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="mono">{inv.issued_date ? new Date(inv.issued_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</td>
                  <td className="mono">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</td>
                  <td className="mono">{inr.format(inv.total)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{inv.status.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">Time logged</h2>
        </div>
        {loading ? (
          <div className="skeleton-line" style={{ width: '70%' }} />
        ) : Object.keys(hoursByStaff).length === 0 ? (
          <p className="card__empty">No time entries yet.</p>
        ) : (
          <ul className="mini-list">
            {Object.entries(hoursByStaff).map(([name, minutes]) => (
              <li key={name} className="mini-list__item">
                {name}
                <span className="mono" style={{ float: 'right', color: 'var(--ink-soft)' }}>
                  {(minutes / 60).toFixed(1)}h
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
