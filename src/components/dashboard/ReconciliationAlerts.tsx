import { Link } from 'react-router-dom';

interface ReconciliationSummaryRow {
  client_id: string;
  legal_name: string;
  matched: number;
  mismatch: number;
  missing_tally: number;
  missing_portal: number;
  itc_risk: number;
}

interface Props {
  rows: ReconciliationSummaryRow[];
  loading: boolean;
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function describe(row: ReconciliationSummaryRow): string {
  const parts: string[] = [];
  if (row.mismatch > 0) parts.push(`${row.mismatch} amount mismatch${row.mismatch > 1 ? 'es' : ''}`);
  if (row.missing_tally > 0) parts.push(`${row.missing_tally} missing in Tally`);
  if (row.missing_portal > 0) parts.push(`${row.missing_portal} missing in GSTR-2B`);
  return parts.join(' · ');
}

export function ReconciliationAlerts({ rows, loading }: Props) {
  const withIssues = rows
    .filter((r) => r.mismatch > 0 || r.missing_tally > 0 || r.missing_portal > 0)
    .sort((a, b) => b.itc_risk - a.itc_risk);

  return (
    <section className="card dashboard-grid__wide">
      <div className="card__header">
        <h2 className="card__title">Reconciliation alerts — Tally ↔ portal</h2>
        <Link className="card__link" to="/tally/reconciliation">
          Reconciliation center
        </Link>
      </div>

      {loading ? (
        <>
          <div className="skeleton-line" style={{ width: '95%' }} />
          <div className="skeleton-line" style={{ width: '88%' }} />
        </>
      ) : withIssues.length === 0 ? (
        <p className="card__empty">No open discrepancies this period.</p>
      ) : (
        <div className="recon-list">
          {withIssues.slice(0, 6).map((row) => (
            <div className="recon-item" key={row.client_id}>
              <span className="recon-item__mark" aria-hidden="true">
                ⚠
              </span>
              <span className="recon-item__body">
                <span className="recon-item__client">
                  <Link to={`/clients/${row.client_id}`}>{row.legal_name}</Link>
                </span>
                {' — '}
                <span className="recon-item__detail">{describe(row)}</span>
              </span>
              {row.itc_risk > 0 && <span className="recon-item__amount">{inr.format(row.itc_risk)}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
