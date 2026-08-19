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
