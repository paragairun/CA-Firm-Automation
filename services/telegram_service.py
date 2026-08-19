"""
Telegram Bot API — used to ping the partner for hot leads, overdue compliance,
overdue invoices, stuck document follow-ups, and workflow-level errors.
"""
import logging

import requests

import config

log = logging.getLogger("telegram")


def notify_partner(text: str) -> bool:
    if not config.TELEGRAM_BOT_TOKEN or not config.TELEGRAM_PARTNER_CHAT_ID:
        log.error("Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_PARTNER_CHAT_ID missing)")
        return False

    url = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": config.TELEGRAM_PARTNER_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown",
    }
    try:
        resp = requests.post(url, json=payload, timeout=15)
        if resp.status_code >= 400:
            log.error("Telegram send failed (%s): %s", resp.status_code, resp.text[:500])
            return False
        return True
    except requests.RequestException as e:
        log.error("Telegram send exception: %s", e)
        return False
