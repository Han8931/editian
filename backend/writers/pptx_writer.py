import shutil
from typing import Any
from pptx import Presentation
from pptx.util import Pt


def apply_pptx_revisions(
    input_path: str,
    output_path: str,
    revisions: list[dict[str, Any]],
) -> None:
    if input_path != output_path:
        shutil.copy2(input_path, output_path)

    prs = Presentation(output_path)

    for revision in revisions:
        scope = revision["scope"]
        revised_text: str = revision["revised"]

        font_name: str | None  = revision.get("font_name")
        font_size: float | None = revision.get("font_size")
        bold: bool | None      = revision.get("bold")
        italic: bool | None    = revision.get("italic")
        underline: bool | None = revision.get("underline")
        strike: bool | None    = revision.get("strike")

        if scope["type"] == "shape":
            slide_idx = scope.get("slide_index")
            shape_indices = scope.get("shape_indices") or []
            if slide_idx is not None and slide_idx < len(prs.slides):
                slide = prs.slides[slide_idx]
                for shape_idx in shape_indices:
                    if shape_idx < len(slide.shapes):
                        s = slide.shapes[shape_idx]
                        if s.has_text_frame:
                            _set_shape_text(s, revised_text, font_name, font_size, bold, italic, underline, strike)

        elif scope["type"] == "slide":
            slide_idx = scope.get("slide_index")
            if slide_idx is not None and slide_idx < len(prs.slides):
                slide = prs.slides[slide_idx]
                text_shapes = [s for s in slide.shapes if s.has_text_frame]
                revised_parts = revised_text.split("\n\n")
                for i, shape in enumerate(text_shapes):
                    _set_shape_text(shape, revised_parts[i] if i < len(revised_parts) else "", font_name, font_size, bold, italic, underline, strike)

        elif scope["type"] == "document":
            parts = revised_text.split("\n\n---\n\n")
            for slide_idx, slide in enumerate(prs.slides):
                text_shapes = [s for s in slide.shapes if s.has_text_frame]
                slide_text = parts[slide_idx] if slide_idx < len(parts) else ""
                slide_parts = slide_text.split("\n\n")
                for i, shape in enumerate(text_shapes):
                    _set_shape_text(shape, slide_parts[i] if i < len(slide_parts) else "", font_name, font_size, bold, italic, underline, strike)

    prs.save(output_path)


def _apply_font(run: Any, font_name: str | None, font_size: float | None,
                bold: bool | None, italic: bool | None, underline: bool | None,
                strike: bool | None) -> None:
    if font_name is not None:
        run.font.name = font_name
    if font_size is not None:
        run.font.size = Pt(font_size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if underline is not None:
        run.font.underline = underline
    if strike is not None:
        run.font.strike = strike


def _set_shape_text(shape: Any, text: str, font_name: str | None = None, font_size: float | None = None,
                    bold: bool | None = None, italic: bool | None = None, underline: bool | None = None,
                    strike: bool | None = None) -> None:
    tf = shape.text_frame
    if not tf.paragraphs:
        return
    first_para = tf.paragraphs[0]
    if first_para.runs:
        first_para.runs[0].text = text
        for run in first_para.runs[1:]:
            run.text = ""
        for run in first_para.runs:
            _apply_font(run, font_name, font_size, bold, italic, underline, strike)
    # Remove extra paragraphs
    for para in tf.paragraphs[1:]:
        p_elem = para._p
        p_elem.getparent().remove(p_elem)
