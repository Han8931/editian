import re
from dataclasses import dataclass


_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
_LIST_RE = re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+")
_HR_RE = re.compile(r"^\s{0,3}(?:[-*_]\s*){3,}$")
_SETEXT_H1_RE = re.compile(r"^\s*=+\s*$")
_SETEXT_H2_RE = re.compile(r"^\s*-+\s*$")
_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$")


@dataclass(slots=True)
class MarkdownBlock:
    index: int
    text: str
    style: str


def read_markdown_text(file_path: str) -> str:
    with open(file_path, "r", encoding="utf-8") as f:
        return f.read()


def detect_newline(text: str) -> str:
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def classify_markdown_block(text: str) -> str:
    lines = [line for line in normalize_newlines(text).split("\n") if line.strip()]
    if not lines:
        return "paragraph"

    first = lines[0].lstrip()
    second = lines[1].strip() if len(lines) > 1 else ""

    if _FENCE_RE.match(first):
        return "code"
    if first.startswith("#"):
        return "heading"
    if len(lines) > 1 and (_SETEXT_H1_RE.match(second) or _SETEXT_H2_RE.match(second)):
        return "heading"
    if _HR_RE.match(first):
        return "rule"
    if first.startswith(">"):
        return "quote"
    if _LIST_RE.match(first):
        return "list"
    if len(lines) > 1 and "|" in first and _TABLE_SEPARATOR_RE.match(second):
        return "table"
    return "paragraph"


def split_markdown_blocks(text: str) -> list[str]:
    normalized = normalize_newlines(text)
    if not normalized.strip():
        return []

    blocks: list[str] = []
    current: list[str] = []
    fence_marker: str | None = None

    for line in normalized.split("\n"):
        stripped = line.strip()
        fence_match = _FENCE_RE.match(line)

        if fence_marker is not None:
            current.append(line)
            if fence_match and fence_match.group(1)[0] == fence_marker[0] and len(fence_match.group(1)) >= len(fence_marker):
                fence_marker = None
            continue

        if not stripped:
            if current:
                blocks.append("\n".join(current).strip("\n"))
                current = []
            continue

        current.append(line)
        if fence_match:
            fence_marker = fence_match.group(1)

    if current:
        blocks.append("\n".join(current).strip("\n"))

    return [block for block in blocks if block.strip()]


def parse_markdown_blocks(text: str) -> list[MarkdownBlock]:
    return [
        MarkdownBlock(index=i, text=block, style=classify_markdown_block(block))
        for i, block in enumerate(split_markdown_blocks(text))
    ]


def serialize_markdown_blocks(
    blocks: list[str],
    newline: str = "\n",
    trailing_newline: bool = True,
) -> str:
    cleaned = [normalize_newlines(block).strip("\n") for block in blocks if block.strip()]
    if not cleaned:
        return ""
    rendered = f"{newline}{newline}".join(cleaned)
    if trailing_newline:
        rendered += newline
    return rendered
