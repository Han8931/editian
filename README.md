# Editian — AI document revision with a human touch

A web tool for editing and polishing Word and PowerPoint documents using LLMs. Upload a `.docx` or `.pptx` file, give a natural language instruction, preview the diff, and accept or reject the changes — all without leaving the browser.

## Features

- **DOCX support** — renders document as HTML, edit by paragraph or entire document
- **PPTX support** — slide-by-slide navigation, edit individual slides
- **Diff preview** — see before/after for every revision before applying
- **Flexible LLM backend** — works with Ollama (local), OpenAI, or any OpenAI-compatible API
- **Configurable file storage** — keep files on local disk or synchronize them through S3
- **Non-destructive** — changes apply only on Accept; download the revised file when done

## Project Structure

```
editian/
├── backend/               # Python + FastAPI
│   ├── main.py            # API routes: upload, revise, apply, download
│   ├── llm.py             # LLM client abstraction (Ollama / OpenAI / compatible)
│   ├── storage.py         # S3 storage helper for upload/download sync
│   ├── parsers/
│   │   ├── docx_parser.py # python-docx + mammoth → HTML
│   │   └── pptx_parser.py # python-pptx → slide structure
│   ├── writers/
│   │   ├── docx_writer.py # patches paragraphs, preserves formatting
│   │   └── pptx_writer.py # patches shapes, preserves formatting
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/              # React + TypeScript + Vite + Tailwind
    └── src/
        ├── App.tsx
        ├── types.ts
        ├── api/client.ts
        └── components/
            ├── FileUpload.tsx
            ├── DocumentPreview.tsx
            ├── Sidebar.tsx
            ├── DiffViewer.tsx
            └── Settings.tsx
```

## Getting Started

### Backend

Using **uv** (recommended):

```bash
cd backend
uv venv
uv pip install -r requirements.txt
source .venv/bin/activate   # Windows: .venv\Scripts\activate
uvicorn main:app --reload
```

Or with plain pip:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Runs on `http://localhost:8000`.

Create `backend/.env` from `backend/.env.example`:

```bash
cp backend/.env.example backend/.env
```

Storage mode is controlled by `STORAGE_BACKEND`.

Local storage:

```bash
STORAGE_BACKEND=local
```

In this mode, uploaded and processed files stay under `~/.editian/files`.

S3 storage:

```bash
STORAGE_BACKEND=s3
```

Required S3 variables when `STORAGE_BACKEND=s3`:

```bash
S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Optional variables:

```bash
S3_PREFIX=editian
S3_ENDPOINT_URL=
```

S3 flow:

1. User upload is written to a local temp file
2. The file is uploaded to S3
3. The backend downloads that S3 object back to the local working copy for parsing/editing
4. Any processed output is uploaded back to S3 before download/undo/redo responses are finalized
5. The final browser download is served from the latest local copy after syncing it to S3

Example `backend/.env` for S3:

```bash
STORAGE_BACKEND=s3
S3_BUCKET=my-editian-bucket
S3_PREFIX=editian
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

> Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:3000`.

### LLM Setup

The app supports three LLM providers, configurable from the settings panel (⚙) in the sidebar:

| Provider | Setup |
|---|---|
| **Ollama** (default) | Run `ollama serve` and pull a model, e.g. `ollama pull llama3.2` |
| **OpenAI** | Enter your API key in settings, set model to `gpt-4o` |
| **Custom** | Any OpenAI-compatible endpoint — set Base URL and API key |

## Usage

1. Open `http://localhost:3000`
2. Drop a `.docx` or `.pptx` file onto the upload area
3. In the sidebar, choose a scope: **Whole doc**, **Current slide**, or **Paragraphs**
4. Type an instruction, e.g. *"Make this more concise"* or *"Fix grammar and tone"*
5. Click **Revise** (or ⌘ Enter)
6. Review the before/after diff — click **Accept** or **Reject**
7. Click **Download** in the top bar to save the revised file

## Requirements

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip
- Node.js 18+
- An LLM: [Ollama](https://ollama.com) running locally, or an OpenAI API key



# Todos

- Support other languages
- Layout change
- Close button remove
- Logging
- Manual mode table issue
- PPTX display issue
