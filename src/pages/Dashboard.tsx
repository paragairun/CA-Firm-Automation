import { useEffect, useState } from 'react';
import {
  getComplianceHeatmap,
  getSyncHealthSummary,
  getRevenueOutstandingSummary,
  getUpcomingDeadlines,
  getReconciliationSummaryByClient,
  type ComplianceHeatmapRow,
  type SyncHealthSummary,
  type RevenueOutstandingSummary,
  type UpcomingDeadline,
} from '../lib/queries';
import { ComplianceHeatmap } from '../components/dashboard/ComplianceHeatmap';
import { SyncHealthPanel } from '../components/dashboard/SyncHealthPanel';
import { RevenueOutstanding } from '../components/dashboard/RevenueOutstanding';
import { DeadlinesPanel } from '../components/dashboard/DeadlinesPanel';
import { ReconciliationAlerts } from '../components/dashboard/ReconciliationAlerts';

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function Dashboard() {
  const [heatmap, setHeatmap] = useState<ComplianceHeatmapRow[]>([]);
  const [syncHealth, setSyncHealth] = useState<SyncHealthSummary | null>(null);
  const [revenue, setRevenue] = useState<RevenueOutstandingSummary | null>(null);
  const [deadlines, setDeadlines] = useState<UpcomingDeadline[]>([]);
  const [reconciliation, setReconciliation] = useState<
    Awaited<ReturnType<typeof getReconciliationSummaryByClient>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [heatmapData, syncData, revenueData, deadlineData, reconData] = await Promise.all([
          getComplianceHeatmap(),
          getSyncHealthSummary(),
          getRevenueOutstandingSummary(),
          getUpcomingDeadlines(7),
          getReconciliationSummaryByClient(currentPeriod()),
        ]);
        if (cancelled) return;
        setHeatmap(heatmapData);
        setSyncHealth(syncData);
        setRevenue(revenueData);
        setDeadlines(deadlineData);
        setReconciliation(reconData);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {error && (
        <div className="dashboard-grid" style={{ paddingBottom: 0 }}>
          <div className="card dashboard-grid__wide" style={{ borderColor: 'var(--bad)' }}>
            <p style={{ margin: 0, color: 'var(--bad)' }}>Couldn't load the dashboard: {error}</p>
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        <ComplianceHeatmap rows={heatmap} loading={loading} />
        <SyncHealthPanel summary={syncHealth} loading={loading} />

        <RevenueOutstanding summary={revenue} loading={loading} />
        <DeadlinesPanel deadlines={deadlines} loading={loading} />

        <ReconciliationAlerts rows={reconciliation} loading={loading} />
      </div>
    </>
  );
}
