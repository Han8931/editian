import base64
from pptx import Presentation
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn
from typing import Any, Optional


# ── Colour helpers ────────────────────────────────────────────────────────────

def _color_hex(color_obj) -> Optional[str]:
    try:
        if color_obj.type is not None:
            return f"#{color_obj.rgb}"
    except Exception:
        pass
    return None


def _fill_hex(fill_obj) -> Optional[str]:
    try:
        from pptx.enum.dml import MSO_FILL
        if fill_obj.type == MSO_FILL.SOLID:
            return _color_hex(fill_obj.fore_color)
    except Exception:
        pass
    return None


# ── Image extraction ──────────────────────────────────────────────────────────

def _blip_image_src(elem, part) -> Optional[str]:
    """
    Search *elem* (any lxml element) for an <a:blip r:embed="…"> and return
    a base64 data-URL for the referenced image, or None.
    """
    try:
        blip = elem.find('.//' + qn('a:blip'))
        if blip is None:
            return None
        rId = blip.get(qn('r:embed'))
        if not rId:
            return None
        img_part = part.related_parts[rId]
        data = base64.b64encode(img_part.blob).decode('utf-8')
        return f"data:{img_part.content_type};base64,{data}"
    except Exception:
        return None


def _geometry(shape, left_offset: int, top_offset: int) -> dict:
    return {
        "left":   (shape.left  or 0) + left_offset,
        "top":    (shape.top   or 0) + top_offset,
        "width":  shape.width  or 0,
        "height": shape.height or 0,
    }


def _image_dict(shape, idx: int, left_offset: int, top_offset: int, src: str) -> dict:
    return {
        "index": idx,
        "name": shape.name,
        "shape_type": "image",
        "text": "",
        "image_src": src,
        "paragraphs": [],
        "fill_color": None,
        "ph_idx": None,
        "vertical_anchor": "top",
        **_geometry(shape, left_offset, top_offset),
    }


# ── Text extraction ───────────────────────────────────────────────────────────

_ALIGN_MAP = {
    PP_ALIGN.CENTER:    "center",
    PP_ALIGN.RIGHT:     "right",
    PP_ALIGN.JUSTIFY:   "justify",
    PP_ALIGN.DISTRIBUTE:"justify",
}

_ANCHOR_MAP = {
    MSO_ANCHOR.MIDDLE: "middle",
    MSO_ANCHOR.BOTTOM: "bottom",
}


def _text_dict(shape, idx: int) -> Optional[dict]:
    if not shape.has_text_frame:
        return None

    tf = shape.text_frame
    paragraphs = []

    for para in tf.paragraphs:
        runs = []
        for run in para.runs:
            f = run.font
            runs.append({
                "text":      run.text,
                "bold":      f.bold,
                "italic":    f.italic,
                "underline": f.underline,
                "strike":    f.strike,
                "font_name": f.name,
                "size":      f.size.pt if f.size is not None else None,
                "color":     _color_hex(f.color),
            })

        if not runs and para.text:
            runs = [{"text": para.text, "bold": None, "italic": None,
                     "underline": None, "strike": None, "font_name": None, "size": None, "color": None}]

        paragraphs.append({
            "text":  para.text,
            "align": _ALIGN_MAP.get(para.alignment, "left"),
            "runs":  runs,
        })

    full_text = "\n".join(p["text"] for p in paragraphs)
    if not full_text.strip():
        return None

    ph_idx = None
    try:
        if shape.is_placeholder:
            ph_idx = shape.placeholder_format.idx
    except Exception:
        pass

    vertical_anchor = "top"
    try:
        vertical_anchor = _ANCHOR_MAP.get(tf.vertical_anchor, "top")
    except Exception:
        pass

    return {
        "index": idx,
        "name": shape.name,
        "shape_type": "text",
        "text": full_text,
        "paragraphs": paragraphs,
        "fill_color": _fill_hex(shape.fill),
        "ph_idx": ph_idx,
        "vertical_anchor": vertical_anchor,
        "image_src": None,
    }


# ── Shape dispatcher ──────────────────────────────────────────────────────────

def _parse_shape(shape, idx: int, part, left_offset: int = 0, top_offset: int = 0) -> list[dict]:
    stype = shape.shape_type

    # ── Direct picture shape ──────────────────────────────────────────────────
    if stype == MSO_SHAPE_TYPE.PICTURE:
        try:
            img = shape.image
            data = base64.b64encode(img.blob).decode('utf-8')
            src = f"data:{img.content_type};base64,{data}"
            return [_image_dict(shape, idx, left_offset, top_offset, src)]
        except Exception:
            pass
        # Fallback: try blip extraction
        src = _blip_image_src(shape._element, part)
        if src:
            return [_image_dict(shape, idx, left_offset, top_offset, src)]
        return []

    # ── Group: recurse with offset ─────────────────────────────────────────────
    if stype == MSO_SHAPE_TYPE.GROUP:
        gl = (shape.left or 0) + left_offset
        gt = (shape.top  or 0) + top_offset
        children = []
        for j, child in enumerate(shape.shapes):
            children.extend(_parse_shape(child, idx * 10000 + j, part, gl, gt))
        return children

    # ── Any shape with a blip (picture) fill ──────────────────────────────────
    # Covers picture placeholders, rectangles with image fill, etc.
    src = _blip_image_src(shape._element, part)
    if src:
        return [_image_dict(shape, idx, left_offset, top_offset, src)]

    # ── Text shape ────────────────────────────────────────────────────────────
    result = _text_dict(shape, idx)
    if result:
        geo = _geometry(shape, left_offset, top_offset)
        result.update(geo)
        return [result]

    return []


# ── Public API ────────────────────────────────────────────────────────────────

def parse_pptx(file_path: str) -> dict[str, Any]:
    prs = Presentation(file_path)
    slides = []

    for i, slide in enumerate(prs.slides):
        shapes = []
        for j, shape in enumerate(slide.shapes):
            shapes.extend(_parse_shape(shape, j, slide.part))

        bg_color = None
        try:
            bg_color = _fill_hex(slide.background.fill)
        except Exception:
            pass

        slides.append({
            "index":      i,
            "shapes":     shapes,
            "background": bg_color,
        })

    return {
        "slides":       slides,
        "total":        len(prs.slides),
        "slide_width":  prs.slide_width,
        "slide_height": prs.slide_height,
    }
