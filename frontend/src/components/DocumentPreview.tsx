import React, { useEffect, useRef, useState } from 'react'
import type { UploadResponse, PptxStructure, DocxStructure, Revision } from '../types'

interface CellRef { t: number; r: number; c: number }

interface Props {
  doc: UploadResponse
  mode?: 'ai' | 'manual'
  currentSlide: number
  onSlideChange: (index: number) => void
  selectedIndices: number[]
  onSelectionChange: (indices: number[]) => void
  selectedTable?: number | null
  onTableSelect?: (tableIndex: number | null) => void
  onDirectEdit?: (revision: Revision) => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

type EditingState = {
  index: number
  original: string
  text: string
  originalFormatting?: CapturedFormatting
  cellRef?: { t: number; r: number; c: number }
} | null

type ManualEditRef = {
  el: HTMLElement
  index: number
  original: string
  originalFormatting: CapturedFormatting
  isCancelled: boolean
} | null

type CapturedFormatting = Pick<Revision, 'font_name' | 'font_size' | 'bold' | 'italic' | 'underline' | 'strike'>

/** Returns the data-para-index of the element under the pointer, or null. */
function paraIndexAt(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y)
  const block = el?.closest('[data-para-index]')
  if (!block) return null
  return Number(block.getAttribute('data-para-index'))
}

function rangeOf(a: number, b: number): number[] {
  const lo = Math.min(a, b), hi = Math.max(a, b)
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

/** Place the text caret at the given viewport coordinates (cross-browser). */
function placeCaret(clientX: number, clientY: number) {
  try {
    const doc = document as any
    if (doc.caretRangeFromPoint) {
      const range = doc.caretRangeFromPoint(clientX, clientY) as Range
      if (range) {
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    } else if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(clientX, clientY)
      if (pos) {
        const range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        range.collapse(true)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  } catch {
    // Caret placement failed — cursor will be at beginning, acceptable fallback
  }
}

function pxToPt(value: string): number | null {
  const px = Number.parseFloat(value)
  if (!Number.isFinite(px) || px <= 0) return null
  return Math.round((px * 72) / 96 * 10) / 10
}

function hasTextContent(el: Element): boolean {
  return !!el.textContent?.replace(/\s+/g, '')
}

function commandStateFromElement(root: HTMLElement, selector: string, cssCheck: (style: CSSStyleDeclaration) => boolean): boolean | null {
  const nodes = Array.from(root.querySelectorAll(selector)).filter(hasTextContent)
  if (nodes.length > 0) return true

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let foundText = false
  let allMatch = true
  let node = walker.nextNode()
  while (node) {
    if (node.textContent?.trim()) {
      foundText = true
      const parent = (node.parentElement ?? root)
      if (!cssCheck(window.getComputedStyle(parent))) {
        allMatch = false
        break
      }
    }
    node = walker.nextNode()
  }
  return foundText ? allMatch : null
}

function captureFormatting(root: HTMLElement): CapturedFormatting {
  const style = window.getComputedStyle(root)
  const fontSize = pxToPt(style.fontSize)
  const rawFontFamily = style.fontFamily
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .find(Boolean)

  return {
    font_name: rawFontFamily && rawFontFamily !== 'sans-serif' ? rawFontFamily : null,
    font_size: fontSize,
    bold: commandStateFromElement(root, 'strong,b', (s) => Number.parseInt(s.fontWeight, 10) >= 600 || s.fontWeight === 'bold'),
    italic: commandStateFromElement(root, 'em,i', (s) => s.fontStyle === 'italic' || s.fontStyle === 'oblique'),
    underline: commandStateFromElement(root, 'u', (s) => s.textDecorationLine.includes('underline')),
    strike: commandStateFromElement(root, 's,strike', (s) => s.textDecorationLine.includes('line-through')),
  }
}

function sameValue(a: string | number | boolean | null | undefined, b: string | number | boolean | null | undefined): boolean {
  return (a ?? null) === (b ?? null)
}

function formattingChanged(a: CapturedFormatting | undefined, b: CapturedFormatting): boolean {
  return !sameValue(a?.font_name, b.font_name)
    || !sameValue(a?.font_size, b.font_size)
    || !sameValue(a?.bold, b.bold)
    || !sameValue(a?.italic, b.italic)
    || !sameValue(a?.underline, b.underline)
    || !sameValue(a?.strike, b.strike)
}

export default function DocumentPreview({
  doc,
  mode = 'ai',
  currentSlide,
  onSlideChange,
  selectedIndices,
  onSelectionChange,
  selectedTable,
  onTableSelect,
  onDirectEdit,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: Props) {
  const isManual = mode === 'manual'

  const isDragging = useRef(false)
  const anchorIdx = useRef<number | null>(null)
  const [editing, setEditing] = useState<EditingState>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [zoom, setZoom] = useState(100)
  const manualShapeElementRef = useRef<HTMLElement | null>(null)
  const manualShapeDraftRef = useRef<string | null>(null)

  // ── Manual mode state ────────────────────────────────────────────────────
  // Tracks the currently-edited DOM element for inline DOCX editing
  const manualEditRef = useRef<ManualEditRef>(null)
  // True while the user has unsaved typed changes (cleared by auto-save or blur)
  const [hasPendingEdit, setHasPendingEdit] = useState(false)
  // Debounce timer for auto-save
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Separate display HTML — only updated when not actively editing, to avoid
  // clobbering an active contentEditable when a prior edit's API call returns
  const [displayHtml, setDisplayHtml] = useState<string>(doc.html ?? '')

  // Reset when the document itself changes (workspace switch / upload)
  useEffect(() => {
    if (manualEditRef.current) commitDocxEdit()
    setDisplayHtml(doc.html ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.file_id])

  // Update display when doc content changes (after API edits), but NOT while editing
  useEffect(() => {
    if (manualEditRef.current) return
    setDisplayHtml(doc.html ?? '')
  }, [doc.html])

  // Commit any pending DOCX edit when switching from manual → AI mode
  useEffect(() => {
    if (!isManual && manualEditRef.current) commitDocxEdit()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManual])

  // ── DOCX manual edit helpers ─────────────────────────────────────────────

  /** Send the current text to the server without closing the editor. */
  function autoSaveDocxEdit() {
    const ref = manualEditRef.current
    if (!ref || ref.isCancelled) return
    const revised = ref.el.innerText.trim()
    const original = ref.original.trim()
    const formatting = captureFormatting(ref.el)
    if (revised === original && !formattingChanged(ref.originalFormatting, formatting)) return

    // Advance the baseline so the next save compares from here, not the start
    ref.original = revised
    ref.originalFormatting = formatting
    setHasPendingEdit(false)

    onDirectEdit?.({
      scope: { type: 'paragraphs', paragraph_indices: [ref.index] },
      original,
      revised,
      ...formatting,
    })
  }

  function scheduleAutoSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null
      autoSaveDocxEdit()
    }, 800)
  }

  function clearAutoSaveTimer() {
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
  }

  function startDocxEdit(el: HTMLElement, paraIdx: number, clientX: number, clientY: number) {
    // Already editing this exact element — let browser handle cursor natively
    if (manualEditRef.current?.el === el) return
    // Commit any other element currently being edited
    if (manualEditRef.current) commitDocxEdit()

    const original = el.innerText
    manualEditRef.current = {
      el,
      index: paraIdx,
      original,
      originalFormatting: captureFormatting(el),
      isCancelled: false,
    }

    el.contentEditable = 'true'
    el.style.outline = '2px solid #3b82f6'
    el.style.borderRadius = '3px'
    el.style.backgroundColor = '#eff6ff'
    el.focus()

    // Auto-save 800 ms after the user stops typing
    const onInput = () => { setHasPendingEdit(true); scheduleAutoSave() }
    el.addEventListener('input', onInput)
    ;(el as any).__editInputListener = onInput

    // Compute caret position from pointer and apply after focus settles
    const savedX = clientX, savedY = clientY
    requestAnimationFrame(() => placeCaret(savedX, savedY))
  }

  /** Close the editor and flush any remaining unsaved text. */
  function commitDocxEdit() {
    clearAutoSaveTimer()
    const ref = manualEditRef.current
    if (!ref) return
    manualEditRef.current = null
    setHasPendingEdit(false)

    const { el, index, original, originalFormatting, isCancelled } = ref
    el.contentEditable = 'false'
    el.style.outline = ''
    el.style.borderRadius = ''
    el.style.backgroundColor = ''

    const listener = (el as any).__editInputListener
    if (listener) { el.removeEventListener('input', listener); delete (el as any).__editInputListener }

    if (isCancelled) {
      el.innerText = original
      // Sync displayHtml so the preview reflects the last saved state
      setDisplayHtml(doc.html ?? '')
      return
    }

    const revised = el.innerText.trim()
    const formatting = captureFormatting(el)
    if (revised === original.trim() && !formattingChanged(originalFormatting, formatting)) {
      // Already saved by auto-save — sync displayHtml to the updated doc
      setDisplayHtml(doc.html ?? '')
      return
    }

    onDirectEdit?.({
      scope: { type: 'paragraphs', paragraph_indices: [index] },
      original: original.trim(),
      revised,
      ...formatting,
    })
  }

  function cancelDocxEdit() {
    clearAutoSaveTimer()
    if (!manualEditRef.current) return
    manualEditRef.current.isCancelled = true
    commitDocxEdit()
  }

  // ── Shared AI-mode editing (PPTX + old DOCX double-click) ───────────────

  const editingKey = editing
    ? editing.cellRef
      ? `cell-${editing.cellRef.t}-${editing.cellRef.r}-${editing.cellRef.c}`
      : `item-${editing.index}`
    : null
  useEffect(() => {
    if (!editingKey) return
    const el = editTextareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [editingKey])

  // Arrow-key slide navigation (PPTX only, disabled while editing)
  useEffect(() => {
    if (doc.file_type !== 'pptx') return
    const { slides } = doc.structure as import('../types').PptxStructure
    const onKey = (e: KeyboardEvent) => {
      if (editing) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (currentSlide < slides.length - 1) { onSlideChange(currentSlide + 1); onSelectionChange([]) }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (currentSlide > 0) { onSlideChange(currentSlide - 1); onSelectionChange([]) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, currentSlide, editing, onSlideChange, onSelectionChange])

  // PPTX: auto-scale slide canvas to fit container width
  const slideContainerRef = useRef<HTMLDivElement>(null)
  const [slideScale, setSlideScale] = useState(1)
  const pptxStructure = doc.file_type === 'pptx' ? (doc.structure as import('../types').PptxStructure) : null
  const naturalW = pptxStructure ? pptxStructure.slide_width / 12700 : 960
  const naturalH = pptxStructure ? pptxStructure.slide_height / 12700 : 540

  useEffect(() => {
    const el = slideContainerRef.current
    if (!el || doc.file_type !== 'pptx') return
    const update = () => { if (el.clientWidth > 0) setSlideScale(el.clientWidth / naturalW) }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [naturalW, doc.file_type])

  function zoomIn() { setZoom((z) => Math.min(z + 10, 200)) }
  function zoomOut() { setZoom((z) => Math.max(z - 10, 50)) }

  function ZoomControls() {
    return (
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-sm px-1 py-0.5">
        <button
          onClick={zoomOut}
          disabled={zoom <= 50}
          className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-base font-medium"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={() => setZoom(100)}
          className="text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded px-1 py-0.5 min-w-[3rem] text-center transition-colors"
          title="Reset zoom"
        >
          {zoom}%
        </button>
        <button
          onClick={zoomIn}
          disabled={zoom >= 200}
          className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-base font-medium"
          title="Zoom in"
        >
          +
        </button>
      </div>
    )
  }

  // ── Manual mode toolbar ─────────────────────────────────────────────────

  function handleManualSave() {
    if (doc.file_type === 'docx') {
      commitDocxEdit()
    } else {
      saveEdit()
    }
  }

  function ManualToolbar() {
    if (!isManual) return null

    function activeEditableElement(): HTMLElement | null {
      return manualEditRef.current?.el ?? manualShapeElementRef.current
    }

    function fmt(cmd: string) {
      document.execCommand(cmd, false, undefined)
      activeEditableElement()?.focus()
      setHasPendingEdit(true)
      if (isManual && doc.file_type === 'pptx' && manualShapeElementRef.current) {
        manualShapeDraftRef.current = manualShapeElementRef.current.innerText
      }
    }

    function applyFontSize(fontSize: number) {
      const el = activeEditableElement()
      if (!el) return
      el.style.fontSize = `${fontSize}pt`
      el.focus()
      setHasPendingEdit(true)
      if (doc.file_type === 'pptx') {
        manualShapeDraftRef.current = el.innerText
      }
    }

    function triggerUndo() {
      if (hasPendingEdit && activeEditableElement()) {
        document.execCommand('undo', false, undefined)
        return
      }
      onUndo?.()
    }

    function triggerRedo() {
      if (hasPendingEdit && activeEditableElement()) {
        document.execCommand('redo', false, undefined)
        return
      }
      onRedo?.()
    }

    const btnBase = 'w-8 h-8 flex items-center justify-center rounded transition-colors hover:bg-gray-100 text-gray-700 select-none'

    return (
      <div className="flex items-center gap-0.5 px-4 py-1.5 bg-white border-b border-gray-200 flex-shrink-0">
        <select
          defaultValue=""
          onChange={(e) => {
            const next = Number(e.target.value)
            if (Number.isFinite(next) && next > 0) applyFontSize(next)
            e.target.value = ''
          }}
          title="Font size"
          className="h-8 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="" disabled>Size</option>
          {[10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36].map((size) => (
            <option key={size} value={size}>{size} pt</option>
          ))}
        </select>
        <button
          onMouseDown={(e) => { e.preventDefault(); fmt('bold') }}
          title="Bold (⌘B)"
          className={btnBase}
        >
          <strong className="text-sm leading-none">B</strong>
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); fmt('italic') }}
          title="Italic (⌘I)"
          className={btnBase}
        >
          <em className="text-sm leading-none not-italic font-medium" style={{ fontStyle: 'italic' }}>I</em>
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); fmt('underline') }}
          title="Underline (⌘U)"
          className={btnBase}
        >
          <u className="text-sm leading-none">U</u>
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); fmt('strikeThrough') }}
          title="Strikethrough"
          className={btnBase}
        >
          <s className="text-sm leading-none">S</s>
        </button>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <button
          onMouseDown={(e) => { e.preventDefault(); triggerUndo() }}
          disabled={!hasPendingEdit && !canUndo}
          title="Undo (⌘Z)"
          className={`${btnBase} disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          <span className="text-sm leading-none">↩</span>
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); triggerRedo() }}
          disabled={!hasPendingEdit && !canRedo}
          title="Redo (⌘⇧Z)"
          className={`${btnBase} disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          <span className="text-sm leading-none">↪</span>
        </button>
        <div className="flex-1" />
        {hasPendingEdit && (
          <span className="text-xs text-amber-500 mr-2 select-none">Unsaved changes</span>
        )}
        <button
          onMouseDown={(e) => { e.preventDefault(); handleManualSave() }}
          title="Save now (⌘S)"
          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors select-none ${
            hasPendingEdit
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
          }`}
        >
          Save
        </button>
      </div>
    )
  }

  function stopDrag() {
    isDragging.current = false
  }

  function handleManualHistoryShortcut(e: React.KeyboardEvent<HTMLElement>) {
    if (!(e.metaKey || e.ctrlKey)) return
    const key = e.key.toLowerCase()
    const isRedo = key === 'y' || (key === 'z' && e.shiftKey)
    const isUndo = key === 'z' && !e.shiftKey
    if (!isUndo && !isRedo) return

    if (hasPendingEdit) return

    e.preventDefault()
    e.stopPropagation()
    if (isRedo) onRedo?.()
    else onUndo?.()
  }

  function saveEdit() {
    if (!editing) return
    const revisedText = (
      isManual && doc.file_type === 'pptx' && !editing.cellRef
        ? manualShapeElementRef.current?.innerText ?? manualShapeDraftRef.current ?? editing.text
        : editing.text
    ).trim()
    const originalText = editing.original.trim()
    const formatting: CapturedFormatting = (
      isManual && doc.file_type === 'pptx' && !editing.cellRef && manualShapeElementRef.current
        ? captureFormatting(manualShapeElementRef.current)
        : {}
    )

    if (revisedText !== originalText || formattingChanged(editing.originalFormatting, formatting)) {
      let scope: Revision['scope']
      if (editing.cellRef) {
        scope = {
          type: 'table_cell',
          table_index: editing.cellRef.t,
          row_index: editing.cellRef.r,
          cell_index: editing.cellRef.c,
        }
      } else if (doc.file_type === 'docx') {
        scope = { type: 'paragraphs', paragraph_indices: [editing.index] }
      } else {
        scope = { type: 'shape', slide_index: currentSlide, shape_indices: [editing.index] }
      }
      onDirectEdit?.({ scope, original: originalText, revised: revisedText, ...formatting })
    }
    manualShapeElementRef.current = null
    manualShapeDraftRef.current = null
    setHasPendingEdit(false)
    setEditing(null)
  }

  function cancelEdit() {
    manualShapeElementRef.current = null
    manualShapeDraftRef.current = null
    setHasPendingEdit(false)
    setEditing(null)
  }

  // AI-mode bottom panel (not shown in manual mode)
  function EditingPanel() {
    if (!editing || isManual) return null
    return (
      <div className="bg-white border-t border-gray-200 shadow-lg px-8 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {editing.cellRef ? 'Edit cell' : doc.file_type === 'docx' ? 'Edit paragraph' : 'Edit shape'}
          </div>
          <textarea
            ref={editTextareaRef}
            className="w-full border border-blue-300 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            rows={Math.max(2, editing.text.split('\n').length + 1)}
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { cancelEdit(); e.preventDefault() }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { saveEdit(); e.preventDefault() }
            }}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">⌘ Enter to save · Esc to cancel</p>
            <div className="flex gap-2">
              <button
                onClick={cancelEdit}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── DOCX ────────────────────────────────────────────────────────────────
  if (doc.file_type === 'docx') {
    const { paragraphs } = doc.structure as DocxStructure
    const structureIndices = new Set(paragraphs.map((p) => p.index))

    const highlightCSS =
      !isManual && selectedIndices.length > 0
        ? selectedIndices.map((i) => `[data-para-index="${i}"]`).join(',') +
          '{ background-color: #dbeafe !important; outline: 1px solid #93c5fd; border-radius: 3px; }'
        : ''

    const cellHighlightCSS =
      !isManual && selectedTable != null
        ? `[data-cell-ref^="t${selectedTable}r"] { background-color: #dbeafe !important; outline: 1px solid #93c5fd; }`
        : ''

    const editHighlightCSS =
      !isManual && editing
        ? editing.cellRef
          ? `[data-cell-ref="t${editing.cellRef.t}r${editing.cellRef.r}c${editing.cellRef.c}"] { outline: 2px solid #3b82f6 !important; background-color: #eff6ff !important; border-radius: 3px; }`
          : `[data-para-index="${editing.index}"] { outline: 2px solid #3b82f6 !important; border-radius: 3px; }`
        : ''

    // In manual mode paragraphs should show a text cursor, not a pointer
    const manualCursorCSS = isManual ? '[data-para-index] { cursor: text; }' : ''

    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
        {ManualToolbar()}
        <div className="flex-1 relative overflow-hidden">
          <ZoomControls />
          <div
            className={`h-full overflow-auto p-8 ${isManual ? '' : 'select-none'}`}
            onMouseDown={(e) => {
              if (isManual) {
                // Skip table cells — not supported in manual mode v1
                if ((e.target as Element).closest('[data-cell-ref]')) return
                const el = (e.target as Element).closest('[data-para-index]') as HTMLElement | null
                if (!el) {
                  // Clicked outside any paragraph — commit current edit
                  if (manualEditRef.current) commitDocxEdit()
                  return
                }
                const idx = Number(el.getAttribute('data-para-index'))
                if (!structureIndices.has(idx)) return
                startDocxEdit(el, idx, e.clientX, e.clientY)
              } else {
                const cellEl = (e.target as Element).closest('[data-cell-ref]')
                if (cellEl) {
                  const ref = cellEl.getAttribute('data-cell-ref')!
                  const m = ref.match(/t(\d+)/)
                  if (m) {
                    const tableIdx = +m[1]
                    onTableSelect?.(selectedTable === tableIdx ? null : tableIdx)
                  }
                  return
                }
                const idx = paraIndexAt(e.clientX, e.clientY)
                if (idx === null || !structureIndices.has(idx)) {
                  // Clicked whitespace or outside the page — clear all selection
                  onTableSelect?.(null)
                  return
                }
                isDragging.current = true
                anchorIdx.current = idx
                onSelectionChange(
                  selectedIndices.length === 1 && selectedIndices[0] === idx ? [] : [idx],
                )
              }
            }}
            onMouseMove={isManual ? undefined : (e) => {
              if (!isDragging.current || anchorIdx.current === null) return
              const idx = paraIndexAt(e.clientX, e.clientY)
              if (idx === null) return
              onSelectionChange(rangeOf(anchorIdx.current, idx).filter((i) => structureIndices.has(i)))
            }}
            onMouseUp={isManual ? undefined : stopDrag}
            onMouseLeave={isManual ? undefined : stopDrag}
            onBlur={isManual ? (e: React.FocusEvent<HTMLDivElement>) => {
              const ref = manualEditRef.current
              if (!ref) return
              // Only commit if the element losing focus is our editing element
              if ((e.target as Node) !== ref.el) return
              // Don't commit if focus moves within the same element
              if (ref.el.contains(e.relatedTarget as Node)) return
              commitDocxEdit()
            } : undefined}
            onKeyDown={isManual ? (e) => {
              handleManualHistoryShortcut(e)
              if (e.defaultPrevented) return
              if (e.key === 'Escape' && manualEditRef.current) {
                e.preventDefault()
                e.stopPropagation()
                cancelDocxEdit()
              } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                commitDocxEdit()
              }
            } : undefined}
          >
            {highlightCSS && <style>{highlightCSS}</style>}
            {cellHighlightCSS && <style>{cellHighlightCSS}</style>}
            {editHighlightCSS && <style>{editHighlightCSS}</style>}
            {manualCursorCSS && <style>{manualCursorCSS}</style>}
            <div
              className="max-w-3xl mx-auto bg-white shadow-md rounded-xl p-12 min-h-[calc(100vh-8rem)] docx-preview"
              style={{ zoom: `${zoom}%` }}
            >
              <div dangerouslySetInnerHTML={{ __html: displayHtml }} />
            </div>
          </div>
        </div>
        {EditingPanel()}
      </div>
    )
  }

  // ── PPTX ────────────────────────────────────────────────────────────────
  const { slides } = doc.structure as PptxStructure
  const slide = slides[currentSlide]

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
      {ManualToolbar()}
      {/* Slide canvas area */}
      <div
        className="flex-1 flex items-center justify-center p-6 overflow-auto relative"
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        {ZoomControls()}
        <div className="w-full max-w-4xl" style={{ zoom: `${zoom}%` }}>
          {/* Aspect-ratio shell — height driven by padding-top trick */}
          <div
            ref={slideContainerRef}
            className="relative w-full shadow-2xl select-none overflow-hidden"
            style={{
              paddingTop: `${(naturalH / naturalW) * 100}%`,
              background: slide?.background ?? '#ffffff',
              borderRadius: 4,
            }}
          >
            {/* Natural-size canvas scaled to fit the shell */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: naturalW,
                height: naturalH,
                transform: `scale(${slideScale})`,
                transformOrigin: 'top left',
              }}
            >
              {slide?.shapes.length ? (
                slide.shapes.map((shape, pos) => {
                  const isImage = shape.shape_type === 'image'
                  const isSelected = !isImage && !isManual && selectedIndices.includes(shape.index)
                  const isEditing = !isImage && editing?.index === shape.index
                  const justify =
                    shape.vertical_anchor === 'middle' ? 'center'
                    : shape.vertical_anchor === 'bottom' ? 'flex-end'
                    : 'flex-start'
                  return (
                    <div
                      key={`${shape.index}-${pos}`}
                      contentEditable={isManual && isEditing ? true : undefined}
                      suppressContentEditableWarning={isManual && isEditing}
                      style={{
                        position: 'absolute',
                        left: shape.left / 12700,
                        top: shape.top / 12700,
                        width: shape.width / 12700,
                        height: shape.height / 12700,
                        boxSizing: 'border-box',
                        ...(isImage ? {} : {
                          padding: '4px 8px',
                          cursor: isManual ? 'text' : 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: justify,
                          backgroundColor: isEditing
                            ? '#eff6ff'
                            : isSelected
                            ? 'rgba(219,234,254,0.6)'
                            : (shape.fill_color ?? undefined),
                          outline: isEditing
                            ? '2px solid #3b82f6'
                            : isSelected
                            ? '1px solid #93c5fd'
                            : undefined,
                          outlineOffset: 1,
                        }),
                      }}
                      onMouseDown={isImage ? undefined : (e) => {
                        if (isManual) {
                          // In manual mode: single click enters edit mode
                          if (!isEditing) {
                            manualShapeDraftRef.current = shape.text
                            setHasPendingEdit(false)
                            setEditing({
                              index: shape.index,
                              original: shape.text,
                              text: shape.text,
                              originalFormatting: captureFormatting(e.currentTarget as HTMLElement),
                            })
                            onSelectionChange([])
                          }
                          return
                        }
                        // AI mode: selection
                        if (isEditing) return
                        isDragging.current = true
                        anchorIdx.current = pos
                        onSelectionChange(
                          selectedIndices.length === 1 && selectedIndices[0] === shape.index
                            ? []
                            : [shape.index],
                        )
                      }}
                      onMouseEnter={isImage || isManual ? undefined : () => {
                        if (!isDragging.current || anchorIdx.current === null) return
                        onSelectionChange(
                          rangeOf(anchorIdx.current, pos).map((p) => slide.shapes[p].index),
                        )
                      }}
                      onBlur={isManual && isEditing ? (e) => {
                        manualShapeDraftRef.current = (e.currentTarget as HTMLElement).innerText
                        saveEdit()
                      } : undefined}
                      onInput={isManual && isEditing ? (e) => {
                        manualShapeDraftRef.current = (e.currentTarget as HTMLElement).innerText
                        setHasPendingEdit(true)
                      } : undefined}
                      onKeyDown={isManual && isEditing ? (e) => {
                        handleManualHistoryShortcut(e)
                        if (e.defaultPrevented) return
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          e.stopPropagation()
                          cancelEdit()  // React restores the original text on re-render
                        } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          saveEdit()
                        }
                      } : undefined}
                      ref={isManual && isEditing ? (el) => {
                        manualShapeElementRef.current = el
                      } : undefined}
                    >
                      {isImage && shape.image_src ? (
                        <img
                          src={shape.image_src}
                          draggable={false}
                          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
                        />
                      ) : (
                        shape.paragraphs.map((para, pi) => (
                          <p
                            key={pi}
                            style={{
                              margin: 0,
                              padding: 0,
                              lineHeight: 1.25,
                              textAlign: (para.align ?? 'left') as React.CSSProperties['textAlign'],
                              minHeight: '1em',
                            }}
                          >
                            {para.runs.map((run, ri) => (
                              <span
                                key={ri}
                                style={{
                                  fontSize: run.size ?? (shape.ph_idx === 0 ? 36 : 20),
                                  fontFamily: run.font_name ?? 'sans-serif',
                                  fontWeight: run.bold ? 'bold' : 'normal',
                                  fontStyle: run.italic ? 'italic' : 'normal',
                                  textDecoration: [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
                                  color: run.color ?? '#1a1a1a',
                                }}
                              >
                                {run.text}
                              </span>
                            ))}
                          </p>
                        ))
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-gray-400 italic">Empty slide</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {EditingPanel()}

      {/* Slide strip */}
      <div className="h-20 bg-white border-t border-gray-200 flex items-center px-4 gap-2 overflow-x-auto flex-shrink-0">
        {slides.map((s, i) => (
          <button
            key={s.index}
            onClick={() => {
              onSlideChange(i)
              onSelectionChange([])
            }}
            className={`flex-shrink-0 w-16 h-12 rounded-lg border text-xs font-semibold transition-colors ${
              currentSlide === i
                ? 'border-blue-500 bg-blue-50 text-blue-600'
                : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-400'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}
