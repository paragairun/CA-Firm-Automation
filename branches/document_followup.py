"""
BRANCH 7 — Document Follow-up
Use Case 2c: any 'Pending' row in documents_tracker not followed-up in 3+ days
gets an AI-drafted reminder (tone escalates by attempt). 3rd+ follow-up pings
the partner.

Runs daily at 9:30 AM.
"""
from datetime import datetime

import config
from db import fetch_all, execute
from error_handling import catch_and_log
from services.llm import draft
from services.whatsapp import send_whatsapp_message
from services.email_service import send_email
from services.telegram_service import notify_partner


def _days_since(dt) -> int | None:
    if not dt:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except ValueError:
            return None
    if dt.tzinfo is not None:
        now = datetime.now(dt.tzinfo)
    else:
        now = datetime.now()
    return (now - dt).days


@catch_and_log("Daily 930AM - Document Followup")
def run() -> None:
    for row in fetch_all("SELECT * FROM documents_tracker"):
        if row["status"] != "Pending":
            continue
        ref_date = row.get("last_followup_date") or row.get("requested_date")
        gap = _days_since(ref_date)
        if gap is None or gap < 3:
            continue
        _process_one(row)


@catch_and_log("Document Followup Row")
def _process_one(row: dict) -> None:
    followup_count = int(row.get("followup_count") or 0)

    prompt = (
        f"Write a short WhatsApp/email-friendly follow-up (3-4 lines) from {config.FIRM_NAME} "
        f"reminding a client to share a still-pending document.\n\n"
        f"Client: {row['client_name']}\nDocument: {row['document_name']}\n"
        f"Related to: {row['compliance_type']}\nThis is follow-up number: {followup_count + 1} "
        f"(1st = gentle, 2nd = clearer, 3rd+ = firmer, mention it may delay filing/compliance).\n\n"
        f"Ask them to share it at the earliest convenience."
    )
    message = draft(prompt)

    if row.get("phone"):
        send_whatsapp_message(row["phone"], message)
    if row.get("email"):
        send_email(row["email"], f"Reminder: {row['document_name']} needed", message)

    execute(
        "UPDATE documents_tracker SET followup_count = followup_count + 1, last_followup_date = now() "
        "WHERE doc_id = %s",
        (row["doc_id"],),
    )

    if followup_count + 1 >= 3:
        notify_partner(
            f"📄 *Document Still Pending*\nClient: {row['client_name']}\nDocument: {row['document_name']}\n"
            f"Follow-ups sent: {followup_count + 1}\nConsider a direct call."
        )
