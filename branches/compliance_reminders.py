"""
BRANCH 6 — Compliance Deadline & Reminder System
Use Case 3: GST/ITR/TDS/ROC deadlines -> reminders at 7d/3d/1d/due-today/overdue,
tone escalates automatically. Overdue >3 days pings the partner on Telegram.

Runs daily at 9:00 AM (SCHEDULER_TIMEZONE).
"""
from datetime import date

import config
from db import fetch_all, execute
from error_handling import catch_and_log
from services.llm import draft
from services.whatsapp import send_whatsapp_message
from services.email_service import send_email
from services.telegram_service import notify_partner


def _days_diff(due_date) -> int | None:
    if not due_date:
        return None
    if isinstance(due_date, str):
        try:
            due_date = date.fromisoformat(due_date[:10])
        except ValueError:
            return None
    return (due_date - date.today()).days


def _compute_stage(days: int) -> str | None:
    if days == 7:
        return "friendly_7d"
    if days == 3:
        return "reminder_3d"
    if days == 1:
        return "urgent_1d"
    if days == 0:
        return "due_today"
    if days < 0:
        return "overdue"
    return None


_STAGE_HINTS = {
    "friendly_7d": "gentle heads-up",
    "reminder_3d": "clearer reminder",
    "urgent_1d": "urgent tone due tomorrow",
    "due_today": "due today act now",
    "overdue": "firm but polite, mention possible late fee/penalty risk",
}


@catch_and_log("Daily 9AM - Compliance Check")
def run() -> None:
    for row in fetch_all("SELECT * FROM compliance_calendar"):
        if row["status"] == "Filed" or not row["due_date"]:
            continue
        days = _days_diff(row["due_date"])
        if days is None:
            continue
        stage = _compute_stage(days)
        if not stage:
            continue

        _process_one(row, days, stage)


@catch_and_log("Compliance Reminder Row")
def _process_one(row: dict, days: int, stage: str) -> None:
    days_overdue = abs(days) if days < 0 else 0

    prompt = (
        f"Write a short WhatsApp/email-friendly compliance reminder (3-5 lines) from "
        f"{config.FIRM_NAME}, a Chartered Accountancy firm in India, to a client.\n\n"
        f"Client: {row['client_name']}\nCompliance type: {row['compliance_type']}\n"
        f"Due date: {row['due_date']}\nStage: {stage} ({_STAGE_HINTS[stage]}, {days_overdue} days "
        f"overdue)\n\nTone must match the stage exactly. Ask them to share any pending "
        f"info/documents needed to file on time. Sign off simply as \"Team\"."
    )
    message = draft(prompt)

    if row.get("phone"):
        send_whatsapp_message(row["phone"], message)
    if row.get("email"):
        send_email(row["email"], f"{row['compliance_type']} due {row['due_date']} — reminder", message)

    execute(
        "UPDATE compliance_calendar SET reminder_count = reminder_count + 1, last_reminder_date = now() "
        "WHERE compliance_id = %s",
        (row["compliance_id"],),
    )

    if days_overdue > 3:
        notify_partner(
            f"🚨 *Compliance Overdue*\nClient: {row['client_name']}\nType: {row['compliance_type']}\n"
            f"Due: {row['due_date']}\nDays overdue: {days_overdue}"
        )
