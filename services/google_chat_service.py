"""
Google Chat incoming webhook — replaces Telegram for partner alerts.
Set up: Google Chat -> the alerts Space -> Apps & integrations -> Manage
webhooks -> copy the URL into GOOGLE_CHAT_WEBHOOK_URL. No OAuth needed;
the webhook URL itself is the secret. Google Chat uses the same
single-asterisk *bold* markdown as the original Telegram messages, so
message text needs no reformatting.
"""
import logging

import requests

import config

log = logging.getLogger("google_chat")


def notify_partner(text: str) -> bool:
    if not config.GOOGLE_CHAT_WEBHOOK_URL:
        log.error("Google Chat webhook not configured (GOOGLE_CHAT_WEBHOOK_URL missing)")
        return False
    try:
        resp = requests.post(config.GOOGLE_CHAT_WEBHOOK_URL, json={"text": text}, timeout=15)
        if resp.status_code >= 400:
            log.error("Google Chat send failed (%s): %s", resp.status_code, resp.text[:500])
            return False
        return True
    except requests.RequestException as e:
        log.error("Google Chat send exception: %s", e)
        return False
