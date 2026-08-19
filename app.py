"""
CA Firm Automation Suite — Flask entry point.

Routes (mirrors the original n8n workflow's 5 webhooks):
  GET/POST /webhooks/whatsapp-incoming   Branch 1
  POST     /webhooks/website-lead        Branch 2
  POST     /webhooks/request-documents   Branch 4
  POST     /webhooks/payment-confirmation Branch 5
  GET      /health                       liveness check

Background:
  - Gmail poller thread (Branch 3), polls every GMAIL_POLL_SECONDS
  - APScheduler running the 4 daily jobs (Branches 6-9) at 9:00 / 9:30 /
    10:00 / 10:30 SCHEDULER_TIMEZONE
"""
import logging
import threading
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from flask import Flask, jsonify, request

import config
from branches import whatsapp_incoming, website_lead, email_support, request_documents, payment_confirmation
from branches import compliance_reminders, document_followup, lead_followup, invoice_followup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("app")

app = Flask(__name__)


# ── Branch 1: WhatsApp Incoming ─────────────────────────────────────────
@app.route("/webhooks/whatsapp-incoming", methods=["GET", "POST"])
def whatsapp_incoming_route():
    if request.method == "GET":
        body, status = whatsapp_incoming.verify_webhook(request.args)
        if status == 404:
            return "", 404
        if isinstance(body, dict):
            return jsonify(body), status
        return body, status

    # POST: ack immediately, process in background (matches original's
    # "fast 200 then route" behaviour).
    whatsapp_incoming.process_async(request.get_json(force=True, silent=True) or {})
    return jsonify({"status": "received"}), 200


# ── Branch 2: Website Lead Form ─────────────────────────────────────────
@app.route("/webhooks/website-lead", methods=["POST"])
def website_lead_route():
    try:
        body, status = website_lead.handle_website_lead(request.get_json(force=True, silent=True) or {})
    except Exception:
        log.exception("website-lead processing error")
        return jsonify({"error": "internal_error", "message": "could not process submission, team notified"}), 500
    return jsonify(body), status


# ── Branch 4: Request Documents ─────────────────────────────────────────
@app.route("/webhooks/request-documents", methods=["POST"])
def request_documents_route():
    try:
        body, status = request_documents.handle_request_documents(request.get_json(force=True, silent=True) or {})
    except Exception:
        log.exception("request-documents processing error")
        return jsonify({"error": "internal_error", "message": "could not process request, team notified"}), 500
    return jsonify(body), status


# ── Branch 5: Payment Confirmation ──────────────────────────────────────
@app.route("/webhooks/payment-confirmation", methods=["POST"])
def payment_confirmation_route():
    try:
        body, status = payment_confirmation.handle_payment_confirmation(
            request.get_json(force=True, silent=True) or {}
        )
    except Exception:
        log.exception("payment-confirmation processing error")
        return (
            jsonify({"error": "internal_error", "message": "could not process payment update, team notified"}),
            500,
        )
    return jsonify(body), status


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


# ── Branch 3: Gmail poller (background thread) ──────────────────────────
def _gmail_poll_loop():
    while True:
        try:
            email_support.poll_and_process()
        except Exception:
            log.exception("Gmail poll loop error")
        time.sleep(config.GMAIL_POLL_SECONDS)


# ── Branches 6-9: daily scheduled jobs ───────────────────────────────────
def _start_scheduler():
    scheduler = BackgroundScheduler(timezone=config.SCHEDULER_TIMEZONE)
    scheduler.add_job(
        compliance_reminders.run,
        CronTrigger(hour=config.COMPLIANCE_CHECK_HOUR, minute=config.COMPLIANCE_CHECK_MINUTE),
        id="compliance_reminders",
    )
    scheduler.add_job(
        document_followup.run,
        CronTrigger(hour=config.DOCUMENT_FOLLOWUP_HOUR, minute=config.DOCUMENT_FOLLOWUP_MINUTE),
        id="document_followup",
    )
    scheduler.add_job(
        lead_followup.run,
        CronTrigger(hour=config.LEAD_FOLLOWUP_HOUR, minute=config.LEAD_FOLLOWUP_MINUTE),
        id="lead_followup",
    )
    scheduler.add_job(
        invoice_followup.run,
        CronTrigger(hour=config.INVOICE_FOLLOWUP_HOUR, minute=config.INVOICE_FOLLOWUP_MINUTE),
        id="invoice_followup",
    )
    scheduler.start()
    log.info(
        "Scheduler started: compliance %02d:%02d, documents %02d:%02d, leads %02d:%02d, invoices %02d:%02d (%s)",
        config.COMPLIANCE_CHECK_HOUR, config.COMPLIANCE_CHECK_MINUTE,
        config.DOCUMENT_FOLLOWUP_HOUR, config.DOCUMENT_FOLLOWUP_MINUTE,
        config.LEAD_FOLLOWUP_HOUR, config.LEAD_FOLLOWUP_MINUTE,
        config.INVOICE_FOLLOWUP_HOUR, config.INVOICE_FOLLOWUP_MINUTE,
        config.SCHEDULER_TIMEZONE,
    )
    return scheduler


if __name__ == "__main__":
    threading.Thread(target=_gmail_poll_loop, daemon=True).start()
    _start_scheduler()
    app.run(host="0.0.0.0", port=config.PORT, debug=config.DEBUG)
