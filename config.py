"""
Central configuration — everything is loaded from environment variables.
Copy .env.example to .env and fill in real values before running.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def _req(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            f"Copy .env.example to .env and fill it in."
        )
    return val


def _opt(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


# ── Firm identity ────────────────────────────────────────────────────────
FIRM_NAME = _opt("FIRM_NAME", "Your CA Firm")

# ── Google Workspace service account (domain-wide delegation) ────────────
# One service account authorizes Sheets, Gmail, Drive, and Calendar access,
# impersonating a real Workspace mailbox (GOOGLE_IMPERSONATE_EMAIL) via
# domain-wide delegation. See README for the exact Admin Console setup steps.
GOOGLE_SERVICE_ACCOUNT_FILE = _req("GOOGLE_SERVICE_ACCOUNT_FILE")
GOOGLE_IMPERSONATE_EMAIL = _req("GOOGLE_IMPERSONATE_EMAIL")

# ── Google Sheets (data store) ────────────────────────────────────────────
GOOGLE_SPREADSHEET_ID = _req("GOOGLE_SPREADSHEET_ID")

# ── Google Drive (document storage) ───────────────────────────────────────
# Leave blank to auto-create/find a "CA Firm Documents" folder in the
# impersonated user's My Drive. Set to a folder ID (ideally inside a Shared
# Drive, so the whole firm can see it) to use a specific location instead.
GOOGLE_DRIVE_ROOT_FOLDER_ID = _opt("GOOGLE_DRIVE_ROOT_FOLDER_ID")

# ── Google Calendar (compliance deadlines) ────────────────────────────────
# Use a dedicated shared calendar's ID for firm-wide visibility, or "primary"
# for the impersonated mailbox's own calendar.
GOOGLE_CALENDAR_ID = _opt("GOOGLE_CALENDAR_ID", "primary")

# ── Google Chat (partner alerts) ──────────────────────────────────────────
# Google Chat -> the alerts Space -> Apps & integrations -> Manage webhooks.
GOOGLE_CHAT_WEBHOOK_URL = _req("GOOGLE_CHAT_WEBHOOK_URL")

# ── Gemini (LLM) ─────────────────────────────────────────────────────────
GEMINI_API_KEY = _req("GEMINI_API_KEY")
GEMINI_MODEL = _opt("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_TEMPERATURE = float(_opt("GEMINI_TEMPERATURE", "0.4"))
MEMORY_WINDOW = int(_opt("MEMORY_WINDOW", "12"))

# ── WhatsApp Cloud API (Meta) ────────────────────────────────────────────
WHATSAPP_PHONE_NUMBER_ID = _opt("WHATSAPP_PHONE_NUMBER_ID")
WHATSAPP_ACCESS_TOKEN = _opt("WHATSAPP_ACCESS_TOKEN")
WHATSAPP_WEBHOOK_VERIFY_TOKEN = _opt("WHATSAPP_WEBHOOK_VERIFY_TOKEN")
WHATSAPP_API_VERSION = _opt("WHATSAPP_API_VERSION", "v21.0")

# ── Gmail polling cadence (Gmail API list call, not IMAP) ─────────────────
GMAIL_POLL_SECONDS = int(_opt("GMAIL_POLL_SECONDS", "60"))
GMAIL_PROCESSED_LABEL = _opt("GMAIL_PROCESSED_LABEL", "CA-Firm-Processed")

# ── Flask ────────────────────────────────────────────────────────────────
PORT = int(_opt("PORT", "8000"))
DEBUG = _opt("FLASK_DEBUG", "false").lower() == "true"

# ── Scheduled job times (24h, instance-local timezone; original used IST) ─
COMPLIANCE_CHECK_HOUR, COMPLIANCE_CHECK_MINUTE = 9, 0
DOCUMENT_FOLLOWUP_HOUR, DOCUMENT_FOLLOWUP_MINUTE = 9, 30
LEAD_FOLLOWUP_HOUR, LEAD_FOLLOWUP_MINUTE = 10, 0
INVOICE_FOLLOWUP_HOUR, INVOICE_FOLLOWUP_MINUTE = 10, 30
SCHEDULER_TIMEZONE = _opt("SCHEDULER_TIMEZONE", "Asia/Kolkata")
