"""
Shared Google Workspace credentials builder. One service account key,
delegated domain-wide, impersonating a real Workspace mailbox — used by
Sheets, Gmail, Drive, and Calendar service modules alike.

Setup (Workspace admin, one-time):
  1. GCP project -> APIs & Services -> enable: Google Sheets API, Gmail API,
     Google Drive API, Google Calendar API.
  2. IAM -> Service Accounts -> create one, download its JSON key ->
     GOOGLE_SERVICE_ACCOUNT_FILE.
  3. Note the service account's numeric "Client ID" (Service Account
     details -> Advanced settings, or the "client_id" field in the key JSON).
  4. admin.google.com -> Security -> API controls -> Domain-wide delegation
     -> Add new -> paste the Client ID -> OAuth scopes:
       https://www.googleapis.com/auth/spreadsheets,
       https://www.googleapis.com/auth/gmail.modify,
       https://www.googleapis.com/auth/gmail.send,
       https://www.googleapis.com/auth/drive,
       https://www.googleapis.com/auth/calendar
  5. GOOGLE_IMPERSONATE_EMAIL = the real Workspace mailbox this service
     should act as (e.g. team@yourfirm.com) — that mailbox is what sends/
     receives the emails, owns the Drive files, and owns the calendar.
"""
from google.oauth2 import service_account

import config

SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets"
SCOPE_GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify"
SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send"
SCOPE_DRIVE = "https://www.googleapis.com/auth/drive"
SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar"

_cache: dict[tuple, service_account.Credentials] = {}


def get_credentials(scopes: list[str]):
    key = tuple(sorted(scopes))
    if key not in _cache:
        creds = service_account.Credentials.from_service_account_file(
            config.GOOGLE_SERVICE_ACCOUNT_FILE, scopes=list(scopes)
        )
        creds = creds.with_subject(config.GOOGLE_IMPERSONATE_EMAIL)
        _cache[key] = creds
    return _cache[key]
