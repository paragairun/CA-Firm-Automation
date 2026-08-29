export interface AgentConfig {
  supabase_url: string;
  supabase_anon_key: string;
  agent_id: string;
  client_id: string;
  agent_token: string; // decrypted in memory only — see crypto.ts for at-rest handling
  tally_endpoint: string; // e.g. http://localhost:9000
  tally_company_name: string | null; // exact Tally company name for SVCURRENTCOMPANY; set at company binding time
  sync_config_id: string | null; // set after company binding in the web app; null until then
  sync_frequency: 'realtime' | 'hourly' | 'daily';
}

export interface LedgerRecord {
  ledger_name: string;
  ledger_group?: string;
  opening_balance?: number;
  closing_balance?: number;
  balance_type?: 'dr' | 'cr';
}

export interface VoucherRecord {
  voucher_type: 'sales' | 'purchase' | 'payment' | 'receipt' | 'journal';
  voucher_number: string;
  voucher_date: string; // ISO yyyy-mm-dd
  amount: number;
  party_ledger?: string;
  gst_taxable_value?: number;
  gst_amount?: number;
}

export interface SyncJob {
  id: string;
  sync_config_id: string;
  ledgers: LedgerRecord[];
  vouchers: VoucherRecord[];
  created_at: string;
  attempts: number;
  last_error?: string;
}
