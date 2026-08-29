// Hand-authored types matching supabase/migrations/0001_init_schema.sql.
// Once you have a running Supabase project (local or hosted), regenerate
// this file with `npm run db:types` for full accuracy — this version
// covers the tables the current query layer touches.

export type StaffRole = 'admin' | 'partner' | 'audit_manager' | 'article_assistant';
export type ClientStatus = 'active' | 'dormant' | 'offboarded';
export type EntityType = 'individual' | 'firm' | 'llp' | 'pvt_ltd' | 'trust';
export type FilingStatus = 'pending' | 'docs_requested' | 'in_progress' | 'under_review' | 'filed' | 'approved';
export type TaskStatus = FilingStatus;
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskTriggerSource = 'manual' | 'deadline' | 'tally_discrepancy';
export type ReconciliationStatus =
  | 'matched'
  | 'mismatch'
  | 'missing_in_tally'
  | 'missing_in_portal'
  | 'under_review'
  | 'resolved'
  | 'escalated';
export type WriteBackStatus = 'pending' | 'approved' | 'sent' | 'confirmed' | 'failed' | 'rejected';
export type AgentStatus = 'online' | 'offline' | 'error';
export type SyncStatus = 'success' | 'partial_failure' | 'failed' | 'never_synced';

export interface Database {
  public: {
    Tables: {
      firms: {
        Row: { id: string; name: string; branding: Record<string, unknown>; created_at: string };
        Insert: Partial<Database['public']['Tables']['firms']['Row']> & { name: string };
        Update: Partial<Database['public']['Tables']['firms']['Row']>;
      Relationships: [];
      };
      staff: {
        Row: {
          id: string;
          firm_id: string;
          auth_user_id: string | null;
          name: string;
          email: string;
          role: StaffRole;
          permissions: Record<string, unknown>;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['staff']['Row']> & { firm_id: string; name: string; email: string };
        Update: Partial<Database['public']['Tables']['staff']['Row']>;
      Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          firm_id: string;
          entity_type: EntityType;
          legal_name: string;
          pan: string | null;
          gstins: string[];
          cin_llpin: string | null;
          status: ClientStatus;
          primary_contact_id: string | null;
          onboarded_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['clients']['Row']> & { entity_type: EntityType; legal_name: string };
        Update: Partial<Database['public']['Tables']['clients']['Row']>;
      Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          role: string | null;
          email: string | null;
          phone: string | null;
          portal_access: boolean;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['contacts']['Row']> & { client_id: string; name: string };
        Update: Partial<Database['public']['Tables']['contacts']['Row']>;
      Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          category: string;
          storage_path: string;
          version: number;
          uploaded_by: string | null;
          encryption_key_ref: string | null;
          audit_trail: unknown[];
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['documents']['Row']> & { client_id: string; category: string; storage_path: string };
        Update: Partial<Database['public']['Tables']['documents']['Row']>;
      Relationships: [];
      };
      credentials_vault: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          portal_type: string;
          username_encrypted: string;
          password_encrypted: string;
          otp_secret_encrypted: string | null;
          access_scope: StaffRole[];
          last_verified_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['credentials_vault']['Row']> & {
          client_id: string;
          portal_type: string;
          username_encrypted: string;
          password_encrypted: string;
        };
        Update: Partial<Database['public']['Tables']['credentials_vault']['Row']>;
      Relationships: [];
      };
      services: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          service_type: string;
          frequency: string;
          assigned_staff_id: string | null;
          fee_amount: number | null;
          active: boolean;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['services']['Row']> & { client_id: string; service_type: string; frequency: string };
        Update: Partial<Database['public']['Tables']['services']['Row']>;
      Relationships: [];
      };
      filings: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          service_id: string | null;
          filing_type: string;
          period: string;
          status: FilingStatus;
          due_date: string;
          filed_date: string | null;
          ack_number: string | null;
          source_data_snapshot: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['filings']['Row']> & {
          client_id: string;
          filing_type: string;
          period: string;
          due_date: string;
        };
        Update: Partial<Database['public']['Tables']['filings']['Row']>;
      Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string | null;
          filing_id: string | null;
          title: string;
          description: string | null;
          status: TaskStatus;
          assigned_to: string | null;
          priority: TaskPriority;
          trigger_source: TaskTriggerSource;
          due_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['tasks']['Row']> & { title: string };
        Update: Partial<Database['public']['Tables']['tasks']['Row']>;
      Relationships: [];
      };
      time_entries: {
        Row: {
          id: string;
          firm_id: string;
          staff_id: string;
          task_id: string | null;
          client_id: string | null;
          minutes_logged: number;
          billable: boolean;
          entry_date: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['time_entries']['Row']> & { staff_id: string; minutes_logged: number };
        Update: Partial<Database['public']['Tables']['time_entries']['Row']>;
      Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          line_items: unknown[];
          total: number;
          status: string;
          issued_date: string | null;
          due_date: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['invoices']['Row']> & { client_id: string };
        Update: Partial<Database['public']['Tables']['invoices']['Row']>;
      Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          firm_id: string;
          invoice_id: string;
          amount: number;
          method: string;
          paid_at: string;
        };
        Insert: Partial<Database['public']['Tables']['payments']['Row']> & { firm_id: string; invoice_id: string; amount: number; method: string };
        Update: Partial<Database['public']['Tables']['payments']['Row']>;
      Relationships: [];
      };
      tally_sync_agents: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          install_id: string;
          machine_fingerprint: string | null;
          agent_version: string | null;
          auth_cert_ref: string | null;
          last_heartbeat_at: string | null;
          status: AgentStatus;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['tally_sync_agents']['Row']> & { client_id: string; install_id: string };
        Update: Partial<Database['public']['Tables']['tally_sync_agents']['Row']>;
      Relationships: [];
      };
      tally_sync_configs: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          agent_id: string | null;
          tally_company_name: string;
          tally_endpoint: string;
          sync_frequency: string;
          sync_scope: Record<string, unknown>;
          write_back_enabled: boolean;
          last_sync_at: string | null;
          last_sync_status: SyncStatus;
          auth_token_ref: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['tally_sync_configs']['Row']> & { client_id: string; tally_company_name: string };
        Update: Partial<Database['public']['Tables']['tally_sync_configs']['Row']>;
      Relationships: [];
      };
      tally_ledgers: {
        Row: {
          id: string;
          firm_id: string;
          sync_config_id: string;
          ledger_name: string;
          ledger_group: string | null;
          opening_balance: number;
          closing_balance: number;
          balance_type: 'dr' | 'cr' | null;
          gstin: string | null;
          raw_xml_ref: string | null;
          synced_at: string;
        };
        Insert: Partial<Database['public']['Tables']['tally_ledgers']['Row']> & { firm_id: string; sync_config_id: string; ledger_name: string };
        Update: Partial<Database['public']['Tables']['tally_ledgers']['Row']>;
      Relationships: [];
      };
      tally_vouchers: {
        Row: {
          id: string;
          firm_id: string;
          sync_config_id: string;
          voucher_type: string;
          voucher_number: string;
          voucher_date: string;
          amount: number;
          party_ledger: string | null;
          gst_taxable_value: number | null;
          gst_amount: number | null;
          synced_at: string;
        };
        Insert: Partial<Database['public']['Tables']['tally_vouchers']['Row']> & {
          firm_id: string;
          sync_config_id: string;
          voucher_type: string;
          voucher_number: string;
          voucher_date: string;
          amount: number;
        };
        Update: Partial<Database['public']['Tables']['tally_vouchers']['Row']>;
      Relationships: [];
      };
      reconciliation_records: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          period: string;
          type: string;
          supplier_gstin: string | null;
          invoice_number: string | null;
          tally_value: number | null;
          portal_value: number | null;
          delta: number | null;
          status: ReconciliationStatus;
          resolution_notes: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['reconciliation_records']['Row']> & { client_id: string; period: string; type: string };
        Update: Partial<Database['public']['Tables']['reconciliation_records']['Row']>;
      Relationships: [];
      };
      tally_write_back_jobs: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          sync_config_id: string;
          filing_id: string | null;
          voucher_payload: Record<string, unknown>;
          status: WriteBackStatus;
          approved_by: string | null;
          approved_at: string | null;
          tally_voucher_number: string | null;
          error_detail: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['tally_write_back_jobs']['Row']> & {
          client_id: string;
          sync_config_id: string;
          voucher_payload: Record<string, unknown>;
        };
        Update: Partial<Database['public']['Tables']['tally_write_back_jobs']['Row']>;
      Relationships: [];
      };
      client_staff_assignments: {
        Row: { id: string; firm_id: string; client_id: string; staff_id: string; created_at: string };
        Insert: Partial<Database['public']['Tables']['client_staff_assignments']['Row']> & { firm_id: string; client_id: string; staff_id: string };
        Update: Partial<Database['public']['Tables']['client_staff_assignments']['Row']>;
      Relationships: [];
      };
      activity_log: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string | null;
          actor_id: string | null;
          action: string;
          summary: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['activity_log']['Row']> & { firm_id: string; action: string; summary: string };
        Update: Partial<Database['public']['Tables']['activity_log']['Row']>;
      Relationships: [];
      };
      gstr2b_line_items: {
        Row: {
          id: string;
          firm_id: string;
          client_id: string;
          period: string;
          supplier_gstin: string;
          invoice_number: string;
          invoice_date: string | null;
          taxable_value: number;
          tax_amount: number;
          imported_by: string | null;
          imported_at: string;
        };
        Insert: Partial<Database['public']['Tables']['gstr2b_line_items']['Row']> & {
          client_id: string;
          period: string;
          supplier_gstin: string;
          invoice_number: string;
        };
        Update: Partial<Database['public']['Tables']['gstr2b_line_items']['Row']>;
      Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      run_gstr2b_reconciliation: {
        Args: { p_client_id: string; p_period: string };
        Returns: {
          matched_count: number;
          mismatch_count: number;
          missing_in_tally_count: number;
          missing_in_portal_count: number;
        }[];
      };
      debug_client_insert_context: {
        Args: Record<string, never>;
        Returns: {
          auth_uid: string | null;
          resolved_staff_role: string | null;
          resolved_firm_id: string | null;
          matching_staff_rows: number;
          firm_row_exists: boolean;
        }[];
      };
      test_create_client: {
        Args: { p_entity_type: EntityType; p_legal_name: string };
        Returns: Database['public']['Tables']['clients']['Row'];
      };
    };
    Enums: Record<string, never>;
  };
}
