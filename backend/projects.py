"""Filesystem storage for multi-file projects (e.g. a LaTeX project: main.tex
+ refs.bib + chapters/*.tex).

A project is just a directory tree under PROJECTS_DIR/{project_id}/. All access
goes through `safe_join`, which guarantees paths stay inside the project root
(no traversal via `..` or absolute paths).
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path


# Files/dirs we never surface to the agent or the UI.
_IGNORED_DIRS = {".git", "__pycache__", ".vscode", ".idea", "node_modules", ".texpadtmp"}
_IGNORED_SUFFIXES = {
    ".aux", ".log", ".out", ".toc", ".lof", ".lot", ".synctex.gz",
    ".fls", ".fdb_latexmk", ".bbl", ".blg", ".nav", ".snm", ".vrb",
    ".DS_Store",
}
# Text file types the agent is allowed to read/search/edit.
TEXT_SUFFIXES = {".tex", ".latex", ".bib", ".sty", ".cls", ".txt", ".md", ".markdown", ".bst", ".cfg"}

_MAX_TEXT_BYTES = 2_000_000  # skip reading files larger than this as text


def _is_ignored(rel_parts: tuple[str, ...], name: str) -> bool:
    if any(part in _IGNORED_DIRS for part in rel_parts):
        return True
    suffix = Path(name).suffix.lower()
    if suffix in _IGNORED_SUFFIXES:
        return True
    if name == ".DS_Store":
        return True
    return False


def safe_join(project_dir: str | Path, rel_path: str) -> Path:
    """Resolve `rel_path` inside `project_dir`, refusing anything that escapes it."""
    root = Path(project_dir).resolve()
    # Normalize separators and strip a leading slash so absolute-looking paths
    # are treated as project-relative.
    cleaned = rel_path.replace("\\", "/").lstrip("/")
    target = (root / cleaned).resolve()
    if root != target and root not in target.parents:
        raise ValueError(f"Path escapes the project directory: {rel_path!r}")
    return target


def create_project_from_files(project_dir: str | Path, files: list[tuple[str, bytes]]) -> list[str]:
    """Write uploaded (relative_path, bytes) pairs into the project, preserving
    structure. Returns the list of stored relative paths."""
    root = Path(project_dir)
    root.mkdir(parents=True, exist_ok=True)
    stored: list[str] = []
    for rel_path, payload in files:
        rel = rel_path.replace("\\", "/").lstrip("/")
        if not rel:
            continue
        parts = tuple(Path(rel).parts[:-1])
        if _is_ignored(parts, Path(rel).name):
            continue
        target = safe_join(root, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        stored.append(rel)
    return stored


def extract_zip(project_dir: str | Path, zip_bytes: bytes) -> list[str]:
    """Extract a .zip into the project. A single top-level wrapper directory
    (common when zipping a folder) is flattened away."""
    root = Path(project_dir)
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        top_levels = {n.split("/", 1)[0] for n in names}
        strip_prefix = ""
        if len(top_levels) == 1:
            only = next(iter(top_levels))
            if any("/" in n for n in names):
                strip_prefix = only + "/"

        files: list[tuple[str, bytes]] = []
        for name in names:
            rel = name[len(strip_prefix):] if strip_prefix and name.startswith(strip_prefix) else name
            if not rel:
                continue
            files.append((rel, zf.read(name)))
    return create_project_from_files(root, files)


def list_project_files(project_dir: str | Path) -> list[str]:
    """Relative paths of all non-ignored files in the project, sorted."""
    root = Path(project_dir).resolve()
    results: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if _is_ignored(rel.parts[:-1], rel.name):
            continue
        results.append(rel.as_posix())
    return sorted(results)


def is_text_file(rel_path: str) -> bool:
    return Path(rel_path).suffix.lower() in TEXT_SUFFIXES


def read_text(project_dir: str | Path, rel_path: str) -> str:
    target = safe_join(project_dir, rel_path)
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(rel_path)
    if target.stat().st_size > _MAX_TEXT_BYTES:
        raise ValueError(f"File is too large to read as text: {rel_path}")
    return target.read_text(encoding="utf-8", errors="replace")


def write_text(project_dir: str | Path, rel_path: str, content: str) -> None:
    target = safe_join(project_dir, rel_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="")


def detect_main_tex(project_dir: str | Path, files: list[str] | None = None) -> str | None:
    """Heuristic: the .tex file containing \\documentclass and \\begin{document}.
    Prefers a file literally named main.tex; falls back to the first .tex."""
    rels = files if files is not None else list_project_files(project_dir)
    tex_files = [f for f in rels if Path(f).suffix.lower() in (".tex", ".latex")]
    if not tex_files:
        return None

    candidates: list[str] = []
    for rel in tex_files:
        try:
            text = read_text(project_dir, rel)
        except Exception:
            continue
        if "\\documentclass" in text and "\\begin{document}" in text:
            candidates.append(rel)

    pool = candidates or tex_files
    for rel in pool:
        if Path(rel).name.lower() == "main.tex":
            return rel
    # Shortest path tends to be the root document.
    return min(pool, key=lambda r: (r.count("/"), len(r)))


def zip_project(project_dir: str | Path) -> bytes:
    """Zip the project (excluding ignored build artifacts) for download."""
    root = Path(project_dir).resolve()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in list_project_files(root):
            zf.write(root / rel, rel)
    return buf.getvalue()
