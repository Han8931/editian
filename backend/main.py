import uuid
import json
import shutil
import hashlib
import logging
import time
from pathlib import Path
import os
import mimetypes

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import Optional

from parsers.docx_parser import parse_docx, get_docx_html, get_cell_text, get_table_cells
from parsers.markdown_parser import parse_markdown
from parsers.pptx_parser import parse_pptx, get_pptx_cell_text, get_pptx_table_cells
from writers.docx_writer import apply_docx_revisions
from writers.markdown_writer import apply_markdown_revisions
from writers.pptx_writer import apply_pptx_revisions
from llm import run_agent_loop, run_chat, run_text_revision, stream_chat
from logging_config import get_request_id, reset_request_id, set_request_id, setup_logging
from storage import S3DocumentStorage, StorageConfigError
import slide_renderer

load_dotenv(Path(__file__).with_name(".env"))
setup_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="Editian")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Persistent storage directory
FILES_DIR = Path.home() / ".editian" / "files"
FILES_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR = FILES_DIR.parent / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
SLIDES_DIR = FILES_DIR.parent / "slide_images"
SLIDES_DIR.mkdir(parents=True, exist_ok=True)
REGISTRY_FILE = FILES_DIR.parent / "registry.json"

_storage_backend = os.getenv("STORAGE_BACKEND", "local").strip().lower()
try:
    _storage: S3DocumentStorage | StorageConfigError = S3DocumentStorage.from_env()
except StorageConfigError as exc:
    _storage = exc
    if _storage_backend == "s3":
        logger.warning("s3 storage backend configured but unavailable error=%s", exc)

# In-memory file registry {file_id: {path, type, name}}
_files: dict = {}

# Undo/redo stacks {file_id: [snapshot_path, ...]}
_undo_stacks: dict[str, list[str]] = {}
_redo_stacks: dict[str, list[str]] = {}


def _save_registry() -> None:
    REGISTRY_FILE.write_text(json.dumps({
        "files": _files,
        "undo_stacks": _undo_stacks,
        "redo_stacks": _redo_stacks,
    }))


def _load_registry() -> None:
    if not REGISTRY_FILE.exists():
        return
    try:
        data = json.loads(REGISTRY_FILE.read_text())
        for fid, info in data.get("files", {}).items():
            if "path" not in info:
                continue
            if _storage_backend == "s3" and "s3_key" not in info:
                if not isinstance(_storage, StorageConfigError):
                    info["s3_key"] = _storage.build_key(fid, info["name"])
            _files[fid] = info
        for fid, stack in data.get("undo_stacks", {}).items():
            valid = [p for p in stack if Path(p).exists()]
            if valid:
                _undo_stacks[fid] = valid
        for fid, stack in data.get("redo_stacks", {}).items():
            valid = [p for p in stack if Path(p).exists()]
            if valid:
                _redo_stacks[fid] = valid
    except Exception:
        logger.exception("failed to load registry path=%s", REGISTRY_FILE)


_load_registry()
logger.info(
    "backend initialized storage_backend=%s tracked_files=%d slide_renderer_available=%s slide_renderer_backend=%s",
    _storage_backend,
    len(_files),
    slide_renderer.is_available(),
    slide_renderer.backend_name(),
)


def _push_snapshot(file_id: str) -> None:
    """Copy the current file onto the undo stack and clear the redo stack."""
    path = _ensure_local_file(file_id)
    snap = str(FILES_DIR / f"{file_id}.snap.{uuid.uuid4().hex[:8]}")
    shutil.copy2(path, snap)
    _undo_stacks.setdefault(file_id, []).append(snap)
    for p in _redo_stacks.pop(file_id, []):
        Path(p).unlink(missing_ok=True)


def _require_storage() -> S3DocumentStorage:
    if _storage_backend != "s3":
        raise HTTPException(500, f"Storage backend '{_storage_backend}' does not use S3.")
    if isinstance(_storage, StorageConfigError):
        exc = _storage
        raise HTTPException(500, f"S3 is not configured: {exc}") from exc
    return _storage


def _ensure_local_file(file_id: str) -> str:
    info = _get_file(file_id)
    path = Path(info["path"])
    if not path.exists():
        if _storage_backend != "s3":
            raise HTTPException(500, "Local file is missing.")
        storage = _require_storage()
        s3_key = info.get("s3_key")
        if not s3_key:
            raise HTTPException(500, "File is missing an S3 key.")
        logger.info("restoring local file from s3 file_id=%s key=%s", file_id, s3_key)
        storage.download_file(s3_key, path)
    return str(path)


def _sync_file_to_remote(file_id: str) -> None:
    if _storage_backend != "s3":
        return
    info = _get_file(file_id)
    storage = _require_storage()
    local_path = _ensure_local_file(file_id)
    s3_key = info.get("s3_key")
    if not s3_key:
        raise HTTPException(500, "File is missing an S3 key.")
    logger.debug("syncing file to s3 file_id=%s key=%s", file_id, s3_key)
    storage.upload_file(local_path, s3_key)


def _asset_suffix(content_type: Optional[str], filename: Optional[str] = None) -> str:
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    if filename:
        suffix = Path(filename).suffix.lower()
        if suffix:
            return suffix
    guessed = mimetypes.guess_extension(mime) if mime else None
    if guessed == ".jpe":
        return ".jpg"
    return guessed or ".bin"


def _pptx_asset_resolver(file_id: str):
    asset_dir = ASSETS_DIR / file_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    def resolve(blob: bytes, content_type: Optional[str], filename: Optional[str] = None) -> str:
        digest = hashlib.sha256(blob).hexdigest()
        suffix = _asset_suffix(content_type, filename)
        asset_name = f"{digest}{suffix}"
        asset_path = asset_dir / asset_name
        if not asset_path.exists():
            asset_path.write_bytes(blob)
        return f"/api/files/{file_id}/assets/{asset_name}"

    return resolve


# ---------- Models ----------

class LLMConfig(BaseModel):
    provider: str = "ollama"
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: str = "llama3.2"
    timeout: float = 120


class RevisionScope(BaseModel):
    type: str  # document | paragraphs | slide | shape | table_cell | insert_table | insert_paragraph | delete_paragraph | insert_slide | delete_slide | duplicate_slide | insert_text_box
    paragraph_indices: Optional[list[int]] = None
    slide_index: Optional[int] = None
    shape_indices: Optional[list[int]] = None
    table_index: Optional[int] = None
    row_index: Optional[int] = None
    cell_index: Optional[int] = None
    # insert_table fields
    paragraph_index: Optional[int] = None   # insert after this paragraph (-1 = end)
    rows: Optional[int] = None
    cols: Optional[int] = None
    # insert_text_box fields
    text_box_left: Optional[int] = None     # EMU
    text_box_top: Optional[int] = None      # EMU
    text_box_width: Optional[int] = None    # EMU
    text_box_height: Optional[int] = None   # EMU
    # insert_slide with content fields
    slide_title: Optional[str] = None
    slide_body: Optional[str] = None
    # move_shape fields (EMU)
    new_left: Optional[int] = None
    new_top: Optional[int] = None


class ReviseRequest(BaseModel):
    file_id: str
    scope: RevisionScope
    instruction: str
    llm: LLMConfig
    current_slide: Optional[int] = None  # hint: which slide the user is currently viewing
    preferred_language: Optional[str] = None


class ApplyRevision(BaseModel):
    scope: RevisionScope
    original: str
    revised: str
    font_name: Optional[str] = None
    font_size: Optional[float] = None
    align: Optional[str] = None
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    underline: Optional[bool] = None
    strike: Optional[bool] = None
    bullet: Optional[bool] = None


class ApplyRequest(BaseModel):
    file_id: str
    revisions: list[ApplyRevision]


# ---------- Helpers ----------

def _get_file(file_id: str) -> dict:
    if file_id not in _files:
        raise HTTPException(404, "File not found. Please re-upload.")
    return _files[file_id]


def _slide_cache_dir(file_id: str) -> Path:
    return SLIDES_DIR / file_id


def _invalidate_slide_cache(file_id: str) -> None:
    slide_renderer.invalidate(_slide_cache_dir(file_id))


# ---------- Routes ----------

@app.middleware("http")
async def bind_request_logging_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    token = set_request_id(request_id)
    start = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.debug(
            "request completed method=%s path=%s status_code=%s duration_ms=%.1f",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - start) * 1000,
        )
        return response
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "unhandled request error method=%s path=%s duration_ms=%.1f",
            request.method,
            request.url.path,
            duration_ms,
        )
        raise
    finally:
        reset_request_id(token)

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in (".docx", ".pptx", ".md", ".markdown"):
        raise HTTPException(400, "Only .docx, .pptx, and markdown files are supported.")

    file_id = str(uuid.uuid4())
    file_path = FILES_DIR / f"{file_id}{ext}"
    payload = await file.read()
    file_path.write_bytes(payload)
    file_type = "markdown" if ext in (".md", ".markdown") else ext[1:]
    file_info = {"path": str(file_path), "type": file_type, "name": file.filename}
    if _storage_backend == "s3":
        storage = _require_storage()
        s3_key = storage.build_key(file_id, file.filename)
        storage.upload_file(file_path, s3_key)
        file_path.unlink(missing_ok=True)
        storage.download_file(s3_key, file_path)
        file_info["s3_key"] = s3_key

    _files[file_id] = file_info
    try:
        response = _build_response(file_id)
    except Exception as exc:
        logger.exception(
            "upload parse failed file_id=%s name=%s file_type=%s",
            file_id,
            file.filename,
            file_type,
        )
        _files.pop(file_id, None)
        Path(file_info["path"]).unlink(missing_ok=True)
        shutil.rmtree(ASSETS_DIR / file_id, ignore_errors=True)
        raise HTTPException(422, f"Failed to parse uploaded {ext[1:]} file: {exc}") from exc

    logger.info(
        "upload succeeded file_id=%s name=%s file_type=%s size_bytes=%d",
        file_id,
        file.filename,
        file_type,
        len(payload),
    )
    _save_registry()
    return response


@app.post("/api/revise")
async def revise(req: ReviseRequest):
    info = _get_file(req.file_id)
    file_type = info["type"]
    file_path = _ensure_local_file(req.file_id)
    llm = req.llm
    try:
        response = await _do_revise(req, file_type, file_path, llm)
        logger.info(
            "revisions generated file_id=%s file_type=%s scope=%s count=%d provider=%s model=%s",
            req.file_id,
            file_type,
            req.scope.type,
            len(response["revisions"]),
            llm.provider,
            llm.model,
        )
        return response
    except TimeoutError as e:
        logger.warning(
            "revision timed out file_id=%s file_type=%s scope=%s provider=%s model=%s timeout=%s",
            req.file_id,
            file_type,
            req.scope.type,
            llm.provider,
            llm.model,
            llm.timeout,
        )
        raise HTTPException(408, str(e))


_SYSTEM_PROMPT = (
    "You are a document editor. Apply the user's instruction exactly. "
    "— To REVISE existing content: call revise_text, revise_paragraph, or revise_shape for each item that needs changing. "
    "  When multiple text-document paragraphs are selected, prefer revise_paragraphs_batch. "
    "  Items labeled [context] are reference only — do NOT revise them. "
    "  Only revise items with a numeric label (e.g. [3], [shape=2]). "
    "  For formatting-only changes, call the tool with the original text unchanged and set the formatting params. "
    "  For DOCX and PPTX, revised_text must be plain text. "
    "  For Markdown files, revised_text must be markdown source text. "
    "  Never include HTML or XML unless the original content already uses it. "
    "  Alignment: left | center | right | justify. "
    "— For DOCX or Markdown, to ADD a new paragraph/block: call insert_paragraph with the target paragraph index and text. "
    "  Use paragraph_index=-1 to append at the end. "
    "  When the user wants one new paragraph below a selected text passage, prefer insert_paragraph_after_selection. "
    "— For DOCX or Markdown, to DELETE an existing paragraph/block: call delete_paragraph with that paragraph index. "
    "— For DOCX or Markdown, to MERGE the selected paragraphs into one replacement paragraph: call merge_selected_paragraphs. "
    "— To ADD a new slide: call add_slide with a clear title and body. "
    "  Use after_slide_index=-1 to append at the end, or a specific 0-based index to insert after that slide. "
    "— To ADD new text to an existing slide: call add_text_box with the slide_index and text. "
    "You MUST always call at least one tool. Do not add explanations."
)

_CONTEXT_WINDOW = 3  # number of neighboring paragraphs/shapes to include as context


def _para_prompt(paragraphs: list[dict], selected_indices: set[int]) -> str:
    """Build a paragraph listing with [context] labels for non-selected neighbors."""
    non_empty = [p for p in paragraphs if p["text"].strip()]
    pos_of = {p["index"]: i for i, p in enumerate(non_empty)}
    sel_positions = [pos_of[idx] for idx in selected_indices if idx in pos_of]
    if not sel_positions:
        return ""
    start = max(0, min(sel_positions) - _CONTEXT_WINDOW)
    end   = min(len(non_empty) - 1, max(sel_positions) + _CONTEXT_WINDOW)
    lines = []
    for p in non_empty[start : end + 1]:
        tag = f"[{p['index']}]" if p["index"] in selected_indices else "[context]"
        lines.append(f"{tag} {p['text']}")
    return "\n\n".join(lines)


def _shape_prompt(all_shapes: list[dict], selected_indices: set[int]) -> str:
    """Build a shape listing with [context] labels for non-selected shapes."""
    lines = []
    for sh in all_shapes:
        if not sh["text"].strip():
            continue
        tag = f"[shape={sh['index']}]" if sh["index"] in selected_indices else "[context]"
        lines.append(f"{tag} {sh['text']}")
    return "\n\n".join(lines)


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


_FONT_NAME_PROP  = {"type": "string",  "description": "Font name to apply (e.g. 'Arial'). Omit if not changing."}
_FONT_SIZE_PROP  = {"type": "number",  "description": "Font size in points (e.g. 24). Omit if not changing."}
_ALIGN_PROP      = {"type": "string",  "enum": ["left", "center", "right", "justify"], "description": "Paragraph alignment. Omit if not changing."}
_BOLD_PROP       = {"type": "boolean", "description": "Set to true/false to enable/disable bold. Omit if not changing."}
_ITALIC_PROP     = {"type": "boolean", "description": "Set to true/false to enable/disable italic. Omit if not changing."}
_UNDERLINE_PROP  = {"type": "boolean", "description": "Set to true/false to enable/disable underline. Omit if not changing."}

_FORMAT_PROPS = {
    "font_name": _FONT_NAME_PROP,
    "font_size": _FONT_SIZE_PROP,
    "align":     _ALIGN_PROP,
    "bold":      _BOLD_PROP,
    "italic":    _ITALIC_PROP,
    "underline": _UNDERLINE_PROP,
}

_REVISED_TEXT_DESCRIPTION = (
    "The revised text. Use plain text for DOCX/PPTX and markdown source for Markdown files. "
    "Never return HTML or XML."
)

_REVISE_TEXT_TOOL = _tool(
    "revise_text",
    "Provide the revised text and any formatting changes (font_name, font_size, align, bold, italic, underline).",
    {"revised_text": {"type": "string", "description": _REVISED_TEXT_DESCRIPTION}, **_FORMAT_PROPS},
    ["revised_text"],
)

_REVISE_PARAGRAPH_TOOL = _tool(
    "revise_paragraph",
    "Update a paragraph's text and/or formatting (font_name, font_size, align, bold, italic, underline).",
    {
        "index": {"type": "integer", "description": "Paragraph index (as shown in brackets)"},
        "revised_text": {"type": "string", "description": _REVISED_TEXT_DESCRIPTION},
        **_FORMAT_PROPS,
    },
    ["index", "revised_text"],
)

_REVISE_PARAGRAPHS_BATCH_TOOL = _tool(
    "revise_paragraphs_batch",
    "Update multiple selected paragraphs in one call. Include one item per paragraph that should change.",
    {
        "revisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "Paragraph index (as shown in brackets)"},
                    "revised_text": {"type": "string", "description": _REVISED_TEXT_DESCRIPTION},
                    **_FORMAT_PROPS,
                },
                "required": ["index", "revised_text"],
            },
        },
    },
    ["revisions"],
)

_REVISE_CELL_TOOL = _tool(
    "revise_table_cell",
    "Update a table cell's text and/or formatting (font_name, font_size, align, bold, italic, underline).",
    {
        "row_index": {"type": "integer"},
        "cell_index": {"type": "integer"},
        "revised_text": {"type": "string", "description": _REVISED_TEXT_DESCRIPTION},
        **_FORMAT_PROPS,
    },
    ["row_index", "cell_index", "revised_text"],
)

_INSERT_PARAGRAPH_TOOL = _tool(
    "insert_paragraph",
    "Insert a new paragraph after the specified paragraph index. Use paragraph_index=-1 to append at the end.",
    {
        "paragraph_index": {
            "type": "integer",
            "description": "Insert the new paragraph after this 0-based paragraph index. Use -1 to append at the end.",
        },
        "text": {"type": "string", "description": "Text for the new paragraph."},
        **_FORMAT_PROPS,
    },
    ["paragraph_index", "text"],
)

_INSERT_PARAGRAPH_AFTER_SELECTION_TOOL = _tool(
    "insert_paragraph_after_selection",
    "Insert one new paragraph immediately below the selected text-document paragraph selection.",
    {
        "text": {"type": "string", "description": "Text for the new paragraph to place below the selection."},
        **_FORMAT_PROPS,
    },
    ["text"],
)

_MERGE_SELECTED_PARAGRAPHS_TOOL = _tool(
    "merge_selected_paragraphs",
    "Merge the selected text-document paragraphs into one replacement paragraph.",
    {
        "revised_text": {"type": "string", "description": _REVISED_TEXT_DESCRIPTION},
        **_FORMAT_PROPS,
    },
    ["revised_text"],
)

_DELETE_PARAGRAPH_TOOL = _tool(
    "delete_paragraph",
    "Delete an existing paragraph by its 0-based paragraph index.",
    {
        "index": {"type": "integer", "description": "Paragraph index (as shown in brackets)."},
    },
    ["index"],
)

_ADD_SLIDE_TOOL = _tool(
    "add_slide",
    "Insert a new slide with a title and body text after the specified slide index.",
    {
        "after_slide_index": {
            "type": "integer",
            "description": "Insert the new slide after this 0-based slide index. Use -1 to append at the end.",
        },
        "title": {
            "type": "string",
            "description": "Title text for the new slide.",
        },
        "body": {
            "type": "string",
            "description": "Body / content text for the new slide.",
        },
    },
    ["after_slide_index", "title"],
)

_REVISE_SHAPE_TOOL = _tool(
    "revise_shape",
    "Update a slide shape's text and/or formatting (font_name, font_size, align, bold, italic, underline).",
    {
        "slide_index": {"type": "integer"},
        "shape_index": {"type": "integer"},
        "revised_text": {"type": "string", "description": _REVISED_TEXT_DESCRIPTION},
        **_FORMAT_PROPS,
    },
    ["slide_index", "shape_index", "revised_text"],
)

_ADD_TEXT_BOX_TOOL = _tool(
    "add_text_box",
    "Add a new text box with the given content to a slide. The position is chosen automatically.",
    {
        "slide_index": {"type": "integer", "description": "0-based index of the slide to add the text box to."},
        "text": {"type": "string", "description": "Text content for the new text box."},
        **{k: v for k, v in _FORMAT_PROPS.items() if k in ("font_size", "bold", "italic", "align")},
    },
    ["slide_index", "text"],
)


async def _do_revise(req, file_type, file_path, llm):

    def call_agent(user_message: str, tools: list[dict]) -> list[tuple[str, dict]]:
        return run_agent_loop(
            _SYSTEM_PROMPT,
            user_message,
            tools,
            llm.provider,
            llm.model,
            llm.base_url,
            llm.api_key,
            llm.timeout,
        )

    def text_fallback(original: str) -> str:
        """Fallback for models that can't produce tool calls: get revised text directly."""
        return run_text_revision(
            original, req.instruction,
            llm.provider, llm.model, llm.base_url, llm.api_key, llm.timeout,
            allow_markdown=file_type == "markdown",
        )

    revisions = []

    if file_type in ("docx", "markdown"):
        structure = parse_docx(file_path) if file_type == "docx" else parse_markdown(file_path)
        paragraphs = structure["paragraphs"]

        if req.scope.type == "document":
            paras_text = "\n\n".join(
                f"[{p['index']}] {p['text']}" for p in paragraphs if p["text"].strip()
            )
            prompt = (
                f"Paragraphs:\n{paras_text}\n\n"
                f"Instruction: {req.instruction}\n\n"
                "If the instruction is to revise existing text, call revise_paragraph. "
                "If it asks to add a new paragraph, call insert_paragraph. "
                "If it asks to remove a paragraph, call delete_paragraph."
            )
            calls = call_agent(prompt, [_REVISE_PARAGRAPH_TOOL, _INSERT_PARAGRAPH_TOOL, _DELETE_PARAGRAPH_TOOL])
            para_map = {p["index"]: p for p in paragraphs}
            if not calls:
                # Fallback: revise every non-empty paragraph individually
                for _p in paragraphs:
                    if not _p["text"].strip():
                        continue
                    _revised = text_fallback(_p["text"])
                    if _revised and _revised.strip() != _p["text"].strip():
                        calls.append(("revise_paragraph", {"index": _p["index"], "revised_text": _revised}))
            for name, args in calls:
                if name == "revise_paragraph":
                    idx = args["index"]
                    if idx in para_map:
                        revisions.append({
                            "scope": {"type": "paragraphs", "paragraph_indices": [idx]},
                            "original": para_map[idx]["text"],
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })
                elif name == "insert_paragraph":
                    paragraph_index = args.get("paragraph_index", -1)
                    revisions.append({
                        "scope": {"type": "insert_paragraph", "paragraph_index": paragraph_index},
                        "original": "",
                        "revised": args["text"],
                        "font_name": args.get("font_name"),
                        "font_size": args.get("font_size"),
                        "align": args.get("align"),
                        "bold": args.get("bold"),
                        "italic": args.get("italic"),
                        "underline": args.get("underline"),
                    })
                elif name == "delete_paragraph":
                    idx = args["index"]
                    if idx in para_map:
                        revisions.append({
                            "scope": {"type": "delete_paragraph", "paragraph_indices": [idx]},
                            "original": para_map[idx]["text"],
                            "revised": "",
                        })

        elif req.scope.type == "paragraphs":
            selected_indices = set(req.scope.paragraph_indices or [])
            paras_text = _para_prompt(paragraphs, selected_indices)
            para_map = {p["index"]: p for p in paragraphs if p["index"] in selected_indices}
            if len(para_map) == 1:
                idx, para = next(iter(para_map.items()))
                prompt = (
                    f"Selected paragraph:\n[target] {para['text']}\n\n"
                    f"Nearby context:\n{paras_text}\n\n"
                    f"Instruction: {req.instruction}\n\n"
                    "To change the selected paragraph text, call revise_text. "
                    "To remove the selected paragraph, call delete_paragraph with its numeric index. "
                    "To add a new paragraph near it, call insert_paragraph after that numeric index."
                )
                calls = call_agent(prompt, [_REVISE_TEXT_TOOL, _INSERT_PARAGRAPH_TOOL, _DELETE_PARAGRAPH_TOOL])
                if not calls:
                    revised = text_fallback(para["text"])
                    if revised:
                        calls = [("revise_text", {"revised_text": revised})]
                for name, args in calls:
                    if name == "revise_text":
                        revisions.append({
                            "scope": {"type": "paragraphs", "paragraph_indices": [idx]},
                            "original": para["text"],
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })
                    elif name == "insert_paragraph":
                        paragraph_index = args.get("paragraph_index", idx)
                        if paragraph_index == idx or paragraph_index == -1:
                            revisions.append({
                                "scope": {"type": "insert_paragraph", "paragraph_index": paragraph_index},
                                "original": "",
                                "revised": args["text"],
                                "font_name": args.get("font_name"),
                                "font_size": args.get("font_size"),
                                "align": args.get("align"),
                                "bold": args.get("bold"),
                                "italic": args.get("italic"),
                                "underline": args.get("underline"),
                            })
                    elif name == "delete_paragraph":
                        delete_idx = args["index"]
                        if delete_idx == idx:
                            revisions.append({
                                "scope": {"type": "delete_paragraph", "paragraph_indices": [idx]},
                                "original": para["text"],
                                "revised": "",
                            })
            else:
                insert_after_index = max(selected_indices) if selected_indices else -1
                ordered_indices = sorted(para_map)
                selected_original = "\n\n".join(para_map[idx]["text"] for idx in ordered_indices)
                prompt = (
                    f"Paragraphs:\n{paras_text}\n\n"
                    f"Instruction: {req.instruction}\n\n"
                    "Treat the numbered paragraphs together as the selected passage. "
                    "For revising multiple selected paragraphs, prefer a single revise_paragraphs_batch call with one revision item per numbered paragraph that should change. "
                    "If the user wants the selected paragraphs merged into one replacement paragraph, call merge_selected_paragraphs. "
                    f"If the user wants one combined output below the selection, call insert_paragraph_after_selection and it will be inserted after paragraph {insert_after_index}. "
                    "Only delete paragraphs that have numeric labels, never [context]. "
                    "If adding text nearby, insert a new paragraph after one of the numbered paragraphs."
                )
                calls = call_agent(
                    prompt,
                    [
                        _REVISE_PARAGRAPHS_BATCH_TOOL,
                        _MERGE_SELECTED_PARAGRAPHS_TOOL,
                        _REVISE_PARAGRAPH_TOOL,
                        _INSERT_PARAGRAPH_AFTER_SELECTION_TOOL,
                        _INSERT_PARAGRAPH_TOOL,
                        _DELETE_PARAGRAPH_TOOL,
                    ],
                )
                if not calls:
                    _merge_kw = {"merge", "combine", "join", "concatenate", "fuse", "blend", "consolidate", "unify"}
                    if any(kw in req.instruction.lower() for kw in _merge_kw):
                        # Merge intent: produce one merged paragraph
                        revised = text_fallback(selected_original)
                        if revised and ordered_indices:
                            calls = [("merge_selected_paragraphs", {"revised_text": revised})]
                    else:
                        # Revise intent: revise each selected paragraph individually
                        for _idx in ordered_indices:
                            _revised = text_fallback(para_map[_idx]["text"])
                            if _revised:
                                calls.append(("revise_paragraph", {"index": _idx, "revised_text": _revised}))
                for name, args in calls:
                    if name == "revise_paragraphs_batch":
                        for item in args.get("revisions", []):
                            idx = item.get("index")
                            if idx in para_map:
                                revisions.append({
                                    "scope": {"type": "paragraphs", "paragraph_indices": [idx]},
                                    "original": para_map[idx]["text"],
                                    "revised": item["revised_text"],
                                    "font_name": item.get("font_name"),
                                    "font_size": item.get("font_size"),
                                    "align": item.get("align"),
                                    "bold": item.get("bold"),
                                    "italic": item.get("italic"),
                                    "underline": item.get("underline"),
                                })
                    elif name == "merge_selected_paragraphs":
                        if ordered_indices:
                            revisions.append({
                                "scope": {"type": "merge_paragraphs", "paragraph_indices": ordered_indices},
                                "original": selected_original,
                                "revised": args["revised_text"],
                                "font_name": args.get("font_name"),
                                "font_size": args.get("font_size"),
                                "align": args.get("align"),
                                "bold": args.get("bold"),
                                "italic": args.get("italic"),
                                "underline": args.get("underline"),
                            })
                    elif name == "insert_paragraph_after_selection":
                        revisions.append({
                            "scope": {"type": "insert_paragraph", "paragraph_index": insert_after_index},
                            "original": "",
                            "revised": args["text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })
                    elif name == "revise_paragraph":
                        idx = args["index"]
                        if idx in para_map:
                            revisions.append({
                                "scope": {"type": "paragraphs", "paragraph_indices": [idx]},
                                "original": para_map[idx]["text"],
                                "revised": args["revised_text"],
                                "font_name": args.get("font_name"),
                                "font_size": args.get("font_size"),
                                "align": args.get("align"),
                                "bold": args.get("bold"),
                                "italic": args.get("italic"),
                                "underline": args.get("underline"),
                            })
                    elif name == "insert_paragraph":
                        paragraph_index = args.get("paragraph_index", -1)
                        if paragraph_index in selected_indices or paragraph_index == -1:
                            revisions.append({
                                "scope": {"type": "insert_paragraph", "paragraph_index": paragraph_index},
                                "original": "",
                                "revised": args["text"],
                                "font_name": args.get("font_name"),
                                "font_size": args.get("font_size"),
                                "align": args.get("align"),
                                "bold": args.get("bold"),
                                "italic": args.get("italic"),
                                "underline": args.get("underline"),
                            })
                    elif name == "delete_paragraph":
                        idx = args["index"]
                        if idx in para_map:
                            revisions.append({
                                "scope": {"type": "delete_paragraph", "paragraph_indices": [idx]},
                                "original": para_map[idx]["text"],
                                "revised": "",
                            })

        elif req.scope.type == "table_cell" and file_type == "docx":
            table_index = req.scope.table_index or 0
            row_index   = req.scope.row_index or 0
            cell_index  = req.scope.cell_index or 0
            cell_text   = get_cell_text(file_path, table_index, row_index, cell_index)
            if cell_text:
                # Include the full table as context so the LLM can see surrounding cells
                all_cells = get_table_cells(file_path, table_index)
                table_context = "\n".join(
                    f"  [context] {c['text']}" if not (c["row"] == row_index and c["col"] == cell_index)
                    else f"  [target] {c['text']}"
                    for c in all_cells if c["text"].strip()
                )
                prompt = (
                    f"Table:\n{table_context}\n\n"
                    f"Revise only the [target] cell:\n{cell_text}\n\n"
                    f"Instruction: {req.instruction}"
                )
                calls = call_agent(prompt, [_REVISE_TEXT_TOOL])
                if not calls:
                    revised = text_fallback(cell_text)
                    if revised:
                        calls = [("revise_text", {"revised_text": revised})]
                for name, args in calls:
                    if name == "revise_text":
                        revisions.append({
                            "scope": {"type": "table_cell", "table_index": table_index, "row_index": row_index, "cell_index": cell_index},
                            "original": cell_text,
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })

        elif req.scope.type == "table" and file_type == "docx":
            table_index = req.scope.table_index or 0
            cells = get_table_cells(file_path, table_index)
            cells_text = "\n".join(
                f"[{c['row']},{c['col']}] {c['text']}" for c in cells if c["text"].strip()
            )
            calls = call_agent(f"Table cells:\n{cells_text}\n\nInstruction: {req.instruction}", [_REVISE_CELL_TOOL])
            cell_map = {(c["row"], c["col"]): c for c in cells}
            for name, args in calls:
                if name == "revise_table_cell":
                    row, col = args["row_index"], args["cell_index"]
                    if (row, col) in cell_map:
                        revisions.append({
                            "scope": {
                                "type": "table_cell",
                                "table_index": table_index,
                                "row_index": row,
                                "cell_index": col,
                            },
                            "original": cell_map[(row, col)]["text"],
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })

    elif file_type == "pptx":
        structure = parse_pptx(file_path, _pptx_asset_resolver(req.file_id))
        slides = structure["slides"]

        if req.scope.type == "document":
            num_slides = len(slides)
            shapes_text = "\n\n".join(
                f"[slide={s['index']},shape={sh['index']}] {sh['text']}"
                for s in slides for sh in s["shapes"] if sh["text"].strip()
            )
            current_slide_hint = (
                f"\nUser is currently viewing slide {req.current_slide} (0-based). "
                f"When adding a text box to an existing slide, use slide_index={req.current_slide} unless the instruction clearly specifies a different slide."
                if req.current_slide is not None else ""
            )
            user_msg = (
                f"Presentation has {num_slides} slide(s) (0-based indices 0–{num_slides - 1}).\n"
                f"Existing shapes:\n{shapes_text}\n\n"
                f"Instruction: {req.instruction}\n"
                f"{current_slide_hint}\n"
                f"If the instruction is to ADD a new slide, call add_slide. "
                f"If the instruction is to ADD new text to an existing slide, call add_text_box. "
                f"If the instruction is to REVISE existing text, call revise_shape for each shape to change."
            )
            slide_w = structure.get("slide_width", 9144000)
            slide_h = structure.get("slide_height", 5143500)

            def _handle_add_text_box(args: dict) -> None:
                s_idx = args.get("slide_index", req.current_slide if req.current_slide is not None else 0)
                text  = args.get("text", "")
                # Auto-position: full width, centred vertically on the lower two-thirds
                left  = int(slide_w * 0.05)
                width = int(slide_w * 0.90)
                top   = int(slide_h * 0.55)
                height= int(slide_h * 0.30)
                revisions.append({
                    "scope": {
                        "type": "insert_text_box",
                        "slide_index": s_idx,
                        "text_box_left":   left,
                        "text_box_top":    top,
                        "text_box_width":  width,
                        "text_box_height": height,
                    },
                    "original": "",
                    "revised": text,
                    "font_size": args.get("font_size"),
                    "align":     args.get("align"),
                    "bold":      args.get("bold"),
                    "italic":    args.get("italic"),
                })

            calls = call_agent(user_msg, [_REVISE_SHAPE_TOOL, _ADD_SLIDE_TOOL, _ADD_TEXT_BOX_TOOL])
            shape_map = {(s["index"], sh["index"]): sh for s in slides for sh in s["shapes"]}
            for name, args in calls:
                if name == "revise_shape":
                    key = (args["slide_index"], args["shape_index"])
                    if key in shape_map:
                        revisions.append({
                            "scope": {"type": "shape", "slide_index": key[0], "shape_indices": [key[1]]},
                            "original": shape_map[key]["text"],
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })
                elif name == "add_slide":
                    after_idx = args.get("after_slide_index", -1)
                    if after_idx < 0:
                        after_idx = num_slides - 1
                    revisions.append({
                        "scope": {
                            "type": "insert_slide",
                            "slide_index": after_idx,
                            "slide_title": args.get("title", ""),
                            "slide_body": args.get("body", ""),
                        },
                        "original": "",
                        "revised": "",
                    })
                elif name == "add_text_box":
                    _handle_add_text_box(args)

        elif req.scope.type in ("slide", "shape"):
            slide_idx = req.scope.slide_index
            slide = next((s for s in slides if s["index"] == slide_idx), None)
            if not slide:
                raise HTTPException(404, f"Slide {slide_idx} not found.")

            if req.scope.type == "shape" and req.scope.shape_indices:
                selected_shapes = [sh for sh in slide["shapes"] if sh["index"] in req.scope.shape_indices]
            else:
                selected_shapes = slide["shapes"]

            selected_set = {sh["index"] for sh in selected_shapes}

            num_slides = len(slides)
            slide_w = structure.get("slide_width", 9144000)
            slide_h = structure.get("slide_height", 5143500)

            def _handle_add_slide(args: dict) -> None:
                after_idx = args.get("after_slide_index", -1)
                if after_idx < 0:
                    after_idx = num_slides - 1
                revisions.append({
                    "scope": {
                        "type": "insert_slide",
                        "slide_index": after_idx,
                        "slide_title": args.get("title", ""),
                        "slide_body": args.get("body", ""),
                    },
                    "original": "",
                    "revised": "",
                })

            def _handle_add_text_box_on_slide(args: dict) -> None:
                s_idx = slide_idx  # always use the current slide, ignore LLM's slide_index
                text  = args.get("text", "")
                left  = int(slide_w * 0.05)
                width = int(slide_w * 0.90)
                top   = int(slide_h * 0.55)
                height= int(slide_h * 0.30)
                revisions.append({
                    "scope": {
                        "type": "insert_text_box",
                        "slide_index": s_idx,
                        "text_box_left":   left,
                        "text_box_top":    top,
                        "text_box_width":  width,
                        "text_box_height": height,
                    },
                    "original": "",
                    "revised": text,
                    "font_size": args.get("font_size"),
                    "align":     args.get("align"),
                    "bold":      args.get("bold"),
                    "italic":    args.get("italic"),
                })

            _edit_hint = (
                "\n\nIf the instruction is to ADD a new slide, call add_slide. "
                "If the instruction is to ADD new text to the current slide, call add_text_box. "
                "If the instruction is to REVISE existing text, call the revision tool."
            )

            if len(selected_shapes) == 1:
                sh = selected_shapes[0]
                shapes_text = _shape_prompt(slide["shapes"], selected_set)
                calls = call_agent(f"Shapes:\n{shapes_text}\n\nInstruction: {req.instruction}{_edit_hint}", [_REVISE_TEXT_TOOL, _ADD_SLIDE_TOOL, _ADD_TEXT_BOX_TOOL])
                if not calls:
                    revised = text_fallback(sh["text"])
                    if revised:
                        calls = [("revise_text", {"revised_text": revised})]
                for name, args in calls:
                    if name == "revise_text":
                        revisions.append({
                            "scope": {"type": "shape", "slide_index": slide_idx, "shape_indices": [sh["index"]]},
                            "original": sh["text"],
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })
                    elif name == "add_slide":
                        _handle_add_slide(args)
                    elif name == "add_text_box":
                        _handle_add_text_box_on_slide(args)
            else:
                shapes_text = _shape_prompt(slide["shapes"], selected_set)
                calls = call_agent(f"Shapes:\n{shapes_text}\n\nInstruction: {req.instruction}{_edit_hint}", [_REVISE_SHAPE_TOOL, _ADD_SLIDE_TOOL, _ADD_TEXT_BOX_TOOL])
                shape_map = {sh["index"]: sh for sh in selected_shapes}
                for name, args in calls:
                    if name == "revise_shape":
                        idx = args["shape_index"]
                        if idx in shape_map:
                            revisions.append({
                                "scope": {"type": "shape", "slide_index": slide_idx, "shape_indices": [idx]},
                            "original": shape_map[idx]["text"],
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                            })
                    elif name == "add_slide":
                        _handle_add_slide(args)
                    elif name == "add_text_box":
                        _handle_add_text_box_on_slide(args)

        elif req.scope.type == "table_cell":
            slide_idx = req.scope.slide_index
            table_index = req.scope.table_index or 0
            row_index = req.scope.row_index or 0
            cell_index = req.scope.cell_index or 0
            if slide_idx is None:
                raise HTTPException(400, "slide_index is required for PPTX table cell revisions.")

            cell_text = get_pptx_cell_text(file_path, slide_idx, table_index, row_index, cell_index)
            if cell_text is None:
                raise HTTPException(404, "PPTX table cell not found.")

            all_cells = get_pptx_table_cells(file_path, slide_idx, table_index)
            table_context = "\n".join(
                f"  [context] {c['text']}" if not (c["row"] == row_index and c["col"] == cell_index)
                else f"  [target] {c['text']}"
                for c in all_cells if c["text"].strip()
            )
            prompt = (
                f"Table:\n{table_context}\n\n"
                f"Revise only the [target] cell:\n{cell_text}\n\n"
                f"Instruction: {req.instruction}"
            )
            calls = call_agent(prompt, [_REVISE_TEXT_TOOL])
            if not calls:
                revised = text_fallback(cell_text)
                if revised:
                    calls = [("revise_text", {"revised_text": revised})]
            for name, args in calls:
                if name == "revise_text":
                    revisions.append({
                        "scope": {
                            "type": "table_cell",
                            "slide_index": slide_idx,
                            "table_index": table_index,
                            "row_index": row_index,
                            "cell_index": cell_index,
                        },
                        "original": cell_text,
                        "revised": args["revised_text"],
                        "font_name": args.get("font_name"),
                        "font_size": args.get("font_size"),
                        "align": args.get("align"),
                        "bold": args.get("bold"),
                        "italic": args.get("italic"),
                        "underline": args.get("underline"),
                    })

        elif req.scope.type == "table":
            slide_idx = req.scope.slide_index
            table_index = req.scope.table_index or 0
            if slide_idx is None:
                raise HTTPException(400, "slide_index is required for PPTX table revisions.")

            cells = get_pptx_table_cells(file_path, slide_idx, table_index)
            if not cells:
                raise HTTPException(404, "PPTX table not found.")

            cells_text = "\n".join(
                f"[{c['row']},{c['col']}] {c['text']}" for c in cells if c["text"].strip()
            )
            calls = call_agent(f"Table cells:\n{cells_text}\n\nInstruction: {req.instruction}", [_REVISE_CELL_TOOL])
            cell_map = {(c["row"], c["col"]): c for c in cells}
            for name, args in calls:
                if name == "revise_table_cell":
                    row, col = args["row_index"], args["cell_index"]
                    if (row, col) in cell_map:
                        revisions.append({
                            "scope": {
                                "type": "table_cell",
                                "slide_index": slide_idx,
                                "table_index": table_index,
                                "row_index": row,
                                "cell_index": col,
                            },
                            "original": cell_map[(row, col)]["text"],
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "align": args.get("align"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })

    return {"revisions": revisions}


@app.post("/api/apply")
async def apply(req: ApplyRequest):
    info = _get_file(req.file_id)
    file_type = info["type"]
    file_path = _ensure_local_file(req.file_id)
    rev_dicts = [r.model_dump() for r in req.revisions]

    _push_snapshot(req.file_id)

    if file_type == "docx":
        apply_docx_revisions(file_path, file_path, rev_dicts)
    elif file_type == "markdown":
        apply_markdown_revisions(file_path, file_path, rev_dicts)
    else:
        apply_pptx_revisions(file_path, file_path, rev_dicts)

    _sync_file_to_remote(req.file_id)
    _invalidate_slide_cache(req.file_id)
    _save_registry()
    logger.info(
        "revisions applied file_id=%s file_type=%s count=%d",
        req.file_id,
        file_type,
        len(rev_dicts),
    )
    return _build_response(req.file_id)


@app.post("/api/undo/{file_id}")
async def undo(file_id: str):
    info = _get_file(file_id)
    _ensure_local_file(file_id)
    stack = _undo_stacks.get(file_id, [])
    if not stack:
        raise HTTPException(400, "Nothing to undo.")
    # Push current file onto redo stack
    redo_snap = str(FILES_DIR / f"{file_id}.redo.{uuid.uuid4().hex[:8]}")
    shutil.copy2(info["path"], redo_snap)
    _redo_stacks.setdefault(file_id, []).append(redo_snap)
    # Restore previous snapshot
    snap = stack.pop()
    shutil.copy2(snap, info["path"])
    Path(snap).unlink(missing_ok=True)
    _sync_file_to_remote(file_id)
    _invalidate_slide_cache(file_id)
    _save_registry()
    logger.info("undo completed file_id=%s file_type=%s", file_id, info["type"])
    return _build_response(file_id)


@app.post("/api/redo/{file_id}")
async def redo(file_id: str):
    info = _get_file(file_id)
    _ensure_local_file(file_id)
    stack = _redo_stacks.get(file_id, [])
    if not stack:
        raise HTTPException(400, "Nothing to redo.")
    # Push current file onto undo stack
    undo_snap = str(FILES_DIR / f"{file_id}.snap.{uuid.uuid4().hex[:8]}")
    shutil.copy2(info["path"], undo_snap)
    _undo_stacks.setdefault(file_id, []).append(undo_snap)
    # Restore redo snapshot
    snap = stack.pop()
    shutil.copy2(snap, info["path"])
    Path(snap).unlink(missing_ok=True)
    _sync_file_to_remote(file_id)
    _invalidate_slide_cache(file_id)
    _save_registry()
    logger.info("redo completed file_id=%s file_type=%s", file_id, info["type"])
    return _build_response(file_id)


@app.get("/api/download/{file_id}")
async def download(file_id: str):
    info = _get_file(file_id)
    _sync_file_to_remote(file_id)
    logger.info("download requested file_id=%s file_type=%s", file_id, info["type"])
    return FileResponse(
        _ensure_local_file(file_id),
        filename=f"revised_{info['name']}",
        media_type="application/octet-stream",
    )


@app.get("/api/files/{file_id}")
async def get_file(file_id: str):
    _get_file(file_id)
    return _build_response(file_id)


@app.get("/api/files/{file_id}/slides/{slide_idx}/image")
async def get_slide_image(file_id: str, slide_idx: int):
    """Return a LibreOffice-rendered PNG for the given slide (cached by file mtime)."""
    info = _get_file(file_id)
    if info["type"] != "pptx":
        raise HTTPException(400, "Slide images are only available for PPTX files.")
    if not slide_renderer.backend_name():
        raise HTTPException(503, "Slide renderer is not available.")
    file_path = _ensure_local_file(file_id)

    # Cache lives in a sub-dir keyed by the file's mtime so stale renders are
    # never served after an edit.
    try:
        mtime_ns = str(int(Path(file_path).stat().st_mtime_ns))
    except Exception:
        mtime_ns = "0"
    cache_dir = _slide_cache_dir(file_id) / mtime_ns

    png_path = slide_renderer.get_or_render(file_path, slide_idx, cache_dir)
    if png_path is None or not png_path.exists():
        logger.warning(
            "slide image render failed file_id=%s slide_idx=%s backend=%s",
            file_id,
            slide_idx,
            slide_renderer.backend_name(),
        )
        raise HTTPException(404, "Slide image could not be rendered.")

    return FileResponse(
        png_path,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/api/files/{file_id}/assets/{asset_name}")
async def get_file_asset(file_id: str, asset_name: str):
    _get_file(file_id)
    asset_root = (ASSETS_DIR / file_id).resolve()
    asset_path = (asset_root / asset_name).resolve()
    if asset_root not in asset_path.parents:
        raise HTTPException(404, "Asset not found.")
    if not asset_path.exists() or not asset_path.is_file():
        raise HTTPException(404, "Asset not found.")
    return FileResponse(
        asset_path,
        media_type=mimetypes.guess_type(asset_path.name)[0] or "application/octet-stream",
    )


@app.post("/api/files/{file_id}/branch")
async def branch_file(file_id: str):
    info = _get_file(file_id)
    new_id   = str(uuid.uuid4())
    new_path = FILES_DIR / f"{new_id}{Path(info['path']).suffix}"
    shutil.copy2(_ensure_local_file(file_id), new_path)
    file_info = {"path": str(new_path), "type": info["type"], "name": info["name"]}
    if _storage_backend == "s3":
        storage = _require_storage()
        s3_key = storage.build_key(new_id, info["name"])
        storage.upload_file(new_path, s3_key)
        file_info["s3_key"] = s3_key
    _files[new_id] = file_info
    _save_registry()
    logger.info("branch created source_file_id=%s new_file_id=%s file_type=%s", file_id, new_id, info["type"])
    return _build_response(new_id)


@app.delete("/api/files/{file_id}")
async def delete_file(file_id: str):
    deleted_type = None
    if file_id in _files:
        info = _files[file_id]
        deleted_type = info["type"]
        Path(info["path"]).unlink(missing_ok=True)
        s3_key = info.get("s3_key")
        if _storage_backend == "s3" and s3_key and not isinstance(_storage, StorageConfigError):
            _storage.delete_file(s3_key)
        del _files[file_id]
    for p in _undo_stacks.pop(file_id, []):
        Path(p).unlink(missing_ok=True)
    for p in _redo_stacks.pop(file_id, []):
        Path(p).unlink(missing_ok=True)
    shutil.rmtree(ASSETS_DIR / file_id, ignore_errors=True)
    _invalidate_slide_cache(file_id)
    _save_registry()
    logger.info("file deleted file_id=%s file_type=%s", file_id, deleted_type or "unknown")
    return {"ok": True}


class ChatMessage(BaseModel):
    role: str   # 'user' | 'assistant'
    content: str


class ChatRequest(BaseModel):
    file_id: str
    messages: list[ChatMessage]
    llm: LLMConfig
    scope: Optional[RevisionScope] = None
    preferred_language: Optional[str] = None


_CHAT_SYSTEM_PROMPT = (
    "You are a helpful assistant that answers questions about the document provided below. "
    "Answer clearly and concisely. You may quote relevant passages when helpful. "
    "Do not make up content that is not in the document."
)


def _chat_language_instruction(code: Optional[str]) -> str:
    if code == "zh":
        return "Respond in Simplified Chinese unless the user explicitly asks for another language."
    if code == "ko":
        return "Respond in Korean unless the user explicitly asks for another language."
    if code == "en":
        return "Respond in English unless the user explicitly asks for another language."
    return ""


def _extract_selected_text(
    file_type: str,
    file_path: str,
    scope: RevisionScope,
    file_id: Optional[str] = None,
) -> Optional[str]:
    """Return the plain text of the selection, or None if the scope covers the whole document."""
    if scope.type == "document":
        return None

    if file_type in ("docx", "markdown"):
        structure = parse_docx(file_path) if file_type == "docx" else parse_markdown(file_path)
        paragraphs = structure["paragraphs"]
        if scope.type == "paragraphs" and scope.paragraph_indices:
            idx_set = set(scope.paragraph_indices)
            lines = [p["text"] for p in paragraphs if p["index"] in idx_set and p["text"].strip()]
            return "\n\n".join(lines) or None
        if file_type == "docx" and scope.type in ("table_cell", "table"):
            table_index = scope.table_index or 0
            if scope.type == "table_cell":
                return get_cell_text(file_path, table_index, scope.row_index or 0, scope.cell_index or 0) or None
            cells = get_table_cells(file_path, table_index)
            return "\n".join(c["text"] for c in cells if c["text"].strip()) or None

    elif file_type == "pptx":
        structure = parse_pptx(file_path, _pptx_asset_resolver(file_id) if file_id else None)
        slides = structure["slides"]
        if scope.type in ("shape", "table", "table_cell"):
            slide_idx = scope.slide_index
            slide = next((s for s in slides if s["index"] == slide_idx), None)
            if not slide:
                return None
            if scope.type == "shape" and scope.shape_indices:
                idx_set = set(scope.shape_indices)
                lines = [sh["text"] for sh in slide["shapes"] if sh["index"] in idx_set and sh["text"].strip()]
                return "\n\n".join(lines) or None
            if scope.type == "table":
                table_index = scope.table_index or 0
                cells = get_pptx_table_cells(file_path, slide_idx or 0, table_index)
                return "\n".join(c["text"] for c in cells if c["text"].strip()) or None
            if scope.type == "table_cell":
                return get_pptx_cell_text(
                    file_path,
                    slide_idx or 0,
                    scope.table_index or 0,
                    scope.row_index or 0,
                    scope.cell_index or 0,
                ) or None

    return None


@app.post("/api/chat")
async def chat(req: ChatRequest):
    info = _get_file(req.file_id)
    file_type = info["type"]
    file_path = _ensure_local_file(req.file_id)

    # Extract full document text as context
    if file_type in ("docx", "markdown"):
        structure = parse_docx(file_path) if file_type == "docx" else parse_markdown(file_path)
        doc_text = "\n\n".join(
            p["text"] for p in structure["paragraphs"] if p["text"].strip()
        )
    else:
        structure = parse_pptx(file_path, _pptx_asset_resolver(req.file_id))
        lines = []
        for slide in structure["slides"]:
            slide_texts = [sh["text"] for sh in slide["shapes"] if sh["text"].strip()]
            if slide_texts:
                lines.append(f"[Slide {slide['index'] + 1}]\n" + "\n".join(slide_texts))
        doc_text = "\n\n".join(lines)

    # Build system prompt — append selected passage when a scope is provided
    system_prompt = f"{_CHAT_SYSTEM_PROMPT}\n\nDocument content:\n\"\"\"\n{doc_text}\n\"\"\""
    language_instruction = _chat_language_instruction(req.preferred_language)
    if language_instruction:
        system_prompt = f"{system_prompt}\n\n{language_instruction}"
    if req.scope:
        selected_text = _extract_selected_text(file_type, file_path, req.scope, req.file_id)
        if selected_text:
            system_prompt += (
                "\n\nThe user has selected the following passage from the document. "
                "Focus your answer on this passage unless the question clearly refers to something else:\n"
                f"\"\"\"\n{selected_text}\n\"\"\""
            )

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    llm = req.llm
    request_id = get_request_id()
    logger.info(
        "chat started file_id=%s file_type=%s messages=%d provider=%s model=%s preferred_language=%s",
        req.file_id,
        file_type,
        len(messages),
        llm.provider,
        llm.model,
        req.preferred_language or "default",
    )

    def generate():
        token = set_request_id(request_id)
        try:
            for chunk in stream_chat(
                system_prompt,
                messages,
                llm.provider,
                llm.model,
                llm.base_url,
                llm.api_key,
                llm.timeout,
            ):
                yield f"data: {json.dumps(chunk)}\n\n"
        except TimeoutError as e:
            logger.warning(
                "chat timed out file_id=%s provider=%s model=%s timeout=%s",
                req.file_id,
                llm.provider,
                llm.model,
                llm.timeout,
            )
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        except Exception as e:
            logger.exception(
                "chat failed file_id=%s provider=%s model=%s",
                req.file_id,
                llm.provider,
                llm.model,
            )
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            reset_request_id(token)
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- Internal ----------

def _build_response(file_id: str) -> dict:
    info = _files[file_id]
    file_type = info["type"]
    file_path = _ensure_local_file(file_id)

    # Use file mtime as a cache-busting version for slide images.
    try:
        slide_render_version = str(int(Path(file_path).stat().st_mtime_ns))
    except Exception:
        slide_render_version = "0"

    base = {
        "file_id": file_id,
        "name": info["name"],
        "can_undo": len(_undo_stacks.get(file_id, [])) > 0,
        "can_redo": len(_redo_stacks.get(file_id, [])) > 0,
        "slide_render_version": slide_render_version,
        "slide_renderer_available": slide_renderer.is_available(),
        "slide_render_backend": slide_renderer.backend_name(),
    }

    if file_type == "docx":
        return {**base, "file_type": "docx", "structure": parse_docx(file_path), "html": get_docx_html(file_path)}
    if file_type == "markdown":
        return {
            **base,
            "file_type": "markdown",
            "structure": parse_markdown(file_path),
        }
    else:
        return {
            **base,
            "file_type": "pptx",
            "structure": parse_pptx(file_path, _pptx_asset_resolver(file_id)),
        }


# ── Serve the built frontend (SPA) ──────────────────────────────────────────
# This must come last so it doesn't shadow any /api/* routes above.
# Build the frontend first: cd frontend && npm run build
_FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
