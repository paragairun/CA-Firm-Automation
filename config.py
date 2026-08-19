"""
Central configuration — everything is loaded from environment variables.
Copy .env.example to .env and fill in real values before running.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def _req(name: str) -> str:
    """Fetch a required env var; raise a clear error at startup if missing."""
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

# ── Database ─────────────────────────────────────────────────────────────
DATABASE_URL = _req("DATABASE_URL")  # postgres connection string (Supabase or any Postgres)

# ── Groq (LLM) ───────────────────────────────────────────────────────────
GROQ_API_KEY = _req("GROQ_API_KEY")
GROQ_MODEL = _opt("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_BASE_URL = _opt("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_TEMPERATURE = float(_opt("GROQ_TEMPERATURE", "0.4"))
MEMORY_WINDOW = int(_opt("MEMORY_WINDOW", "12"))  # matches original contextWindowLength

# ── WhatsApp Cloud API (Meta) ────────────────────────────────────────────
WHATSAPP_PHONE_NUMBER_ID = _opt("WHATSAPP_PHONE_NUMBER_ID")
WHATSAPP_ACCESS_TOKEN = _opt("WHATSAPP_ACCESS_TOKEN")
WHATSAPP_WEBHOOK_VERIFY_TOKEN = _opt("WHATSAPP_WEBHOOK_VERIFY_TOKEN")
WHATSAPP_API_VERSION = _opt("WHATSAPP_API_VERSION", "v21.0")

# ── Gmail (SMTP send + IMAP poll, App Password auth) ─────────────────────
GMAIL_ADDRESS = _opt("GMAIL_ADDRESS")
GMAIL_APP_PASSWORD = _opt("GMAIL_APP_PASSWORD")
GMAIL_POLL_SECONDS = int(_opt("GMAIL_POLL_SECONDS", "60"))  # matches original "every minute"

# ── Telegram (partner alerts) ────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = _opt("TELEGRAM_BOT_TOKEN")
TELEGRAM_PARTNER_CHAT_ID = _opt("TELEGRAM_PARTNER_CHAT_ID")

# ── Flask ────────────────────────────────────────────────────────────────
PORT = int(_opt("PORT", "8000"))
DEBUG = _opt("FLASK_DEBUG", "false").lower() == "true"

# ── Scheduled job times (24h, instance-local timezone; original used IST) ─
COMPLIANCE_CHECK_HOUR, COMPLIANCE_CHECK_MINUTE = 9, 0
DOCUMENT_FOLLOWUP_HOUR, DOCUMENT_FOLLOWUP_MINUTE = 9, 30
LEAD_FOLLOWUP_HOUR, LEAD_FOLLOWUP_MINUTE = 10, 0
INVOICE_FOLLOWUP_HOUR, INVOICE_FOLLOWUP_MINUTE = 10, 30
SCHEDULER_TIMEZONE = _opt("SCHEDULER_TIMEZONE", "Asia/Kolkata")
