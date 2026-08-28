import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

export function AppShell({ firmName = 'Demo & Associates' }: { firmName?: string }) {
  const { staff, signOut } = useAuth();
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead__left">
          <h1 className="masthead__firm">{firmName}</h1>
          <nav className="masthead__nav">
            <NavLink to="/" end className={({ isActive }) => `masthead__nav-link${isActive ? ' masthead__nav-link--active' : ''}`}>
              Dashboard
            </NavLink>
            <NavLink to="/clients" className={({ isActive }) => `masthead__nav-link${isActive ? ' masthead__nav-link--active' : ''}`}>
              Clients
            </NavLink>
            <NavLink to="/team" className={({ isActive }) => `masthead__nav-link${isActive ? ' masthead__nav-link--active' : ''}`}>
              Team
            </NavLink>
          </nav>
        </div>
        <div className="masthead__right">
          <span className="masthead__date">{today}</span>
          {staff && (
            <span className="masthead__user">
              {staff.name}
              <button className="btn-link" type="button" onClick={signOut} style={{ marginLeft: 'var(--space-3)' }}>
                Sign out
              </button>
            </span>
          )}
        </div>
      </header>
      <Outlet />
    </div>
  );
}
