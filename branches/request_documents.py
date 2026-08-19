"""
BRANCH 4 — Request Documents (Partner-initiated)
Use Case 2a: partner/system POSTs { client_id, compliance_type, documents:[...] }
-> creates Pending rows in documents_tracker + sends an AI-drafted request via
WhatsApp+Email.

Call this from another workflow, an internal tool, or manually via curl/Postman
whenever a new compliance task starts and documents are needed.
"""
import time

import config
from db import fetch_one, execute
from error_handling import catch_and_log
from services.llm import draft
from services.whatsapp import send_whatsapp_message
from services.email_service import send_email


def validate_payload(body: dict) -> dict:
    client_id = str(body.get("client_id", "")).strip()
    compliance_type = str(body.get("compliance_type") or "General").strip()
    documents = [str(d).strip() for d in (body.get("documents") or []) if str(d).strip()]
    return {
        "valid": bool(client_id and documents),
        "client_id": client_id,
        "compliance_type": compliance_type,
        "documents": documents,
    }


@catch_and_log("Request Documents Webhook")
def handle_request_documents(body: dict) -> tuple[dict, int]:
    payload = validate_payload(body)
    if not payload["valid"]:
        return {"error": "bad_request", "message": "client_id and non-empty documents[] required"}, 400

    client = fetch_one("SELECT * FROM clients WHERE client_id = %s", (payload["client_id"],)) or {}
    client_name = client.get("name", "Client")
    phone = client.get("phone", "")
    email = client.get("email", "")

    for idx, doc_name in enumerate(payload["documents"]):
        execute(
            "INSERT INTO documents_tracker "
            "(doc_id, client_id, client_name, phone, email, compliance_type, document_name, "
            "requested_date, status, followup_count) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, now(), 'Pending', 0)",
            (
                f"DOC-{int(time.time() * 1000)}-{idx}",
                payload["client_id"],
                client_name,
                phone,
                email,
                payload["compliance_type"],
                doc_name,
            ),
        )

    doc_list = "\n".join(f"{i + 1}. {d}" for i, d in enumerate(payload["documents"]))
    prompt = (
        f"You are writing on behalf of {config.FIRM_NAME}, a Chartered Accountancy firm in "
        f"India, to a client, asking them to submit documents needed for their "
        f"{payload['compliance_type']} work. Write a short, polite, clear message "
        f"(WhatsApp/email friendly, 4-6 lines) that lists the required documents and asks them "
        f"to share it at the earliest so filing isn't delayed. Include this exact document list "
        f"formatted as-is:\n{doc_list}\n\nClient name: {client_name}"
    )
    message = draft(prompt)

    if phone:
        send_whatsapp_message(phone, message)
    if email:
        send_email(email, f"Documents needed — {payload['compliance_type']}", message)

    return {"status": "received"}, 200
