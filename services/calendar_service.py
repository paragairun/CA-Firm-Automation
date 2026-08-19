"""
Google Calendar — mirrors each non-Filed Compliance_Calendar row as a
real all-day calendar event with a native reminder, so the partner sees
every GST/ITR/TDS/ROC deadline on their actual calendar instead of only
inside the Sheet. Idempotent: creates once, then patches in place using
the event id saved back onto the sheet row (calendar_event_id column).
"""
import logging
import threading
from datetime import date, timedelta

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

import config
from services.google_auth import get_credentials, SCOPE_CALENDAR

log = logging.getLogger("calendar_service")

_svc_lock = threading.Lock()
_svc = None


def _service():
    global _svc
    if _svc is None:
        with _svc_lock:
            if _svc is None:
                creds = get_credentials([SCOPE_CALENDAR])
                _svc = build("calendar", "v3", credentials=creds, cache_discovery=False)
    return _svc


def _event_body(row: dict) -> dict:
    due = row["due_date"]
    due_str = due if isinstance(due, str) else due.isoformat()
    next_day = (date.fromisoformat(due_str[:10]) + timedelta(days=1)).isoformat()
    return {
        "summary": f"{row['compliance_type']} due — {row['client_name']}",
        "description": (
            f"Client: {row['client_name']}\nCompliance type: {row['compliance_type']}\n"
            f"Status: {row['status']}\nSynced automatically from Compliance_Calendar."
        ),
        "start": {"date": due_str[:10]},
        "end": {"date": next_day},
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "popup", "minutes": 24 * 60},  # 1 day before
                {"method": "popup", "minutes": 0},  # on the day
            ],
        },
    }


def sync_compliance_event(row: dict) -> str:
    """Creates the event if row has no calendar_event_id yet, otherwise
    patches the existing event so edits made directly in the Sheet (e.g. a
    corrected due_date) stay reflected. Returns the event id (empty string
    on failure — callers should treat that as non-fatal)."""
    svc = _service()
    existing_id = row.get("calendar_event_id") or ""

    try:
        if existing_id:
            svc.events().patch(
                calendarId=config.GOOGLE_CALENDAR_ID, eventId=existing_id, body=_event_body(row)
            ).execute()
            return existing_id
        created = svc.events().insert(
            calendarId=config.GOOGLE_CALENDAR_ID, body=_event_body(row)
        ).execute()
        return created["id"]
    except HttpError as e:
        log.error("Calendar sync failed for compliance_id %s: %s", row.get("compliance_id"), e)
        return existing_id
