"""Agentic, multi-file project editing (Codex / Claude-Code style).

Given a natural-language instruction, the agent explores an uploaded project
with read-only tools (list_files / read_file / search) and stages edits with
edit_file / write_file. Edits are NOT written to disk here — they accumulate in
an in-memory working copy and are returned as per-file diffs for the user to
review and accept. Applying accepted edits is the caller's job.
"""
from __future__ import annotations

import difflib
import logging
from pathlib import Path

import projects
from llm import run_tool_agent

logger = logging.getLogger(__name__)


# ── Tool schemas ─────────────────────────────────────────────────────────────

def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


PROJECT_TOOLS = [
    _tool(
        "list_files",
        "List every editable file in the project (relative paths).",
        {},
        [],
    ),
    _tool(
        "read_file",
        "Read the full current contents of a file by its relative path. Reflects any edits you have already staged this session.",
        {"path": {"type": "string", "description": "Project-relative file path, e.g. 'chapters/intro.tex'."}},
        ["path"],
    ),
    _tool(
        "search",
        "Search all text files for a substring (e.g. a \\cite key, a \\label, or a command name). Returns matching path:line: text.",
        {"query": {"type": "string", "description": "Literal substring to search for."}},
        ["query"],
    ),
    _tool(
        "edit_file",
        "Stage an edit to a file by replacing an exact snippet. old_string must occur EXACTLY ONCE in the file's current contents. Use this for targeted changes.",
        {
            "path": {"type": "string", "description": "Project-relative file path to edit."},
            "old_string": {"type": "string", "description": "Exact existing text to replace (must be unique in the file)."},
            "new_string": {"type": "string", "description": "Replacement text."},
        },
        ["path", "old_string", "new_string"],
    ),
    _tool(
        "write_file",
        "Stage a full-file write — create a new file or overwrite an existing one with the given contents.",
        {
            "path": {"type": "string", "description": "Project-relative file path to create or overwrite."},
            "content": {"type": "string", "description": "Full new contents of the file."},
        },
        ["path", "content"],
    ),
]


_SEARCH_MATCH_LIMIT = 60
_READ_CHAR_LIMIT = 60_000


# ── Session ──────────────────────────────────────────────────────────────────

class ProjectAgentSession:
    """Holds a working copy of the project and the tool implementations.

    Reads/searches go through the working copy so the agent sees its own staged
    edits. Edits never touch disk — they accumulate in `_working` and are
    diffed against the on-disk originals in `proposed_edits()`.
    """

    def __init__(self, project_dir: str | Path):
        self.project_dir = Path(project_dir)
        self._files = projects.list_project_files(self.project_dir)
        self._working: dict[str, str] = {}   # rel_path -> current (possibly edited) text
        self._touched: set[str] = set()       # rel_paths edited or created this session

    # -- content access (working copy) --

    def _current_text(self, rel_path: str) -> str:
        if rel_path in self._working:
            return self._working[rel_path]
        text = projects.read_text(self.project_dir, rel_path)  # may raise
        self._working[rel_path] = text
        return text

    # -- tool implementations --

    def list_files(self) -> str:
        known = sorted(set(self._files) | self._touched)
        if not known:
            return "(project is empty)"
        return "\n".join(known)

    def read_file(self, path: str) -> str:
        try:
            text = self._current_text(path)
        except FileNotFoundError:
            return f"ERROR: file not found: {path}"
        except Exception as exc:
            return f"ERROR: {exc}"
        if len(text) > _READ_CHAR_LIMIT:
            return text[:_READ_CHAR_LIMIT] + f"\n... [truncated, {len(text)} chars total]"
        return text

    def search(self, query: str) -> str:
        if not query:
            return "ERROR: empty query"
        matches: list[str] = []
        for rel in sorted(set(self._files) | self._touched):
            if not projects.is_text_file(rel):
                continue
            try:
                text = self._current_text(rel)
            except Exception:
                continue
            for lineno, line in enumerate(text.splitlines(), start=1):
                if query in line:
                    matches.append(f"{rel}:{lineno}: {line.strip()[:200]}")
                    if len(matches) >= _SEARCH_MATCH_LIMIT:
                        matches.append("... [more matches omitted]")
                        return "\n".join(matches)
        return "\n".join(matches) if matches else f"No matches for {query!r}."

    def edit_file(self, path: str, old_string: str, new_string: str) -> str:
        try:
            text = self._current_text(path)
        except FileNotFoundError:
            return f"ERROR: file not found: {path}. Use write_file to create it."
        except Exception as exc:
            return f"ERROR: {exc}"
        count = text.count(old_string)
        if count == 0:
            return "ERROR: old_string not found in the file. Read the file again and copy the exact text."
        if count > 1:
            return f"ERROR: old_string occurs {count} times; it must be unique. Add surrounding context to make it unique."
        self._working[path] = text.replace(old_string, new_string, 1)
        self._touched.add(path)
        return f"OK: staged edit to {path}."

    def write_file(self, path: str, content: str) -> str:
        try:
            projects.safe_join(self.project_dir, path)
        except ValueError as exc:
            return f"ERROR: {exc}"
        existed = path in self._files or (path in self._working)
        self._working[path] = content
        self._touched.add(path)
        return f"OK: staged {'overwrite of' if existed else 'new file'} {path}."

    # -- dispatch --

    def execute(self, name: str, args: dict) -> str:
        if name == "list_files":
            return self.list_files()
        if name == "read_file":
            return self.read_file(args.get("path", ""))
        if name == "search":
            return self.search(args.get("query", ""))
        if name == "edit_file":
            return self.edit_file(args.get("path", ""), args.get("old_string", ""), args.get("new_string", ""))
        if name == "write_file":
            return self.write_file(args.get("path", ""), args.get("content", ""))
        return f"ERROR: unknown tool {name}"

    # -- results --

    def proposed_edits(self) -> list[dict]:
        edits: list[dict] = []
        for rel in sorted(self._touched):
            revised = self._working.get(rel, "")
            is_new = rel not in self._files
            if is_new:
                original = ""
            else:
                try:
                    original = projects.read_text(self.project_dir, rel)
                except Exception:
                    original = ""
            if original == revised:
                continue
            diff = "".join(
                difflib.unified_diff(
                    original.splitlines(keepends=True),
                    revised.splitlines(keepends=True),
                    fromfile=f"a/{rel}",
                    tofile=f"b/{rel}",
                )
            )
            edits.append({
                "path": rel,
                "kind": "create" if is_new else "edit",
                "original": original,
                "revised": revised,
                "diff": diff,
            })
        return edits


# ── Prompt ──────────────────────────────────────────────────────────────────

def _build_system_prompt(main_file: str | None, file_list: list[str]) -> str:
    main_hint = f"The main document is '{main_file}'. " if main_file else ""
    listing = "\n".join(f"  - {f}" for f in file_list[:200])
    if len(file_list) > 200:
        listing += f"\n  ... ({len(file_list) - 200} more)"
    return (
        "You are an expert LaTeX editing agent working inside a multi-file project. "
        f"{main_hint}"
        "Carry out the user's instruction by exploring the project and staging precise edits.\n\n"
        "Workflow:\n"
        "1. Use list_files and read_file to understand the relevant files before changing anything.\n"
        "2. Use search to locate \\cite keys, \\label/\\ref targets, custom macros, or any text you need.\n"
        "3. Make changes with edit_file (targeted, unique-snippet replacement) or write_file (whole-file / new file).\n\n"
        "Rules:\n"
        "- Only cite keys that actually exist in the .bib files — never invent a citation key. Search the .bib to confirm.\n"
        "- Reuse existing custom commands and \\label names; do not introduce duplicates.\n"
        "- Keep edits minimal and focused on the instruction. Preserve surrounding formatting and LaTeX validity.\n"
        "- Prefer edit_file for small changes; only use write_file for new files or large rewrites.\n"
        "- When you are done, stop calling tools and reply with a short plain-text summary of what you changed and why.\n\n"
        f"Project files:\n{listing}"
    )


def run_project_agent(
    project_dir: str | Path,
    main_file: str | None,
    instruction: str,
    provider: str,
    model: str,
    base_url: str | None = None,
    api_key: str | None = None,
    timeout: float = 120,
    max_iterations: int = 20,
) -> dict:
    """Run the agent over the project and return proposed (un-applied) edits.

    Returns {"summary": str, "edits": [{path, kind, original, revised, diff}]}.
    """
    session = ProjectAgentSession(project_dir)
    system_prompt = _build_system_prompt(main_file, session._files)
    summary = run_tool_agent(
        system_prompt,
        instruction,
        PROJECT_TOOLS,
        session.execute,
        provider,
        model,
        base_url,
        api_key,
        timeout,
        max_iterations=max_iterations,
    )
    edits = session.proposed_edits()
    logger.info("project agent done dir=%s edits=%d", project_dir, len(edits))
    return {"summary": summary, "edits": edits}
