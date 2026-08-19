"""
Gmail send (SMTP) + poll unread inbox (IMAP), using a Gmail App Password
(Google Account -> Security -> 2-Step Verification -> App passwords).
This replaces the original n8n Gmail OAuth2 node + Gmail Trigger (every-minute poll).
"""
import email as email_lib
import imaplib
import logging
import re
import smtplib
from email.mime.text import MIMEText

import config
from db import fetch_one, execute

log = logging.getLogger("email_service")


def send_email(to_addr: str, subject: str, body: str) -> bool:
    if not to_addr or not body:
        log.warning("send_email called with empty to_addr or body, skipping")
        return False
    if not config.GMAIL_ADDRESS or not config.GMAIL_APP_PASSWORD:
        log.error("Gmail not configured (GMAIL_ADDRESS / GMAIL_APP_PASSWORD missing)")
        return False

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = config.GMAIL_ADDRESS
    msg["To"] = to_addr

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as smtp:
            smtp.login(config.GMAIL_ADDRESS, config.GMAIL_APP_PASSWORD)
            smtp.sendmail(config.GMAIL_ADDRESS, [to_addr], msg.as_string())
        return True
    except Exception as e:
        log.error("Email send failed: %s", e)
        return False


def _extract_sender_email(from_header: str) -> str:
    match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", from_header or "")
    return match.group(0) if match else (from_header or "")


def _extract_body_text(msg) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get("Content-Disposition"):
                try:
                    return part.get_payload(decode=True).decode(errors="ignore")
                except Exception:
                    continue
        return ""
    try:
        return msg.get_payload(decode=True).decode(errors="ignore")
    except Exception:
        return ""


def fetch_unread_emails() -> list[dict]:
    """
    Poll the inbox for unread mail (mirrors original Gmail Trigger
    filter "is:unread -label:ca-firm-automation-processed"). Each returned
    message is marked \\Seen so it is never re-processed. Skips messages
    sent from our own address (internal team mail).
    """
    if not config.GMAIL_ADDRESS or not config.GMAIL_APP_PASSWORD:
        log.error("Gmail not configured, skipping poll")
        return []

    out = []
    try:
        imap = imaplib.IMAP4_SSL("imap.gmail.com")
        imap.login(config.GMAIL_ADDRESS, config.GMAIL_APP_PASSWORD)
        imap.select("INBOX")

        status, data = imap.search(None, "UNSEEN")
        if status != "OK":
            imap.logout()
            return []

        ids = data[0].split()
        for msg_id in ids:
            status, msg_data = imap.fetch(msg_id, "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            msg = email_lib.message_from_bytes(raw)

            from_header = msg.get("From", "")
            sender_email = _extract_sender_email(from_header)
            if sender_email.lower() == config.GMAIL_ADDRESS.lower():
                # Skip mail we sent ourselves so we never reply to our own replies.
                imap.store(msg_id, "+FLAGS", "\\Seen")
                continue

            subject = msg.get("Subject", "")
            body_text = _extract_body_text(msg)
            thread_id = msg.get("Message-ID", msg_id.decode())

            out.append(
                {
                    "sender_email": sender_email,
                    "subject": subject,
                    "body_text": body_text.strip(),
                    "thread_id": thread_id,
                }
            )
            # Mark as read immediately so a crash mid-batch doesn't reprocess
            # already-handed-off messages on the next poll.
            imap.store(msg_id, "+FLAGS", "\\Seen")

        imap.logout()
    except Exception as e:
        log.error("Gmail poll failed: %s", e)

    return out
