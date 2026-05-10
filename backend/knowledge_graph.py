"""
Knowledge graph extraction and entity-level diff for Compare Mode.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from llm import run_chat

logger = logging.getLogger(__name__)

_EXTRACT_SYSTEM = (
    "You are a knowledge graph extraction engine.\n"
    "Extract entities AND relationships from the numbered document paragraphs.\n"
    "Return ONLY a valid JSON object, no markdown fences, no explanation:\n"
    "{\n"
    '  "entities": [\n'
    '    {"name": "...", "type": "Person|Organization|Location|Date|Number|Concept|Product",\n'
    '     "value": "specific value or role (e.g. CEO, $2.3M, Q3 2024)", "para_indices": [...]},\n'
    "    ...\n"
    "  ],\n"
    '  "relationships": [\n'
    '    {"source": "entity name A", "target": "entity name B", "label": "short relation (2-4 words)"},\n'
    "    ...\n"
    "  ]\n"
    "}\n\n"
    "Rules:\n"
    "- Entities: focus on facts likely to differ between document versions. At most 25 entities.\n"
    "- Relationships: only between extracted entities. At most 30. Keep labels concise.\n"
    "- para_indices: paragraph numbers from the input where the entity appears.\n"
    "- Return ONLY valid JSON."
)


def _build_numbered_text(para_index_map: list[tuple[int, str]]) -> str:
    return "\n".join(f"[{idx}] {text}" for idx, text in para_index_map)


def extract_graph(
    para_index_map: list[tuple[int, str]],
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
) -> dict:
    """Extract entities and relationships from a numbered paragraph list.

    Returns {"entities": [...], "relationships": [...]}.
    """
    numbered = _build_numbered_text(para_index_map[:60])
    try:
        response = run_chat(
            _EXTRACT_SYSTEM,
            [{"role": "user", "content": f"Document:\n{numbered[:8000]}"}],
            provider,
            model,
            base_url,
            api_key,
            timeout,
        )
        cleaned = re.sub(r"```(?:json)?\s*|\s*```", "", response).strip()
        data = json.loads(cleaned)
        if isinstance(data, dict):
            entities = [e for e in data.get("entities", []) if isinstance(e, dict) and "name" in e]
            relationships = [r for r in data.get("relationships", []) if isinstance(r, dict) and "source" in r and "target" in r]
            return {"entities": entities, "relationships": relationships}
    except Exception:
        logger.exception("graph extraction failed")
    return {"entities": [], "relationships": []}


def extract_entities(
    para_index_map: list[tuple[int, str]],
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
) -> list[dict]:
    """Backwards-compatible wrapper — returns only the entities list."""
    return extract_graph(para_index_map, provider, model, base_url, api_key, timeout)["entities"]


def compute_entity_diff(
    entities_a: list[dict],
    entities_b: list[dict],
) -> list[dict]:
    """Compute entity-level diff between two entity lists."""
    index_a = {e["name"].lower(): e for e in entities_a}
    index_b = {e["name"].lower(): e for e in entities_b}

    diff: list[dict] = []

    for name_lower, ea in index_a.items():
        eb = index_b.get(name_lower)
        if eb:
            val_a = str(ea.get("value", "")).strip().lower()
            val_b = str(eb.get("value", "")).strip().lower()
            status = "changed" if val_a != val_b else "unchanged"
            diff.append({
                "name": ea["name"],
                "type": ea.get("type", "Concept"),
                "value_a": ea.get("value", ""),
                "value_b": eb.get("value", ""),
                "para_indices_a": ea.get("para_indices", []),
                "para_indices_b": eb.get("para_indices", []),
                "status": status,
            })
        else:
            diff.append({
                "name": ea["name"],
                "type": ea.get("type", "Concept"),
                "value_a": ea.get("value", ""),
                "value_b": None,
                "para_indices_a": ea.get("para_indices", []),
                "para_indices_b": [],
                "status": "removed",
            })

    for name_lower, eb in index_b.items():
        if name_lower not in index_a:
            diff.append({
                "name": eb["name"],
                "type": eb.get("type", "Concept"),
                "value_a": None,
                "value_b": eb.get("value", ""),
                "para_indices_a": [],
                "para_indices_b": eb.get("para_indices", []),
                "status": "added",
            })

    order = {"changed": 0, "added": 1, "removed": 2, "unchanged": 3}
    diff.sort(key=lambda x: (order.get(x["status"], 4), x["name"].lower()))
    return diff
