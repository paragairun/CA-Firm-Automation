"""
Gemini (Google GenAI SDK) LLM wrapper.

Two call shapes, matching the two node types used throughout the original
n8n workflow:

  draft(prompt)                  -> single-shot completion, no memory.
                                     (was: @n8n/n8n-nodes-langchain.chainLlm)

  agent_reply(session_key,
              system_message,
              user_message)      -> stateful chat: loads the last
                                     MEMORY_WINDOW turns for this session,
                                     calls the model, saves both the new
                                     user + assistant turns.
                                     (was: @n8n/n8n-nodes-langchain.agent +
                                      memoryBufferWindow)

Memory is stored with OpenAI-style roles ("user"/"assistant") in the
Conversation_Memory sheet, and translated to Gemini's "user"/"model" roles
only at call time — keeps the sheet contents provider-agnostic if the LLM
is ever swapped again.
"""
import json
import logging
import re
import time

from google import genai
from google.genai import types

import config
from services.sheets_db import CONVERSATION_MEMORY

log = logging.getLogger("llm")

_client = genai.Client(api_key=config.GEMINI_API_KEY)


def draft(prompt: str) -> str:
    """Single-shot, no conversation history. Used for AI-drafted messages
    (reminders, follow-ups, opening replies) and lead classification."""
    try:
        resp = _client.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=config.GEMINI_TEMPERATURE),
        )
        return (resp.text or "").strip()
    except Exception as e:
        log.error("Gemini draft() call failed: %s", e)
        return ""


def _load_memory(session_key: str) -> list[dict]:
    # Sheets has no server-side ORDER BY/LIMIT, so filter+sort client-side.
    # Fine at CA-firm scale; see services/sheets_db.py docstring re: archiving.
    rows = [r for r in CONVERSATION_MEMORY.all_rows() if r["session_key"] == session_key]
    rows.sort(key=lambda r: r["created_at"])
    windowed = rows[-config.MEMORY_WINDOW:]
    return [{"role": r["role"], "content": r["content"]} for r in windowed]


def _save_turn(session_key: str, role: str, content: str) -> None:
    CONVERSATION_MEMORY.append(
        {
            "id": f"{session_key}-{int(time.time() * 1000)}",
            "session_key": session_key,
            "role": role,
            "content": content,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
    )


def _to_gemini_contents(history: list[dict], user_message: str) -> list[types.Content]:
    contents = []
    for turn in history:
        role = "model" if turn["role"] == "assistant" else "user"
        contents.append(types.Content(role=role, parts=[types.Part(text=turn["content"])]))
    contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))
    return contents


def agent_reply(session_key: str, system_message: str, user_message: str) -> str:
    """Stateful chat reply, windowed by session_key (e.g. 'wa-support-<phone>',
    'wa-lead-<phone>', 'email-support-<email>')."""
    history = _load_memory(session_key)
    contents = _to_gemini_contents(history, user_message)

    try:
        resp = _client.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_message,
                temperature=config.GEMINI_TEMPERATURE,
            ),
        )
        output = (resp.text or "").strip()
    except Exception as e:
        log.error("Gemini agent_reply() call failed: %s", e)
        output = "Sorry, I'm having trouble responding right now — a member of our team will follow up with you shortly."

    _save_turn(session_key, "user", user_message)
    _save_turn(session_key, "assistant", output)
    return output


def parse_json_block(raw_text: str, fallback: dict) -> dict:
    """Mirrors the original 'Parse ... JSON' code nodes: strip markdown
    fences, regex out the first {...} block, parse it, fall back on failure."""
    text = (raw_text or "").strip()
    text = re.sub(r"```json", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```", "", text).strip()
    match = re.search(r"\{[\s\S]*\}", text)
    try:
        return json.loads(match.group(0) if match else text)
    except Exception:
        return dict(fallback)
