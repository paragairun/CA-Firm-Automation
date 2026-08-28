import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getClientDetail, requestPairingCode, type ClientDetailData } from '../lib/queries';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never synced';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ClientOverview() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ClientDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getClientDetail(id, currentPeriod())
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load client.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="card" style={{ borderColor: 'var(--bad)' }}>
        <p style={{ margin: 0, color: 'var(--bad)' }}>Couldn't load this client: {error}</p>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="card">
        <div className="skeleton-line" style={{ width: '90%' }} />
        <div className="skeleton-line" style={{ width: '75%' }} />
      </div>
    );
  }

  return (
    <>
      {/* Tally Sync Panel — pinned near the top, per spec §5.2 */}
      <section className="card sync-panel">
        {data.syncConfig ? (
          <>
            <div className="sync-panel__row">
              <span className="sync-panel__label">Company</span>
              <span>{data.syncConfig.tally_company_name}</span>
            </div>
            <div className="sync-panel__row">
              <span className="sync-panel__label">Agent</span>
              <span>
                <span
                  className={`sync-health__dot sync-health__dot--${
                    data.syncConfig.agent_status === 'online' ? 'online' : 'offline'
                  }`}
                  style={{ marginRight: 6 }}
                />
                {data.syncConfig.agent_status ?? 'unknown'} · last sync {timeAgo(data.syncConfig.last_sync_at)}
              </span>
            </div>
            <div className="sync-panel__actions">
              <button className="btn-link" type="button">
                Sync now
              </button>
              <button className="btn-link" type="button">
                View ledger explorer
              </button>
            </div>
          </>
        ) : (
          <div>
            <p className="card__empty">No Tally company connected for this client yet.</p>
            {pairingCode ? (
              <p className="pairing-code">
                Pairing code: <span className="mono pairing-code__value">{pairingCode.code}</span>
                <span className="pairing-code__expiry">
                  {' '}
                  expires {new Date(pairingCode.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <br />
                Enter this into the Sync Agent installer at the client's site.
              </p>
            ) : (
              <button
                className="btn-link"
                type="button"
                disabled={pairingBusy}
                onClick={async () => {
                  if (!id) return;
                  setPairingBusy(true);
                  try {
                    setPairingCode(await requestPairingCode(id));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to generate pairing code.');
                  } finally {
                    setPairingBusy(false);
                  }
                }}
              >
                {pairingBusy ? 'Generating…' : 'Connect Tally'}
              </button>
            )}
          </div>
        )}
      </section>

      <div className="detail-grid">
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">Filings timeline</h2>
            <Link className="card__link" to="#">
              View full timeline
            </Link>
          </div>
          {data.filings.length === 0 ? (
            <p className="card__empty">No filings recorded yet.</p>
          ) : (
            <ul className="filing-timeline">
              {data.filings.map((f) => (
                <li key={f.id} className="filing-timeline__item">
                  <span className="filing-timeline__type">{f.filing_type.replace(/_/g, ' ')}</span>
                  <span className="filing-timeline__period">{f.period}</span>
                  <span className={`filing-timeline__status filing-timeline__status--${f.status}`}>
                    {f.status.replace(/_/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">Quick stats</h2>
          <div className="stat">
            <div className="stat__label">Outstanding (synced from Tally)</div>
            <div className="stat__value" style={{ fontSize: 20 }}>
              {inr.format(data.outstandingBalance)}
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">ITC at risk</div>
            <div className="stat__value" style={{ fontSize: 20, color: data.reconciliation.itcRisk > 0 ? 'var(--bad)' : undefined }}>
              {inr.format(data.reconciliation.itcRisk)}
              {data.reconciliation.mismatchCount > 0 && (
                <span className="stat__sub" style={{ display: 'inline', marginLeft: 8 }}>
                  ({data.reconciliation.mismatchCount} mismatch{data.reconciliation.mismatchCount > 1 ? 'es' : ''})
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card__header">
            <h2 className="card__title">Open tasks ({data.openTasks.length})</h2>
          </div>
          {data.openTasks.length === 0 ? (
            <p className="card__empty">No open tasks.</p>
          ) : (
            <ul className="mini-list">
              {data.openTasks.map((t) => (
                <li key={t.id} className="mini-list__item">
                  {t.title}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card__header">
            <h2 className="card__title">Document vault</h2>
            <Link className="card__link" to={`/clients/${id}/documents`}>
              View vault
            </Link>
          </div>
          {data.recentDocuments.length === 0 ? (
            <p className="card__empty">No documents uploaded yet.</p>
          ) : (
            <ul className="mini-list">
              {data.recentDocuments.map((d) => (
                <li key={d.id} className="mini-list__item">
                  {d.storage_path.split('/').pop()}
                  <span className="mono" style={{ color: 'var(--ink-faint)', marginLeft: 6 }}>
                    v{d.version}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
