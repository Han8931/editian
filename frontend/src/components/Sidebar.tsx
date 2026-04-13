import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { Settings2, ArrowLeft, Sparkles, MousePointer, MessageSquare, PenLine, CornerDownLeft, Trash2, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { UploadResponse, LLMConfig, RevisionScope, Revision, PptxStructure, ChatMessage } from '../types'
import { reviseDocument, applyRevisions, chatWithDocument } from '../api/client'
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
  const [activeTab, setActiveTab] = useState<'edit' | 'chat'>('edit')

  // Edit tab state
  const [instruction, setInstruction] = useState('')
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Chat tab state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const isPptx = doc.file_type === 'pptx'

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  function buildScope(): RevisionScope {
    if (selectedTable != null) return { type: 'table', table_index: selectedTable }
    if (selectedIndices.length === 0) return { type: 'document' }
    if (isPptx) return { type: 'shape', slide_index: currentSlide, shape_indices: selectedIndices }
    return { type: 'paragraphs', paragraph_indices: selectedIndices }
  }

  // ── Edit tab handlers ──────────────────────────────────────────────────

  async function handleRevise() {
    if (!instruction.trim()) return
    setEditLoading(true)
    setEditError(null)
    try {
      const result = await reviseDocument({ file_id: doc.file_id, scope: buildScope(), instruction, llm })
      setRevisions(result.revisions)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Revision failed.')
    } finally {
      setEditLoading(false)
    }
  }

  async function handleAccept(revision: Revision) {
    try {
      const updated = await applyRevisions(doc.file_id, [revision])
      onDocumentUpdate(updated)
      setRevisions((prev) => prev.filter((r) => r !== revision))
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to apply revision.')
    }
  }

  async function handleAcceptAll() {
    try {
      const updated = await applyRevisions(doc.file_id, revisions)
      onDocumentUpdate(updated)
      setRevisions([])
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to apply revisions.')
    }
  }

  function handleReject(revision: Revision) {
    setRevisions((prev) => prev.filter((r) => r !== revision))
  }

  // ── Chat tab handlers ──────────────────────────────────────────────────

  async function handleChat() {
    const text = chatInput.trim()
    if (!text) return
    const scope = buildScope()
    const hasSelection = scope.type !== 'document'
    const userMsg: ChatMessage = { role: 'user', content: text }
    const nextMessages = [...chatMessages, userMsg]
    setChatMessages(nextMessages)
    setChatInput('')
    setChatLoading(true)
    setChatError(null)
    try {
      const reply = await chatWithDocument({
        file_id: doc.file_id,
        messages: nextMessages,
        llm,
        scope: hasSelection ? scope : undefined,
      })
      setChatMessages([...nextMessages, { role: 'assistant', content: reply }])
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Chat failed.')
      setChatMessages(chatMessages)
    } finally {
      setChatLoading(false)
    }
  }

  function useAsInstruction(content: string) {
    setInstruction(content)
    setActiveTab('edit')
  }

  // ── Settings screen ────────────────────────────────────────────────────

  if (showSettings) {
    return (
      <aside className="border-l border-gray-200 bg-white flex flex-col flex-shrink-0" style={style}>
        <div className="h-12 px-4 border-b border-gray-200 flex items-center gap-3">
          <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600 transition-colors" title="Back">
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
    if (isPptx) return `${selectedIndices.length} shape${selectedIndices.length > 1 ? 's' : ''} selected`
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
          <span className="font-semibold text-sm text-gray-800">AI</span>

          {/* Edit | Chat tab toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 ml-2">
            {(['edit', 'chat'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === tab ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'edit' ? <PenLine size={11} /> : <MessageSquare size={11} />}
                {tab === 'edit' ? 'Edit' : 'Chat'}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => setShowSettings(true)} className="text-gray-400 hover:text-gray-600 transition-colors" title="LLM settings">
          <Settings2 size={16} />
        </button>
      </div>

      {/* ── Edit tab ────────────────────────────────────────────────────── */}
      {activeTab === 'edit' && (
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">

          {isPptx && pptxStructure && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Slide</label>
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

          {selectionLabel ? (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              <span className="text-sm font-medium text-blue-700">{selectionLabel}</span>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5">
              <MousePointer size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500 leading-relaxed">
                Click or drag to select {isPptx ? 'shapes' : 'paragraphs'}. Without a selection, the whole {isPptx ? 'slide' : 'document'} is revised.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <textarea
              className="w-full border border-gray-200 rounded-xl bg-gray-50 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 focus:bg-white transition-all placeholder-gray-400"
              rows={4}
              placeholder="What would you like to change?"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRevise() }}
            />
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

          {editError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{editError}</div>
          )}

          <button
            onClick={handleRevise}
            disabled={editLoading || !instruction.trim()}
            className={`w-full py-2.5 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all select-none
              ${editLoading
                ? 'btn-revise-loading cursor-default shadow-md shadow-blue-200'
                : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
          >
            {editLoading ? (
              <>
                <Sparkles size={14} className="opacity-80" />
                <span className="tracking-wide">Revising</span>
                <span className="flex items-center gap-[3px] ml-0.5 mt-px">
                  <span className="dot-bounce" />
                  <span className="dot-bounce" />
                  <span className="dot-bounce" />
                </span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Revise
              </>
            )}
          </button>

          {revisions.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {revisions.length} revision{revisions.length > 1 ? 's' : ''}
                </span>
                {revisions.length > 1 && (
                  <button onClick={handleAcceptAll} className="text-xs font-medium text-green-600 hover:text-green-700 transition-colors">
                    Accept all
                  </button>
                )}
              </div>
              {revisions.map((revision, i) => (
                <DiffViewer key={i} revision={revision} index={i} onAccept={() => handleAccept(revision)} onReject={() => handleReject(revision)} />
              ))}
            </div>
          )}

        </div>
      )}

      {/* ── Chat tab ────────────────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Message thread */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {chatMessages.length === 0 && !chatLoading && (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-12 gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                  <MessageSquare size={18} className="text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-600">Ask anything about this document</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Summarize sections, clarify wording, ask about tone — the AI has the full document as context.
                </p>
              </div>
            )}

            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[90%] rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed bg-blue-500 text-white whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[95%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-gray-100 text-gray-800 text-sm prose-chat">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p:          ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                        ul:         ({ children }) => <ul className="mb-2 last:mb-0 pl-4 space-y-0.5 list-disc">{children}</ul>,
                        ol:         ({ children }) => <ol className="mb-2 last:mb-0 pl-4 space-y-0.5 list-decimal">{children}</ol>,
                        li:         ({ children }) => <li className="leading-relaxed">{children}</li>,
                        strong:     ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                        em:         ({ children }) => <em className="italic">{children}</em>,
                        h1:         ({ children }) => <p className="font-semibold text-gray-900 mb-1">{children}</p>,
                        h2:         ({ children }) => <p className="font-semibold text-gray-900 mb-1">{children}</p>,
                        h3:         ({ children }) => <p className="font-medium text-gray-800 mb-1">{children}</p>,
                        code:       ({ children }) => <code className="bg-gray-200 text-gray-800 rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
                        pre:        ({ children }) => <pre className="bg-gray-200 rounded-lg p-2.5 text-xs font-mono overflow-x-auto mb-2 last:mb-0 whitespace-pre-wrap">{children}</pre>,
                        blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-600 italic mb-2 last:mb-0">{children}</blockquote>,
                        hr:         () => <hr className="border-gray-300 my-2" />,
                        table:      ({ children }) => <div className="overflow-x-auto mb-2 last:mb-0"><table className="w-full text-xs border-collapse">{children}</table></div>,
                        thead:      ({ children }) => <thead className="bg-gray-200">{children}</thead>,
                        th:         ({ children }) => <th className="border border-gray-300 px-2 py-1 text-left font-semibold">{children}</th>,
                        td:         ({ children }) => <td className="border border-gray-300 px-2 py-1">{children}</td>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <button
                    onClick={() => useAsInstruction(msg.content)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500 transition-colors px-1"
                    title="Use as edit instruction"
                  >
                    <PenLine size={11} />
                    Use as instruction
                  </button>
                )}
              </div>
            ))}

            {chatLoading && (
              <div className="flex items-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin text-gray-400" />
                  <span className="text-sm text-gray-400">Thinking…</span>
                </div>
              </div>
            )}

            {chatError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{chatError}</div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Selection context indicator */}
          {selectionLabel && (
            <div className="flex-shrink-0 flex items-center gap-2 border-t border-gray-200 px-3 py-2 bg-blue-50">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              <span className="text-xs font-medium text-blue-700 truncate">{selectionLabel} — asking about selection</span>
            </div>
          )}

          {/* Input bar */}
          <div className="flex-shrink-0 border-t border-gray-200 p-3 flex gap-2 items-end">
            {chatMessages.length > 0 && (
              <button
                onClick={() => { setChatMessages([]); setChatError(null) }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
                title="Clear conversation"
              >
                <Trash2 size={14} />
              </button>
            )}
            <textarea
              className="flex-1 border border-gray-200 rounded-xl bg-gray-50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 focus:bg-white transition-all placeholder-gray-400 max-h-32"
              rows={1}
              placeholder="Ask about this document…"
              value={chatInput}
              onChange={(e) => {
                setChatInput(e.target.value)
                // Auto-grow
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleChat()
                }
              }}
            />
            <button
              onClick={handleChat}
              disabled={chatLoading || !chatInput.trim()}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              title="Send (Enter)"
            >
              {chatLoading ? <Loader2 size={14} className="animate-spin" /> : <CornerDownLeft size={14} />}
            </button>
          </div>

        </div>
      )}

    </aside>
  )
}
