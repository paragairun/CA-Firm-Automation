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
from services.sheets_db import CLIENTS, COMPLIANCE_CALENDAR, INVOICES, DOCUMENTS_TRACKER, LEADS, TASKS
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
        #
        # A query-string value with a literal '+' in it arrives here
        # already turned into a space — that's standard URL/form decoding
        # (RFC 1866), not a bug, but it silently breaks an exact-match
        # comparison if the real key contains '+'. Since that's the only
        # character this transformation touches, and it's one-directional
        # and deterministic, we safely check both the value as received
        # and the value with spaces restored to '+' — so a key containing
        # '+' still works correctly via the URL method, not just headers.
        provided = request.headers.get("X-Dashboard-Key", "") or request.args.get("key", "")
        expected = config.DASHBOARD_ACCESS_KEY
        matches = expected and (
            hmac.compare_digest(provided, expected)
            or hmac.compare_digest(provided.replace(" ", "+"), expected)
        )
        if not matches:
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


# ── Dashboard write actions (all require the dashboard key) ─────────────
@app.route("/api/clients", methods=["POST"])
@require_dashboard_key
def add_client_route():
    import time

    body = request.get_json(force=True, silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"error": "bad_request", "message": "name is required"}), 400

    client_id = f"CL-{int(time.time() * 1000)}"
    CLIENTS.append(
        {
            "client_id": client_id,
            "name": name,
            "phone": str(body.get("phone", "")).strip(),
            "email": str(body.get("email", "")).strip(),
            "business_type": str(body.get("business_type", "")).strip(),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
    )
    return jsonify({"status": "ok", "client_id": client_id}), 200


@app.route("/api/compliance/<compliance_id>/mark-filed", methods=["POST"])
@require_dashboard_key
def mark_compliance_filed_route(compliance_id):
    ok = COMPLIANCE_CALENDAR.update_by("compliance_id", compliance_id, {"status": "Filed"})
    if not ok:
        return jsonify({"error": "not_found"}), 404
    return jsonify({"status": "ok"}), 200


@app.route("/api/compliance", methods=["POST"])
@require_dashboard_key
def add_compliance_route():
    import time

    body = request.get_json(force=True, silent=True) or {}
    client_id = str(body.get("client_id", "")).strip()
    compliance_type = str(body.get("compliance_type", "")).strip()
    due_date = str(body.get("due_date", "")).strip()
    if not (client_id and compliance_type and due_date):
        return jsonify({"error": "bad_request", "message": "client_id, compliance_type, due_date required"}), 400

    client = CLIENTS.find_one("client_id", client_id) or {}
    compliance_id = f"COMP-{int(time.time() * 1000)}"
    COMPLIANCE_CALENDAR.append(
        {
            "compliance_id": compliance_id,
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "phone": client.get("phone", ""),
            "email": client.get("email", ""),
            "compliance_type": compliance_type,
            "due_date": due_date,
            "status": "Pending",
            "reminder_count": 0,
        }
    )
    return jsonify({"status": "ok", "compliance_id": compliance_id}), 200


@app.route("/api/invoices/<invoice_id>/mark-paid", methods=["POST"])
@require_dashboard_key
def mark_invoice_paid_route(invoice_id):
    ok = INVOICES.update_by("invoice_id", invoice_id, {"status": "Paid"})
    if not ok:
        return jsonify({"error": "not_found"}), 404
    return jsonify({"status": "ok"}), 200


@app.route("/api/invoices", methods=["POST"])
@require_dashboard_key
def add_invoice_route():
    import time

    body = request.get_json(force=True, silent=True) or {}
    client_id = str(body.get("client_id", "")).strip()
    due_date = str(body.get("due_date", "")).strip()
    try:
        amount = float(body.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0
    if not (client_id and due_date and amount > 0):
        return jsonify({"error": "bad_request", "message": "client_id, due_date, amount (> 0) required"}), 400

    client = CLIENTS.find_one("client_id", client_id) or {}
    invoice_id = f"INV-{int(time.time() * 1000)}"
    INVOICES.append(
        {
            "invoice_id": invoice_id,
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "phone": client.get("phone", ""),
            "email": client.get("email", ""),
            "amount": amount,
            "currency": str(body.get("currency") or "INR").strip(),
            "due_date": due_date,
            "status": "Pending",
            "reminder_count": 0,
            "escalated": "No",
        }
    )
    return jsonify({"status": "ok", "invoice_id": invoice_id}), 200


@app.route("/api/documents/<doc_id>/mark-received", methods=["POST"])
@require_dashboard_key
def mark_document_received_route(doc_id):
    import datetime as dt

    ok = DOCUMENTS_TRACKER.update_by(
        "doc_id", doc_id, {"status": "Received", "received_date": dt.datetime.now().isoformat()}
    )
    if not ok:
        return jsonify({"error": "not_found"}), 404
    return jsonify({"status": "ok"}), 200


@app.route("/api/documents", methods=["POST"])
@require_dashboard_key
def add_document_route():
    import time
    import datetime as dt

    body = request.get_json(force=True, silent=True) or {}
    client_id = str(body.get("client_id", "")).strip()
    document_name = str(body.get("document_name", "")).strip()
    if not (client_id and document_name):
        return jsonify({"error": "bad_request", "message": "client_id, document_name required"}), 400

    client = CLIENTS.find_one("client_id", client_id) or {}
    doc_id = f"DOC-{int(time.time() * 1000)}"
    DOCUMENTS_TRACKER.append(
        {
            "doc_id": doc_id,
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "phone": client.get("phone", ""),
            "email": client.get("email", ""),
            "compliance_type": str(body.get("compliance_type", "")).strip(),
            "document_name": document_name,
            "requested_date": dt.datetime.now().isoformat(),
            "status": "Pending",
            "followup_count": 0,
        }
    )
    return jsonify({"status": "ok", "doc_id": doc_id}), 200


@app.route("/api/leads", methods=["POST"])
@require_dashboard_key
def add_lead_route():
    import time

    body = request.get_json(force=True, silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"error": "bad_request", "message": "name is required"}), 400

    lead_id = f"LEAD-MANUAL-{int(time.time() * 1000)}"
    LEADS.append(
        {
            "lead_id": lead_id,
            "name": name,
            "phone": str(body.get("phone", "")).strip(),
            "email": str(body.get("email", "")).strip(),
            "source": str(body.get("source") or "Manual").strip(),
            "requirement": str(body.get("requirement", "")).strip(),
            "status": "New",
            "followup_attempts": 0,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
    )
    return jsonify({"status": "ok", "lead_id": lead_id}), 200


@app.route("/api/leads/<lead_id>/set-status", methods=["POST"])
@require_dashboard_key
def set_lead_status_route(lead_id):
    body = request.get_json(force=True, silent=True) or {}
    new_status = str(body.get("status", "")).strip()
    valid_statuses = {"New", "Qualifying", "Converted", "Lost", "Cold-Closed"}
    if new_status not in valid_statuses:
        return jsonify({"error": "bad_request", "message": f"status must be one of {sorted(valid_statuses)}"}), 400

    ok = LEADS.update_by("lead_id", lead_id, {"status": new_status})
    if not ok:
        return jsonify({"error": "not_found"}), 404
    return jsonify({"status": "ok"}), 200


@app.route("/api/tasks", methods=["POST"])
@require_dashboard_key
def add_task_route():
    import time

    body = request.get_json(force=True, silent=True) or {}
    title = str(body.get("title", "")).strip()
    if not title:
        return jsonify({"error": "bad_request", "message": "title is required"}), 400

    client_id = str(body.get("client_id", "")).strip()
    client_name = ""
    if client_id:
        client = CLIENTS.find_one("client_id", client_id) or {}
        client_name = client.get("name", "")

    task_id = f"TASK-{int(time.time() * 1000)}"
    TASKS.append(
        {
            "task_id": task_id,
            "title": title,
            "description": str(body.get("description", "")).strip(),
            "client_id": client_id,
            "client_name": client_name,
            "due_date": str(body.get("due_date", "")).strip(),
            "priority": str(body.get("priority") or "Medium").strip(),
            "status": "Open",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
    )
    return jsonify({"status": "ok", "task_id": task_id}), 200


@app.route("/api/tasks/<task_id>/mark-done", methods=["POST"])
@require_dashboard_key
def mark_task_done_route(task_id):
    ok = TASKS.update_by("task_id", task_id, {"status": "Done"})
    if not ok:
        return jsonify({"error": "not_found"}), 404
    return jsonify({"status": "ok"}), 200


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
