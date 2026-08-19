"""
Google Drive — stores documents clients send in on WhatsApp. The original
n8n workflow never actually downloaded/stored WhatsApp media, it only
flipped a status flag; with Workspace storage available this fills that
gap in for real: one root folder, one subfolder per client, files uploaded
with a readable name, link saved back onto the Documents_Tracker row.
"""
import io
import logging
import threading

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseUpload

import config
from services.google_auth import get_credentials, SCOPE_DRIVE

log = logging.getLogger("drive_service")

_svc_lock = threading.Lock()
_svc = None
_root_folder_id_cache = None
_client_folder_cache: dict[str, str] = {}

ROOT_FOLDER_NAME = "CA Firm Documents"


def _service():
    global _svc
    if _svc is None:
        with _svc_lock:
            if _svc is None:
                creds = get_credentials([SCOPE_DRIVE])
                _svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    return _svc


def _find_or_create_folder(name: str, parent_id: str | None) -> str:
    svc = _service()
    query = f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    if parent_id:
        query += f" and '{parent_id}' in parents"
    resp = svc.files().list(q=query, fields="files(id, name)", spaces="drive").execute()
    files = resp.get("files", [])
    if files:
        return files[0]["id"]

    body = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        body["parents"] = [parent_id]
    created = svc.files().create(body=body, fields="id").execute()
    return created["id"]


def _root_folder_id() -> str:
    global _root_folder_id_cache
    if config.GOOGLE_DRIVE_ROOT_FOLDER_ID:
        return config.GOOGLE_DRIVE_ROOT_FOLDER_ID
    if _root_folder_id_cache is None:
        _root_folder_id_cache = _find_or_create_folder(ROOT_FOLDER_NAME, None)
    return _root_folder_id_cache


def _client_folder_id(client_id: str, client_name: str) -> str:
    if client_id in _client_folder_cache:
        return _client_folder_cache[client_id]
    folder_name = f"{client_name} ({client_id})" if client_id else client_name
    folder_id = _find_or_create_folder(folder_name, _root_folder_id())
    _client_folder_cache[client_id] = folder_id
    return folder_id


def upload_client_document(client_id: str, client_name: str, filename: str, content: bytes, mime_type: str) -> str:
    """Uploads a file into the client's Drive subfolder, returns its webViewLink
    (empty string on failure — callers should treat that as non-fatal)."""
    try:
        folder_id = _client_folder_id(client_id, client_name)
        media = MediaIoBaseUpload(io.BytesIO(content), mimetype=mime_type, resumable=False)
        created = _service().files().create(
            body={"name": filename, "parents": [folder_id]},
            media_body=media,
            fields="id, webViewLink",
        ).execute()
        return created.get("webViewLink", "")
    except HttpError as e:
        log.error("Drive upload failed for client %s: %s", client_id, e)
        return ""
