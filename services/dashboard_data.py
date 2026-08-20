"""
Builds the real data payload for the staff dashboard (/dashboard page,
/api/dashboard-data endpoint). Every field here is computed from the
actual Sheets tables — nothing hardcoded, nothing invented. Fields the
underlying data doesn't actually track (e.g. a lead's deal value, an
in-progress "AI qualification %") are deliberately left out rather than
faked — see README "Dashboard" section.
"""
from datetime import date, datetime

from services.sheets_db import CLIENTS, COMPLIANCE_CALENDAR, LEADS, INVOICES, DOCUMENTS_TRACKER, QUERY_LOG


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return value


def _parse_datetime_date(value):
    if not value:
        return None
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value[:19]).date()
        except ValueError:
            return _parse_date(value)
    return value


def build_dashboard_payload() -> dict:
    today = date.today()

    clients = CLIENTS.all_rows()
    compliance = COMPLIANCE_CALENDAR.all_rows()
    leads = LEADS.all_rows()
    invoices = INVOICES.all_rows()
    documents = DOCUMENTS_TRACKER.all_rows()
    query_log = QUERY_LOG.all_rows()

    # ── Compliance ──
    open_compliance = [r for r in compliance if r.get("status") != "Filed"]
    urgent_compliance = []
    for r in open_compliance:
        d = _parse_date(r.get("due_date"))
        if d and 0 <= (d - today).days <= 7:
            urgent_compliance.append(r)

    def compliance_sort_key(r):
        d = _parse_date(r.get("due_date"))
        return d or date.max

    compliance_sorted = sorted(open_compliance, key=compliance_sort_key)

    # ── Invoices ──
    paid_invoices = [r for r in invoices if r.get("status") == "Paid"]
    unpaid_invoices = [r for r in invoices if r.get("status") != "Paid"]
    overdue_invoices = [r for r in unpaid_invoices if r.get("status") == "Overdue"]
    fees_collected_total = sum(float(r.get("amount") or 0) for r in paid_invoices)
    pending_fees_total = sum(float(r.get("amount") or 0) for r in unpaid_invoices)

    # ── Leads ──
    open_leads = [r for r in leads if r.get("status") not in ("Converted", "Lost", "Cold-Closed")]
    hot_leads = [r for r in open_leads if r.get("qualification_score") == "Hot"]
    leads_by_status: dict[str, list] = {}
    for r in leads:
        leads_by_status.setdefault(r.get("status") or "New", []).append(r)

    # ── Documents ──
    pending_documents = [r for r in documents if r.get("status") == "Pending"]

    # ── Query log (support activity) ──
    queries_today = 0
    for r in query_log:
        d = _parse_datetime_date(r.get("timestamp"))
        if d == today:
            queries_today += 1

    return {
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "total_clients": len(clients),
            "pending_deadlines": len(open_compliance),
            "urgent_deadlines_7d": len(urgent_compliance),
            "fees_collected_total": round(fees_collected_total, 2),
            "pending_fees_total": round(pending_fees_total, 2),
            "overdue_invoices_count": len(overdue_invoices),
            "open_leads": len(open_leads),
            "hot_leads": len(hot_leads),
            "pending_documents": len(pending_documents),
            "queries_handled_today": queries_today,
        },
        "compliance": compliance_sorted,
        "leads": leads,
        "leads_by_status": leads_by_status,
        "invoices": sorted(invoices, key=lambda r: _parse_date(r.get("due_date")) or date.max),
        "documents": documents,
        "clients": clients,
    }
