"""
Google Sheets as the data store, replacing Postgres. Each "table" is one
tab in a single Google Sheet (GOOGLE_SPREADSHEET_ID). Row 1 of every tab
must contain exactly the header names listed below, in any order the
sheet already has them in is fine — SHEETS_TABLE reads the actual header
row and maps by name, so it's safe for a human to reorder columns, but NOT
safe to rename them (run setup_sheets.py once to create tabs with the
correct headers).

This gives the partner a live, editable admin UI for free (any change made
directly in the Sheet is picked up on the next read) — the trade-off is
weaker concurrency guarantees than a real database: two simultaneous writes
to the same row can race. For a single small CA firm's traffic this is a
non-issue in practice; see README for the caveat and a couple of Sheets-scale
things worth watching (Conversation_Memory grows unbounded — periodic
archiving recommended).
"""
import logging
import threading

from googleapiclient.discovery import build

import config
from services.google_auth import get_credentials, SCOPE_SHEETS

log = logging.getLogger("sheets_db")

_svc_lock = threading.Lock()
_svc = None


def _service():
    global _svc
    if _svc is None:
        with _svc_lock:
            if _svc is None:
                creds = get_credentials([SCOPE_SHEETS])
                _svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return _svc


def _col_letter(idx0: int) -> str:
    """0-based column index -> spreadsheet column letters (0 -> A, 25 -> Z, 26 -> AA)."""
    idx = idx0 + 1
    letters = ""
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


class SheetsTable:
    def __init__(self, sheet_name: str, headers: list[str], int_cols: list[str] = None,
                 float_cols: list[str] = None):
        self.sheet_name = sheet_name
        self.headers = headers
        self.int_cols = int_cols or []
        self.float_cols = float_cols or []
        self._last_col = _col_letter(len(headers) - 1)

    def _cast(self, d: dict) -> dict:
        for c in self.int_cols:
            try:
                d[c] = int(float(d.get(c) or 0))
            except (ValueError, TypeError):
                d[c] = 0
        for c in self.float_cols:
            try:
                d[c] = float(d.get(c) or 0)
            except (ValueError, TypeError):
                d[c] = 0.0
        return d

    def _data_range(self) -> str:
        return f"{self.sheet_name}!A2:{self._last_col}1000000"

    def _row_range(self, row_number: int) -> str:
        return f"{self.sheet_name}!A{row_number}:{self._last_col}{row_number}"

    def all_rows_with_index(self) -> list[tuple[int, dict]]:
        """Returns [(sheet_row_number, row_dict), ...]. Row 2 is the first data row."""
        resp = (
            _service()
            .spreadsheets()
            .values()
            .get(
                spreadsheetId=config.GOOGLE_SPREADSHEET_ID,
                range=self._data_range(),
                valueRenderOption="UNFORMATTED_VALUE",
            )
            .execute()
        )
        rows = resp.get("values", [])
        out = []
        for i, raw in enumerate(rows):
            padded = raw + [""] * (len(self.headers) - len(raw))
            d = {h: padded[j] for j, h in enumerate(self.headers)}
            out.append((i + 2, self._cast(d)))
        return out

    def all_rows(self) -> list[dict]:
        return [d for _, d in self.all_rows_with_index()]

    def find(self, match_col: str, match_val) -> tuple[int, dict] | tuple[None, None]:
        target = str(match_val)
        for row_number, d in self.all_rows_with_index():
            if str(d.get(match_col, "")) == target:
                return row_number, d
        return None, None

    def find_one(self, match_col: str, match_val) -> dict | None:
        _, d = self.find(match_col, match_val)
        return d

    def append(self, row: dict) -> None:
        full = [row.get(h, "") for h in self.headers]
        _service().spreadsheets().values().append(
            spreadsheetId=config.GOOGLE_SPREADSHEET_ID,
            range=f"{self.sheet_name}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [full]},
        ).execute()

    def update_row(self, row_number: int, row: dict) -> None:
        full = [row.get(h, "") for h in self.headers]
        _service().spreadsheets().values().update(
            spreadsheetId=config.GOOGLE_SPREADSHEET_ID,
            range=self._row_range(row_number),
            valueInputOption="RAW",
            body={"values": [full]},
        ).execute()

    def upsert_by(self, match_col: str, row: dict) -> None:
        """Insert a new row, or merge `row`'s fields into the existing row
        matched on match_col (mirrors the original workflow's
        'appendOrUpdate' Google Sheets operation)."""
        row_number, existing = self.find(match_col, row.get(match_col))
        if existing:
            merged = {**existing, **row}
            self.update_row(row_number, merged)
        else:
            self.append({h: row.get(h, "") for h in self.headers})

    def update_by(self, match_col: str, match_val, updates: dict) -> bool:
        """Partial update of the row matched on match_col/match_val."""
        row_number, existing = self.find(match_col, match_val)
        if not existing:
            return False
        merged = {**existing, **updates}
        self.update_row(row_number, merged)
        return True


# ── Table definitions (1:1 with the original workflow's Google Sheets tabs,
#    plus a few new columns for the added Drive/Calendar integrations) ────

CLIENTS = SheetsTable(
    "Clients",
    ["client_id", "name", "phone", "email", "business_type", "created_at"],
)

DOCUMENTS_TRACKER = SheetsTable(
    "Documents_Tracker",
    [
        "doc_id", "client_id", "client_name", "phone", "email", "compliance_type",
        "document_name", "requested_date", "status", "followup_count",
        "last_followup_date", "received_date", "drive_file_link",
    ],
    int_cols=["followup_count"],
)

COMPLIANCE_CALENDAR = SheetsTable(
    "Compliance_Calendar",
    [
        "compliance_id", "client_id", "client_name", "phone", "email", "compliance_type",
        "due_date", "status", "reminder_count", "last_reminder_date", "calendar_event_id",
    ],
    int_cols=["reminder_count"],
)

LEADS = SheetsTable(
    "Leads",
    [
        "lead_id", "name", "phone", "email", "source", "requirement", "business_type",
        "urgency", "qualification_score", "status", "followup_date", "followup_attempts",
        "created_at", "notes", "message_text",
    ],
    int_cols=["followup_attempts"],
)

INVOICES = SheetsTable(
    "Invoices",
    [
        "invoice_id", "client_id", "client_name", "phone", "email", "amount", "currency",
        "due_date", "status", "reminder_count", "last_reminder_date", "escalated",
    ],
    int_cols=["reminder_count"],
    float_cols=["amount"],
)

QUERY_LOG = SheetsTable(
    "Query_Log",
    ["log_id", "client_id", "phone", "email", "channel", "query_text", "ai_response", "timestamp"],
)

ERROR_LOG = SheetsTable(
    "Error_Log",
    ["error_id", "workflow_name", "node_name", "error_message", "timestamp"],
)

# Replaces the original LangChain memoryBufferWindow nodes. Grows without
# bound — see the module docstring; archive old rows periodically.
CONVERSATION_MEMORY = SheetsTable(
    "Conversation_Memory",
    ["id", "session_key", "role", "content", "created_at"],
)

ALL_TABLES = [
    CLIENTS, DOCUMENTS_TRACKER, COMPLIANCE_CALENDAR, LEADS, INVOICES,
    QUERY_LOG, ERROR_LOG, CONVERSATION_MEMORY,
]
