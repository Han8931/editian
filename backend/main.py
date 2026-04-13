import uuid
import json
import shutil
from pathlib import Path
import os

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import Optional

from parsers.docx_parser import parse_docx, get_docx_html, get_cell_text, get_table_cells
from parsers.pptx_parser import parse_pptx
from writers.docx_writer import apply_docx_revisions
from writers.pptx_writer import apply_pptx_revisions
from llm import run_agent_loop
from storage import S3DocumentStorage, StorageConfigError

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
REGISTRY_FILE = FILES_DIR.parent / "registry.json"

load_dotenv(Path(__file__).with_name(".env"))
_storage_backend = os.getenv("STORAGE_BACKEND", "local").strip().lower()
try:
    _storage: S3DocumentStorage | StorageConfigError = S3DocumentStorage.from_env()
except StorageConfigError as exc:
    _storage = exc

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
        pass  # corrupt registry — start fresh


_load_registry()


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
    storage.upload_file(local_path, s3_key)


# ---------- Models ----------

class LLMConfig(BaseModel):
    provider: str = "ollama"
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: str = "llama3.2"
    timeout: float = 120


class RevisionScope(BaseModel):
    type: str  # document | paragraphs | slide | shape | table_cell
    paragraph_indices: Optional[list[int]] = None
    slide_index: Optional[int] = None
    shape_indices: Optional[list[int]] = None
    table_index: Optional[int] = None
    row_index: Optional[int] = None
    cell_index: Optional[int] = None


class ReviseRequest(BaseModel):
    file_id: str
    scope: RevisionScope
    instruction: str
    llm: LLMConfig


class ApplyRevision(BaseModel):
    scope: RevisionScope
    original: str
    revised: str
    font_name: Optional[str] = None
    font_size: Optional[float] = None
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    underline: Optional[bool] = None
    strike: Optional[bool] = None


class ApplyRequest(BaseModel):
    file_id: str
    revisions: list[ApplyRevision]


# ---------- Helpers ----------

def _get_file(file_id: str) -> dict:
    if file_id not in _files:
        raise HTTPException(404, "File not found. Please re-upload.")
    return _files[file_id]


# ---------- Routes ----------

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in (".docx", ".pptx"):
        raise HTTPException(400, "Only .docx and .pptx files are supported.")

    file_id = str(uuid.uuid4())
    file_path = FILES_DIR / f"{file_id}{ext}"
    file_path.write_bytes(await file.read())
    file_info = {"path": str(file_path), "type": ext[1:], "name": file.filename}
    if _storage_backend == "s3":
        storage = _require_storage()
        s3_key = storage.build_key(file_id, file.filename)
        storage.upload_file(file_path, s3_key)
        file_path.unlink(missing_ok=True)
        storage.download_file(s3_key, file_path)
        file_info["s3_key"] = s3_key

    _files[file_id] = file_info
    _save_registry()
    return _build_response(file_id)


@app.post("/api/revise")
async def revise(req: ReviseRequest):
    info = _get_file(req.file_id)
    file_type = info["type"]
    file_path = _ensure_local_file(req.file_id)
    llm = req.llm
    try:
        return await _do_revise(req, file_type, file_path, llm)
    except TimeoutError as e:
        raise HTTPException(408, str(e))


_SYSTEM_PROMPT = (
    "You are a document editor. Apply the user's instruction to the provided content. "
    "Items labeled [context] are surrounding content provided for tone and style reference only — "
    "do NOT revise them. Only revise items with a numeric label (e.g. [3], [shape=2]). "
    "You MUST call the tool — even if only formatting changes are needed and the text itself stays the same. "
    "For formatting-only changes (font, size, bold, italic, underline), call the tool with the original text "
    "unchanged in revised_text and set the relevant formatting parameters. "
    "revised_text must be plain text only — never include HTML, XML, or any markup. "
    "Do not add explanations."
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
_BOLD_PROP       = {"type": "boolean", "description": "Set to true/false to enable/disable bold. Omit if not changing."}
_ITALIC_PROP     = {"type": "boolean", "description": "Set to true/false to enable/disable italic. Omit if not changing."}
_UNDERLINE_PROP  = {"type": "boolean", "description": "Set to true/false to enable/disable underline. Omit if not changing."}

_FORMAT_PROPS = {
    "font_name": _FONT_NAME_PROP,
    "font_size": _FONT_SIZE_PROP,
    "bold":      _BOLD_PROP,
    "italic":    _ITALIC_PROP,
    "underline": _UNDERLINE_PROP,
}

_REVISE_TEXT_TOOL = _tool(
    "revise_text",
    "Provide the revised text and any formatting changes (font_name, font_size, bold, italic, underline).",
    {"revised_text": {"type": "string", "description": "The revised plain text (no HTML or markup)"}, **_FORMAT_PROPS},
    ["revised_text"],
)

_REVISE_PARAGRAPH_TOOL = _tool(
    "revise_paragraph",
    "Update a paragraph's text and/or formatting (font_name, font_size, bold, italic, underline).",
    {
        "index": {"type": "integer", "description": "Paragraph index (as shown in brackets)"},
        "revised_text": {"type": "string", "description": "The revised plain text (no HTML or markup)"},
        **_FORMAT_PROPS,
    },
    ["index", "revised_text"],
)

_REVISE_CELL_TOOL = _tool(
    "revise_table_cell",
    "Update a table cell's text and/or formatting (font_name, font_size, bold, italic, underline).",
    {
        "row_index": {"type": "integer"},
        "cell_index": {"type": "integer"},
        "revised_text": {"type": "string", "description": "The revised plain text (no HTML or markup)"},
        **_FORMAT_PROPS,
    },
    ["row_index", "cell_index", "revised_text"],
)

_REVISE_SHAPE_TOOL = _tool(
    "revise_shape",
    "Update a slide shape's text and/or formatting (font_name, font_size, bold, italic, underline).",
    {
        "slide_index": {"type": "integer"},
        "shape_index": {"type": "integer"},
        "revised_text": {"type": "string", "description": "The revised plain text (no HTML or markup)"},
        **_FORMAT_PROPS,
    },
    ["slide_index", "shape_index", "revised_text"],
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

    revisions = []

    if file_type == "docx":
        structure = parse_docx(file_path)
        paragraphs = structure["paragraphs"]

        if req.scope.type == "document":
            paras_text = "\n\n".join(
                f"[{p['index']}] {p['text']}" for p in paragraphs if p["text"].strip()
            )
            calls = call_agent(f"Paragraphs:\n{paras_text}\n\nInstruction: {req.instruction}", [_REVISE_PARAGRAPH_TOOL])
            para_map = {p["index"]: p for p in paragraphs}
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
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })

        elif req.scope.type == "paragraphs":
            selected_indices = set(req.scope.paragraph_indices or [])
            paras_text = _para_prompt(paragraphs, selected_indices)
            calls = call_agent(f"Paragraphs:\n{paras_text}\n\nInstruction: {req.instruction}", [_REVISE_PARAGRAPH_TOOL])
            para_map = {p["index"]: p for p in paragraphs if p["index"] in selected_indices}
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
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })

        elif req.scope.type == "table_cell":
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
                for name, args in calls:
                    if name == "revise_text":
                        revisions.append({
                            "scope": {"type": "table_cell", "table_index": table_index, "row_index": row_index, "cell_index": cell_index},
                            "original": cell_text,
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })

        elif req.scope.type == "table":
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
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })

    elif file_type == "pptx":
        structure = parse_pptx(file_path)
        slides = structure["slides"]

        if req.scope.type == "document":
            shapes_text = "\n\n".join(
                f"[slide={s['index']},shape={sh['index']}] {sh['text']}"
                for s in slides for sh in s["shapes"] if sh["text"].strip()
            )
            calls = call_agent(f"Shapes:\n{shapes_text}\n\nInstruction: {req.instruction}", [_REVISE_SHAPE_TOOL])
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
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })

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

            if len(selected_shapes) == 1:
                sh = selected_shapes[0]
                # Include all other shapes on the slide as context
                shapes_text = _shape_prompt(slide["shapes"], selected_set)
                calls = call_agent(f"Shapes:\n{shapes_text}\n\nInstruction: {req.instruction}", [_REVISE_TEXT_TOOL])
                for name, args in calls:
                    if name == "revise_text":
                        revisions.append({
                            "scope": {"type": "shape", "slide_index": slide_idx, "shape_indices": [sh["index"]]},
                            "original": sh["text"],
                            "revised": args["revised_text"],
                            "font_name": args.get("font_name"),
                            "font_size": args.get("font_size"),
                            "bold": args.get("bold"),
                            "italic": args.get("italic"),
                            "underline": args.get("underline"),
                        })
            else:
                # Include unselected shapes on the slide as context
                shapes_text = _shape_prompt(slide["shapes"], selected_set)
                calls = call_agent(f"Shapes:\n{shapes_text}\n\nInstruction: {req.instruction}", [_REVISE_SHAPE_TOOL])
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
    else:
        apply_pptx_revisions(file_path, file_path, rev_dicts)

    _sync_file_to_remote(req.file_id)
    _save_registry()
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
    _save_registry()
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
    _save_registry()
    return _build_response(file_id)


@app.get("/api/download/{file_id}")
async def download(file_id: str):
    info = _get_file(file_id)
    _sync_file_to_remote(file_id)
    return FileResponse(
        _ensure_local_file(file_id),
        filename=f"revised_{info['name']}",
        media_type="application/octet-stream",
    )


@app.get("/api/files/{file_id}")
async def get_file(file_id: str):
    _get_file(file_id)
    return _build_response(file_id)


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
    return _build_response(new_id)


@app.delete("/api/files/{file_id}")
async def delete_file(file_id: str):
    if file_id in _files:
        info = _files[file_id]
        Path(info["path"]).unlink(missing_ok=True)
        s3_key = info.get("s3_key")
        if _storage_backend == "s3" and s3_key and not isinstance(_storage, StorageConfigError):
            _storage.delete_file(s3_key)
        del _files[file_id]
    for p in _undo_stacks.pop(file_id, []):
        Path(p).unlink(missing_ok=True)
    for p in _redo_stacks.pop(file_id, []):
        Path(p).unlink(missing_ok=True)
    _save_registry()
    return {"ok": True}


# ---------- Internal ----------

def _build_response(file_id: str) -> dict:
    info = _files[file_id]
    file_type = info["type"]
    file_path = _ensure_local_file(file_id)

    base = {
        "file_id": file_id,
        "name": info["name"],
        "can_undo": len(_undo_stacks.get(file_id, [])) > 0,
        "can_redo": len(_redo_stacks.get(file_id, [])) > 0,
    }

    if file_type == "docx":
        return {**base, "file_type": "docx", "structure": parse_docx(file_path), "html": get_docx_html(file_path)}
    else:
        return {**base, "file_type": "pptx", "structure": parse_pptx(file_path)}
