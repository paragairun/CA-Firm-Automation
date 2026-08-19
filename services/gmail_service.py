"""
Gmail API — send (via users.messages.send) and poll unread mail (via
users.messages.list), using domain-wide-delegated service account creds
(no per-user OAuth consent, no app password). Replaces the original
n8n Gmail OAuth2 node + Gmail Trigger (every-minute poll).

Processed-tracking mirrors the original workflow's filter
("is:unread -label:ca-firm-automation-processed") exactly: instead of an
IMAP \\Seen flag, we apply a real Gmail label (GMAIL_PROCESSED_LABEL) and
remove UNREAD, so the label is visible and filterable in the Gmail UI too.
"""
import base64
import logging
import re
import threading
from email.mime.text import MIMEText

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

import config
from services.google_auth import get_credentials, SCOPE_GMAIL_MODIFY, SCOPE_GMAIL_SEND

log = logging.getLogger("gmail_service")

_svc_lock = threading.Lock()
_svc = None
_label_id_cache = None


def _service():
    global _svc
    if _svc is None:
        with _svc_lock:
            if _svc is None:
                creds = get_credentials([SCOPE_GMAIL_MODIFY, SCOPE_GMAIL_SEND])
                _svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
    return _svc


def send_email(to_addr: str, subject: str, body: str) -> bool:
    if not to_addr or not body:
        log.warning("send_email called with empty to_addr or body, skipping")
        return False
    try:
        msg = MIMEText(body)
        msg["to"] = to_addr
        msg["from"] = config.GOOGLE_IMPERSONATE_EMAIL
        msg["subject"] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        _service().users().messages().send(userId="me", body={"raw": raw}).execute()
        return True
    except HttpError as e:
        log.error("Gmail send failed: %s", e)
        return False


def _get_or_create_processed_label() -> str:
    global _label_id_cache
    if _label_id_cache:
        return _label_id_cache

    svc = _service()
    resp = svc.users().labels().list(userId="me").execute()
    for lbl in resp.get("labels", []):
        if lbl["name"] == config.GMAIL_PROCESSED_LABEL:
            _label_id_cache = lbl["id"]
            return _label_id_cache

    created = svc.users().labels().create(
        userId="me",
        body={
            "name": config.GMAIL_PROCESSED_LABEL,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show",
        },
    ).execute()
    _label_id_cache = created["id"]
    return _label_id_cache


def _extract_sender_email(from_header: str) -> str:
    match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", from_header or "")
    return match.group(0) if match else (from_header or "")


def _extract_body_text(payload: dict) -> str:
    def walk(part):
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            data = part["body"]["data"]
            return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode(errors="ignore")
        for sub in part.get("parts", []) or []:
            found = walk(sub)
            if found:
                return found
        return ""

    text = walk(payload)
    if text:
        return text
    # Fall back to whatever body data exists directly on the top-level payload.
    data = payload.get("body", {}).get("data")
    if data:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode(errors="ignore")
    return ""


def fetch_unread_emails() -> list[dict]:
    """Poll for unread mail not yet processed, mirroring the original filter.
    Each message returned is immediately labelled processed + marked read,
    so a crash mid-batch never causes a re-send on the next poll."""
    svc = _service()
    label_id = _get_or_create_processed_label()
    out = []

    try:
        resp = svc.users().messages().list(
            userId="me",
            q=f"is:unread -label:{config.GMAIL_PROCESSED_LABEL}",
            maxResults=25,
        ).execute()
    except HttpError as e:
        log.error("Gmail poll (list) failed: %s", e)
        return []

    for m in resp.get("messages", []):
        try:
            full = svc.users().messages().get(userId="me", id=m["id"], format="full").execute()
            headers = {h["name"]: h["value"] for h in full["payload"].get("headers", [])}
            from_header = headers.get("From", "")
            sender_email = _extract_sender_email(from_header)

            if sender_email.lower() == config.GOOGLE_IMPERSONATE_EMAIL.lower():
                # Internal mail sent from our own mailbox — skip, just mark processed.
                svc.users().messages().modify(
                    userId="me", id=m["id"],
                    body={"addLabelIds": [label_id], "removeLabelIds": ["UNREAD"]},
                ).execute()
                continue

            out.append(
                {
                    "sender_email": sender_email,
                    "subject": headers.get("Subject", ""),
                    "body_text": _extract_body_text(full["payload"]).strip(),
                    "thread_id": full.get("threadId", m["id"]),
                }
            )
            svc.users().messages().modify(
                userId="me", id=m["id"],
                body={"addLabelIds": [label_id], "removeLabelIds": ["UNREAD"]},
            ).execute()
        except HttpError as e:
            log.error("Gmail poll: failed to fetch/process message %s: %s", m.get("id"), e)

    return out
