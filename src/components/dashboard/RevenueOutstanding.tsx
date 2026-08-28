import { Link } from 'react-router-dom';
import type { RevenueOutstandingSummary } from '../../lib/queries';

interface Props {
  summary: RevenueOutstandingSummary | null;
  loading: boolean;
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function RevenueOutstanding({ summary, loading }: Props) {
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Revenue &amp; outstanding</h2>
        <Link className="card__link" to="/billing">
          Aging report
        </Link>
      </div>

      {loading || !summary ? (
        <>
          <div className="skeleton-line" style={{ width: '60%', height: 26 }} />
          <div className="skeleton-line" style={{ width: '50%', height: 26 }} />
        </>
      ) : (
        <>
          <div className="stat">
            <div className="stat__label">Billed (month to date)</div>
            <div className="stat__value">{inr.format(summary.billed_mtd)}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Outstanding (synced from Tally)</div>
            <div className="stat__value">{inr.format(summary.outstanding_total)}</div>
            <div className="stat__sub">
              across {summary.outstanding_client_count} client{summary.outstanding_client_count === 1 ? '' : 's'}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
