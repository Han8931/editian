import { useState, type CSSProperties } from 'react'
import { Settings2, ArrowLeft } from 'lucide-react'
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

  // Slide navigator for pptx (when no shape is selected)
  const pptxStructure = isPptx ? (doc.structure as PptxStructure) : null

  return (
    <aside className="border-l border-gray-200 bg-white flex flex-col flex-shrink-0" style={style}>
      {/* Header */}
      <div className="h-12 px-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <span className="font-medium text-gray-800">Edit</span>
        <button
          onClick={() => setShowSettings(true)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="LLM settings"
        >
          <Settings2 size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* Slide navigator (pptx only) */}
        {isPptx && pptxStructure && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Slide
            </label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
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

        {/* Selection status */}
        <div className="text-xs rounded-lg px-3 py-2 border border-dashed border-gray-300 text-gray-500 leading-relaxed">
          {selectionLabel ? (
            <span className="text-blue-600 font-medium">{selectionLabel}</span>
          ) : (
            <>
              <span className="font-medium text-gray-600">No selection</span>
              {' '}— click or drag{' '}
              {isPptx ? 'shapes on the slide' : 'paragraphs or table cells in the document'}.
              Submitting without a selection revises the whole {isPptx ? 'slide' : 'document'}.
            </>
          )}
        </div>

        {/* Instruction */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Instruction
          </label>
          <textarea
            className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 placeholder-gray-400"
            rows={3}
            placeholder="e.g. Make this more concise and formal"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRevise()
            }}
          />
          <p className="text-xs text-gray-400 mt-1">⌘ Enter to submit</p>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        <button
          onClick={handleRevise}
          disabled={loading || !instruction.trim()}
          className="w-full py-2.5 bg-blue-500 text-white rounded-lg font-medium text-sm hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Revising…' : 'Revise'}
        </button>

        {/* Revisions */}
        {revisions.length > 0 && (
          <div className="flex flex-col gap-3">
            {revisions.length > 1 && (
              <button
                onClick={handleAcceptAll}
                className="w-full py-2 border border-green-500 text-green-600 rounded-lg text-sm font-medium hover:bg-green-50 transition-colors"
              >
                Accept all ({revisions.length})
              </button>
            )}
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
