"""
setup_sheets.py — v2 (logic extracted into run_setup() so it's callable
both from the command line and from app.py's /internal/setup-sheets route,
for cases where running this locally isn't convenient)

One-time setup: creates every required tab (with the correct header row)
in the target Google Sheet, if it doesn't already exist. Safe to re-run —
skips tabs that already exist and never touches existing data.

CLI usage:
    python3 setup_sheets.py

Remote usage (no local Python needed — runs on the already-deployed
service instead):
    curl -X POST https://your-app.onrender.com/internal/setup-sheets \
      -H "X-Dashboard-Key: YOUR_DASHBOARD_ACCESS_KEY"

Requires GOOGLE_SERVICE_ACCOUNT_FILE, GOOGLE_IMPERSONATE_EMAIL, and
GOOGLE_SPREADSHEET_ID to already be set, and the spreadsheet must already
exist (create a blank Google Sheet, share it isn't even necessary since
we're impersonating the owner — just grab its ID from the URL) with
GOOGLE_IMPERSONATE_EMAIL as owner or editor.
"""
import logging

from googleapiclient.discovery import build

import config
from services.google_auth import get_credentials, SCOPE_SHEETS
from services.sheets_db import ALL_TABLES

log = logging.getLogger("setup_sheets")


def run_setup() -> dict:
    """Creates missing tabs + header rows. Returns a summary dict (used by
    both the CLI printout and the /internal/setup-sheets JSON response)."""
    creds = get_credentials([SCOPE_SHEETS])
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)

    meta = svc.spreadsheets().get(spreadsheetId=config.GOOGLE_SPREADSHEET_ID).execute()
    existing_titles = {s["properties"]["title"] for s in meta.get("sheets", [])}

    created_tabs = []
    requests = []
    for table in ALL_TABLES:
        if table.sheet_name in existing_titles:
            continue
        requests.append({"addSheet": {"properties": {"title": table.sheet_name}}})
        created_tabs.append(table.sheet_name)

    if requests:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=config.GOOGLE_SPREADSHEET_ID, body={"requests": requests}
        ).execute()

    headers_written = []
    for table in ALL_TABLES:
        current = svc.spreadsheets().values().get(
            spreadsheetId=config.GOOGLE_SPREADSHEET_ID, range=f"{table.sheet_name}!A1:A1"
        ).execute()
        if current.get("values"):
            continue
        svc.spreadsheets().values().update(
            spreadsheetId=config.GOOGLE_SPREADSHEET_ID,
            range=f"{table.sheet_name}!A1",
            valueInputOption="RAW",
            body={"values": [table.headers]},
        ).execute()
        headers_written.append(table.sheet_name)

    return {
        "tabs_created": created_tabs,
        "headers_written": headers_written,
        "already_complete": [t.sheet_name for t in ALL_TABLES if t.sheet_name not in created_tabs and t.sheet_name not in headers_written],
    }


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    result = run_setup()
    for name in result["tabs_created"]:
        log.info("Created tab: %s", name)
    for name in result["headers_written"]:
        log.info("Wrote header row: %s", name)
    for name in result["already_complete"]:
        log.info("Already complete, left as-is: %s", name)
    log.info("Done. Populate the Clients tab to get started.")


if __name__ == "__main__":
    main()
