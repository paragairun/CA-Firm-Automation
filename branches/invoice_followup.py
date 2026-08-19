"""
BRANCH 9 — Invoice / Payment Follow-up
Use Case 5 (reminders half): unpaid invoices get staged reminders (3d
upcoming / due today / 1-7d / 8-15d / 15d+) with escalating tone. >15 days
overdue auto-flags escalated + pings the partner on Telegram.

Runs daily at 10:30 AM. Pairs with Branch 5 (Payment Confirmation) which
marks invoices Paid and stops these reminders.
"""
from datetime import date

import config
from db import fetch_all, execute
from error_handling import catch_and_log
from services.llm import draft
from services.whatsapp import send_whatsapp_message
from services.email_service import send_email
from services.telegram_service import notify_partner


def _overdue_days(due_date) -> int | None:
    if not due_date:
        return None
    if isinstance(due_date, str):
        try:
            due_date = date.fromisoformat(due_date[:10])
        except ValueError:
            return None
    return (date.today() - due_date).days  # positive = overdue


def _compute_stage(overdue_days: int) -> str | None:
    if overdue_days == -3:
        return "upcoming_3d"
    if overdue_days == 0:
        return "due_today"
    if 1 <= overdue_days <= 7:
        return "overdue_mild"
    if 8 <= overdue_days <= 15:
        return "overdue_moderate"
    if overdue_days > 15:
        return "overdue_severe"
    return None


_STAGE_HINTS = {
    "upcoming_3d": "friendly heads-up",
    "due_today": "due today please pay",
    "overdue_mild": "polite overdue reminder up to a week",
    "overdue_moderate": "firmer tone 8-15 days overdue, mention it's affecting the account",
    "overdue_severe": "firm professional tone, mention the team may follow up by call",
}


@catch_and_log("Daily 1030AM - Invoice Followup")
def run() -> None:
    for row in fetch_all("SELECT * FROM invoices"):
        if row["status"] == "Paid":
            continue
        overdue_days = _overdue_days(row["due_date"])
        if overdue_days is None:
            continue
        stage = _compute_stage(overdue_days)
        if not stage:
            continue
        _process_one(row, overdue_days, stage)


@catch_and_log("Invoice Followup Row")
def _process_one(row: dict, overdue_days: int, stage: str) -> None:
    days_overdue = overdue_days if overdue_days > 0 else 0

    prompt = (
        f"Write a short WhatsApp/email-friendly payment reminder (3-5 lines) from "
        f"{config.FIRM_NAME}, a Chartered Accountancy firm in India.\n\n"
        f"Client: {row['client_name']}\nInvoice: {row['invoice_id']}\n"
        f"Amount due: {row.get('currency', 'INR')} {row.get('amount')}\nDue date: {row['due_date']}\n"
        f"Stage: {stage} ({_STAGE_HINTS[stage]}, {days_overdue} days overdue)\n\n"
        f"Match tone exactly to the stage. Include a simple payment request line. Do not be rude "
        f"even at overdue_severe — stay professional."
    )
    message = draft(prompt)

    if row.get("phone"):
        send_whatsapp_message(row["phone"], message)
    if row.get("email"):
        send_email(row["email"], f"Payment reminder — Invoice {row['invoice_id']}", message)

    new_status = "Overdue" if days_overdue > 0 else "Pending"
    new_escalated = "Yes" if days_overdue > 15 else (row.get("escalated") or "No")

    execute(
        "UPDATE invoices SET status = %s, reminder_count = reminder_count + 1, "
        "last_reminder_date = now(), escalated = %s WHERE invoice_id = %s",
        (new_status, new_escalated, row["invoice_id"]),
    )

    if days_overdue > 15:
        notify_partner(
            f"💰 *Invoice Severely Overdue*\nClient: {row['client_name']}\n"
            f"Amount: {row.get('currency', 'INR')} {row.get('amount')}\nDays overdue: {days_overdue}\n"
            f"Recommend a direct call."
        )
