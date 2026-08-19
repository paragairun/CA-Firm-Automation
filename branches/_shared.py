"""
Shared helpers used by more than one branch — client matching and the
compliance/document context summary fed to the AI support agent. Kept
identical in behaviour to the original workflow's duplicated
"Match Client by Phone/Email" and "Build Client Context Summary" code nodes.
"""
import re
import time
from datetime import datetime

import config
from services.sheets_db import CLIENTS, COMPLIANCE_CALENDAR, DOCUMENTS_TRACKER, QUERY_LOG


def match_client_by_phone(from_phone: str) -> dict | None:
    """Loose match: compares digit-only phone numbers, allowing either side
    to be a suffix of the other (handles country-code prefix mismatches
    like +91 vs 91 vs no prefix)."""
    digits = re.sub(r"\D", "", from_phone or "")
    if not digits:
        return None
    for row in CLIENTS.all_rows():
        p = re.sub(r"\D", "", row.get("phone") or "")
        if p and (p == digits or p.endswith(digits) or digits.endswith(p)):
            return row
    return None


def match_client_by_email(sender_email: str) -> dict | None:
    email_l = (sender_email or "").strip().lower()
    if not email_l:
        return None
    for row in CLIENTS.all_rows():
        if (row.get("email") or "").strip().lower() == email_l:
            return row
    return None


def build_client_context_summary(client_id: str, client_name: str) -> str:
    """Builds the system-prompt context block used by both the WhatsApp and
    Email support agents: this client's compliance calendar + document
    status, and nothing else (never leaks other clients' data)."""
    compliance_rows = [r for r in COMPLIANCE_CALENDAR.all_rows() if r["client_id"] == client_id]
    doc_rows = [r for r in DOCUMENTS_TRACKER.all_rows() if r["client_id"] == client_id]

    compliance_lines = (
        "\n".join(f"- {r['compliance_type']}: due {r['due_date']}, status {r['status']}" for r in compliance_rows)
        if compliance_rows
        else "- No compliance records on file."
    )
    doc_lines = (
        "\n".join(f"- {r['document_name']} ({r['compliance_type']}): {r['status']}" for r in doc_rows)
        if doc_rows
        else "- No documents currently requested."
    )

    today = datetime.now().strftime("%d %b %Y")
    return (
        f"You are the AI support assistant for {config.FIRM_NAME} (a Chartered Accountancy firm "
        f"in India). Today's date is {today}.\n"
        f"Client: {client_name} (Client ID: {client_id or 'N/A'}).\n\n"
        f"Client's compliance calendar:\n{compliance_lines}\n\n"
        f"Client's document status:\n{doc_lines}\n\n"
        f"Rules:\n"
        f"- Answer questions about GST, ITR, TDS, ROC, and general tax/compliance in simple, "
        f"clear language (Hindi-English mix is fine if the client writes that way).\n"
        f"- Use the compliance/document data above to answer specifics about THIS client's due "
        f"dates and pending documents. Never invent a due date or document status that isn't "
        f"listed above.\n"
        f"- For anything requiring judgment calls, specific tax advice beyond general FAQ, or "
        f"anything you are not fully certain about, tell the client a CA from the team will "
        f"personally follow up, and do not guess.\n"
        f"- Keep replies short and appropriate for the channel (a few lines max).\n"
        f"- Never share other clients' data."
    )


def log_query(client_id: str, phone: str, email: str, channel: str, query_text: str, ai_response: str) -> None:
    QUERY_LOG.append(
        {
            "log_id": f"LOG-{int(time.time() * 1000)}",
            "client_id": client_id,
            "phone": phone,
            "email": email,
            "channel": channel,
            "query_text": query_text,
            "ai_response": ai_response,
            "timestamp": datetime.now().isoformat(),
        }
    )
