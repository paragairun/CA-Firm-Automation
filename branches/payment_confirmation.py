"""
BRANCH 5 — Payment Confirmation
Use Case 5 (status update half): POST { invoice_id, amount_paid, payment_date }
-> marks Invoices row Paid + sends thank-you receipt via WhatsApp+Email.

Call from your payment gateway webhook (Razorpay/PayU/etc.) or manually when
cash/cheque payment is recorded.
"""
from datetime import datetime

import config
from error_handling import catch_and_log
from services.llm import draft
from services.whatsapp import send_whatsapp_message
from services.gmail_service import send_email
from services.sheets_db import INVOICES


def validate_payload(body: dict) -> dict:
    invoice_id = str(body.get("invoice_id", "")).strip()
    return {
        "valid": bool(invoice_id),
        "invoice_id": invoice_id,
        "amount_paid": body.get("amount_paid") or body.get("amount") or "",
        "payment_date": body.get("payment_date") or datetime.now().isoformat(),
    }


@catch_and_log("Payment Confirmation Webhook")
def handle_payment_confirmation(body: dict) -> tuple[dict, int]:
    payload = validate_payload(body)
    if not payload["valid"]:
        return {"error": "bad_request", "message": "invoice_id required"}, 400

    invoice = INVOICES.find_one("invoice_id", payload["invoice_id"])
    if not invoice:
        # Mirrors original: no further branch fires when the invoice isn't found,
        # but the webhook still acks 200 (payload itself was valid).
        return {"status": "received"}, 200

    INVOICES.update_by("invoice_id", payload["invoice_id"], {"status": "Paid"})

    prompt = (
        f"Write a short, warm thank-you message (WhatsApp/email friendly, 2-4 lines) from "
        f"{config.FIRM_NAME} confirming receipt of payment for invoice {invoice['invoice_id']}, "
        f"amount {invoice.get('currency', 'INR')} {invoice.get('amount')}. Client name: "
        f"{invoice.get('client_name')}. Do not add anything else."
    )
    message = draft(prompt)

    if invoice.get("phone"):
        send_whatsapp_message(invoice["phone"], message)
    if invoice.get("email"):
        send_email(invoice["email"], "Payment received — thank you!", message)

    return {"status": "received"}, 200
