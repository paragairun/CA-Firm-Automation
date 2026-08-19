# CA Firm Automation Suite

A full-stack rewrite of the "CA Firm Automation — Zero to Pro Automation"
n8n workflow as a real Python/Flask service — running almost entirely on
Google Workspace (paid tier) instead of a no-code workflow file and a
scattering of third-party SaaS tools.

## What it does

| # | Trigger | Branch | Use case |
|---|---|---|---|
| 1 | `GET/POST /webhooks/whatsapp-incoming` | WhatsApp router | Support (known clients), document receipt, lead qualification (unknown numbers) |
| 2 | `POST /webhooks/website-lead` | Website lead form | AI opening reply + classification + urgent alert |
| 3 | Gmail poll (every `GMAIL_POLL_SECONDS`) | Email support | Known-client AI support replies; unknown senders become leads |
| 4 | `POST /webhooks/request-documents` | Document request | Partner-initiated document collection ask |
| 5 | `POST /webhooks/payment-confirmation` | Payment confirmation | Marks invoice Paid + sends thank-you |
| 6 | Daily 09:00 | Compliance reminders | GST/ITR/TDS/ROC deadline nudges, escalating tone, synced to Calendar |
| 7 | Daily 09:30 | Document follow-up | Nudges for documents still Pending 3+ days |
| 8 | Daily 10:00 | Lead follow-up | Nudges open leads; auto Cold-Closed after 4 attempts |
| 9 | Daily 10:30 | Invoice follow-up | Staged payment reminders, escalates >15 days overdue |

Every branch that fails logs to the `Error_Log` sheet and pings the
partner on Google Chat — same as the original workflow's shared
error-handling chain.

## Architecture — Google Workspace end to end

| Piece | Service |
|---|---|
| Data store | **Google Sheets** (one spreadsheet, one tab per table) — the partner can open it directly as a live admin UI |
| AI (drafting + support agent) | **Gemini API** (`gemini-3.6-flash` by default) |
| Email send/poll | **Gmail API** — domain-wide delegation, no app password |
| Document storage | **Google Drive** — WhatsApp-received files saved into per-client folders |
| Compliance deadlines | **Google Calendar** — real events with native reminders |
| Partner alerts | **Google Chat** incoming webhook |
| WhatsApp | Meta Cloud API (no Google equivalent exists) |
| Scheduling | APScheduler, in-process |

One Google Cloud service account, authorized for **domain-wide
delegation** in your Workspace Admin Console, powers Sheets, Gmail,
Drive, and Calendar together — it impersonates a real mailbox
(`GOOGLE_IMPERSONATE_EMAIL`) so sent mail, owned files, and calendar
events all belong to the firm, not to a faceless service account.

Runs as a single long-lived process (systemd), same pattern as the
trading bot on `padmajak-trading-bot-v2`.

## Setup

### 1. Enable APIs (Google Cloud Console)

In the GCP project tied to your Workspace (can be the same project as the
trading bot, or a new one):
**APIs & Services → Enable APIs** → enable all four:
- Google Sheets API
- Gmail API
- Google Drive API
- Google Calendar API

### 2. Create the service account

**IAM & Admin → Service Accounts → Create Service Account** → any name
(e.g. `ca-firm-automation`) → **Keys → Add Key → JSON** → download it as
`service-account.json`, keep it out of git.

Note the service account's **Client ID** — it's on the service account's
details page ("Advanced settings", or the `client_id` field inside the
downloaded JSON key).

### 3. Authorize domain-wide delegation (Workspace Admin Console)

`admin.google.com` → **Security → API controls → Domain-wide delegation
→ Add new**:
- Client ID: the one from step 2
- OAuth scopes (comma-separated, all on one line):
  ```
  https://www.googleapis.com/auth/spreadsheets,
  https://www.googleapis.com/auth/gmail.modify,
  https://www.googleapis.com/auth/gmail.send,
  https://www.googleapis.com/auth/drive,
  https://www.googleapis.com/auth/calendar
  ```

### 4. Pick the mailbox this service acts as

Any real Workspace mailbox — e.g. `automation@yourfirm.com`. This is
`GOOGLE_IMPERSONATE_EMAIL`. Sent emails, uploaded Drive files, and
calendar events will all belong to this mailbox.

### 5. Create the Google Sheet

Create a blank Google Sheet, owned by (or shared as Editor with)
`GOOGLE_IMPERSONATE_EMAIL`. Copy its ID from the URL:
`https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` →
`GOOGLE_SPREADSHEET_ID`.

### 6. Gemini API key

`aistudio.google.com` → **Get API key** (billed against your paid Gemini
tier) → `GEMINI_API_KEY`.

### 7. Google Chat webhook (partner alerts)

Google Chat → create/open the Space you want alerts in → **Apps &
integrations → Manage webhooks → Add webhook** → copy the URL →
`GOOGLE_CHAT_WEBHOOK_URL`.

### 8. WhatsApp Cloud API (unchanged — Meta, not Google)

Meta for Developers → your App → WhatsApp → API Setup →
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`. Pick any secret
string for `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and set the same value in the
Meta App dashboard's webhook config once deployed.

### 9. Configure and initialize

```bash
cp .env.example .env        # fill in everything from steps 1-8
# put the downloaded service-account.json in the project root
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 setup_sheets.py     # creates all 8 tabs with correct headers
```

`setup_sheets.py` is safe to re-run — it skips tabs that already exist
and never touches existing data.

### 10. Populate the Clients tab

Unlike the original (Google Sheets edited by hand with no validation),
you can also insert rows directly in the Sheets UI, or programmatically:

```python
from services.sheets_db import CLIENTS
CLIENTS.append({
    "client_id": "CL-001", "name": "Rahul Sharma", "phone": "919876543210",
    "email": "rahul@example.com", "business_type": "Proprietorship",
})
```

Same for `Compliance_Calendar` and `Invoices` as you onboard clients and
create filings/invoices — the partner can also just type rows straight
into the Sheet.

### 11. WhatsApp webhook

Point Meta's App dashboard webhook Callback URL at:
`https://your-domain/webhooks/whatsapp-incoming`
with the same `WHATSAPP_WEBHOOK_VERIFY_TOKEN` from step 8.

### 12. Run locally

Requires **Python 3.10+** (uses `X | None` type hints).

```bash
python3 app.py
```

### 13. Deploy (GCP VM, systemd — same pattern as the trading bot)

```bash
# on the VM
git clone <this-repo> ca-firm-automation
cd ca-firm-automation
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env            # fill in real values
# upload service-account.json into this directory too
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

- **Data store**: a real Google Sheet with a defined schema per tab
  (`services/sheets_db.py`), created via `setup_sheets.py` instead of
  hand-built.
- **Auth model**: one service account with domain-wide delegation instead
  of four separate per-service OAuth credentials (Gmail OAuth2, Sheets
  OAuth2, Telegram bot token, WhatsApp header-auth token) — WhatsApp still
  needs its own Meta token since it isn't a Google product.
- **Document storage**: the original never actually downloaded WhatsApp
  media, it only flipped a status flag. This port downloads it and saves
  it into a per-client Drive folder, with the file link written back onto
  the `Documents_Tracker` row.
- **Compliance deadlines**: also mirrored into Google Calendar as real
  events with reminders (`calendar_event_id` column links each sheet row
  to its event), not just sheet rows.
- **Partner alerts**: Google Chat webhook instead of a Telegram bot.
- **LLM**: Gemini (`gemini-3.6-flash` by default, configurable) instead of
  Groq/Llama.
- **"Fast ack" on the WhatsApp webhook**: reproduced with a background
  thread (`branches/whatsapp_incoming.process_async`) instead of n8n's
  `responseNode` + parallel branches.
- Everything else — prompts, reminder-stage thresholds (7d/3d/1d/due-today/
  overdue for compliance; 3d/due-today/1-7d/8-15d/15d+ for invoices;
  3-day gap + escalate-at-3 for documents; 4-attempt cold-close for leads)
  — is a direct, faithful port of the original workflow's logic.

## Operational notes

- **Sheets concurrency**: every read scans the full tab and every write
  is a read-modify-write. Fine at a single small CA firm's data volume;
  not something to scale to thousands of rows without moving hot tables
  (in particular `Conversation_Memory`) to a real database later.
- **`Conversation_Memory` grows unbounded** — it's an append-only log of
  every AI chat turn, never pruned. Periodically archive/delete old rows
  (e.g. anything older than 90 days) if the tab starts feeling sluggish.
- **Gemini model deprecations**: Google retires Gemini model versions on
  a rolling basis (see `ai.google.dev/gemini-api/docs/changelog`). If
  `GEMINI_MODEL` ever starts erroring, check that page and bump the env var.

## Not yet built

- An admin UI beyond the Sheet itself — for now that Sheet *is* the admin
  UI (view/edit clients, compliance, invoices, leads directly).
- Any Vertex AI / GCP-billing variant of the Gemini calls — this uses the
  simpler Gemini Developer API (`GEMINI_API_KEY`), billed against your
  Google AI Studio paid tier. Swappable in `services/llm.py` if you'd
  rather route Gemini calls through Vertex AI and GCP billing instead.
