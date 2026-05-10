from typing import Any

from markdown_utils import parse_markdown_blocks, read_markdown_text


def parse_markdown(file_path: str) -> dict[str, Any]:
    blocks = parse_markdown_blocks(read_markdown_text(file_path))
    paragraphs = [
        {
            "index": block.index,
            "text": block.text,
            "style": block.style,
        }
        for block in blocks
    ]
    return {"paragraphs": paragraphs, "total": len(paragraphs)}
