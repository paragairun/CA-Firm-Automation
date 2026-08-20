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

# ── Gmail polling cadence — now a reference value only; actual cadence is
#    set by the Cloud Scheduler job's cron expression (see README). Kept
#    here since branches/email_support.py's docstring refers to it.
GMAIL_POLL_SECONDS = int(_opt("GMAIL_POLL_SECONDS", "60"))
GMAIL_PROCESSED_LABEL = _opt("GMAIL_PROCESSED_LABEL", "CA-Firm-Processed")

# ── Flask / Cloud Run ──────────────────────────────────────────────────
PORT = int(_opt("PORT", "8080"))  # Cloud Run injects PORT=8080 by default
DEBUG = _opt("FLASK_DEBUG", "false").lower() == "true"

# ── Internal endpoint auth (Cloud Scheduler -> /internal/* routes) ───────
# Any long random string. Cloud Scheduler jobs send it as the
# X-Internal-Secret header; see README "Deploying to Cloud Run".
SCHEDULER_SHARED_SECRET = _req("SCHEDULER_SHARED_SECRET")

# ── Dashboard access (staff-facing /dashboard page + /api/dashboard-data) ─
# Any long random string. The dashboard page prompts for this once and
# stores it in the browser, sending it as the X-Dashboard-Key header.
DASHBOARD_ACCESS_KEY = _req("DASHBOARD_ACCESS_KEY")

# ── Scheduler timezone (informational — set directly on each Cloud
#    Scheduler job at creation time; see README) ──────────────────────────
SCHEDULER_TIMEZONE = _opt("SCHEDULER_TIMEZONE", "Asia/Kolkata")
