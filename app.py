"""
CA Firm Automation Suite — Flask entry point (Cloud Run / serverless).

Public routes (mirrors the original n8n workflow's webhooks):
  GET/POST /webhooks/whatsapp-incoming     Branch 1
  POST     /webhooks/website-lead          Branch 2
  POST     /webhooks/request-documents     Branch 4
  POST     /webhooks/payment-confirmation  Branch 5
  GET      /health                         liveness check

Internal routes, triggered by Cloud Scheduler (see README "Deploying to
Cloud Run" for the exact gcloud commands to create these 5 jobs):
  POST /internal/gmail-poll            Branch 3 — every minute
  POST /internal/compliance-reminders  Branch 6 — daily 09:00 IST
  POST /internal/document-followup     Branch 7 — daily 09:30 IST
  POST /internal/lead-followup         Branch 8 — daily 10:00 IST
  POST /internal/invoice-followup      Branch 9 — daily 10:30 IST

All /internal/* routes require a matching 'X-Internal-Secret' header
(SCHEDULER_SHARED_SECRET) — Cloud Scheduler is configured to send it on
every call. Public routes stay unauthenticated since Meta, your payment
gateway, and your website form can't provide that header (WhatsApp has
its own hub.verify_token handshake instead; a payment-gateway signature
check would be a sensible future hardening step, not built here).

Why no background threads or in-process scheduler here (unlike the VM
deployment): Cloud Run can freeze or kill a container's CPU the moment a
request finishes, so anything relying on a long-lived background thread —
the old Gmail poll loop, the old APScheduler — is unreliable in this
environment. Everything here runs synchronously inside a single HTTP
request/response cycle instead, triggered either by an external webhook
or by Cloud Scheduler hitting an /internal/* route.

One real behavioural change worth knowing: the WhatsApp webhook used to
ACK Meta instantly and process the message in a background thread. On
Cloud Run it processes the message (LLM call + a couple of Sheets/
WhatsApp API calls) and replies within the same request before returning
the ack — typically still a few seconds, comfortably inside Meta's
expected response window, but no longer instant.
"""
import functools
import hmac
import logging

from flask import Flask, jsonify, request, send_from_directory

import config
from branches import whatsapp_incoming, website_lead, email_support, request_documents, payment_confirmation
from branches import compliance_reminders, document_followup, lead_followup, invoice_followup
from services.dashboard_data import build_dashboard_payload
from setup_sheets import run_setup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("app")

app = Flask(__name__)


def require_scheduler_secret(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        provided = request.headers.get("X-Internal-Secret", "")
        expected = config.SCHEDULER_SHARED_SECRET
        if not expected or not hmac.compare_digest(provided, expected):
            return jsonify({"error": "unauthorized"}), 401
        return fn(*args, **kwargs)

    return wrapper


def require_dashboard_key(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        # Accept the key either as a header (used by the dashboard page's
        # JS) or as a ?key= query param (lets a person trigger a protected
        # route by just pasting a URL in a browser — avoids terminal/shell
        # quoting issues entirely for one-off manual actions).
        provided = request.headers.get("X-Dashboard-Key", "") or request.args.get("key", "")
        expected = config.DASHBOARD_ACCESS_KEY
        if not expected or not hmac.compare_digest(provided, expected):
            return jsonify({"error": "unauthorized"}), 401
        return fn(*args, **kwargs)

    return wrapper


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

    whatsapp_incoming.handle_incoming(request.get_json(force=True, silent=True) or {})
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


# ── Staff dashboard (real data, key-gated) ───────────────────────────────
@app.route("/dashboard", methods=["GET"])
def dashboard_page_route():
    return send_from_directory("static", "dashboard.html")


@app.route("/api/dashboard-data", methods=["GET"])
@require_dashboard_key
def dashboard_data_route():
    return jsonify(build_dashboard_payload()), 200


@app.route("/internal/setup-sheets", methods=["GET", "POST"])
@require_dashboard_key
def setup_sheets_route():
    """One-time (safe to re-run) — creates the 8 required tabs + header
    rows in GOOGLE_SPREADSHEET_ID if they don't already exist. Lets this
    run against the deployed service instead of needing local Python."""
    try:
        result = run_setup()
        return jsonify({"status": "ok", **result}), 200
    except Exception as e:
        log.exception("setup-sheets failed")
        return jsonify({"status": "error", "message": str(e)}), 500


# ── Branch 3 + 6-9: Cloud Scheduler-triggered internal jobs ─────────────
@app.route("/internal/gmail-poll", methods=["POST"])
@require_scheduler_secret
def gmail_poll_route():
    email_support.poll_and_process()
    return jsonify({"status": "ok"}), 200


@app.route("/internal/compliance-reminders", methods=["POST"])
@require_scheduler_secret
def compliance_reminders_route():
    compliance_reminders.run()
    return jsonify({"status": "ok"}), 200


@app.route("/internal/document-followup", methods=["POST"])
@require_scheduler_secret
def document_followup_route():
    document_followup.run()
    return jsonify({"status": "ok"}), 200


@app.route("/internal/lead-followup", methods=["POST"])
@require_scheduler_secret
def lead_followup_route():
    lead_followup.run()
    return jsonify({"status": "ok"}), 200


@app.route("/internal/invoice-followup", methods=["POST"])
@require_scheduler_secret
def invoice_followup_route():
    invoice_followup.run()
    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    # Local dev only — Cloud Run invokes the app via gunicorn (see Dockerfile).
    app.run(host="0.0.0.0", port=config.PORT, debug=config.DEBUG)
