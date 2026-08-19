"""
WhatsApp Cloud API (Meta Graph API) — send text messages.
Direct port of the original httpRequest nodes:
POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
"""
import logging

import requests

import config

log = logging.getLogger("whatsapp")


def send_whatsapp_message(to_phone: str, body: str) -> bool:
    if not to_phone or not body:
        log.warning("send_whatsapp_message called with empty to_phone or body, skipping")
        return False
    if not config.WHATSAPP_PHONE_NUMBER_ID or not config.WHATSAPP_ACCESS_TOKEN:
        log.error("WhatsApp not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN missing)")
        return False

    url = (
        f"https://graph.facebook.com/{config.WHATSAPP_API_VERSION}/"
        f"{config.WHATSAPP_PHONE_NUMBER_ID}/messages"
    )
    payload = {
        "messaging_product": "whatsapp",
        "to": to_phone,
        "type": "text",
        "text": {"body": body},
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.WHATSAPP_ACCESS_TOKEN}",
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        if resp.status_code >= 400:
            log.error("WhatsApp send failed (%s): %s", resp.status_code, resp.text[:500])
            return False
        return True
    except requests.RequestException as e:
        log.error("WhatsApp send exception: %s", e)
        return False


def download_media(media_id: str) -> tuple[bytes, str] | tuple[None, None]:
    """Two-step Meta media download: resolve media_id -> temporary URL,
    then fetch the bytes. Returns (content_bytes, mime_type) or (None, None)
    on failure. Used to save documents clients send in on WhatsApp into
    Drive (see branches/whatsapp_incoming.py)."""
    if not media_id or not config.WHATSAPP_ACCESS_TOKEN:
        return None, None
    headers = {"Authorization": f"Bearer {config.WHATSAPP_ACCESS_TOKEN}"}
    try:
        meta_resp = requests.get(
            f"https://graph.facebook.com/{config.WHATSAPP_API_VERSION}/{media_id}",
            headers=headers,
            timeout=15,
        )
        if meta_resp.status_code >= 400:
            log.error("WhatsApp media metadata fetch failed (%s): %s", meta_resp.status_code, meta_resp.text[:300])
            return None, None
        meta = meta_resp.json()
        media_url = meta.get("url")
        mime_type = meta.get("mime_type", "application/octet-stream")
        if not media_url:
            return None, None

        content_resp = requests.get(media_url, headers=headers, timeout=30)
        if content_resp.status_code >= 400:
            log.error("WhatsApp media download failed (%s)", content_resp.status_code)
            return None, None
        return content_resp.content, mime_type
    except requests.RequestException as e:
        log.error("WhatsApp media download exception: %s", e)
        return None, None
