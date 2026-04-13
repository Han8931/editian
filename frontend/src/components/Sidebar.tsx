import { useState, type CSSProperties } from 'react'
import { Settings2, ArrowLeft, Sparkles, Loader2, MousePointer } from 'lucide-react'
import type { UploadResponse, LLMConfig, RevisionScope, Revision, PptxStructure } from '../types'
import { reviseDocument, applyRevisions } from '../api/client'
import DiffViewer from './DiffViewer'
import Settings from './Settings'

interface Props {
  doc: UploadResponse
  currentSlide: number
  onSlideChange: (index: number) => void
  onDocumentUpdate: (doc: UploadResponse) => void
  selectedIndices: number[]
  selectedTable?: number | null
  style?: CSSProperties
}

const DEFAULT_LLM: LLMConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.2',
  timeout: 120,
}

const SUGGESTIONS = [
  'Make more concise',
  'Fix grammar',
  'More formal',
  'Simplify language',
  'Improve clarity',
  'Stronger opening',
]

function loadSavedLLM(): LLMConfig {
  try {
    const raw = localStorage.getItem('editian_llm')
    if (raw) return { ...DEFAULT_LLM, ...JSON.parse(raw) }
  } catch {}
  return DEFAULT_LLM
}

export default function Sidebar({
  doc,
  currentSlide,
  onSlideChange,
  onDocumentUpdate,
  selectedIndices,
  selectedTable,
  style,
}: Props) {
  const [showSettings, setShowSettings] = useState(false)
  const [llm, setLlm] = useState<LLMConfig>(loadSavedLLM)
  const [instruction, setInstruction] = useState('')
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPptx = doc.file_type === 'pptx'

  function buildScope(): RevisionScope {
    if (selectedTable != null) {
      return { type: 'table', table_index: selectedTable }
    }
    if (selectedIndices.length === 0) return { type: 'document' }
    if (isPptx) {
      return { type: 'shape', slide_index: currentSlide, shape_indices: selectedIndices }
    }
    return { type: 'paragraphs', paragraph_indices: selectedIndices }
  }

  async function handleRevise() {
    if (!instruction.trim()) return
    setLoading(true)
    setError(null)
    try {
      const result = await reviseDocument({
        file_id: doc.file_id,
        scope: buildScope(),
        instruction,
        llm,
      })
      setRevisions(result.revisions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revision failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleAccept(revision: Revision) {
    try {
      const updated = await applyRevisions(doc.file_id, [revision])
      onDocumentUpdate(updated)
      setRevisions((prev) => prev.filter((r) => r !== revision))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply revision.')
    }
  }

  async function handleAcceptAll() {
    try {
      const updated = await applyRevisions(doc.file_id, revisions)
      onDocumentUpdate(updated)
      setRevisions([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply revisions.')
    }
  }

  function handleReject(revision: Revision) {
    setRevisions((prev) => prev.filter((r) => r !== revision))
  }

  if (showSettings) {
    return (
      <aside className="border-l border-gray-200 bg-white flex flex-col flex-shrink-0" style={style}>
        <div className="h-12 px-4 border-b border-gray-200 flex items-center gap-3">
          <button
            onClick={() => setShowSettings(false)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="font-medium text-gray-800">LLM Settings</span>
        </div>
        <Settings llm={llm} onChange={setLlm} />
      </aside>
    )
  }

  const selectionLabel = (() => {
    if (selectedTable != null) return 'Table selected'
    if (selectedIndices.length === 0) return null
    if (isPptx) {
      return `${selectedIndices.length} shape${selectedIndices.length > 1 ? 's' : ''} selected`
    }
    return `${selectedIndices.length} paragraph${selectedIndices.length > 1 ? 's' : ''} selected`
  })()

  const pptxStructure = isPptx ? (doc.structure as PptxStructure) : null

  return (
    <aside className="border-l border-gray-200 bg-white flex flex-col flex-shrink-0" style={style}>

      {/* Header */}
      <div className="h-12 px-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Sparkles size={13} className="text-white" />
          </div>
          <span className="font-semibold text-sm text-gray-800">AI Edit</span>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="LLM settings"
        >
          <Settings2 size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">

        {/* Slide navigator (pptx only) */}
        {isPptx && pptxStructure && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Slide
            </label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-colors"
              value={currentSlide}
              onChange={(e) => onSlideChange(Number(e.target.value))}
            >
              {pptxStructure.slides.map((s, i) => (
                <option key={s.index} value={i}>
                  Slide {i + 1}{s.shapes[0] ? ` — ${s.shapes[0].text.slice(0, 30)}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Selection indicator */}
        {selectionLabel ? (
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-sm font-medium text-blue-700">{selectionLabel}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5">
            <MousePointer size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500 leading-relaxed">
              Click or drag to select {isPptx ? 'shapes' : 'paragraphs'}. Submitting without a selection revises the whole {isPptx ? 'slide' : 'document'}.
            </p>
          </div>
        )}

        {/* Instruction */}
        <div className="flex flex-col gap-2">
          <textarea
            className="w-full border border-gray-200 rounded-xl bg-gray-50 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 focus:bg-white transition-all placeholder-gray-400"
            rows={4}
            placeholder="What would you like to change?"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRevise()
            }}
          />

          {/* Suggestion chips */}
          {!instruction && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInstruction(s)}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400">⌘ Enter to submit</p>
        </div>

        {/* Error */}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Revise button */}
        <button
          onClick={handleRevise}
          disabled={loading || !instruction.trim()}
          className="w-full py-2.5 rounded-xl font-semibold text-sm bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Revising…
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Revise
            </>
          )}
        </button>

        {/* Revisions */}
        {revisions.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {revisions.length} revision{revisions.length > 1 ? 's' : ''}
              </span>
              {revisions.length > 1 && (
                <button
                  onClick={handleAcceptAll}
                  className="text-xs font-medium text-green-600 hover:text-green-700 transition-colors"
                >
                  Accept all
                </button>
              )}
            </div>
            {revisions.map((revision, i) => (
              <DiffViewer
                key={i}
                revision={revision}
                index={i}
                onAccept={() => handleAccept(revision)}
                onReject={() => handleReject(revision)}
              />
            ))}
          </div>
        )}

      </div>
    </aside>
  )
}
