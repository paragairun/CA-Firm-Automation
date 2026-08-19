# CA Firm Automation Suite

A full-stack rewrite of the "CA Firm Automation — Zero to Pro Automation"
n8n workflow as a real Python/Flask service, backed by Postgres instead of
Google Sheets. Same 5 use cases, same 9 entry points, same message logic —
just owned code instead of a no-code workflow file.

## What it does

| # | Trigger | Branch | Use case |
|---|---|---|---|
| 1 | `GET/POST /webhooks/whatsapp-incoming` | WhatsApp router | Support (known clients), document receipt, lead qualification (unknown numbers) |
| 2 | `POST /webhooks/website-lead` | Website lead form | AI opening reply + classification + urgent alert |
| 3 | Gmail poll (every `GMAIL_POLL_SECONDS`) | Email support | Known-client AI support replies; unknown senders become leads |
| 4 | `POST /webhooks/request-documents` | Document request | Partner-initiated document collection ask |
| 5 | `POST /webhooks/payment-confirmation` | Payment confirmation | Marks invoice Paid + sends thank-you |
| 6 | Daily 09:00 | Compliance reminders | GST/ITR/TDS/ROC deadline nudges, escalating tone |
| 7 | Daily 09:30 | Document follow-up | Nudges for documents still Pending 3+ days |
| 8 | Daily 10:00 | Lead follow-up | Nudges open leads; auto Cold-Closed after 4 attempts |
| 9 | Daily 10:30 | Invoice follow-up | Staged payment reminders, escalates >15 days overdue |

Every branch that fails logs to the `error_log` table and pings the partner
on Telegram — same as the original workflow's shared error-handling chain.

## Architecture

- **Flask** — webhook routes (`app.py`)
- **Postgres** (Supabase or any instance) — `clients`, `documents_tracker`,
  `compliance_calendar`, `leads`, `invoices`, `query_log`, `error_log`,
  `conversation_memory` (see `schema.sql`)
- **Groq** (Llama 3.3 70B, OpenAI-compatible API) — AI drafting + support agent
- **WhatsApp Cloud API** (Meta) — send/receive WhatsApp messages
- **Gmail** — send via SMTP, poll via IMAP, both using an App Password (no
  Google Cloud OAuth project needed)
- **Telegram Bot API** — partner alerts
- **APScheduler** — the 4 daily jobs, running inside the same process
- Runs as a single long-lived process (systemd), same pattern as the
  trading bot on `padmajak-trading-bot-v2`

## Setup

### 1. Database

Create a Postgres database (Supabase project, or any Postgres instance —
including one on the same GCP VM as the trading bot), then run:

```bash
psql "$DATABASE_URL" -f schema.sql
```

### 2. Credentials to gather

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase: Project Settings → Database → Connection string (URI) |
| `GROQ_API_KEY` | console.groq.com → API Keys |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Meta for Developers → your App → WhatsApp → API Setup |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Any secret string you choose |
| `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` | Google Account → Security → 2-Step Verification → App passwords |
| `TELEGRAM_BOT_TOKEN` | Message @BotFather on Telegram → `/newbot` |
| `TELEGRAM_PARTNER_CHAT_ID` | Message your new bot, then check `https://api.telegram.org/bot<token>/getUpdates` for your chat id |

Copy `.env.example` to `.env` and fill all of the above in, plus `FIRM_NAME`.

### 3. Populate the Clients table

Unlike the original (which expected you to maintain a Google Sheet by
hand), you can insert clients directly:

```sql
INSERT INTO clients (client_id, name, phone, email, business_type)
VALUES ('CL-001', 'Rahul Sharma', '919876543210', 'rahul@example.com', 'Proprietorship');
```

Same for `compliance_calendar` and `invoices` as you onboard clients and
create filings/invoices.

### 4. WhatsApp webhook

Point Meta's App dashboard webhook Callback URL at:
`https://your-domain/webhooks/whatsapp-incoming`
with the same `WHATSAPP_WEBHOOK_VERIFY_TOKEN` you set in `.env`.

### 5. Run locally

Requires **Python 3.10+** (uses `X | None` type hints).

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

### 6. Deploy (GCP VM, systemd — same pattern as the trading bot)

```bash
# on the VM
git clone <this-repo> ca-firm-automation
cd ca-firm-automation
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in real values
sudo cp deploy/ca-firm-automation.service /etc/systemd/system/
sudo sed -i 's/YOUR_LINUX_USER/'"$USER"'/g' /etc/systemd/system/ca-firm-automation.service
sudo systemctl daemon-reload
sudo systemctl enable --now ca-firm-automation
sudo systemctl status ca-firm-automation
```

Expose it publicly (Nginx reverse proxy + TLS, or a tunnel like the
existing `parsley-walk-operator.ngrok-free.dev` pattern) so Meta and your
payment gateway can reach the webhooks.

## Differences from the original n8n workflow

- **Data store**: Postgres tables instead of Google Sheets tabs (schema in
  `schema.sql`, 1:1 mapping to the original sheet columns).
- **Config**: real `.env` file instead of search-and-replace placeholder
  strings scattered through the workflow JSON.
- **Gmail auth**: SMTP/IMAP with an App Password instead of Gmail OAuth2 —
  zero Google Cloud project setup required. If you'd rather use the Gmail
  API (e.g. for a shared team inbox), that's a contained swap inside
  `services/email_service.py`.
- **"Fast ack" on the WhatsApp webhook**: reproduced with a background
  thread (`branches/whatsapp_incoming.process_async`) instead of n8n's
  `responseNode` + parallel branches.
- Everything else — prompts, reminder-stage thresholds (7d/3d/1d/due-today/
  overdue for compliance; 3d/due-today/1-7d/8-15d/15d+ for invoices;
  3-day gap + escalate-at-3 for documents; 4-attempt cold-close for leads)
  — is a direct, faithful port of the original workflow's logic.

## Not yet built

This is a working backend service — same functional surface as the n8n
workflow, deployable today. Two things the original also didn't have that
you may want next:
- An admin UI (the original relied on directly editing Google Sheets;
  right now you'd use `psql` or a DB GUI to manage clients/compliance/invoices)
- Inbound media download from WhatsApp (the original only marked documents
  "Received" on any media message — it never actually stored the file
  content, and neither does this port; add Meta's media-download API call
  in `branches/whatsapp_incoming._handle_media_message` if you want to save
  the actual files)
