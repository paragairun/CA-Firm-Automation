"""
BRANCH 2 — Website Lead Form
Use Case 4: enquiry -> AI opening question + classification -> WhatsApp/Email
+ urgent-lead alert.

Expects POST JSON body: { name, phone, email, message, source }
"""
import time
from datetime import datetime, timedelta

from error_handling import catch_and_log
import config
from services.llm import draft, parse_json_block
from services.google_chat_service import notify_partner
from services.whatsapp import send_whatsapp_message
from services.gmail_service import send_email
from services.sheets_db import LEADS


def validate_payload(body: dict) -> dict:
    name = str(body.get("name", "")).strip()
    phone = str(body.get("phone", "")).strip()
    email = str(body.get("email", "")).strip()
    message = str(body.get("message") or body.get("requirement") or "").strip()
    valid = bool(name and (phone or email))
    return {
        "valid": valid,
        "name": name or "Website Visitor",
        "phone": phone,
        "email": email,
        "message": message or "No message provided.",
        "source": body.get("source") or "Website",
    }


@catch_and_log("Website Lead Form Webhook")
def handle_website_lead(body: dict) -> tuple[dict, int]:
    payload = validate_payload(body)
    if not payload["valid"]:
        return {"error": "bad_request", "message": "name and (phone or email) required"}, 400

    lead_id = f"LEAD-WEB-{int(time.time() * 1000)}"
    LEADS.upsert_by(
        "phone" if payload["phone"] else "email",
        {
            "lead_id": lead_id,
            "name": payload["name"],
            "phone": payload["phone"],
            "email": payload["email"],
            "source": payload["source"],
            "status": "New",
            "followup_date": (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d"),
            "followup_attempts": 0,
            "notes": payload["message"],
        },
    )

    opening_prompt = (
        f"You are the intake assistant for {config.FIRM_NAME}, a Chartered Accountancy firm in "
        f"India. A visitor just submitted this enquiry on the website. Write a warm, short "
        f"(3-4 lines) opening reply that: thanks them, restates you understood their need in one "
        f"line, and asks ONE clarifying question to move the conversation forward. Do not quote "
        f"any price. Hindi-English mix is fine if their message was in Hinglish.\n\n"
        f"Visitor name: {payload['name']}\nVisitor message: {payload['message']}"
    )
    opening_message = draft(opening_prompt)

    classify_prompt = (
        "Classify this CA-firm website enquiry. Output STRICT JSON only, exactly this shape, no "
        'markdown:\n{ "requirement": "<short string e.g. GST Registration / ITR Filing / Company '
        'Incorporation / Tax Audit / Bookkeeping / ROC Compliance / Other / Unclear>", '
        '"urgency": "<High/Medium/Low/Unclear>" }\n\n'
        f"Message: {payload['message']}"
    )
    raw = draft(classify_prompt)
    parsed = parse_json_block(raw, {"requirement": "Unclear", "urgency": "Unclear"})

    LEADS.upsert_by(
        "phone" if payload["phone"] else "email",
        {
            "phone": payload["phone"] or "",
            "email": payload["email"] or "",
            "requirement": parsed.get("requirement", "Unclear"),
            "urgency": parsed.get("urgency", "Unclear"),
            "status": "Qualifying",
        },
    )

    if payload["phone"]:
        send_whatsapp_message(payload["phone"], opening_message)
    if payload["email"]:
        send_email(payload["email"], f"Thanks for reaching out to {config.FIRM_NAME}", opening_message)

    if parsed.get("urgency") == "High":
        notify_partner(
            f"🌐 *Urgent Website Lead*\nName: {payload['name']}\nPhone: {payload['phone']}\n"
            f"Email: {payload['email']}\nRequirement: {parsed.get('requirement')}"
        )

    return {"status": "received"}, 200
