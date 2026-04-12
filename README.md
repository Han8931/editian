# Editian — AI document revision with a human touch

A web tool for editing and polishing Word and PowerPoint documents using LLMs. Upload a `.docx` or `.pptx` file, give a natural language instruction, preview the diff, and accept or reject the changes — all without leaving the browser.

## Features

- **DOCX support** — renders document as HTML, edit by paragraph or entire document
- **PPTX support** — slide-by-slide navigation, edit individual slides
- **Diff preview** — see before/after for every revision before applying
- **Flexible LLM backend** — works with Ollama (local), OpenAI, or any OpenAI-compatible API
- **Non-destructive** — changes apply only on Accept; download the revised file when done

## Project Structure

```
editian/
├── backend/               # Python + FastAPI
│   ├── main.py            # API routes: upload, revise, apply, download
│   ├── llm.py             # LLM client abstraction (Ollama / OpenAI / compatible)
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
- Revising animation...
- Editing mode / AI Mode


