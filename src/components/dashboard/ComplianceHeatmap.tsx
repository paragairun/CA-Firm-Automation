import { Link } from 'react-router-dom';
import type { ComplianceHeatmapRow } from '../../lib/queries';
import { StatusStamp } from './StatusStamp';

interface Props {
  rows: ComplianceHeatmapRow[];
  loading: boolean;
}

export function ComplianceHeatmap({ rows, loading }: Props) {
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Compliance heatmap</h2>
        <Link className="card__link" to="/clients">
          View all clients
        </Link>
      </div>

      {loading ? (
        <>
          <div className="skeleton-line" style={{ width: '100%' }} />
          <div className="skeleton-line" style={{ width: '90%' }} />
          <div className="skeleton-line" style={{ width: '95%' }} />
        </>
      ) : rows.length === 0 ? (
        <p className="card__empty">No clients yet. Add a client to start tracking compliance.</p>
      ) : (
        <table className="heatmap">
          <thead>
            <tr>
              <th>Client</th>
              <th className="heatmap__status-col">GST</th>
              <th className="heatmap__status-col">ITR</th>
              <th className="heatmap__status-col">TDS</th>
              <th className="heatmap__status-col">Audit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.client_id}>
                <td className="heatmap__client-name">
                  <Link className="heatmap__client-link" to={`/clients/${row.client_id}`}>
                    {row.legal_name}
                  </Link>
                </td>
                <td className="heatmap__status-col">
                  <StatusStamp status={row.gst.status} dueDate={row.gst.due_date} />
                </td>
                <td className="heatmap__status-col">
                  <StatusStamp status={row.itr.status} dueDate={row.itr.due_date} />
                </td>
                <td className="heatmap__status-col">
                  <StatusStamp status={row.tds.status} dueDate={row.tds.due_date} />
                </td>
                <td className="heatmap__status-col">
                  <StatusStamp status={row.audit.status} dueDate={row.audit.due_date} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
