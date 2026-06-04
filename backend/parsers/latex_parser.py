from typing import Any

from latex_utils import parse_latex_blocks, read_latex_text


def parse_latex(file_path: str) -> dict[str, Any]:
    blocks = parse_latex_blocks(read_latex_text(file_path))
    paragraphs = [
        {
            "index": block.index,
            "text": block.text,
            "style": block.style,
        }
        for block in blocks
    ]
    return {"paragraphs": paragraphs, "total": len(paragraphs)}
