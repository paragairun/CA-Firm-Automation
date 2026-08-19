"""
Groq (OpenAI-compatible) LLM wrapper.

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
"""
import json
import logging
import re

from openai import OpenAI

import config
from db import fetch_all, execute

log = logging.getLogger("llm")

_client = OpenAI(api_key=config.GROQ_API_KEY, base_url=config.GROQ_BASE_URL)


def draft(prompt: str) -> str:
    """Single-shot, no conversation history. Used for AI-drafted messages
    (reminders, follow-ups, opening replies) and lead classification."""
    try:
        resp = _client.chat.completions.create(
            model=config.GROQ_MODEL,
            temperature=config.GROQ_TEMPERATURE,
            messages=[{"role": "user", "content": prompt}],
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as e:
        log.error("Groq draft() call failed: %s", e)
        return ""


def _load_memory(session_key: str) -> list[dict]:
    rows = fetch_all(
        "SELECT role, content FROM conversation_memory "
        "WHERE session_key = %s ORDER BY created_at DESC LIMIT %s",
        (session_key, config.MEMORY_WINDOW),
    )
    rows.reverse()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def _save_turn(session_key: str, role: str, content: str) -> None:
    execute(
        "INSERT INTO conversation_memory (session_key, role, content) VALUES (%s, %s, %s)",
        (session_key, role, content),
    )


def agent_reply(session_key: str, system_message: str, user_message: str) -> str:
    """Stateful chat reply, windowed by session_key (e.g. 'wa-support-<phone>',
    'wa-lead-<phone>', 'email-support-<email>')."""
    history = _load_memory(session_key)
    messages = [{"role": "system", "content": system_message}] + history + [
        {"role": "user", "content": user_message}
    ]
    try:
        resp = _client.chat.completions.create(
            model=config.GROQ_MODEL,
            temperature=config.GROQ_TEMPERATURE,
            messages=messages,
        )
        output = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        log.error("Groq agent_reply() call failed: %s", e)
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
