import shutil
from typing import Any

from markdown_utils import detect_newline, read_markdown_text, serialize_markdown_blocks, split_markdown_blocks


def apply_markdown_revisions(
    input_path: str,
    output_path: str,
    revisions: list[dict[str, Any]],
) -> None:
    if input_path != output_path:
        shutil.copy2(input_path, output_path)

    original_text = read_markdown_text(output_path)
    newline = detect_newline(original_text)
    trailing_newline = original_text.endswith(("\n", "\r"))
    blocks = split_markdown_blocks(original_text)
    structural_ops: list[dict[str, int]] = []

    def _normalize_block(text: str) -> str:
        return text.strip("\n")

    def _current_index_for_original(original_index: int) -> int | None:
        current_index = original_index
        for op in structural_ops:
            if op["type"] == "delete_paragraph":
                deleted_index = op["index"]
                if deleted_index == original_index:
                    return None
                if deleted_index < original_index:
                    current_index -= 1
            elif op["type"] == "insert_paragraph":
                after_index = op["after_index"]
                if after_index < original_index:
                    current_index += 1
        return current_index

    def _current_insertion_anchor(after_original_index: int) -> int:
        if after_original_index < 0:
            return len(blocks) - 1

        current_index = after_original_index
        for op in structural_ops:
            if op["type"] == "delete_paragraph":
                if op["index"] <= after_original_index:
                    current_index -= 1
            elif op["type"] == "insert_paragraph":
                if op["after_index"] <= after_original_index:
                    current_index += 1
        return current_index

    for revision in revisions:
        scope = revision["scope"]
        revised_text = _normalize_block(revision.get("revised", ""))
        scope_type = scope["type"]

        if scope_type == "document":
            blocks = split_markdown_blocks(revised_text)

        elif scope_type == "paragraphs":
            for idx in (scope.get("paragraph_indices") or []):
                current_idx = _current_index_for_original(idx)
                if current_idx is not None and 0 <= current_idx < len(blocks):
                    blocks[current_idx] = revised_text

        elif scope_type == "insert_paragraph":
            paragraph_index = scope.get("paragraph_index", -1)
            insert_at = _current_insertion_anchor(paragraph_index) + 1
            insert_at = max(0, min(insert_at, len(blocks)))
            blocks.insert(insert_at, revised_text)
            structural_ops.append({"type": "insert_paragraph", "after_index": paragraph_index})

        elif scope_type == "delete_paragraph":
            delete_indices = sorted(scope.get("paragraph_indices") or [], reverse=True)
            for idx in delete_indices:
                current_idx = _current_index_for_original(idx)
                if current_idx is None or not (0 <= current_idx < len(blocks)):
                    continue
                blocks.pop(current_idx)
                structural_ops.append({"type": "delete_paragraph", "index": idx})

        elif scope_type == "merge_paragraphs":
            merge_indices = sorted(scope.get("paragraph_indices") or [])
            if not merge_indices:
                continue

            target_idx = _current_index_for_original(merge_indices[0])
            if target_idx is None or not (0 <= target_idx < len(blocks)):
                continue

            blocks[target_idx] = revised_text
            for idx in merge_indices[1:]:
                current_idx = _current_index_for_original(idx)
                if current_idx is None or not (0 <= current_idx < len(blocks)):
                    continue
                blocks.pop(current_idx)
                structural_ops.append({"type": "delete_paragraph", "index": idx})

    rendered = serialize_markdown_blocks(blocks, newline=newline, trailing_newline=trailing_newline)
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        f.write(rendered)
