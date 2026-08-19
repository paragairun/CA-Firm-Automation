"""
BRANCH 3 — Email Query Support
Use Case 1 (email channel) + Use Case 4 (email leads)

Polls Gmail (via Gmail API) every GMAIL_POLL_SECONDS for unread mail not
yet labelled processed. Known-client senders get the same AI Support Agent
(with live compliance/doc context) used on WhatsApp. Unknown senders get
logged as a new Lead + an AI opening reply.
"""
import time
from datetime import datetime, timedelta

from error_handling import catch_and_log
import config
from services.gmail_service import fetch_unread_emails, send_email
from services.llm import agent_reply, draft
from services.sheets_db import LEADS
from branches._shared import match_client_by_email, build_client_context_summary, log_query


@catch_and_log("Email Query Support Poll")
def poll_and_process() -> None:
    for msg in fetch_unread_emails():
        _process_one(msg)


@catch_and_log("Process One Inbound Email")
def _process_one(msg: dict) -> None:
    sender_email = msg["sender_email"]
    subject = msg["subject"]
    body_text = msg["body_text"]

    client = match_client_by_email(sender_email)

    if client:
        client_id = client.get("client_id", "")
        client_name = client.get("name") or sender_email.split("@")[0] or "there"
        system_context = build_client_context_summary(client_id, client_name)
        user_message = f"{subject}\n\n{body_text}"

        output = agent_reply(f"email-support-{sender_email}", system_context, user_message)
        send_email(sender_email, f"Re: {subject}", output)
        log_query(client_id, "", sender_email, "email", user_message, output)
    else:
        client_name = sender_email.split("@")[0] or "there"
        lead_id = f"LEAD-EMAIL-{int(time.time() * 1000)}"
        LEADS.upsert_by(
            "email",
            {
                "lead_id": lead_id,
                "name": client_name,
                "email": sender_email,
                "source": "Email",
                "status": "New",
                "followup_date": (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d"),
                "followup_attempts": 0,
                "notes": f"{subject}: {body_text}",
            },
        )

        reply_prompt = (
            f"You are the intake assistant for {config.FIRM_NAME}, a Chartered Accountancy firm "
            f"in India, replying to a new email enquiry from someone who is not yet a client. "
            f"Write a short, professional email (4-6 lines) that: thanks them, restates their "
            f"need in one line, asks ONE clarifying question, and says a CA from the team will "
            f"follow up shortly. Do not quote pricing.\n\n"
            f"Subject: {subject}: {body_text}"
        )
        reply_text = draft(reply_prompt)
        send_email(sender_email, f"Re: {subject}", reply_text)
