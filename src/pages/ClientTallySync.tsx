import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getTallySyncForClient, listLedgersForSyncConfig, type TallySyncFull, type TallyLedgerRow } from '../lib/queries';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    getTallySyncForClient(clientId)
      .then(async (s) => {
        setSync(s);
        if (s) setLedgers(await listLedgersForSyncConfig(s.id));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Tally sync data.'))
      .finally(() => setLoading(false));
  }, [clientId]);

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

  if (!sync) {
    return (
      <div className="card">
        <p className="card__empty">No Tally company connected yet — use "Connect Tally" on the Overview tab.</p>
      </div>
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
