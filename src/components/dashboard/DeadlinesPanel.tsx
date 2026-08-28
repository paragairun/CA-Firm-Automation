import { Link } from 'react-router-dom';
import type { UpcomingDeadline } from '../../lib/queries';

interface Props {
  deadlines: UpcomingDeadline[];
  loading: boolean;
}

function isUrgent(dueDate: string) {
  const due = new Date(dueDate);
  const in2Days = new Date();
  in2Days.setDate(in2Days.getDate() + 2);
  return due <= in2Days;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function DeadlinesPanel({ deadlines, loading }: Props) {
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Upcoming deadlines</h2>
        <Link className="card__link" to="/tasks">
          Task board
        </Link>
      </div>

      {loading ? (
        <>
          <div className="skeleton-line" style={{ width: '85%' }} />
          <div className="skeleton-line" style={{ width: '70%' }} />
          <div className="skeleton-line" style={{ width: '80%' }} />
        </>
      ) : deadlines.length === 0 ? (
        <p className="card__empty">Nothing due in the next 7 days.</p>
      ) : (
        <ul className="deadline-list">
          {deadlines.slice(0, 6).map((d) => (
            <li className="deadline-item" key={d.filing_id}>
              <span className={`deadline-item__date${isUrgent(d.due_date) ? ' deadline-item__date--urgent' : ''}`}>
                {formatDate(d.due_date)}
              </span>
              <span className="deadline-item__body">
                <span className="deadline-item__filing">{d.filing_type.replace(/_/g, ' ')}</span>
                <Link to={`/clients/${d.client_id}`}>{d.legal_name}</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
