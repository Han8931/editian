import re
from dataclasses import dataclass


_BEGIN_RE = re.compile(r"\\begin\{([^}]*)\}")
_END_RE = re.compile(r"\\end\{([^}]*)\}")
# An unescaped % starts a comment that runs to end of line.
_COMMENT_RE = re.compile(r"(?<!\\)%.*$")
_HEADING_RE = re.compile(
    r"^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|title|author|date|maketitle)\b"
)
# Single-line commands that should always form their own selectable block,
# separated from surrounding prose (headings and \maketitle). \title/\author/
# \date are intentionally excluded so they stay grouped with the preamble.
_STANDALONE_RE = re.compile(
    r"^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|maketitle)\b"
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
    # Ignore commented-out \begin/\end so a stray "% \begin{figure}" does not
    # leave the environment depth stuck above zero for the rest of the document.
    line = _COMMENT_RE.sub("", line)
    begins = [env for env in _BEGIN_RE.findall(line) if env not in _NON_NESTING_ENVS]
    ends = [env for env in _END_RE.findall(line) if env not in _NON_NESTING_ENVS]
    return len(begins) - len(ends)


@dataclass(slots=True)
class LatexBlock:
    index: int
    text: str
    style: str


def read_latex_text(file_path: str) -> str:
    # LaTeX sources are commonly UTF-8 but legacy files are often Latin-1
    # (accented characters, inputenc latin1). Try the most likely encodings in
    # order before falling back to a lossless byte-preserving decode.
    with open(file_path, "rb") as f:
        raw = f.read()
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    # latin-1 decodes any byte sequence, so this is effectively unreachable.
    return raw.decode("latin-1", errors="replace")


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
    """Split LaTeX source into independently selectable blocks.

    Blocks break on blank lines (so soft-wrapped prose stays together) and also
    at structural boundaries — headings, \\maketitle, and the start/end of
    top-level environments and the document — so a heading is not fused to the
    paragraph that follows it. \\begin..\\end environments stay intact even when
    they span blank lines."""
    normalized = normalize_newlines(text)
    if not normalized.strip():
        return []

    blocks: list[str] = []
    current: list[str] = []
    depth = 0

    def flush() -> None:
        nonlocal current
        if current:
            blocks.append("\n".join(current).strip("\n"))
            current = []

    for line in normalized.split("\n"):
        stripped = line.strip()

        if depth == 0 and not stripped:
            flush()
            continue

        # At the top level, start a new block before a structural line so it is
        # not glued onto the preceding paragraph.
        if depth == 0 and current and (
            _STANDALONE_RE.match(stripped)
            or _BEGIN_RE.match(stripped)
            or _END_RE.match(stripped)
        ):
            flush()

        current.append(line)
        depth += _depth_delta(line)
        if depth < 0:
            depth = 0

        # Once back at the top level, close the block after a standalone command
        # or after an environment / document boundary so following prose starts
        # its own block.
        if depth == 0 and (
            _STANDALONE_RE.match(stripped)
            or _BEGIN_RE.match(stripped)
            or _END_RE.match(stripped)
        ):
            flush()

    flush()

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
