"""
Central error handling — every branch in the original n8n workflow routed
its failure output into a shared 'Build Error Log Entry' -> 'Log Error to
Sheet' -> 'Notify Partner - Workflow Error' chain. This module reproduces
that behaviour as a decorator + helper so every branch/route gets it for free.
"""
import functools
import logging
import time
import traceback

from db import execute
from services.telegram_service import notify_partner

log = logging.getLogger("errors")


def log_error(node_name: str, error_message: str, workflow_name: str = "CA Firm Automation") -> None:
    error_id = f"ERR-{int(time.time() * 1000)}"
    try:
        execute(
            "INSERT INTO error_log (error_id, workflow_name, node_name, error_message, timestamp) "
            "VALUES (%s, %s, %s, %s, now())",
            (error_id, workflow_name, node_name, str(error_message)[:900]),
        )
    except Exception:
        log.error("Failed to write to error_log table (DB may be down): %s", error_message)

    notify_partner(
        f"⚠️ *CA Firm Automation Error*\n"
        f"Workflow: {workflow_name}\n"
        f"Node: {node_name}\n"
        f"Error: {str(error_message)[:900]}\n"
        f"Time: {time.strftime('%Y-%m-%d %H:%M:%S')}"
    )


def catch_and_log(node_name: str):
    """Decorator: run the wrapped function, and on any exception, log it
    to error_log + notify the partner on Telegram, then swallow it (so one
    branch's failure never takes down the webhook response or the scheduler)."""

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                log.exception("Error in %s", node_name)
                log_error(node_name, f"{e}\n{traceback.format_exc()[-600:]}")
                return None

        return wrapper

    return decorator
