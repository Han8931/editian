# Editian

<p align="center">
  <img src="assets/editian_icon.svg" alt="Editian logo" width="96" />
</p>

<p align="center">
  Edit Word and PowerPoint files with AI, review every change, and keep full control.
</p>

Editian is a browser-based editor for `.docx` and `.pptx` files. Upload a document, describe what you want in plain language, review the before/after diff, and accept only the changes you want.

## Why Use It?

- Works with **Word and PowerPoint files**
- Lets you **edit with natural-language instructions**
- Shows a **diff before anything is applied**
- Supports **local models with Ollama** or **hosted APIs like OpenAI**
- Keeps the workflow **non-destructive** until you click **Accept**

## What You Can Do

### DOCX

- Revise a whole document or selected paragraphs
- Paraphrase, shorten, formalize, or clean up wording
- Insert new paragraphs
- Delete paragraphs
- Summarize a selected section and place the summary below it
- Merge multiple selected paragraphs into one
- Edit tables

### PPTX

- Revise slide text or selected text boxes
- Edit PPTX tables
- Add slides
- Preview slides with a higher-fidelity renderer when LibreOffice + Poppler are installed

## Quick Start

### 1. Start the backend

Using `uv`:

```bash
cd backend
uv venv
uv pip install -r requirements.txt
source .venv/bin/activate   # Windows: .venv\Scripts\activate
uvicorn main:app --reload
```

Or with `pip`:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

The backend runs at `http://localhost:8000`.

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:3000`.

### 3. Choose your AI provider

Editian supports:

- **Ollama** for local models
- **OpenAI**
- **Any OpenAI-compatible API**

You can configure the provider from the settings panel inside the app.

## Basic Workflow

1. Open `http://localhost:3000`
2. Upload a `.docx` or `.pptx` file
3. Select a paragraph, table, shape, or slide, or leave nothing selected to edit a larger scope
4. Enter an instruction such as `Paraphrase this paragraph` or `Make this slide more concise`
5. Click **Revise**
6. Review the before/after output
7. Accept or reject each change
8. Download the updated file

## AI Prompt Examples

The app shows sample prompts based on what is selected.

- Whole DOCX: `Fix grammar and tone throughout the document`
- One DOCX paragraph: `Paraphrase this paragraph`
- Multiple DOCX paragraphs: `Summarize this and put it below`
- Multiple DOCX paragraphs: `Merge these into one paragraph`
- DOCX table: `Standardize the wording in this table`
- PPTX slide: `Make this slide more concise`
- PPTX slide: `Add a new slide about...`
- PPTX text box: `Rewrite this text more clearly`

## Better PowerPoint Rendering

For the closest PPTX preview quality, install:

- **LibreOffice**
- **Poppler** (`pdftoppm`)

When these tools are available, Editian renders PowerPoint files like this:

1. `.pptx` to PDF with LibreOffice
2. PDF to slide images with `pdftoppm`
3. The app shows those rendered slides while keeping editable overlays for text and tables

If those tools are not installed, Editian falls back to its built-in HTML/Python preview path. That fallback still works, but complex templates may look less accurate.

### Install on macOS

```bash
brew install --cask libreoffice
brew install poppler
```

### Install on Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y libreoffice poppler-utils
```

### Install on Fedora

```bash
sudo dnf install -y libreoffice poppler-utils
```

### Install on Windows

- Install LibreOffice so `soffice.exe` is available
- Install Poppler for Windows so `pdftoppm.exe` is available
- Add both to `PATH`

Windows support for the native PPTX renderer is not fully wired or tested yet.

## Storage Options

By default, files are stored locally under `~/.editian/files`.

If you want S3-backed storage, set this in `backend/.env`:

```bash
STORAGE_BACKEND=s3
S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Optional:

```bash
S3_PREFIX=editian
S3_ENDPOINT_URL=
```

For local-only storage:

```bash
STORAGE_BACKEND=local
```

## Requirements

- Python 3.13+
- Node.js 18+
- `uv` or `pip`
- An LLM provider such as Ollama or OpenAI

## Notes

- macOS and Linux are supported for the higher-fidelity PPTX renderer
- The backend expects `soffice` and `pdftoppm` on the machine for the best PPTX output
- All edits remain reviewable before you apply them
