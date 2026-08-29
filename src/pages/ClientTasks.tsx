import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listTasksForClient, updateTaskStatus, type Task } from '../lib/queries';

const statusOptions: Task['status'][] = ['pending', 'docs_requested', 'in_progress', 'under_review', 'filed', 'approved'];

export function ClientTasks() {
  const { id: clientId } = useParams<{ id: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    if (!clientId) return;
    listTasksForClient(clientId)
      .then(setTasks)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tasks.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [clientId]);

  async function handleStatusChange(task: Task, status: Task['status']) {
    setBusyId(task.id);
    try {
      await updateTaskStatus(task.id, status);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}
      {loading ? (
        <>
          <div className="skeleton-line" style={{ width: '90%' }} />
          <div className="skeleton-line" style={{ width: '75%' }} />
        </>
      ) : tasks.length === 0 ? (
        <p className="card__empty">No tasks for this client yet.</p>
      ) : (
        <table className="client-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Priority</th>
              <th>Due date</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td style={{ textTransform: 'capitalize' }}>{t.priority}</td>
                <td className="mono">
                  {t.due_date ? new Date(t.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                </td>
                <td style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{t.trigger_source.replace(/_/g, ' ')}</td>
                <td>
                  <select
                    className="search-input"
                    style={{ width: 150, fontSize: 12 }}
                    value={t.status}
                    disabled={busyId === t.id}
                    onChange={(e) => handleStatusChange(t, e.target.value as Task['status'])}
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
