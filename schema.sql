-- CA Firm Automation Suite — database schema
-- Replaces the original n8n workflow's Google Sheets tabs (Clients, Documents_Tracker,
-- Compliance_Calendar, Leads, Invoices, Query_Log, Error_Log) with real Postgres tables.
-- Works on any Postgres instance (Supabase, GCP Cloud SQL, self-hosted).
--
-- Run once against your database:
--   psql "$DATABASE_URL" -f schema.sql

-- ── Clients ──────────────────────────────────────────────────────────────
-- Matched by phone (WhatsApp) or email (email channel) to decide known vs. lead.
CREATE TABLE IF NOT EXISTS clients (
    client_id     TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    phone         TEXT,
    email         TEXT,
    business_type TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients (lower(email));

-- ── Documents_Tracker ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents_tracker (
    doc_id             TEXT PRIMARY KEY,
    client_id          TEXT REFERENCES clients (client_id),
    client_name        TEXT,
    phone              TEXT,
    email              TEXT,
    compliance_type    TEXT,
    document_name      TEXT NOT NULL,
    requested_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
    status             TEXT NOT NULL DEFAULT 'Pending',  -- Pending | Received
    followup_count     INTEGER NOT NULL DEFAULT 0,
    last_followup_date TIMESTAMPTZ,
    received_date      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_docs_client ON documents_tracker (client_id);
CREATE INDEX IF NOT EXISTS idx_docs_status ON documents_tracker (status);

-- ── Compliance_Calendar ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_calendar (
    compliance_id     TEXT PRIMARY KEY,
    client_id          TEXT REFERENCES clients (client_id),
    client_name        TEXT,
    phone              TEXT,
    email              TEXT,
    compliance_type    TEXT NOT NULL,   -- GST / ITR / TDS / ROC / ...
    due_date            DATE NOT NULL,
    status              TEXT NOT NULL DEFAULT 'Pending',  -- Pending | Filed
    reminder_count      INTEGER NOT NULL DEFAULT 0,
    last_reminder_date  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_compliance_client ON compliance_calendar (client_id);
CREATE INDEX IF NOT EXISTS idx_compliance_due ON compliance_calendar (due_date);

-- ── Leads ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
    lead_id             TEXT PRIMARY KEY,
    name                TEXT,
    phone               TEXT,
    email               TEXT,
    source              TEXT,   -- WhatsApp | Website | Email
    requirement         TEXT,
    business_type       TEXT,
    urgency             TEXT,   -- High | Medium | Low | Unclear
    qualification_score TEXT,   -- Hot | Warm | Cold
    status               TEXT NOT NULL DEFAULT 'New',  -- New | Qualifying | Converted | Lost | Cold-Closed
    followup_date        DATE,
    followup_attempts    INTEGER NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes                 TEXT,
    message_text           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_followup_date ON leads (followup_date);

-- ── Invoices ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    invoice_id          TEXT PRIMARY KEY,
    client_id            TEXT REFERENCES clients (client_id),
    client_name           TEXT,
    phone                 TEXT,
    email                 TEXT,
    amount                NUMERIC(12, 2),
    currency              TEXT NOT NULL DEFAULT 'INR',
    due_date               DATE,
    status                 TEXT NOT NULL DEFAULT 'Pending',  -- Pending | Overdue | Paid
    reminder_count          INTEGER NOT NULL DEFAULT 0,
    last_reminder_date       TIMESTAMPTZ,
    escalated                 TEXT NOT NULL DEFAULT 'No'  -- Yes | No
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices (due_date);

-- ── Query_Log ────────────────────────────────────────────────────────────
-- Every AI-answered support query (WhatsApp + email channels).
CREATE TABLE IF NOT EXISTS query_log (
    log_id       TEXT PRIMARY KEY,
    client_id     TEXT,
    phone          TEXT,
    email          TEXT,
    channel         TEXT,   -- whatsapp | email
    query_text       TEXT,
    ai_response       TEXT,
    timestamp          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_query_log_client ON query_log (client_id);

-- ── Error_Log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS error_log (
    error_id       TEXT PRIMARY KEY,
    workflow_name    TEXT,
    node_name         TEXT,
    error_message      TEXT,
    timestamp            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── conversation_memory ──────────────────────────────────────────────────
-- Replaces the original LangChain memoryBufferWindow nodes (windowed chat history
-- per session key: wa-support-<phone>, wa-lead-<phone>, email-support-<email>).
CREATE TABLE IF NOT EXISTS conversation_memory (
    id           BIGSERIAL PRIMARY KEY,
    session_key   TEXT NOT NULL,
    role           TEXT NOT NULL,  -- user | assistant
    content         TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_session ON conversation_memory (session_key, created_at);

-- ── gmail_sync_state ─────────────────────────────────────────────────────
-- Tracks the last Gmail history/message id processed by the email-support poller,
-- so we never double-process the same email across polling runs.
CREATE TABLE IF NOT EXISTS gmail_sync_state (
    id                    INTEGER PRIMARY KEY DEFAULT 1,
    last_processed_uid     TEXT,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO gmail_sync_state (id, last_processed_uid)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;
