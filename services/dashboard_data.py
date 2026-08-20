"""
Builds the real data payload for the staff dashboard (/dashboard page,
/api/dashboard-data endpoint). Every field here is computed from the
actual Sheets tables — nothing hardcoded, nothing invented. Fields the
underlying data doesn't actually track (e.g. a lead's deal value, an
in-progress "AI qualification %") are deliberately left out rather than
faked — see README "Dashboard" section.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta

import config
from services.sheets_db import (
    CLIENTS, COMPLIANCE_CALENDAR, LEADS, INVOICES, DOCUMENTS_TRACKER,
    QUERY_LOG, CONVERSATION_MEMORY, TASKS,
)


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return value


def _parse_datetime(value):
    if not value:
        return None
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value[:19])
        except ValueError:
            return None
    return value


def _month_label(d: date) -> str:
    return d.strftime("%b %Y")


def _build_reports(invoices: list, compliance: list, leads: list) -> dict:
    """Real computed analytics — no invented figures. Every number here
    traces back to actual rows in Invoices / Compliance_Calendar / Leads."""
    today = date.today()

    # Revenue by month — last 6 months, from Paid invoices, bucketed by due_date's month.
    months = []
    cursor = date(today.year, today.month, 1)
    for _ in range(6):
        months.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    months.reverse()

    revenue_by_month = {_month_label(m): 0.0 for m in months}
    for r in invoices:
        if r.get("status") != "Paid":
            continue
        d = _parse_date(r.get("due_date"))
        if not d:
            continue
        label = _month_label(date(d.year, d.month, 1))
        if label in revenue_by_month:
            revenue_by_month[label] += float(r.get("amount") or 0)
    revenue_by_month = {k: round(v, 2) for k, v in revenue_by_month.items()}

    # Compliance completion rate — Filed vs total, over all rows on record.
    total_compliance = len(compliance)
    filed_compliance = len([r for r in compliance if r.get("status") == "Filed"])
    completion_rate = round(100 * filed_compliance / total_compliance, 1) if total_compliance else None

    # Lead funnel — count by status, in a fixed sensible order.
    funnel_order = ["New", "Qualifying", "Converted", "Lost", "Cold-Closed"]
    funnel_counts = {s: 0 for s in funnel_order}
    for r in leads:
        status = r.get("status") or "New"
        funnel_counts[status] = funnel_counts.get(status, 0) + 1

    converted = funnel_counts.get("Converted", 0)
    total_leads = len(leads)
    conversion_rate = round(100 * converted / total_leads, 1) if total_leads else None

    return {
        "revenue_by_month": revenue_by_month,
        "compliance_completion_rate": completion_rate,
        "compliance_filed_count": filed_compliance,
        "compliance_total_count": total_compliance,
        "lead_funnel": funnel_counts,
        "lead_conversion_rate": conversion_rate,
    }


def _build_conversations(limit: int = 25) -> list:
    """Groups Conversation_Memory (real WhatsApp/email transcripts) by
    session, most recent first. Returns a summary per session, not the
    full transcript (kept light — /api/conversations/<key> could return
    the full thread later if needed)."""
    rows = CONVERSATION_MEMORY.all_rows()
    sessions: dict[str, list] = defaultdict(list)
    for r in rows:
        sessions[r["session_key"]].append(r)

    summaries = []
    for session_key, turns in sessions.items():
        turns.sort(key=lambda r: r.get("created_at") or "")
        last = turns[-1] if turns else None
        channel = "WhatsApp" if session_key.startswith("wa-") else "Email" if session_key.startswith("email-") else "Other"
        kind = "Support" if "support" in session_key else "Lead Qualification" if "lead" in session_key else "—"
        summaries.append(
            {
                "session_key": session_key,
                "channel": channel,
                "kind": kind,
                "message_count": len(turns),
                "last_message": (last or {}).get("content", ""),
                "last_role": (last or {}).get("role", ""),
                "last_at": (last or {}).get("created_at", ""),
            }
        )

    summaries.sort(key=lambda s: s["last_at"] or "", reverse=True)
    return summaries[:limit]


def build_dashboard_payload() -> dict:
    today = date.today()

    clients = CLIENTS.all_rows()
    compliance = COMPLIANCE_CALENDAR.all_rows()
    leads = LEADS.all_rows()
    invoices = INVOICES.all_rows()
    documents = DOCUMENTS_TRACKER.all_rows()
    query_log = QUERY_LOG.all_rows()
    tasks = TASKS.all_rows()

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
    leads_by_status: dict[str, list] = defaultdict(list)
    for r in leads:
        leads_by_status[r.get("status") or "New"].append(r)

    # ── Documents ──
    pending_documents = [r for r in documents if r.get("status") == "Pending"]

    # ── Tasks ──
    open_tasks = [r for r in tasks if r.get("status") != "Done"]

    # ── Query log (support activity) ──
    queries_today = 0
    for r in query_log:
        dt = _parse_datetime(r.get("timestamp"))
        if dt and dt.date() == today:
            queries_today += 1

    return {
        "generated_at": datetime.now().isoformat(),
        "config": {
            "firm_name": config.FIRM_NAME,
            "ai_model": config.GEMINI_MODEL,
        },
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
            "open_tasks": len(open_tasks),
        },
        "compliance": compliance_sorted,
        "leads": leads,
        "leads_by_status": dict(leads_by_status),
        "invoices": sorted(invoices, key=lambda r: _parse_date(r.get("due_date")) or date.max),
        "documents": documents,
        "clients": clients,
        "tasks": tasks,
        "conversations": _build_conversations(),
        "reports": _build_reports(invoices, compliance, leads),
    }
