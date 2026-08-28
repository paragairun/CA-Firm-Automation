import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listClients, type Client } from '../lib/queries';

const entityLabels: Record<string, string> = {
  individual: 'Individual',
  firm: 'Firm',
  llp: 'LLP',
  pvt_ltd: 'Pvt Ltd',
  trust: 'Trust',
};

export function ClientList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    listClients()
      .then((data) => {
        if (!cancelled) setClients(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load clients.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = clients.filter((c) => c.legal_name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="content">
      <div className="content__header">
        <h1 className="content__title">Clients</h1>
        <input
          className="search-input"
          type="search"
          placeholder="Search clients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />
      </div>

      <div className="card">
        {error ? (
          <p style={{ color: 'var(--bad)', margin: 0 }}>Couldn't load clients: {error}</p>
        ) : loading ? (
          <>
            <div className="skeleton-line" style={{ width: '100%' }} />
            <div className="skeleton-line" style={{ width: '90%' }} />
            <div className="skeleton-line" style={{ width: '95%' }} />
          </>
        ) : filtered.length === 0 ? (
          <p className="card__empty">
            {clients.length === 0 ? 'No clients yet.' : 'No clients match your search.'}
          </p>
        ) : (
          <table className="client-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Entity type</th>
                <th>GSTIN</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="client-table__name" to={`/clients/${c.id}`}>
                      {c.legal_name}
                    </Link>
                  </td>
                  <td>{entityLabels[c.entity_type] ?? c.entity_type}</td>
                  <td className="mono">{c.gstins?.[0] ?? '—'}</td>
                  <td>
                    <span className={`client-status client-status--${c.status}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
