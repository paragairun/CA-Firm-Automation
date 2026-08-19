"""
BRANCH 8 — Lead Follow-up
Use Case 4 (automatic follow-ups): any open lead whose followup_date has
arrived gets an AI-drafted nudge, then the next follow-up is scheduled +3
days. After 4 attempts with no movement, status auto-set to Cold-Closed.

Runs daily at 10:00 AM.
"""
from datetime import date, timedelta

import config
from error_handling import catch_and_log
from services.llm import draft
from services.whatsapp import send_whatsapp_message
from services.gmail_service import send_email
from services.sheets_db import LEADS

_CLOSED_STATUSES = {"Converted", "Lost", "Cold-Closed"}


@catch_and_log("Daily 10AM - Lead Followup")
def run() -> None:
    today = date.today()
    for row in LEADS.all_rows():
        if row.get("status") in _CLOSED_STATUSES:
            continue
        followup_date = row.get("followup_date")
        if not followup_date:
            continue
        if isinstance(followup_date, str):
            try:
                followup_date = date.fromisoformat(followup_date[:10])
            except ValueError:
                continue
        if followup_date > today:
            continue
        _process_one(row)


@catch_and_log("Lead Followup Row")
def _process_one(row: dict) -> None:
    attempts = int(row.get("followup_attempts") or 0)

    prompt = (
        f"Write a short, friendly follow-up message (WhatsApp/email friendly, 2-4 lines) from "
        f"{config.FIRM_NAME}, a Chartered Accountancy firm in India, to a prospective client who "
        f"enquired about {row.get('requirement') or 'their requirement'} but hasn't "
        f"responded/converted yet. This is follow-up attempt number {attempts + 1}. Keep it "
        f"light, not pushy, and end with a simple question or CTA to continue the conversation. "
        f"Do not quote pricing.\n\nLead name: {row.get('name')}"
    )
    message = draft(prompt)

    if row.get("phone"):
        send_whatsapp_message(row["phone"], message)
    if row.get("email"):
        send_email(row["email"], f"Following up — {config.FIRM_NAME}", message)

    new_attempts = attempts + 1
    max_reached = new_attempts >= 4
    next_followup = "" if max_reached else (date.today() + timedelta(days=3)).isoformat()
    new_status = "Cold-Closed" if max_reached else row.get("status")

    LEADS.update_by(
        "lead_id",
        row["lead_id"],
        {"followup_attempts": new_attempts, "followup_date": next_followup, "status": new_status},
    )
