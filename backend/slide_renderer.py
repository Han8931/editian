"""Render PPTX slides to PNG using LibreOffice headless."""
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Optional

_SOFFICE_CANDIDATES = (
    shutil.which("soffice"),
    # Linux
    "/usr/bin/soffice",
    "/usr/lib/libreoffice/program/soffice",
    # macOS
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/Applications/OpenOffice.app/Contents/MacOS/soffice",
)

_PDFTOPPM_CANDIDATES = (
    shutil.which("pdftoppm"),
    # Linux
    "/usr/bin/pdftoppm",
    # macOS (Homebrew)
    "/opt/homebrew/bin/pdftoppm",
    "/usr/local/bin/pdftoppm",
)

_PDF_RENDER_DPI = 180
_global_lock = threading.Lock()


def _resolve_binary(candidates: tuple[Optional[str], ...]) -> Optional[str]:
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def _find_soffice() -> Optional[str]:
    return _resolve_binary(_SOFFICE_CANDIDATES)


def _find_pdftoppm() -> Optional[str]:
    return _resolve_binary(_PDFTOPPM_CANDIDATES)


def is_available() -> bool:
    """Return True when the preferred PDF-based renderer is available."""
    return _find_soffice() is not None and _find_pdftoppm() is not None


def backend_name() -> Optional[str]:
    """Return the active slide-render backend name, if any."""
    soffice = _find_soffice()
    if not soffice:
        return None
    if _find_pdftoppm():
        return "libreoffice-pdf"
    return "libreoffice-png"


def _run_convert_to_pdf(soffice: str, file_path: str, outdir: Path, profile_dir: Path) -> Optional[Path]:
    result = subprocess.run(
        [
            soffice,
            f"-env:UserInstallation=file://{profile_dir}",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(outdir),
            str(file_path),
        ],
        capture_output=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        return None
    pdfs = sorted(outdir.glob("*.pdf"))
    return pdfs[0] if pdfs else None


def _render_pdf_pages_to_pngs(pdf_path: Path, pdftoppm: str, output_dir: Path) -> int:
    prefix = output_dir / "slide"
    result = subprocess.run(
        [
            pdftoppm,
            "-png",
            "-r",
            str(_PDF_RENDER_DPI),
            str(pdf_path),
            str(prefix),
        ],
        capture_output=True,
        timeout=300,
        check=False,
    )
    if result.returncode != 0:
        return 0

    rendered = 0
    for i, png in enumerate(sorted(output_dir.glob("slide-*.png"))):
        final_png = output_dir / f"{i}.png"
        png.replace(final_png)
        rendered += 1
    return rendered


def _render_via_pdf(file_path: str, output_dir: Path, soffice: str, pdftoppm: str) -> int:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        profile_dir = tmpdir_path / "lo_profile"
        profile_dir.mkdir()
        pdf_dir = tmpdir_path / "pdf"
        pdf_dir.mkdir()

        pdf_path = _run_convert_to_pdf(soffice, file_path, pdf_dir, profile_dir)
        if pdf_path is None:
            return 0

        pages_dir = tmpdir_path / "pages"
        pages_dir.mkdir()
        rendered = _render_pdf_pages_to_pngs(pdf_path, pdftoppm, pages_dir)
        if rendered <= 0:
            return 0

        for png in sorted(pages_dir.glob("*.png"), key=lambda path: int(path.stem)):
            shutil.copy2(png, output_dir / png.name)
        return rendered


def _render_via_png(file_path: str, output_dir: Path, soffice: str) -> int:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        profile_dir = tmpdir_path / "lo_profile"
        profile_dir.mkdir()
        lo_out = tmpdir_path / "out"
        lo_out.mkdir()

        result = subprocess.run(
            [
                soffice,
                f"-env:UserInstallation=file://{profile_dir}",
                "--headless",
                "--convert-to",
                "png",
                "--outdir",
                str(lo_out),
                str(file_path),
            ],
            capture_output=True,
            timeout=180,
            check=False,
        )
        if result.returncode != 0:
            return 0

        pngs = sorted(lo_out.glob("*.png"), key=lambda path: path.name)
        for i, png in enumerate(pngs):
            shutil.copy2(png, output_dir / f"{i}.png")
        return len(pngs)


def render_all(file_path: str, output_dir: Path) -> int:
    """
    Render every slide in *file_path* (PPTX) to PNG files named
    0.png, 1.png, 2.png … in *output_dir*.

    Returns the number of slides rendered.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    soffice = _find_soffice()
    if not soffice:
        return 0

    pdftoppm = _find_pdftoppm()
    if pdftoppm:
        rendered = _render_via_pdf(file_path, output_dir, soffice, pdftoppm)
        if rendered > 0:
            return rendered

    return _render_via_png(file_path, output_dir, soffice)


def get_or_render(file_path: str, slide_idx: int, output_dir: Path) -> Optional[Path]:
    """Return the PNG path for *slide_idx*, rendering the whole file if needed."""
    target = output_dir / f"{slide_idx}.png"
    if target.exists():
        return target

    with _global_lock:
        if target.exists():
            return target
        try:
            render_all(file_path, output_dir)
        except Exception:
            return None

    return target if target.exists() else None


def invalidate(output_dir: Path) -> None:
    """Delete all cached PNGs so the next request triggers a fresh render."""
    shutil.rmtree(output_dir, ignore_errors=True)
