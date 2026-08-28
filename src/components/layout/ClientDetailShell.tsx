import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { getClient, type Client } from '../../lib/queries';

const inertTabs = ['Credential Vault', 'Tally Sync', 'Filings', 'Tasks', 'Billing', 'Activity'];

export function ClientDetailShell() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getClient(id)
      .then((c) => {
        if (!cancelled) setClient(c);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load client.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="detail-layout">
      <nav className="sidebar" aria-label="Client sections">
        <NavLink to={`/clients/${id}`} end className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}>
          Overview
        </NavLink>
        <NavLink
          to={`/clients/${id}/documents`}
          className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}
        >
          Documents
        </NavLink>
        {inertTabs.map((tab) => (
          <span key={tab} className="sidebar__item sidebar__item--disabled" title="Not built yet">
            {tab}
          </span>
        ))}
      </nav>

      <main className="detail-main">
        <div className="detail-header">
          <Link className="card__link" to="/clients">
            ← Clients
          </Link>
          {error ? (
            <span style={{ color: 'var(--bad)', fontSize: 14 }}>{error}</span>
          ) : client ? (
            <>
              <h1 className="detail-header__name">{client.legal_name}</h1>
              <span className={`client-status client-status--${client.status}`}>{client.status}</span>
            </>
          ) : (
            <div className="skeleton-line" style={{ width: 260, height: 24 }} />
          )}
        </div>

        <Outlet />
      </main>
    </div>
  );
}
