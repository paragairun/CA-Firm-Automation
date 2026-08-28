import { Link } from 'react-router-dom';
import type { SyncHealthSummary } from '../../lib/queries';

interface Props {
  summary: SyncHealthSummary | null;
  loading: boolean;
}

export function SyncHealthPanel({ summary, loading }: Props) {
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Tally sync health</h2>
        <Link className="card__link" to="/tally">
          Sync hub
        </Link>
      </div>

      {loading || !summary ? (
        <>
          <div className="skeleton-line" style={{ width: '80%' }} />
          <div className="skeleton-line" style={{ width: '70%' }} />
          <div className="skeleton-line" style={{ width: '75%' }} />
        </>
      ) : (
        <div className="sync-health">
          <Row dot="online" label="Online" count={summary.online} />
          <Row dot="stale" label="Stale (over 24h)" count={summary.stale} />
          <Row dot="offline" label="Offline" count={summary.offline} />
        </div>
      )}
    </section>
  );
}

function Row({ dot, label, count }: { dot: 'online' | 'stale' | 'offline'; label: string; count: number }) {
  return (
    <div className="sync-health__row">
      <span className={`sync-health__dot sync-health__dot--${dot}`} />
      <span className="sync-health__label">{label}</span>
      <span className="mono sync-health__count">{count}</span>
    </div>
  );
}
