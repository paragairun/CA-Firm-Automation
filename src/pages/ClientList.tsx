import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listClients, createClient, type Client, type NewClientInput } from '../lib/queries';

const entityLabels: Record<string, string> = {
  individual: 'Individual',
  firm: 'Firm',
  llp: 'LLP',
  pvt_ltd: 'Pvt Ltd',
  trust: 'Trust',
};

export function ClientList() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [entityType, setEntityType] = useState<Client['entity_type']>('pvt_ltd');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    listClients()
      .then(setClients)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load clients.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!legalName.trim()) return;
    setCreating(true);
    setFormError(null);
    try {
      const input: NewClientInput = {
        entity_type: entityType,
        legal_name: legalName.trim(),
        pan: pan.trim() || undefined,
        gstins: gstin.trim() ? [gstin.trim()] : undefined,
      };
      const created = await createClient(input);
      // Straight to the new client's Overview — the natural next step
      // after creating one is filling it in (documents, Tally connection,
      // etc.), not staring at the list again.
      navigate(`/clients/${created.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create client.');
    } finally {
      setCreating(false);
    }
  }

  const filtered = clients.filter((c) => c.legal_name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="content">
      <div className="content__header">
        <h1 className="content__title">Clients</h1>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <input
            className="search-input"
            type="search"
            placeholder="Search clients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search clients"
          />
          <button className="btn-link" type="button" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New client'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="card invite-form" onSubmit={handleCreate} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className="card__title" style={{ marginBottom: 'var(--space-3)', fontSize: 14 }}>
            New client
          </h2>
          <div className="invite-form__row">
            <select
              className="search-input"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as Client['entity_type'])}
            >
              {Object.entries(entityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="search-input"
              style={{ width: 240 }}
              placeholder="Legal name"
              required
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
            <input
              className="search-input"
              style={{ width: 160 }}
              placeholder="GSTIN (optional)"
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
            />
            <input
              className="search-input"
              style={{ width: 140 }}
              placeholder="PAN (optional)"
              value={pan}
              onChange={(e) => setPan(e.target.value)}
            />
            <button className="btn-link" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
          {formError && <p style={{ color: 'var(--bad)', fontSize: 13, marginTop: 'var(--space-2)' }}>{formError}</p>}
        </form>
      )}

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
            {clients.length === 0 ? 'No clients yet — use "+ New client" above to add your first one.' : 'No clients match your search.'}
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
