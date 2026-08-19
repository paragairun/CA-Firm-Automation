"""
BRANCH 1 — WhatsApp Incoming Router
Use Cases: 1 (Support), 2b (Document Receipt), 4 (Lead Qualification)

1. Meta sends GET to verify webhook (hub.challenge).
2. POST messages are parsed and routed synchronously within the request
   (see app.py docstring for why — Cloud Run doesn't support the original
   "fast ack, then process in a background thread" pattern):
   - Known client + text  -> Support Agent (uses live compliance/doc context)
   - Known client + media -> download from WhatsApp, save to Drive, mark
     the matched pending document Received
   - Unknown number       -> Lead Qualification Agent + auto-scoring
"""
import logging
import time
from datetime import datetime, timedelta

import config
from error_handling import catch_and_log
from services.llm import agent_reply, draft, parse_json_block
from services.google_chat_service import notify_partner
from services.whatsapp import send_whatsapp_message, download_media
from services.drive_service import upload_client_document
from services.sheets_db import DOCUMENTS_TRACKER, LEADS
from branches._shared import match_client_by_phone, build_client_context_summary, log_query

log = logging.getLogger("branch1_whatsapp")


def verify_webhook(query_params: dict):
    """GET handler: Meta's webhook verification handshake."""
    if not query_params.get("hub.mode"):
        return None, 404
    if query_params.get("hub.verify_token") == config.WHATSAPP_WEBHOOK_VERIFY_TOKEN:
        return query_params.get("hub.challenge", ""), 200
    return {"error": "forbidden", "message": "verify token mismatch"}, 403


def handle_incoming(body: dict) -> None:
    """POST handler: fire-and-forget, called from a background thread by
    the Flask route so the webhook can ACK Meta immediately."""
    parsed = _parse_payload(body)
    if not parsed.get("has_message"):
        return  # status update / read receipt, nothing to do

    if parsed["is_media"]:
        _handle_media_message(parsed)
    else:
        client = match_client_by_phone(parsed["from_phone"])
        if client:
            _handle_known_client_text(parsed, client)
        else:
            _handle_lead_qualification(parsed)


@catch_and_log("Parse WhatsApp Payload")
def _parse_payload(body: dict) -> dict:
    entry = (body.get("entry") or [{}])[0]
    change = (entry.get("changes") or [{}])[0]
    value = change.get("value") or {}
    messages = value.get("messages") or []
    contacts = value.get("contacts") or []

    if not messages:
        return {"has_message": False}

    msg = messages[0]
    contact = contacts[0] if contacts else {}
    msg_type = msg.get("type", "text")
    text_body, media_id, media_caption, media_filename = "", "", "", ""

    if msg_type == "text":
        text_body = (msg.get("text") or {}).get("body", "")
    elif msg_type == "document":
        media_id = (msg.get("document") or {}).get("id", "")
        media_caption = (msg.get("document") or {}).get("caption", "")
        media_filename = (msg.get("document") or {}).get("filename", "")
    elif msg_type == "image":
        media_id = (msg.get("image") or {}).get("id", "")
        media_caption = (msg.get("image") or {}).get("caption", "")
    elif msg_type in ("audio", "video", "sticker"):
        media_id = (msg.get(msg_type) or {}).get("id", "")

    return {
        "has_message": True,
        "is_media": msg_type != "text",
        "from_phone": msg.get("from", ""),
        "contact_name": (contact.get("profile") or {}).get("name", ""),
        "message_type": msg_type,
        "message_text": text_body,
        "media_id": media_id,
        "media_caption": media_caption,
        "media_filename": media_filename,
    }


@catch_and_log("WhatsApp Support Agent")
def _handle_known_client_text(parsed: dict, client: dict) -> None:
    client_id = client.get("client_id", "")
    client_name = client.get("name") or parsed.get("contact_name") or "there"
    from_phone = parsed["from_phone"]

    system_context = build_client_context_summary(client_id, client_name)
    output = agent_reply(f"wa-support-{from_phone}", system_context, parsed["message_text"])

    send_whatsapp_message(from_phone, output)
    log_query(client_id, from_phone, "", "whatsapp", parsed["message_text"], output)


@catch_and_log("Match Pending Document")
def _handle_media_message(parsed: dict) -> None:
    from_phone = parsed["from_phone"]
    client = match_client_by_phone(from_phone)
    client_name = (client or {}).get("name") or parsed.get("contact_name") or "there"

    if not client:
        # Unknown number sending media — generic ack only, no lead flow for media.
        send_whatsapp_message(
            from_phone,
            f"Thank you {client_name}, we have received your document. "
            f"Our team will review and get back to you if anything else is needed.",
        )
        return

    client_id = client["client_id"]
    pending = next(
        (r for r in DOCUMENTS_TRACKER.all_rows() if r["client_id"] == client_id and r["status"] == "Pending"),
        None,
    )

    drive_link = ""
    if parsed.get("media_id"):
        content, mime_type = download_media(parsed["media_id"])
        if content:
            filename = parsed.get("media_filename") or f"{parsed['message_type']}-{int(time.time())}"
            drive_link = upload_client_document(client_id, client_name, filename, content, mime_type or "application/octet-stream")
        else:
            log.warning("Could not download WhatsApp media %s for client %s", parsed["media_id"], client_id)

    if pending:
        updates = {"status": "Received", "received_date": datetime.now().isoformat()}
        if drive_link:
            updates["drive_file_link"] = drive_link
        DOCUMENTS_TRACKER.update_by("doc_id", pending["doc_id"], updates)
        send_whatsapp_message(
            from_phone,
            f"Thank you {client_name}! We have received your {pending['document_name']}. "
            f"Our team will verify it shortly.",
        )
    else:
        send_whatsapp_message(
            from_phone,
            f"Thank you {client_name}, we have received your document. "
            f"Our team will review and get back to you if anything else is needed.",
        )


@catch_and_log("WhatsApp Lead Qualification Agent")
def _handle_lead_qualification(parsed: dict) -> None:
    from_phone = parsed["from_phone"]
    lead_id = f"LEAD-WA-{int(time.time() * 1000)}"
    lead_name = parsed.get("contact_name") or "WhatsApp Lead"
    message_text = parsed["message_text"]

    LEADS.upsert_by(
        "phone",
        {
            "lead_id": lead_id,
            "name": lead_name,
            "phone": from_phone,
            "source": "WhatsApp",
            "status": "New",
            "followup_date": _plus_days(2),
            "followup_attempts": 0,
            "message_text": message_text,
        },
    )

    system_message = (
        f"You are the lead-qualification assistant for {config.FIRM_NAME}, a Chartered "
        f"Accountancy firm in India, chatting with a NEW prospective client on WhatsApp who is "
        f"not yet a client. Today is {_today_str()}.\n"
        f"Your job in this conversation:\n"
        f"1. Warmly acknowledge their message.\n"
        f"2. Ask 1-2 short questions at a time (never a long list) to understand: what service "
        f"they need (GST registration, ITR filing, company incorporation, tax audit, "
        f"bookkeeping, ROC compliance, etc.), their business type "
        f"(individual/proprietorship/partnership/company), and urgency/timeline.\n"
        f"3. Once you have enough info, tell them a CA from the team will call/message them "
        f"shortly with next steps, and thank them.\n"
        f"Keep messages short and WhatsApp-appropriate (2-4 lines). Hindi-English mix is fine if "
        f"they write that way. Never quote pricing yourself — say the team will share a quote."
    )
    reply = agent_reply(f"wa-lead-{from_phone}", system_message, message_text)
    send_whatsapp_message(from_phone, reply)

    classification_prompt = (
        "You are a classification assistant for a CA firm's lead pipeline. Based on this "
        "WhatsApp exchange, output STRICT JSON only, no markdown, no explanation, exactly this "
        'shape:\n{ "requirement": "<short string, e.g. GST Registration / ITR Filing / Company '
        'Incorporation / Tax Audit / Bookkeeping / ROC Compliance / Other / Unclear>", '
        '"business_type": "<Individual/Proprietorship/Partnership/Company/Unclear>", '
        '"urgency": "<High/Medium/Low/Unclear>", "score": "<Hot/Warm/Cold>" }\n'
        "Score as Hot if urgency is high or they explicitly want to proceed soon; Warm if "
        "interested but no urgency signal; Cold if vague or just browsing.\n\n"
        f"Prospect's message: {message_text}\nAssistant's reply: {reply}"
    )
    raw = draft(classification_prompt)
    parsed_json = parse_json_block(
        raw, {"requirement": "Unclear", "business_type": "Unclear", "urgency": "Unclear", "score": "Warm"}
    )

    LEADS.upsert_by(
        "phone",
        {
            "phone": from_phone,
            "requirement": parsed_json.get("requirement", "Unclear"),
            "business_type": parsed_json.get("business_type", "Unclear"),
            "urgency": parsed_json.get("urgency", "Unclear"),
            "qualification_score": parsed_json.get("score", "Warm"),
            "status": "Qualifying",
        },
    )

    if parsed_json.get("score") == "Hot":
        notify_partner(
            f"🔥 *Hot Lead (WhatsApp)*\nName: {lead_name}\nPhone: {from_phone}\n"
            f"Requirement: {parsed_json.get('requirement')}\nUrgency: {parsed_json.get('urgency')}"
        )


def _today_str() -> str:
    return datetime.now().strftime("%d %b %Y")


def _plus_days(n: int) -> str:
    return (datetime.now() + timedelta(days=n)).strftime("%Y-%m-%d")
