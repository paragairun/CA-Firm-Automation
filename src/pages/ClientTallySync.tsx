import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  getTallySyncForClient,
  listLedgersForSyncConfig,
  listAgentsForClient,
  bindAgentToSyncConfig,
  type TallySyncFull,
  type TallyLedgerRow,
  type AgentSummary,
} from '../lib/queries';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ClientTallySync() {
  const { id: clientId } = useParams<{ id: string }>();
  const [sync, setSync] = useState<TallySyncFull | null>(null);
  const [ledgers, setLedgers] = useState<TallyLedgerRow[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Company-binding form state (only relevant while sync is null but an
  // unbound paired agent exists — see the "Bind" section below).
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [frequency, setFrequency] = useState<'realtime' | 'hourly' | 'daily'>('daily');
  const [binding, setBinding] = useState(false);

  function load() {
    if (!clientId) return;
    setLoading(true);
    Promise.all([getTallySyncForClient(clientId), listAgentsForClient(clientId)])
      .then(async ([s, agentList]) => {
        setSync(s);
        setAgents(agentList);
        if (s) setLedgers(await listLedgersForSyncConfig(s.id));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Tally sync data.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [clientId]);

  async function handleBind(e: FormEvent) {
    e.preventDefault();
    if (!clientId || !selectedAgentId || !companyName.trim()) return;
    setBinding(true);
    setError(null);
    try {
      await bindAgentToSyncConfig(clientId, selectedAgentId, companyName.trim(), frequency);
      setCompanyName('');
      setSelectedAgentId('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bind agent.');
    } finally {
      setBinding(false);
    }
  }

  if (error) {
    return (
      <div className="card" style={{ borderColor: 'var(--bad)' }}>
        <p style={{ margin: 0, color: 'var(--bad)' }}>{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <div className="skeleton-line" style={{ width: '80%' }} />
      </div>
    );
  }

  const unboundAgents = agents.filter((a) => !a.bound);

  if (!sync) {
    return (
      <>
        <div className="card" style={{ marginBottom: unboundAgents.length ? 'var(--space-4)' : 0 }}>
          <p className="card__empty">No Tally company connected yet — use "Connect Tally" on the Overview tab.</p>
        </div>

        {unboundAgents.length > 0 && (
          <form className="card invite-form" onSubmit={handleBind}>
            <h2 className="card__title" style={{ marginBottom: 'var(--space-2)', fontSize: 14 }}>
              Bind a paired agent to a Tally company
            </h2>
            <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '0 0 var(--space-3)' }}>
              {unboundAgents.length} agent{unboundAgents.length > 1 ? 's have' : ' has'} paired for this client but
              {unboundAgents.length > 1 ? " aren't" : " isn't"} yet assigned to sync a specific Tally company.
            </p>
            <div className="invite-form__row">
              <select className="search-input" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} required>
                <option value="">Select paired agent…</option>
                {unboundAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.install_id.slice(0, 8)} · {a.status} · v{a.agent_version ?? '?'}
                  </option>
                ))}
              </select>
              <input
                className="search-input"
                style={{ width: 220 }}
                placeholder="Exact Tally company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
              <select className="search-input" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                <option value="daily">Daily</option>
                <option value="hourly">Hourly</option>
                <option value="realtime">Realtime</option>
              </select>
              <button className="btn-link" type="submit" disabled={binding}>
                {binding ? 'Binding…' : 'Bind'}
              </button>
            </div>
          </form>
        )}
      </>
    );
  }

  return (
    <>
      <section className="card sync-panel">
        <div className="sync-panel__row">
          <span className="sync-panel__label">Company</span>
          <span>{sync.tally_company_name}</span>
        </div>
        <div className="sync-panel__row">
          <span className="sync-panel__label">Agent</span>
          <span>
            <span className={`sync-health__dot sync-health__dot--${sync.agent_status === 'online' ? 'online' : 'offline'}`} style={{ marginRight: 6 }} />
            {sync.agent_status ?? 'unknown'} · v{sync.agent_version ?? '?'} · heartbeat {timeAgo(sync.agent_last_heartbeat)}
          </span>
        </div>
        <div className="sync-panel__row">
          <span className="sync-panel__label">Frequency</span>
          <span style={{ textTransform: 'capitalize' }}>{sync.sync_frequency}</span>
        </div>
        <div className="sync-panel__row">
          <span className="sync-panel__label">Last sync</span>
          <span>
            {timeAgo(sync.last_sync_at)} · <span style={{ textTransform: 'capitalize' }}>{sync.last_sync_status.replace(/_/g, ' ')}</span>
          </span>
        </div>
        <div className="sync-panel__row">
          <span className="sync-panel__label">Write-back</span>
          <span>{sync.write_back_enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </section>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Ledger explorer ({ledgers.length})</h2>
        </div>
        {ledgers.length === 0 ? (
          <p className="card__empty">No ledgers synced yet.</p>
        ) : (
          <table className="client-table">
            <thead>
              <tr>
                <th>Ledger</th>
                <th>Group</th>
                <th>GSTIN</th>
                <th>Opening</th>
                <th>Closing</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {ledgers.map((l) => (
                <tr key={l.id}>
                  <td>{l.ledger_name}</td>
                  <td style={{ color: 'var(--ink-faint)', fontSize: 12 }}>{l.ledger_group ?? '—'}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{l.gstin ?? '—'}</td>
                  <td className="mono">{l.opening_balance.toLocaleString('en-IN')}</td>
                  <td className="mono">{l.closing_balance.toLocaleString('en-IN')}</td>
                  <td className="mono" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                    {l.balance_type ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
