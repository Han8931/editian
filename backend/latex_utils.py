import re
from dataclasses import dataclass


_BEGIN_RE = re.compile(r"\\begin\{([^}]*)\}")
_END_RE = re.compile(r"\\end\{([^}]*)\}")
_HEADING_RE = re.compile(
    r"^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|title|author|date|maketitle)\b"
)

_MATH_ENV = {
    "equation", "equation*", "align", "align*", "gather", "gather*",
    "multline", "multline*", "displaymath", "math", "eqnarray", "eqnarray*",
    "alignat", "alignat*", "flalign", "flalign*",
}
_LIST_ENV = {"itemize", "enumerate", "description"}
_PREAMBLE_PREFIXES = ("\\documentclass", "\\usepackage", "\\begin{document}", "\\end{document}")
# Environments that wrap the whole document body — not treated as nesting for
# block splitting, so the body still splits into blocks on blank lines.
_NON_NESTING_ENVS = {"document"}


def _depth_delta(line: str) -> int:
    begins = [env for env in _BEGIN_RE.findall(line) if env not in _NON_NESTING_ENVS]
    ends = [env for env in _END_RE.findall(line) if env not in _NON_NESTING_ENVS]
    return len(begins) - len(ends)


@dataclass(slots=True)
class LatexBlock:
    index: int
    text: str
    style: str


def read_latex_text(file_path: str) -> str:
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


def classify_latex_block(text: str) -> str:
    lines = [line for line in normalize_newlines(text).split("\n") if line.strip()]
    if not lines:
        return "paragraph"

    first = lines[0].lstrip()

    if first.startswith(_PREAMBLE_PREFIXES):
        return "preamble"
    if first.startswith("%"):
        return "comment"
    if _HEADING_RE.match(first):
        return "heading"

    begin_match = _BEGIN_RE.match(first)
    if begin_match:
        env = begin_match.group(1)
        if env in _MATH_ENV:
            return "math"
        if env in _LIST_ENV:
            return "list"
        return "environment"

    if first.startswith("\\[") or first.startswith("$$"):
        return "math"
    return "paragraph"


def split_latex_blocks(text: str) -> list[str]:
    """Split LaTeX source into blocks on blank lines, keeping \\begin..\\end
    environments intact even when they contain blank lines."""
    normalized = normalize_newlines(text)
    if not normalized.strip():
        return []

    blocks: list[str] = []
    current: list[str] = []
    depth = 0

    for line in normalized.split("\n"):
        if depth == 0 and not line.strip():
            if current:
                blocks.append("\n".join(current).strip("\n"))
                current = []
            continue

        current.append(line)
        depth += _depth_delta(line)
        if depth < 0:
            depth = 0

    if current:
        blocks.append("\n".join(current).strip("\n"))

    return [block for block in blocks if block.strip()]


def parse_latex_blocks(text: str) -> list[LatexBlock]:
    return [
        LatexBlock(index=i, text=block, style=classify_latex_block(block))
        for i, block in enumerate(split_latex_blocks(text))
    ]


def serialize_latex_blocks(
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
