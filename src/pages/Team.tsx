import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';

type StaffRow = Database['public']['Tables']['staff']['Row'];

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  partner: 'Partner',
  audit_manager: 'Audit Manager',
  article_assistant: 'Article Assistant',
};

export function Team() {
  const { staff: currentStaff } = useAuth();
  const [members, setMembers] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRow['role']>('article_assistant');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const canInvite = currentStaff && ['admin', 'partner'].includes(currentStaff.role);

  function loadMembers() {
    setLoading(true);
    supabase
      .from('staff')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (!error) setMembers(data ?? []);
        setLoading(false);
      });
  }

  useEffect(loadMembers, []);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const { data, error } = await supabase.functions.invoke('invite-staff', {
      body: { email, name, role },
    });
    setSubmitting(false);
    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }
    if (data?.error) {
      setMessage({ type: 'error', text: data.error });
      return;
    }
    setMessage({ type: 'success', text: `Invite sent to ${email}.` });
    setEmail('');
    setName('');
    setRole('article_assistant');
    loadMembers();
  }

  return (
    <div className="content">
      <div className="content__header">
        <h1 className="content__title">Team</h1>
      </div>

      {canInvite && (
        <form className="card invite-form" onSubmit={handleInvite}>
          <h2 className="card__title" style={{ marginBottom: 'var(--space-3)' }}>
            Invite a team member
          </h2>
          <div className="invite-form__row">
            <input
              className="search-input"
              style={{ width: 200 }}
              placeholder="Full name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="search-input"
              style={{ width: 220 }}
              type="email"
              placeholder="Email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select className="search-input" value={role} onChange={(e) => setRole(e.target.value as StaffRow['role'])}>
              <option value="article_assistant">Article Assistant</option>
              <option value="audit_manager">Audit Manager</option>
              <option value="partner">Partner</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn-link" type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
          {message && (
            <p style={{ color: message.type === 'error' ? 'var(--bad)' : 'var(--good)', fontSize: 13, marginTop: 'var(--space-2)' }}>
              {message.text}
            </p>
          )}
        </form>
      )}

      <div className="card">
        {loading ? (
          <div className="skeleton-line" style={{ width: '80%' }} />
        ) : (
          <table className="client-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="client-table__name">{m.name}</td>
                  <td className="mono">{m.email}</td>
                  <td>{roleLabels[m.role] ?? m.role}</td>
                  <td>
                    <span className={`client-status client-status--${m.auth_user_id ? 'active' : 'dormant'}`}>
                      {m.auth_user_id ? 'active' : 'invited'}
                    </span>
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
