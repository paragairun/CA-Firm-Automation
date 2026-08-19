"""
Thin Postgres helper layer. Uses psycopg2 with a small connection pool,
returns rows as dicts (RealDictCursor) so branch code can treat them like
the original workflow's Google Sheets row objects.
"""
import logging
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2.pool import SimpleConnectionPool

import config

log = logging.getLogger("db")

_pool = SimpleConnectionPool(minconn=1, maxconn=10, dsn=config.DATABASE_URL)


@contextmanager
def get_cursor(commit: bool = False):
    conn = _pool.getconn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield cur
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        _pool.putconn(conn)


def fetch_all(sql: str, params: tuple = ()) -> list[dict]:
    with get_cursor() as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def fetch_one(sql: str, params: tuple = ()) -> dict | None:
    with get_cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else None


def execute(sql: str, params: tuple = ()) -> None:
    with get_cursor(commit=True) as cur:
        cur.execute(sql, params)


def upsert(table: str, pk_col: str, row: dict) -> None:
    """
    Generic INSERT ... ON CONFLICT (pk) DO UPDATE, mirroring the original
    workflow's "appendOrUpdate" Google Sheets operation (match by one column).
    Only columns present in `row` are inserted/updated.
    """
    cols = list(row.keys())
    values = [row[c] for c in cols]
    col_list = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    update_cols = [c for c in cols if c != pk_col]
    if update_cols:
        update_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
        sql = (
            f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT ({pk_col}) DO UPDATE SET {update_clause}"
        )
    else:
        sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) ON CONFLICT ({pk_col}) DO NOTHING"
    execute(sql, tuple(values))


def upsert_by(table: str, match_col: str, row: dict) -> None:
    """
    Upsert matching on a column that is NOT the primary key (e.g. original
    sheets matched Leads/Invoices rows by 'phone'/'invoice_id' etc. which may
    not always be the declared PK). Falls back to update-if-exists-else-insert.
    """
    existing = fetch_one(f"SELECT 1 FROM {table} WHERE {match_col} = %s", (row.get(match_col),))
    cols = list(row.keys())
    if existing:
        set_clause = ", ".join(f"{c} = %s" for c in cols if c != match_col)
        values = [row[c] for c in cols if c != match_col] + [row[match_col]]
        execute(f"UPDATE {table} SET {set_clause} WHERE {match_col} = %s", tuple(values))
    else:
        col_list = ", ".join(cols)
        placeholders = ", ".join(["%s"] * len(cols))
        execute(f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})", tuple(row[c] for c in cols))
