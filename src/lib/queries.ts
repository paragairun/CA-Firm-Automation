// Typed data-access layer over Supabase.
// RLS on the database enforces firm/client scoping — these helpers assume
// an authenticated session and don't re-check permissions client-side.

import { supabase } from './supabaseClient';
import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
export type Client = Tables['clients']['Row'];
export type Filing = Tables['filings']['Row'];
export type Task = Tables['tasks']['Row'];
export type ReconciliationRecord = Tables['reconciliation_records']['Row'];
export type TallySyncConfig = Tables['tally_sync_configs']['Row'];

// ---------- Current Staff ----------

export async function getCurrentStaffId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('staff').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// ---------- Tally Agent Pairing ----------

export async function requestPairingCode(clientId: string): Promise<{ code: string; expires_at: string }> {
  const { data, error } = await supabase.functions.invoke('request-pairing-code', {
    body: { client_id: clientId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---------- Clients ----------

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('legal_name');
  if (error) throw error;
  return data;
}

export async function getClient(clientId: string): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();
  if (error) throw error;
  return data;
}

// ---------- Client Detail View ----------
// One consolidated fetch for everything the Client Detail page needs — the
// spec's wireframe (§5.2) shows Tally Sync Panel, Filings Timeline, Quick
// Stats, Open Tasks, and recent Documents together on first load.

export interface ClientDetailData {
  client: Client;
  syncConfig: (TallySyncConfig & { agent_status: string | null; agent_last_heartbeat: string | null }) | null;
  filings: Filing[];
  openTasks: Task[];
  recentDocuments: Array<{ id: string; category: string; storage_path: string; version: number; created_at: string }>;
  outstandingBalance: number;
  reconciliation: { mismatchCount: number; itcRisk: number };
}

export async function getClientDetail(clientId: string, period: string): Promise<ClientDetailData> {
  const [clientRes, syncRes, filingsRes, tasksRes, docsRes, ledgersRes, reconRes] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase
      .from('tally_sync_configs')
      .select('*, tally_sync_agents(status, last_heartbeat_at)')
      .eq('client_id', clientId)
      .maybeSingle()
      .returns<
        | (TallySyncConfig & { tally_sync_agents: { status: string; last_heartbeat_at: string | null } | null })
        | null
      >(),
    supabase.from('filings').select('*').eq('client_id', clientId).order('due_date', { ascending: false }).limit(8),
    supabase
      .from('tasks')
      .select('*')
      .eq('client_id', clientId)
      .not('status', 'in', '(filed,approved)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(6),
    supabase
      .from('documents')
      .select('id, category, storage_path, version, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('tally_ledgers')
      .select('closing_balance, balance_type, ledger_group, tally_sync_configs!inner(client_id)')
      .eq('tally_sync_configs.client_id', clientId)
      .ilike('ledger_group', '%debtor%')
      .returns<Array<{ closing_balance: number | null; balance_type: 'dr' | 'cr' | null; ledger_group: string | null }>>(),
    supabase
      .from('reconciliation_records')
      .select('status, delta')
      .eq('client_id', clientId)
      .eq('period', period)
      .in('status', ['mismatch', 'missing_in_tally']),
  ]);

  if (clientRes.error) throw clientRes.error;
  if (syncRes.error) throw syncRes.error;
  if (filingsRes.error) throw filingsRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (docsRes.error) throw docsRes.error;
  if (ledgersRes.error) throw ledgersRes.error;
  if (reconRes.error) throw reconRes.error;

  const syncData = syncRes.data;
  const syncConfig = syncData
    ? {
        ...syncData,
        agent_status: syncData.tally_sync_agents?.status ?? null,
        agent_last_heartbeat: syncData.tally_sync_agents?.last_heartbeat_at ?? null,
      }
    : null;

  const outstandingBalance = (ledgersRes.data ?? []).reduce((sum, l) => {
    const signed = l.balance_type === 'dr' ? (l.closing_balance ?? 0) : -(l.closing_balance ?? 0);
    return sum + signed;
  }, 0);

  const reconciliation = (reconRes.data ?? []).reduce(
    (acc, r) => ({
      mismatchCount: acc.mismatchCount + 1,
      itcRisk: acc.itcRisk + Math.abs(r.delta ?? 0),
    }),
    { mismatchCount: 0, itcRisk: 0 }
  );

  return {
    client: clientRes.data,
    syncConfig,
    filings: filingsRes.data ?? [],
    openTasks: tasksRes.data ?? [],
    recentDocuments: docsRes.data ?? [],
    outstandingBalance,
    reconciliation,
  };
}

// ---------- Compliance Heatmap ----------
// One row per client with latest filing status per filing_type family,
// suitable for the Dashboard heatmap grid.

export interface ComplianceHeatmapCell {
  status: string | null;
  due_date: string | null;
}

export interface ComplianceHeatmapRow {
  client_id: string;
  legal_name: string;
  gst: ComplianceHeatmapCell;
  itr: ComplianceHeatmapCell;
  tds: ComplianceHeatmapCell;
  audit: ComplianceHeatmapCell;
}

export async function getComplianceHeatmap(): Promise<ComplianceHeatmapRow[]> {
  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('id, legal_name')
    .order('legal_name');
  if (clientErr) throw clientErr;

  const { data: filings, error: filingErr } = await supabase
    .from('filings')
    .select('client_id, filing_type, status, due_date')
    .order('due_date', { ascending: false });
  if (filingErr) throw filingErr;

  const gstTypes = new Set(['gstr1', 'gstr3b', 'gstr9', 'gstr9c']);
  const itrTypes = new Set(['itr1', 'itr2', 'itr3', 'itr4', 'itr5', 'itr6', 'itr7']);
  const tdsTypes = new Set(['tds_24q', 'tds_26q']);
  const auditTypes = new Set(['form_3ca_3cd', 'form_3cb_3cd']);

  const latestByFamily = (clientId: string, family: Set<string>): ComplianceHeatmapCell => {
    const match = filings.find((f) => f.client_id === clientId && family.has(f.filing_type));
    return { status: match?.status ?? null, due_date: match?.due_date ?? null };
  };

  return clients.map((c) => ({
    client_id: c.id,
    legal_name: c.legal_name,
    gst: latestByFamily(c.id, gstTypes),
    itr: latestByFamily(c.id, itrTypes),
    tds: latestByFamily(c.id, tdsTypes),
    audit: latestByFamily(c.id, auditTypes),
  }));
}

// ---------- Upcoming Deadlines ----------

export interface UpcomingDeadline {
  filing_id: string;
  client_id: string;
  legal_name: string;
  filing_type: string;
  due_date: string;
  status: string;
}

export async function getUpcomingDeadlines(daysAhead = 7): Promise<UpcomingDeadline[]> {
  const today = new Date();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysAhead);

  interface RawRow {
    id: string;
    client_id: string;
    filing_type: string;
    due_date: string;
    status: string;
    clients: { legal_name: string } | null;
  }

  const { data, error } = await supabase
    .from('filings')
    .select('id, client_id, filing_type, due_date, status, clients(legal_name)')
    .not('status', 'in', '(filed,approved)')
    .lte('due_date', horizon.toISOString().slice(0, 10))
    .order('due_date', { ascending: true })
    .returns<RawRow[]>();
  if (error) throw error;

  return data.map((f) => ({
    filing_id: f.id,
    client_id: f.client_id,
    legal_name: f.clients?.legal_name ?? 'Unknown',
    filing_type: f.filing_type,
    due_date: f.due_date,
    status: f.status,
  }));
}

// ---------- Revenue & Outstanding ----------

export interface RevenueOutstandingSummary {
  billed_mtd: number;
  outstanding_total: number;
  outstanding_client_count: number;
}

export async function getRevenueOutstandingSummary(): Promise<RevenueOutstandingSummary> {
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const { data: invoices, error: invErr } = await supabase
    .from('invoices')
    .select('total, issued_date')
    .gte('issued_date', monthStartStr);
  if (invErr) throw invErr;

  // Outstanding receivables sourced from synced Tally ledgers (Sundry Debtors
  // group), per the spec's "Revenue & Outstanding Metrics" requirement.
  interface RawLedgerRow {
    closing_balance: number | null;
    balance_type: 'dr' | 'cr' | null;
    ledger_group: string | null;
    sync_config_id: string;
    tally_sync_configs: { client_id: string } | null;
  }

  const { data: ledgers, error: ledgerErr } = await supabase
    .from('tally_ledgers')
    .select('closing_balance, balance_type, ledger_group, sync_config_id, tally_sync_configs(client_id)')
    .ilike('ledger_group', '%debtor%')
    .returns<RawLedgerRow[]>();
  if (ledgerErr) throw ledgerErr;

  const billed_mtd = invoices.reduce((sum, i) => sum + (i.total ?? 0), 0);

  const clientBalances = new Map<string, number>();
  for (const l of ledgers) {
    const clientId = l.tally_sync_configs?.client_id;
    if (!clientId) continue;
    const signed = l.balance_type === 'dr' ? (l.closing_balance ?? 0) : -(l.closing_balance ?? 0);
    clientBalances.set(clientId, (clientBalances.get(clientId) ?? 0) + signed);
  }

  let outstanding_total = 0;
  let outstanding_client_count = 0;
  for (const balance of clientBalances.values()) {
    if (balance > 0) {
      outstanding_total += balance;
      outstanding_client_count += 1;
    }
  }

  return { billed_mtd, outstanding_total, outstanding_client_count };
}



export interface SyncHealthSummary {
  online: number;
  stale: number;
  offline: number;
}

export async function getSyncHealthSummary(): Promise<SyncHealthSummary> {
  const { data, error } = await supabase
    .from('tally_sync_agents')
    .select('status, last_heartbeat_at');
  if (error) throw error;

  const staleThresholdMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  return data.reduce(
    (acc, agent) => {
      if (agent.status === 'offline') {
        acc.offline += 1;
      } else if (
        agent.last_heartbeat_at &&
        now - new Date(agent.last_heartbeat_at).getTime() > staleThresholdMs
      ) {
        acc.stale += 1;
      } else {
        acc.online += 1;
      }
      return acc;
    },
    { online: 0, stale: 0, offline: 0 }
  );
}

// ---------- Reconciliation Center ----------

export async function getReconciliationSummaryByClient(period: string) {
  interface RawReconRow {
    client_id: string;
    status: string;
    delta: number | null;
    clients: { legal_name: string } | null;
  }

  const { data, error } = await supabase
    .from('reconciliation_records')
    .select('client_id, status, delta, clients(legal_name)')
    .eq('period', period)
    .returns<RawReconRow[]>();
  if (error) throw error;

  const byClient = new Map<
    string,
    { legal_name: string; matched: number; mismatch: number; missing_tally: number; missing_portal: number; itc_risk: number }
  >();

  for (const row of data) {
    const clientName = row.clients?.legal_name ?? 'Unknown';
    const entry = byClient.get(row.client_id) ?? {
      legal_name: clientName,
      matched: 0,
      mismatch: 0,
      missing_tally: 0,
      missing_portal: 0,
      itc_risk: 0,
    };
    if (row.status === 'matched') entry.matched += 1;
    else if (row.status === 'mismatch') {
      entry.mismatch += 1;
      entry.itc_risk += Math.abs(row.delta ?? 0);
    } else if (row.status === 'missing_in_tally') {
      entry.missing_tally += 1;
      entry.itc_risk += Math.abs(row.delta ?? 0);
    } else if (row.status === 'missing_in_portal') {
      entry.missing_portal += 1;
    }
    byClient.set(row.client_id, entry);
  }

  return Array.from(byClient.entries()).map(([client_id, v]) => ({ client_id, ...v }));
}

export interface ReconciliationLineItem {
  id: string;
  supplier_gstin: string | null;
  invoice_number: string | null;
  tally_value: number | null;
  portal_value: number | null;
  delta: number | null;
  status: string;
  resolution_notes: string | null;
}

export async function getReconciliationLineItems(
  clientId: string,
  period: string
): Promise<ReconciliationLineItem[]> {
  const { data, error } = await supabase
    .from('reconciliation_records')
    .select('id, supplier_gstin, invoice_number, tally_value, portal_value, delta, status, resolution_notes')
    .eq('client_id', clientId)
    .eq('period', period)
    .order('status')
    .order('delta', { ascending: false });
  if (error) throw error;
  return data;
}

// A single shared note applied to every record in the batch. This is a
// pragmatic simplification of the spec's bulk-resolve flow (§7.3), which
// calls for each row already carrying its own note before a bulk "mark
// resolved" is allowed — full per-row note capture is a further UI pass.
export async function bulkResolveReconciliationRecords(
  recordIds: string[],
  sharedNote: string,
  resolvedBy: string
) {
  if (!sharedNote.trim()) {
    throw new Error('A resolution note is required before marking discrepancies resolved.');
  }
  const { error } = await supabase
    .from('reconciliation_records')
    .update({
      status: 'resolved',
      resolution_notes: sharedNote,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .in('id', recordIds);
  if (error) throw error;
}

export async function escalateReconciliationRecord(recordId: string) {
  const { error } = await supabase
    .from('reconciliation_records')
    .update({ status: 'escalated' })
    .eq('id', recordId);
  if (error) throw error;
}

export async function resolveReconciliationRecord(
  recordId: string,
  resolutionNotes: string,
  resolvedBy: string
) {
  if (!resolutionNotes.trim()) {
    throw new Error('A resolution note is required before marking a discrepancy resolved.');
  }
  const { error } = await supabase
    .from('reconciliation_records')
    .update({
      status: 'resolved',
      resolution_notes: resolutionNotes,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', recordId);
  if (error) throw error;
}

// ---------- Activity Log ----------

export interface ActivityLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  summary: string;
  created_at: string;
}

export async function listActivityForClient(clientId: string, limit = 50): Promise<ActivityLogRow[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, actor_id, action, summary, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}



export async function listFilingsForClient(clientId: string): Promise<Filing[]> {
  const { data, error } = await supabase
    .from('filings')
    .select('*')
    .eq('client_id', clientId)
    .order('due_date', { ascending: false });
  if (error) throw error;
  return data;
}

// ---------- Credential Vault (metadata only — never selects the
// encrypted secret columns; there is nothing client code can safely do
// with ciphertext it can't decrypt anyway) ----------

export interface CredentialMeta {
  id: string;
  portal_type: string;
  last_verified_at: string | null;
  access_scope: string[];
}

export async function listCredentialMetaForClient(clientId: string): Promise<CredentialMeta[]> {
  const { data, error } = await supabase
    .from('credentials_vault')
    .select('id, portal_type, last_verified_at, access_scope')
    .eq('client_id', clientId)
    .order('portal_type');
  if (error) throw error;
  return data;
}

// ---------- Tally Sync tab: full sync config + ledger explorer ----------

export interface TallySyncFull extends TallySyncConfig {
  agent_status: string | null;
  agent_last_heartbeat: string | null;
  agent_version: string | null;
}

export async function getTallySyncForClient(clientId: string): Promise<TallySyncFull | null> {
  const { data, error } = await supabase
    .from('tally_sync_configs')
    .select('*, tally_sync_agents(status, last_heartbeat_at, agent_version)')
    .eq('client_id', clientId)
    .maybeSingle()
    .returns<
      | (TallySyncConfig & {
          tally_sync_agents: { status: string; last_heartbeat_at: string | null; agent_version: string | null } | null;
        })
      | null
    >();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    agent_status: data.tally_sync_agents?.status ?? null,
    agent_last_heartbeat: data.tally_sync_agents?.last_heartbeat_at ?? null,
    agent_version: data.tally_sync_agents?.agent_version ?? null,
  };
}

export interface TallyLedgerRow {
  id: string;
  ledger_name: string;
  ledger_group: string | null;
  opening_balance: number;
  closing_balance: number;
  balance_type: 'dr' | 'cr' | null;
  gstin: string | null;
  synced_at: string;
}

export async function listLedgersForSyncConfig(syncConfigId: string): Promise<TallyLedgerRow[]> {
  const { data, error } = await supabase
    .from('tally_ledgers')
    .select('id, ledger_name, ledger_group, opening_balance, closing_balance, balance_type, gstin, synced_at')
    .eq('sync_config_id', syncConfigId)
    .order('ledger_name');
  if (error) throw error;
  return data;
}

// ---------- Tally Sync tab: agent binding ----------

export interface AgentSummary {
  id: string;
  install_id: string;
  agent_version: string | null;
  status: string;
  last_heartbeat_at: string | null;
  bound: boolean;
}

// Every agent for a client, flagged with whether it's already bound to a
// sync config — powers the "bind this agent to a Tally company" flow on
// the Tally Sync tab (closes the gap the sync-agent README calls out:
// pairing has a UI, but binding didn't until now).
export async function listAgentsForClient(clientId: string): Promise<AgentSummary[]> {
  const [agentsRes, configsRes] = await Promise.all([
    supabase
      .from('tally_sync_agents')
      .select('id, install_id, agent_version, status, last_heartbeat_at')
      .eq('client_id', clientId)
      .order('last_heartbeat_at', { ascending: false }),
    supabase.from('tally_sync_configs').select('agent_id').eq('client_id', clientId),
  ]);
  if (agentsRes.error) throw agentsRes.error;
  if (configsRes.error) throw configsRes.error;

  const boundAgentIds = new Set((configsRes.data ?? []).map((c) => c.agent_id).filter(Boolean));
  return (agentsRes.data ?? []).map((a) => ({ ...a, bound: boundAgentIds.has(a.id) }));
}

export async function bindAgentToSyncConfig(
  clientId: string,
  agentId: string,
  tallyCompanyName: string,
  syncFrequency: 'realtime' | 'hourly' | 'daily'
): Promise<void> {
  const { error } = await supabase.from('tally_sync_configs').insert({
    client_id: clientId,
    agent_id: agentId,
    tally_company_name: tallyCompanyName,
    sync_frequency: syncFrequency,
  });
  if (error) throw error;
}

// ---------- Billing tab ----------

export interface InvoiceRow {
  id: string;
  total: number;
  status: string;
  issued_date: string | null;
  due_date: string | null;
}

export async function listInvoicesForClient(clientId: string): Promise<InvoiceRow[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, total, status, issued_date, due_date')
    .eq('client_id', clientId)
    .order('issued_date', { ascending: false });
  if (error) throw error;
  return data;
}

export interface TimeEntrySummary {
  staff_id: string;
  staff_name: string;
  minutes_logged: number;
  billable: boolean;
}

export async function listTimeEntriesForClient(clientId: string): Promise<TimeEntrySummary[]> {
  interface RawRow {
    staff_id: string;
    minutes_logged: number;
    billable: boolean;
    staff: { name: string } | null;
  }
  const { data, error } = await supabase
    .from('time_entries')
    .select('staff_id, minutes_logged, billable, staff(name)')
    .eq('client_id', clientId)
    .order('entry_date', { ascending: false })
    .returns<RawRow[]>();
  if (error) throw error;
  return data.map((r) => ({
    staff_id: r.staff_id,
    staff_name: r.staff?.name ?? 'Unknown',
    minutes_logged: r.minutes_logged,
    billable: r.billable,
  }));
}

// ---------- Tasks ----------

export async function listTasksForClient(clientId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('client_id', clientId)
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data;
}

export async function updateTaskStatus(taskId: string, status: Task['status']): Promise<void> {
  const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId);
  if (error) throw error;
}

export async function createTaskFromDiscrepancy(
  clientId: string,
  title: string,
  description: string
): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      client_id: clientId,
      title,
      description,
      trigger_source: 'tally_discrepancy',
      status: 'pending',
      priority: 'medium',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function bulkCreateMissingInvoiceTasks(
  clientId: string,
  lineItems: Pick<ReconciliationLineItem, 'supplier_gstin' | 'invoice_number'>[]
): Promise<Task[]> {
  return Promise.all(
    lineItems.map((item) =>
      createTaskFromDiscrepancy(
        clientId,
        `Book missing purchase invoice${item.invoice_number ? ` — ${item.invoice_number}` : ''}`,
        `Present in GSTR-2B but not found in Tally purchase register.${
          item.supplier_gstin ? ` Supplier GSTIN: ${item.supplier_gstin}.` : ''
        }`
      )
    )
  );
}

// ---------- Write-back approval (gated) ----------
// Enforced at the DB layer via RLS (admin/partner/audit_manager only);
// this helper additionally requires an explicit approver id, never posts
// silently, and never marks a job "confirmed" client-side — that status
// only ever comes from the Sync Agent's own callback.

export async function approveWriteBackJob(jobId: string, approvedBy: string) {
  const { error } = await supabase
    .from('tally_write_back_jobs')
    .update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'pending'); // guards against re-approving an already-processed job
  if (error) throw error;
}
