import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react'
import { ArrowLeftRight, Check, Copy, FileText, Loader2, MessageSquare, RefreshCcw, Settings2, Trash2, UploadCloud } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { uploadFile, chatWithComparison } from '../api/client'
import Settings from './Settings'
import { useI18n } from '../i18n'
import type { ChatMessage, CompareSlot, LLMConfig, PptxStructure, TextDocumentStructure, UploadResponse } from '../types'

interface Props {
  currentDoc: UploadResponse | null
  slotA: CompareSlot | null
  slotB: CompareSlot | null
  onAssignSlot: (side: 'a' | 'b', slot: CompareSlot) => Promise<void> | void
  onClearSlot: (side: 'a' | 'b') => Promise<void> | void
  onSwapSlots: () => void
  style?: CSSProperties
}

const COMPARE_CHAT_MIN = 280
const COMPARE_CHAT_MAX = 520
const COMPARE_CHAT_DEFAULT = 352
const LS_COMPARE_CHAT_WIDTH = 'editian_compare_chat_width'

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

function describeStructure(doc: UploadResponse, msg: <T = string>(key: string, params?: Record<string, string | number | boolean>) => T): string {
  if (doc.file_type === 'pptx') {
    const slides = (doc.structure as PptxStructure).slides.length
    return msg<string>('compareSlidesCount', { count: slides })
  }
  const paragraphs = (doc.structure as TextDocumentStructure).paragraphs.filter((p) => p.text.trim()).length
  return msg<string>('compareParagraphsCount', { count: paragraphs })
}

function typeBadgeClass(fileType: UploadResponse['file_type']): string {
  if (fileType === 'docx') return 'bg-blue-100 text-blue-700 border-blue-200'
  if (fileType === 'pptx') return 'bg-orange-100 text-orange-700 border-orange-200'
  return 'bg-emerald-100 text-emerald-700 border-emerald-200'
}

function normalizeChatMarkdown(content: string): string {
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .trim()
}

function CompareMarkdownDocument({ doc }: { doc: UploadResponse }) {
  const { paragraphs } = doc.structure as TextDocumentStructure

  return (
    <div className="markdown-preview">
      {paragraphs
        .filter((paragraph) => paragraph.text.trim())
        .map((paragraph) => (
          <div key={paragraph.index} className="markdown-block">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {paragraph.text}
            </ReactMarkdown>
          </div>
        ))}
    </div>
  )
}

function CompareDocxDocument({ doc }: { doc: UploadResponse }) {
  if (!doc.html) {
    const { paragraphs } = doc.structure as TextDocumentStructure
    return (
      <div className="docx-preview space-y-3">
        {paragraphs
          .filter((paragraph) => paragraph.text.trim())
          .map((paragraph) => (
            <p key={paragraph.index}>{paragraph.text}</p>
          ))}
      </div>
    )
  }

  return <div className="docx-preview" dangerouslySetInnerHTML={{ __html: doc.html }} />
}

function CompareDocumentPane({
  label,
  currentDoc,
  slot,
  onUploaded,
  onUseCurrent,
  onClear,
}: {
  label: string
  currentDoc: UploadResponse | null
  slot: CompareSlot | null
  onUploaded: (doc: UploadResponse) => Promise<void> | void
  onUseCurrent: () => Promise<void> | void
  onClear: () => Promise<void> | void
}) {
  const { msg } = useI18n()
  const inputId = useId()
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const doc = slot?.doc ?? null

  async function handleFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'docx' && ext !== 'pptx' && ext !== 'md' && ext !== 'markdown') {
      setError(msg('uploadUnsupported'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const uploaded = await uploadFile(file)
      await onUploaded(uploaded)
    } catch (e) {
      setError(e instanceof Error ? e.message : msg('uploadFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="min-h-0 h-full rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</div>
        </div>
        {doc && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${typeBadgeClass(doc.file_type)}`}>
            {doc.file_type === 'markdown' ? 'md' : doc.file_type}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 p-4 lg:p-5">
        {doc ? (
          doc.file_type === 'pptx' ? (
            <div className="space-y-4">
              {(doc.structure as PptxStructure).slides.map((slide) => {
                const lines = slide.shapes.map((shape) => shape.text.trim()).filter(Boolean)
                return (
                  <article key={slide.index} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                      {msg('slideLabel', { index: slide.index + 1, title: '' })}
                    </div>
                    {lines.length > 0 ? (
                      <div className="space-y-2">
                        {lines.map((line, index) => (
                          <p key={index} className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">{msg('compareNoVisibleText')}</p>
                    )}
                  </article>
                )
              })}
            </div>
          ) : doc.file_type === 'markdown' ? (
            <div className="rounded-[28px] border border-gray-200 bg-white shadow-sm p-7 lg:p-10">
              <CompareMarkdownDocument doc={doc} />
            </div>
          ) : doc.file_type === 'docx' ? (
            <div className="rounded-[28px] border border-gray-200 bg-white shadow-sm p-7 lg:p-10">
              <CompareDocxDocument doc={doc} />
            </div>
          ) : (
            <p className="text-sm text-gray-400">{msg('compareNoVisibleText')}</p>
          )
        ) : (
          <div
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const file = e.dataTransfer.files[0]
              if (file) void handleFile(file)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => document.getElementById(inputId)?.click()}
            className={`h-full min-h-[22rem] rounded-[28px] border-2 border-dashed px-6 py-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
              isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-300'
            }`}
          >
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={15} className="animate-spin" />
                {msg('processingDocument')}
              </div>
            ) : (
              <>
                <div className="w-11 h-11 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
                  <UploadCloud size={18} />
                </div>
                <div className="text-sm font-medium text-gray-800">{msg('compareDropPrompt')}</div>
                <div className="text-xs text-gray-500 mt-1">{msg('supportedFileTypes')}</div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 bg-white px-4 py-3 flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="file"
          accept=".docx,.pptx,.md,.markdown,text/markdown"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.currentTarget.value = ''
          }}
        />
        <label
          htmlFor={inputId}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors ${
            doc
              ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          <UploadCloud size={14} />
          {doc ? msg('replaceDocument') : msg('uploadDocument')}
        </label>
        {currentDoc && (
          <button
            type="button"
            onClick={() => onUseCurrent()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText size={14} />
            {msg('useCurrentDocument')}
          </button>
        )}
        {doc && (
          <>
            <div className="ml-auto text-xs text-gray-500 hidden md:block">{describeStructure(doc, msg)}</div>
            <button
              type="button"
              onClick={() => onClear()}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
              {msg('clearDocument')}
            </button>
          </>
        )}
        {error && <div className="basis-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      </div>
    </section>
  )
}

export default function CompareMode({
  currentDoc,
  slotA,
  slotB,
  onAssignSlot,
  onClearSlot,
  onSwapSlots,
  style,
}: Props) {
  const { language, setLanguage, msg } = useI18n()
  const [llm, setLlm] = useState<LLMConfig>(loadSavedLLM)
  const [chatPaneWidth, setChatPaneWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(LS_COMPARE_CHAT_WIDTH) ?? '', 10)
    return isNaN(saved) ? COMPARE_CHAT_DEFAULT : saved
  })
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const isDraggingChatRef = useRef(false)
  const stickToBottomRef = useRef(true)
  const copyResetTimerRef = useRef<number | null>(null)

  const ready = !!slotA && !!slotB
  const prompts = useMemo(() => msg<string[]>('compareStarterPrompts'), [msg])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    const scroller = chatScrollRef.current
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
      return
    }
    bottomRef.current?.scrollIntoView()
  }, [messages, chatLoading])

  useEffect(() => () => {
    if (copyResetTimerRef.current != null) {
      window.clearTimeout(copyResetTimerRef.current)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(LS_COMPARE_CHAT_WIDTH, String(chatPaneWidth))
  }, [chatPaneWidth])

  useEffect(() => {
    setMessages([])
    setChatError(null)
    stickToBottomRef.current = true
  }, [slotA?.doc.file_id, slotB?.doc.file_id])

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (!isDraggingChatRef.current || !layoutRef.current) return
      const rect = layoutRef.current.getBoundingClientRect()
      const nextWidth = rect.right - event.clientX
      setChatPaneWidth(Math.min(COMPARE_CHAT_MAX, Math.max(COMPARE_CHAT_MIN, nextWidth)))
    }

    function onMouseUp() {
      if (!isDraggingChatRef.current) return
      isDraggingChatRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  function handleChatScroll(event: UIEvent<HTMLDivElement>) {
    const node = event.currentTarget
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    stickToBottomRef.current = distanceFromBottom < 48
  }

  async function handleSend() {
    if (!slotA || !slotB) return
    const text = chatInput.trim()
    if (!text || chatLoading) return
    const nextMessages = [...messages, { role: 'user', content: text } as ChatMessage]
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setChatInput('')
    setChatLoading(true)
    setChatError(null)
    try {
      await chatWithComparison({
        file_a_id: slotA.doc.file_id,
        file_b_id: slotB.doc.file_id,
        messages: nextMessages,
        llm,
        preferred_language: language,
        onChunk: (chunk) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + chunk }
            }
            return updated
          })
        },
      })
    } catch (e) {
      setChatError(e instanceof Error ? e.message : msg('chatFailed'))
      setMessages(nextMessages)
    } finally {
      setChatLoading(false)
    }
  }

  async function handleRetry() {
    const lastUserIdx = [...messages].map((message) => message.role).lastIndexOf('user')
    if (lastUserIdx === -1 || !slotA || !slotB || chatLoading) return
    const baseMessages = messages.slice(0, lastUserIdx + 1)
    setMessages([...baseMessages, { role: 'assistant', content: '' }])
    setChatLoading(true)
    setChatError(null)
    try {
      await chatWithComparison({
        file_a_id: slotA.doc.file_id,
        file_b_id: slotB.doc.file_id,
        messages: baseMessages,
        llm,
        preferred_language: language,
        onChunk: (chunk) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + chunk }
            }
            return updated
          })
        },
      })
    } catch (e) {
      setChatError(e instanceof Error ? e.message : msg('chatFailed'))
      setMessages(baseMessages)
    } finally {
      setChatLoading(false)
    }
  }

  async function copyMessage(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedIndex(index)
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedIndex(null)
        copyResetTimerRef.current = null
      }, 1500)
    } catch (e) {
      setChatError(e instanceof Error ? e.message : msg('failedToCopyMessage'))
    }
  }

  if (showSettings) {
    return (
      <div className="flex-1 flex bg-gray-50" style={style}>
        <aside className="w-full border-l border-gray-200 bg-white flex flex-col">
          <div className="h-12 px-4 border-b border-gray-200 flex items-center gap-3">
            <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600 transition-colors" title={msg('back')}>
              <ArrowLeftRight size={16} />
            </button>
            <span className="font-medium text-gray-800">{msg('settings')}</span>
          </div>
          <Settings llm={llm} language={language} onChange={setLlm} onLanguageChange={setLanguage} />
        </aside>
      </div>
    )
  }

  return (
    <div className="flex-1 flex bg-gray-50 overflow-hidden" style={style}>
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="w-full flex flex-col gap-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h1 className="text-2xl font-semibold text-gray-900">{msg('compareDocuments')}</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSwapSlots}
                disabled={!slotA || !slotB}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowLeftRight size={15} />
                {msg('swapDocuments')}
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Settings2 size={15} />
                {msg('settings')}
              </button>
            </div>
          </div>

          {!ready ? (
            <div className="flex flex-col gap-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="h-[28rem] lg:h-[calc(100vh-26rem)] min-h-[24rem]">
                  <CompareDocumentPane
                    label={msg('documentA')}
                    currentDoc={currentDoc}
                    slot={slotA}
                    onUploaded={(doc: UploadResponse) => onAssignSlot('a', { doc, source: 'upload' })}
                    onUseCurrent={() => currentDoc ? onAssignSlot('a', { doc: currentDoc, source: 'workspace' }) : undefined}
                    onClear={() => onClearSlot('a')}
                  />
                </div>
                <div className="h-[28rem] lg:h-[calc(100vh-26rem)] min-h-[24rem]">
                  <CompareDocumentPane
                    label={msg('documentB')}
                    currentDoc={currentDoc}
                    slot={slotB}
                    onUploaded={(doc: UploadResponse) => onAssignSlot('b', { doc, source: 'upload' })}
                    onUseCurrent={() => currentDoc ? onAssignSlot('b', { doc: currentDoc, source: 'workspace' }) : undefined}
                    onClear={() => onClearSlot('b')}
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto">
                  <MessageSquare size={20} />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 mt-4">{msg('compareReadyTitle')}</h2>
                <p className="text-sm text-gray-500 mt-2 max-w-2xl mx-auto">{msg('compareReadyBody')}</p>
              </div>
            </div>
          ) : (
            <div
              ref={layoutRef}
              className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_8px_var(--compare-chat-width)] xl:items-start"
              style={{ '--compare-chat-width': `${chatPaneWidth}px` } as CSSProperties}
            >
              <div className="grid gap-6 lg:grid-cols-2 min-w-0">
                <div className="h-[32rem] lg:h-[calc(100vh-16rem)] min-h-[26rem]">
                  <CompareDocumentPane
                    label={msg('documentA')}
                    currentDoc={currentDoc}
                    slot={slotA}
                    onUploaded={(doc: UploadResponse) => onAssignSlot('a', { doc, source: 'upload' })}
                    onUseCurrent={() => currentDoc ? onAssignSlot('a', { doc: currentDoc, source: 'workspace' }) : undefined}
                    onClear={() => onClearSlot('a')}
                  />
                </div>
                <div className="h-[32rem] lg:h-[calc(100vh-16rem)] min-h-[26rem]">
                  <CompareDocumentPane
                    label={msg('documentB')}
                    currentDoc={currentDoc}
                    slot={slotB}
                    onUploaded={(doc: UploadResponse) => onAssignSlot('b', { doc, source: 'upload' })}
                    onUseCurrent={() => currentDoc ? onAssignSlot('b', { doc: currentDoc, source: 'workspace' }) : undefined}
                    onClear={() => onClearSlot('b')}
                  />
                </div>
              </div>

              <div
                className="hidden xl:block w-2 cursor-col-resize rounded-full bg-gray-200 hover:bg-blue-400 active:bg-blue-500 transition-colors"
                onMouseDown={() => {
                  isDraggingChatRef.current = true
                  document.body.style.cursor = 'col-resize'
                  document.body.style.userSelect = 'none'
                }}
              />

              <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm flex flex-col h-[26rem] xl:h-[calc(100vh-16rem)] min-h-[26rem]">
                <div
                  ref={chatScrollRef}
                  onScroll={handleChatScroll}
                  className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
                >
                  {messages.length === 0 && !chatLoading && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-3 py-10">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
                        <MessageSquare size={18} />
                      </div>
                      <div className="text-sm font-medium text-gray-700">{msg('compareAskPromptTitle')}</div>
                      <div className="text-xs text-gray-500 mt-1 leading-relaxed">{msg('compareAskPromptBody')}</div>
                    </div>
                  )}

                  {messages.map((message, index) => (
                    <div key={index} className={`flex flex-col gap-1 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {message.role === 'user' ? (
                        <div className="max-w-[92%] rounded-2xl rounded-br-sm bg-blue-500 text-white px-3.5 py-2.5 text-sm whitespace-pre-wrap">
                          {message.content}
                        </div>
                      ) : (
                        <div className="w-full max-w-[96%] rounded-2xl rounded-bl-sm bg-gray-100 text-gray-800 px-3.5 py-2.5 text-sm prose-chat">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                              ul: ({ children }) => <ul className="mb-2 last:mb-0 pl-4 space-y-0.5 list-disc">{children}</ul>,
                              ol: ({ children }) => <ol className="mb-2 last:mb-0 pl-4 space-y-0.5 list-decimal">{children}</ol>,
                              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                              strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                              code: ({ children }) => <code className="bg-gray-200 text-gray-800 rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
                              pre: ({ children }) => <pre className="bg-gray-200 rounded-lg p-2.5 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{children}</pre>,
                            }}
                          >
                            {normalizeChatMarkdown(message.content)}
                          </ReactMarkdown>
                          {chatLoading && index === messages.length - 1 && message.content !== '' && (
                            <span className="inline-block w-0.5 h-3.5 bg-gray-400 align-middle ml-0.5 animate-pulse" />
                          )}
                        </div>
                      )}
                      {message.role === 'assistant' && (
                        <div className="flex items-center gap-3 px-1">
                          <button
                            type="button"
                            onClick={() => copyMessage(message.content, index)}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            {copiedIndex === index ? <Check size={11} /> : <Copy size={11} />}
                            {copiedIndex === index ? msg('copied') : msg('copy')}
                          </button>
                          {index === messages.length - 1 && !chatLoading && (
                            <button
                              type="button"
                              onClick={handleRetry}
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                            >
                              <RefreshCcw size={11} />
                              {msg('retry')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {chatLoading && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (
                    <div className="flex items-start">
                      <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}

                  {chatError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{chatError}</div>}
                  <div ref={bottomRef} />
                </div>

                <div className="border-t border-gray-200 p-3 flex flex-col gap-3">
                  <div className="flex gap-2 items-end">
                    {messages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setMessages([]); setChatError(null) }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
                        title={msg('clearConversation')}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <textarea
                      rows={1}
                      value={chatInput}
                      placeholder={msg('compareAskPlaceholder')}
                      onChange={(e) => {
                        setChatInput(e.target.value)
                        e.target.style.height = 'auto'
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void handleSend()
                        }
                      }}
                      className="flex-1 border border-gray-200 rounded-xl bg-gray-50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 focus:bg-white transition-all placeholder-gray-400 max-h-32"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={chatLoading || !chatInput.trim()}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                      title={msg('send')}
                    >
                      {chatLoading ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {prompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => setChatInput(prompt)}
                        className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
