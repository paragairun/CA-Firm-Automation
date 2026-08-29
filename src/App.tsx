import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './components/layout/RequireAuth';
import { ClientDetailShell } from './components/layout/ClientDetailShell';
import { Login } from './pages/Login';
import { AcceptInvite } from './pages/AcceptInvite';
import { Dashboard } from './pages/Dashboard';
import { ClientList } from './pages/ClientList';
import { ClientOverview } from './pages/ClientOverview';
import { ClientDocuments } from './pages/ClientDocuments';
import { ClientCredentials } from './pages/ClientCredentials';
import { ClientTallySync } from './pages/ClientTallySync';
import { ClientFilings } from './pages/ClientFilings';
import { ClientTasks } from './pages/ClientTasks';
import { ClientBilling } from './pages/ClientBilling';
import { ReconciliationCenter } from './pages/ReconciliationCenter';
import { ReconciliationDetail } from './pages/ReconciliationDetail';
import { Team } from './pages/Team';
import { ComingSoon } from './pages/ComingSoon';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/clients" element={<ClientList />} />
              <Route path="/clients/:id" element={<ClientDetailShell />}>
                <Route index element={<ClientOverview />} />
                <Route path="documents" element={<ClientDocuments />} />
                <Route path="credentials" element={<ClientCredentials />} />
                <Route path="tally-sync" element={<ClientTallySync />} />
                <Route path="filings" element={<ClientFilings />} />
                <Route path="tasks" element={<ClientTasks />} />
                <Route path="billing" element={<ClientBilling />} />
              </Route>
              <Route path="/team" element={<Team />} />
              <Route path="/tally" element={<ComingSoon title="Tally Integration Hub" />} />
              <Route path="/tally/reconciliation" element={<ReconciliationCenter />} />
              <Route path="/tally/reconciliation/:id" element={<ReconciliationDetail />} />
              <Route path="/billing" element={<ComingSoon title="Billing" />} />
              <Route path="/tasks" element={<ComingSoon title="Task Board" />} />
              <Route path="*" element={<ComingSoon title="Not found" />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
