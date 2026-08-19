"""
One-time setup: creates every required tab (with the correct header row)
in the target Google Sheet, if it doesn't already exist. Safe to re-run —
skips tabs that already exist and never touches existing data.

Usage:
    python3 setup_sheets.py

Requires GOOGLE_SERVICE_ACCOUNT_FILE, GOOGLE_IMPERSONATE_EMAIL, and
GOOGLE_SPREADSHEET_ID to already be set in .env, and the spreadsheet must
already exist (create a blank Google Sheet, share it isn't even necessary
since we're impersonating the owner — just grab its ID from the URL) with
GOOGLE_IMPERSONATE_EMAIL as owner or editor.
"""
import logging

from googleapiclient.discovery import build

import config
from services.google_auth import get_credentials, SCOPE_SHEETS
from services.sheets_db import ALL_TABLES

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("setup_sheets")


def main():
    creds = get_credentials([SCOPE_SHEETS])
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)

    meta = svc.spreadsheets().get(spreadsheetId=config.GOOGLE_SPREADSHEET_ID).execute()
    existing_titles = {s["properties"]["title"] for s in meta.get("sheets", [])}

    requests = []
    for table in ALL_TABLES:
        if table.sheet_name in existing_titles:
            log.info("Tab already exists, skipping: %s", table.sheet_name)
            continue
        requests.append({"addSheet": {"properties": {"title": table.sheet_name}}})

    if requests:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=config.GOOGLE_SPREADSHEET_ID, body={"requests": requests}
        ).execute()
        log.info("Created %d new tab(s).", len(requests))

    # Write header rows (safe even for pre-existing tabs with no data yet —
    # only touches row 1, and only for tabs we just created or that are
    # still empty).
    for table in ALL_TABLES:
        current = svc.spreadsheets().values().get(
            spreadsheetId=config.GOOGLE_SPREADSHEET_ID, range=f"{table.sheet_name}!A1:A1"
        ).execute()
        if current.get("values"):
            log.info("Header already present, leaving as-is: %s", table.sheet_name)
            continue
        svc.spreadsheets().values().update(
            spreadsheetId=config.GOOGLE_SPREADSHEET_ID,
            range=f"{table.sheet_name}!A1",
            valueInputOption="RAW",
            body={"values": [table.headers]},
        ).execute()
        log.info("Wrote header row: %s -> %s", table.sheet_name, table.headers)

    # Default "Sheet1" is left alone if present — delete it manually if unwanted.
    log.info("Done. Populate the Clients tab to get started.")


if __name__ == "__main__":
    main()
