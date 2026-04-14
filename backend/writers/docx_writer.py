import shutil
from typing import Any
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from docx.oxml.ns import qn
from docx.oxml import OxmlElement


_ALIGN_MAP = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}


def apply_docx_revisions(
    input_path: str,
    output_path: str,
    revisions: list[dict[str, Any]],
) -> None:
    if input_path != output_path:
        shutil.copy2(input_path, output_path)

    doc = Document(output_path)

    for revision in revisions:
        scope = revision["scope"]
        revised_text: str = revision["revised"]

        font_name: str | None  = revision.get("font_name")
        font_size: float | None = revision.get("font_size")
        align: str | None      = revision.get("align")
        bold: bool | None      = revision.get("bold")
        italic: bool | None    = revision.get("italic")
        underline: bool | None = revision.get("underline")
        strike: bool | None    = revision.get("strike")

        if scope["type"] == "document":
            revised_paras = revised_text.split("\n\n")
            non_empty = [p for p in doc.paragraphs if p.text.strip()]
            for i, para in enumerate(non_empty):
                new_text = revised_paras[i] if i < len(revised_paras) else ""
                _set_paragraph_text(para, new_text, font_name, font_size, align, bold, italic, underline, strike)

        elif scope["type"] == "paragraphs":
            for idx in (scope.get("paragraph_indices") or []):
                if idx < len(doc.paragraphs):
                    _set_paragraph_text(doc.paragraphs[idx], revised_text, font_name, font_size, align, bold, italic, underline, strike)

        elif scope["type"] == "insert_table":
            rows = scope.get("rows") or 2
            cols = scope.get("cols") or 2
            para_index = scope.get("paragraph_index", -1)
            _insert_table(doc, para_index, rows, cols)

        elif scope["type"] == "table_cell":
            table_index = scope.get("table_index", 0)
            row_index = scope.get("row_index", 0)
            cell_index = scope.get("cell_index", 0)
            if table_index < len(doc.tables):
                table = doc.tables[table_index]
                if row_index < len(table.rows):
                    row = table.rows[row_index]
                    if cell_index < len(row.cells):
                        cell = row.cells[cell_index]
                        if cell.paragraphs:
                            _set_paragraph_text(cell.paragraphs[0], revised_text, font_name, font_size, align, bold, italic, underline, strike)

    doc.save(output_path)


def _insert_table(doc: Any, para_index: int, rows: int, cols: int) -> None:
    """Insert a rows×cols table after the paragraph at para_index (-1 = end of document)."""
    # add_table appends to the body; we'll move it to the right position
    table = doc.add_table(rows=rows, cols=cols)
    try:
        table.style = 'Table Grid'
    except Exception:
        pass

    tbl = table._tbl
    body = doc.element.body

    # Remove from where add_table placed it (end of body)
    body.remove(tbl)

    # Find the reference element to insert after
    paras = doc.paragraphs
    if para_index >= 0 and para_index < len(paras):
        ref_el = paras[para_index]._element
        ref_el.addnext(tbl)
    else:
        # Append before the last sectPr if present, otherwise at end
        sect_pr = body.find(qn('w:sectPr'))
        if sect_pr is not None:
            body.insert(list(body).index(sect_pr), tbl)
        else:
            body.append(tbl)


def _set_paragraph_text(para: Any, text: str, font_name: str | None = None, font_size: float | None = None,
                        align: str | None = None, bold: bool | None = None, italic: bool | None = None,
                        underline: bool | None = None, strike: bool | None = None) -> None:
    if para.runs:
        para.runs[0].text = text
        for run in para.runs[1:]:
            run.text = ""
        runs = para.runs
    else:
        runs = [para.add_run(text)]

    if align is not None and align in _ALIGN_MAP:
        para.alignment = _ALIGN_MAP[align]

    for run in runs:
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
