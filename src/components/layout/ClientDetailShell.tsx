import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { getClient, type Client } from '../../lib/queries';

const inertTabs = ['Activity'];

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

  const navItem = (to: string, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}>
      {label}
    </NavLink>
  );

  return (
    <div className="detail-layout">
      <nav className="sidebar" aria-label="Client sections">
        {navItem(`/clients/${id}`, 'Overview', true)}
        {navItem(`/clients/${id}/documents`, 'Documents')}
        {navItem(`/clients/${id}/credentials`, 'Credential Vault')}
        {navItem(`/clients/${id}/tally-sync`, 'Tally Sync')}
        {navItem(`/clients/${id}/filings`, 'Filings')}
        {navItem(`/clients/${id}/tasks`, 'Tasks')}
        {navItem(`/clients/${id}/billing`, 'Billing')}
        {inertTabs.map((tab) => (
          <span key={tab} className="sidebar__item sidebar__item--disabled" title="No activity log table yet">
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
