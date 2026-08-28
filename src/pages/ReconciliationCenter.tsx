import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReconciliationSummaryByClient } from '../lib/queries';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatPeriodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function ReconciliationCenter() {
  const [period, setPeriod] = useState(currentPeriod());
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getReconciliationSummaryByClient>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getReconciliationSummaryByClient(period)
      .then((data) => {
        if (!cancelled) setRows(data.sort((a, b) => b.itc_risk - a.itc_risk));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load reconciliation data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const totalItcRisk = rows.reduce((sum, r) => sum + r.itc_risk, 0);

  return (
    <div className="content" style={{ maxWidth: 1100 }}>
      <div className="content__header">
        <h1 className="content__title">Reconciliation center</h1>
        <div className="period-switcher">
          <button className="btn-link" type="button" onClick={() => setPeriod((p) => shiftPeriod(p, -1))} aria-label="Previous period">
            ←
          </button>
          <span className="mono period-switcher__label">{formatPeriodLabel(period)}</span>
          <button className="btn-link" type="button" onClick={() => setPeriod((p) => shiftPeriod(p, 1))} aria-label="Next period">
            →
          </button>
        </div>
      </div>

      {totalItcRisk > 0 && !loading && (
        <p className="recon-total-risk">
          Total ITC at risk this period: <span className="mono">{inr.format(totalItcRisk)}</span>
        </p>
      )}

      <div className="card">
        {error ? (
          <p style={{ color: 'var(--bad)', margin: 0 }}>Couldn't load reconciliation data: {error}</p>
        ) : loading ? (
          <>
            <div className="skeleton-line" style={{ width: '95%' }} />
            <div className="skeleton-line" style={{ width: '85%' }} />
          </>
        ) : rows.length === 0 ? (
          <p className="card__empty">No reconciliation records for {formatPeriodLabel(period)} yet.</p>
        ) : (
          <table className="client-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Matched</th>
                <th>Mismatch</th>
                <th>Missing in Tally</th>
                <th>Missing in portal</th>
                <th>ITC at risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.client_id}>
                  <td>
                    <Link className="client-table__name" to={`/tally/reconciliation/${row.client_id}?period=${period}`}>
                      {row.legal_name}
                    </Link>
                  </td>
                  <td className="mono">{row.matched}</td>
                  <td className="mono">{row.mismatch || '—'}</td>
                  <td className="mono">{row.missing_tally || '—'}</td>
                  <td className="mono">{row.missing_portal || '—'}</td>
                  <td className="mono" style={{ color: row.itc_risk > 0 ? 'var(--bad)' : undefined }}>
                    {row.itc_risk > 0 ? inr.format(row.itc_risk) : '—'}
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
