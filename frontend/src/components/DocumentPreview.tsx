import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Copy,
  Italic,
  List,
  Plus,
  Redo2,
  Save,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react'
import type { UploadResponse, PptxStructure, DocxStructure, Revision, ParagraphAlign, Shape } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

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
  cellRef?: CellRef
} | null

type CapturedFormatting = Pick<Revision, 'font_name' | 'font_size' | 'align' | 'bold' | 'italic' | 'underline' | 'strike' | 'bullet'>

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

function resolvePreviewImageSrc(src?: string | null): string | undefined {
  if (!src) return undefined
  if (/^(data:|https?:\/\/|blob:)/i.test(src)) return src
  return new URL(src, `${API_BASE_URL}/`).toString()
}

function shapeTransform(shape: { rotation?: number, flip_horizontal?: boolean, flip_vertical?: boolean }): string | undefined {
  const transforms: string[] = []
  if (shape.flip_horizontal) transforms.push('scaleX(-1)')
  if (shape.flip_vertical) transforms.push('scaleY(-1)')
  if (shape.rotation) transforms.push(`rotate(${shape.rotation}deg)`)
  return transforms.length ? transforms.join(' ') : undefined
}

function svgDecorationStrokeWidth(shape: Shape): number {
  const width = shape.width || 0
  const height = shape.height || 0
  const stroke = shape.stroke_width ?? 0
  if (!stroke || !width || !height) return 1
  const scale = Math.max(Math.min(width, height), 1)
  return Math.max((stroke / scale) * 1000, 1)
}

function decorationBorderRadius(shape: Shape): string | undefined {
  switch (shape.preset_geometry) {
    case 'ellipse':
      return '50%'
    case 'roundRect': {
      const ratio = Math.max(0.05, Math.min(((shape.geometry_adjustments?.adj ?? 16667) / 100000) * 1.8, 0.5))
      return `${Math.round(ratio * 100)}%`
    }
    default:
      return undefined
  }
}

function renderDecoration(shape: Shape) {
  const fill = shape.fill_color ?? 'none'
  const stroke = shape.stroke_color ?? 'none'
  const strokeWidth = svgDecorationStrokeWidth(shape)
  const viewBoxWidth = shape.svg_viewbox_width ?? shape.width ?? 1
  const viewBoxHeight = shape.svg_viewbox_height ?? shape.height ?? 1
  const borderRadius = decorationBorderRadius(shape)

  if (shape.svg_path) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <path d={shape.svg_path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }

  if (shape.preset_geometry === 'straightConnector1' || shape.preset_geometry === 'line') {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <line
          x1={0}
          y1={viewBoxHeight / 2}
          x2={viewBoxWidth}
          y2={viewBoxHeight / 2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="square"
        />
      </svg>
    )
  }

  if (shape.preset_geometry === 'rtTriangle') {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <path
          d={`M 0 0 L ${viewBoxWidth} ${viewBoxHeight} L 0 ${viewBoxHeight} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }

  if (shape.preset_geometry === 'corner') {
    const ratio = Math.max(0.12, Math.min((shape.geometry_adjustments?.adj1 ?? 25000) / 100000, 0.45))
    const t = Math.max(Math.min(viewBoxWidth, viewBoxHeight) * ratio, 1)
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <path
          d={`M 0 0 H ${viewBoxWidth} V ${t} H ${t} V ${viewBoxHeight} H 0 Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: shape.fill_color ?? undefined,
        backgroundImage: shape.fill_gradient && shape.fill_gradient.includes('gradient(') ? shape.fill_gradient : undefined,
        border: shape.stroke_color
          ? `${Math.max((shape.stroke_width ?? 12700) / 12700, 1)}px solid ${shape.stroke_color}`
          : undefined,
        borderRadius,
      }}
    />
  )
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

function normalizeTextAlign(value: string | null | undefined): ParagraphAlign | null {
  const align = value?.trim().toLowerCase()
  if (!align || align === 'auto' || align === 'start' || align === '-webkit-auto') return 'left'
  if (align === 'end') return 'right'
  if (align === 'left' || align === 'center' || align === 'right' || align === 'justify') return align
  return null
}

function alignmentFromElement(root: HTMLElement): ParagraphAlign | null {
  const ownAlign = normalizeTextAlign(window.getComputedStyle(root).textAlign)
  const blocks = [root, ...Array.from(root.querySelectorAll<HTMLElement>('p,div'))].filter(hasTextContent)

  let commonAlign: ParagraphAlign | null = null
  for (const block of blocks) {
    const align = normalizeTextAlign(window.getComputedStyle(block).textAlign)
    if (!align) continue
    if (!commonAlign) {
      commonAlign = align
      continue
    }
    if (commonAlign !== align) return ownAlign ?? commonAlign
  }

  return commonAlign ?? ownAlign
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
  const bullet = (() => {
    const listRoot = root.closest('li, ul, ol')
    if (listRoot?.tagName === 'LI') return true
    if (root.tagName === 'LI') return true
    if (root.querySelector('li')) return true
    const display = window.getComputedStyle(root).display
    return display === 'list-item'
  })()

  return {
    font_name: rawFontFamily && rawFontFamily !== 'sans-serif' ? rawFontFamily : null,
    font_size: fontSize,
    align: alignmentFromElement(root),
    bold: commandStateFromElement(root, 'strong,b', (s) => Number.parseInt(s.fontWeight, 10) >= 600 || s.fontWeight === 'bold'),
    italic: commandStateFromElement(root, 'em,i', (s) => s.fontStyle === 'italic' || s.fontStyle === 'oblique'),
    underline: commandStateFromElement(root, 'u', (s) => s.textDecorationLine.includes('underline')),
    strike: commandStateFromElement(root, 's,strike', (s) => s.textDecorationLine.includes('line-through')),
    bullet,
  }
}

function applyBlockFontSize(root: HTMLElement, fontSize: number) {
  const fontSizePt = `${fontSize}pt`
  root.style.fontSize = fontSizePt

  const descendants = Array.from(root.querySelectorAll<HTMLElement>('*'))
  for (const el of descendants) {
    if (!hasTextContent(el)) continue
    el.style.fontSize = fontSizePt
  }
}

function sameValue(a: string | number | boolean | null | undefined, b: string | number | boolean | null | undefined): boolean {
  return (a ?? null) === (b ?? null)
}

function formattingChanged(a: CapturedFormatting | undefined, b: CapturedFormatting): boolean {
  return !sameValue(a?.font_name, b.font_name)
    || !sameValue(a?.font_size, b.font_size)
    || !sameValue(a?.align, b.align)
    || !sameValue(a?.bold, b.bold)
    || !sameValue(a?.italic, b.italic)
    || !sameValue(a?.underline, b.underline)
    || !sameValue(a?.strike, b.strike)
    || !sameValue(a?.bullet, b.bullet)
}

function swallowPointerEvent(event: React.SyntheticEvent) {
  event.preventDefault()
  event.stopPropagation()
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
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const manualShapeElementRef = useRef<HTMLElement | null>(null)
  const manualShapeDraftRef = useRef<string | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const toolbarInteractionRef = useRef(false)
  const [showFontSizeMenu, setShowFontSizeMenu] = useState(false)
  const [manualEditorActive, setManualEditorActive] = useState(false)
  const fontSizeBtnRef = useRef<HTMLButtonElement>(null)
  const savedRangesRef = useRef<Range[]>([])
  const [fontSizeMenuPos, setFontSizeMenuPos] = useState<{ top: number; left: number } | null>(null)
  const tableBtnRef = useRef<HTMLButtonElement>(null)
  const [showTablePicker, setShowTablePicker] = useState(false)
  const [tablePickerPos, setTablePickerPos] = useState<{ top: number; left: number } | null>(null)
  const [hoverCell, setHoverCell] = useState<{ r: number; c: number } | null>(null)

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

  useEffect(() => {
    if (!showFontSizeMenu && !showTablePicker) return

    function handlePointerDown(event: MouseEvent) {
      if (toolbarRef.current?.contains(event.target as Node)) return
      setShowFontSizeMenu(false)
      setFontSizeMenuPos(null)
      setShowTablePicker(false)
      setTablePickerPos(null)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showFontSizeMenu, showTablePicker])

  useEffect(() => {
    setShowFontSizeMenu(false)
    setFontSizeMenuPos(null)
    setShowTablePicker(false)
    setTablePickerPos(null)
    setManualEditorActive(false)
  }, [doc.file_id, isManual])

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
      scope: ref.cellRef
        ? { type: 'table_cell', table_index: ref.cellRef.t, row_index: ref.cellRef.r, cell_index: ref.cellRef.c }
        : { type: 'paragraphs', paragraph_indices: [ref.index] },
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

  function startDocxEdit(el: HTMLElement, paraIdx: number, clientX: number, clientY: number, cellRef?: CellRef) {
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
      cellRef,
    }
    setManualEditorActive(true)

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
    setManualEditorActive(false)

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
      scope: ref.cellRef
        ? { type: 'table_cell', table_index: ref.cellRef.t, row_index: ref.cellRef.r, cell_index: ref.cellRef.c }
        : { type: 'paragraphs', paragraph_indices: [index] },
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
  const [slideRenderStatus, setSlideRenderStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const pptxStructure = doc.file_type === 'pptx' ? (doc.structure as import('../types').PptxStructure) : null
  const naturalW = pptxStructure ? pptxStructure.slide_width / 12700 : 960
  const naturalH = pptxStructure ? pptxStructure.slide_height / 12700 : 540
  const slideRendererAvailable = doc.file_type === 'pptx' && doc.slide_renderer_available === true
  const renderedSlideImageSrc = slideRendererAvailable
    ? `${API_BASE_URL}/api/files/${doc.file_id}/slides/${currentSlide}/image?v=${encodeURIComponent(doc.slide_render_version ?? '0')}`
    : null
  const useRenderedSlideImage = slideRendererAvailable && slideRenderStatus === 'loaded'

  useEffect(() => {
    const el = slideContainerRef.current
    if (!el || doc.file_type !== 'pptx') return
    const update = () => { if (el.clientWidth > 0) setSlideScale(el.clientWidth / naturalW) }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [naturalW, doc.file_type])

  useEffect(() => {
    if (doc.file_type !== 'pptx') return
    setSlideRenderStatus(slideRendererAvailable ? 'loading' : 'failed')
  }, [doc.file_type, doc.file_id, currentSlide, doc.slide_render_version, slideRendererAvailable])

  // Standard page height in px at 100% zoom: A4/Letter ≈ 11in × 96dpi = 1056px
  const PAGE_HEIGHT_PX = 1056

  useEffect(() => {
    if (doc.file_type !== 'docx') return
    const el = scrollContainerRef.current
    if (!el) return

    function update() {
      // zoom CSS property on the inner div scales scrollHeight proportionally
      const zoomFactor = zoom / 100
      const naturalHeight = el!.scrollHeight / zoomFactor
      const total = Math.max(1, Math.ceil(naturalHeight / PAGE_HEIGHT_PX))
      setTotalPages(total)
      const naturalScrollTop = el!.scrollTop / zoomFactor
      setCurrentPage(Math.min(total, Math.max(1, Math.floor(naturalScrollTop / PAGE_HEIGHT_PX) + 1)))
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      obs.disconnect()
    }
  }, [doc.file_type, doc.html, zoom])

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
    setShowFontSizeMenu(false)
    if (doc.file_type === 'docx') {
      commitDocxEdit()
    } else {
      saveEdit()
    }
  }

  function insertSlide() {
    onDirectEdit?.({
      scope: { type: 'insert_slide', slide_index: currentSlide },
      original: '',
      revised: '',
    })
    // Navigate to the newly inserted slide
    onSlideChange(currentSlide + 1)
  }

  function deleteSlide() {
    const pptx = doc.structure as import('../types').PptxStructure
    if (pptx.slides.length <= 1) return
    onDirectEdit?.({
      scope: { type: 'delete_slide', slide_index: currentSlide },
      original: '',
      revised: '',
    })
    onSlideChange(Math.max(0, currentSlide - 1))
    onSelectionChange([])
  }

  function duplicateSlide() {
    onDirectEdit?.({
      scope: { type: 'duplicate_slide', slide_index: currentSlide },
      original: '',
      revised: '',
    })
    onSlideChange(currentSlide + 1)
  }

  function insertTable(rows: number, cols: number) {
    setShowTablePicker(false)
    setTablePickerPos(null)
    setHoverCell(null)
    // Determine insertion point: after the currently-edited paragraph, last selected, or end
    const paraIdx = manualEditRef.current?.index
      ?? (selectedIndices.length > 0 ? Math.max(...selectedIndices) : -1)
    // Commit any active edit before modifying document structure
    if (manualEditRef.current) commitDocxEdit()
    onDirectEdit?.({
      scope: { type: 'insert_table', paragraph_index: paraIdx, rows, cols },
      original: '',
      revised: '',
    })
  }

  function ManualToolbar() {
    if (!isManual) return null
    const hasActiveEditor = manualEditorActive
    const canSave = hasPendingEdit || hasActiveEditor

    function withActiveEditor(run: (el: HTMLElement) => void) {
      const el = activeManualEditor()
      if (!el) return
      setShowFontSizeMenu(false)
      setFontSizeMenuPos(null)
      // Focus first so execCommand works in Firefox
      el.focus()
      // Restore saved selection ranges (Firefox loses selection on toolbar click)
      const sel = window.getSelection()
      if (sel && savedRangesRef.current.length > 0) {
        sel.removeAllRanges()
        savedRangesRef.current.forEach((r) => sel.addRange(r))
      }
      run(el)
      setHasPendingEdit(true)
      if (doc.file_type === 'pptx') {
        manualShapeDraftRef.current = el.innerText
      }
    }

    function fmt(cmd: string) {
      withActiveEditor(() => {
        document.execCommand(cmd, false, undefined)
      })
    }

    function applyFontSize(fontSize: number) {
      withActiveEditor((el) => {
        applyBlockFontSize(el, fontSize)
      })
      setShowFontSizeMenu(false)
    }

    function applyAlignment(align: Exclude<ParagraphAlign, 'justify'>) {
      const command = align === 'center'
        ? 'justifyCenter'
        : align === 'right'
        ? 'justifyRight'
        : 'justifyLeft'

      withActiveEditor(() => {
        document.execCommand(command, false, undefined)
      })
    }

    function triggerUndo() {
      if (!triggerManualUndo()) onUndo?.()
    }

    function triggerRedo() {
      if (!triggerManualRedo()) onRedo?.()
    }

    const btnBase = 'h-8 min-w-8 inline-flex items-center justify-center rounded-lg px-2 transition-colors text-gray-700 select-none'
    const toolButtonClass = `${btnBase} hover:bg-white`

    return (
      <>
      <div
        ref={toolbarRef}
        onMouseDownCapture={() => {
          toolbarInteractionRef.current = true
          // Save selection ranges before the toolbar click can steal focus (needed for Firefox)
          const sel = window.getSelection()
          savedRangesRef.current = sel
            ? Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i).cloneRange())
            : []
        }}
        onMouseUpCapture={() => {
          requestAnimationFrame(() => {
            toolbarInteractionRef.current = false
          })
        }}
        className="relative flex items-center px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0 h-12"
      >
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
            <div className="relative">
              <button
                ref={fontSizeBtnRef}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (showFontSizeMenu) {
                    setShowFontSizeMenu(false)
                    setFontSizeMenuPos(null)
                  } else {
                    const rect = fontSizeBtnRef.current?.getBoundingClientRect()
                    if (rect) setFontSizeMenuPos({ top: rect.bottom + 4, left: rect.left })
                    setShowFontSizeMenu(true)
                  }
                }}
                title="Font size"
                className={`${toolButtonClass} min-w-[4.75rem] justify-between bg-white`}
              >
                <span className="text-xs font-medium">Size</span>
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              onMouseDown={(e) => { e.preventDefault(); fmt('bold') }}
              title="Bold (⌘B)"
              className={toolButtonClass}
            >
              <Bold size={15} />
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); fmt('italic') }}
              title="Italic (⌘I)"
              className={toolButtonClass}
            >
              <Italic size={15} />
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); fmt('underline') }}
              title="Underline (⌘U)"
              className={toolButtonClass}
            >
              <Underline size={15} />
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); fmt('strikeThrough') }}
              title="Strikethrough"
              className={toolButtonClass}
            >
              <Strikethrough size={15} />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
            <button
              onMouseDown={(e) => { e.preventDefault(); applyAlignment('left') }}
              title="Align left"
              className={toolButtonClass}
            >
              <AlignLeft size={15} />
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); applyAlignment('center') }}
              title="Align center"
              className={toolButtonClass}
            >
              <AlignCenter size={15} />
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); applyAlignment('right') }}
              title="Align right"
              className={toolButtonClass}
            >
              <AlignRight size={15} />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                withActiveEditor(() => {
                  document.execCommand('insertUnorderedList', false, undefined)
                })
              }}
              title="Bullet list"
              className={toolButtonClass}
            >
              <List size={15} />
            </button>
          </div>

          {doc.file_type === 'docx' && (
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
              <button
                ref={tableBtnRef}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (showTablePicker) {
                    setShowTablePicker(false)
                    setTablePickerPos(null)
                  } else {
                    const rect = tableBtnRef.current?.getBoundingClientRect()
                    if (rect) setTablePickerPos({ top: rect.bottom + 4, left: rect.left })
                    setShowTablePicker(true)
                    setHoverCell(null)
                  }
                }}
                title="Insert table"
                className={toolButtonClass}
              >
                <Table2 size={15} />
              </button>
            </div>
          )}

          {doc.file_type === 'pptx' && (
            <>
              <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
                <button
                  onMouseDown={(e) => { e.preventDefault(); insertSlide() }}
                  title="Insert slide after"
                  className={toolButtonClass}
                >
                  <Plus size={15} />
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); duplicateSlide() }}
                  title="Duplicate slide"
                  className={toolButtonClass}
                >
                  <Copy size={15} />
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); deleteSlide() }}
                  title="Delete slide"
                  className={`${toolButtonClass} hover:text-red-500`}
                  disabled={(doc.structure as import('../types').PptxStructure).slides.length <= 1}
                >
                  <Trash2 size={15} />
                </button>
              </div>

            </>
          )}

          <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onPointerDown={(e) => {
                swallowPointerEvent(e)
                if (e.button !== 0) return
                triggerUndo()
              }}
              onClick={swallowPointerEvent}
              onAuxClick={swallowPointerEvent}
              onContextMenu={swallowPointerEvent}
              disabled={!hasActiveEditor && !canUndo}
              title="Undo (⌘Z)"
              className={toolButtonClass}
            >
              <Undo2 size={15} />
            </button>
            <button
              type="button"
              onPointerDown={(e) => {
                swallowPointerEvent(e)
                if (e.button !== 0) return
                triggerRedo()
              }}
              onClick={swallowPointerEvent}
              onAuxClick={swallowPointerEvent}
              onContextMenu={swallowPointerEvent}
              disabled={!hasActiveEditor && !canRedo}
              title="Redo (⌘⇧Z)"
              className={toolButtonClass}
            >
              <Redo2 size={15} />
            </button>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {hasPendingEdit ? (
            <span className="text-xs font-medium text-amber-600 select-none">Unsaved changes</span>
          ) : hasActiveEditor ? (
            <span className="text-xs text-gray-400 select-none">Editing</span>
          ) : null}
          <button
            onMouseDown={(e) => { e.preventDefault(); handleManualSave() }}
            disabled={!canSave}
            title="Save now (⌘S)"
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors select-none ${
              hasPendingEdit
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : canSave
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
            }`}
          >
            <Save size={14} />
            Save
          </button>
        </div>
      </div>

      {/* Font size dropdown — rendered via portal so it's never clipped by overflow:hidden ancestors */}
      {showFontSizeMenu && fontSizeMenuPos && createPortal(
        <div
          style={{ position: 'fixed', top: fontSizeMenuPos.top, left: fontSizeMenuPos.left, zIndex: 9999 }}
          className="grid min-w-[5rem] grid-cols-1 gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
        >
          {[10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36].map((size) => (
            <button
              key={size}
              onMouseDown={(e) => {
                e.preventDefault()
                applyFontSize(size)
              }}
              className="rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-gray-50"
            >
              {size} pt
            </button>
          ))}
        </div>,
        document.body,
      )}

      {/* Table picker — portal so it's never clipped */}
      {showTablePicker && tablePickerPos && createPortal(
        <div
          style={{ position: 'fixed', top: tablePickerPos.top, left: tablePickerPos.left, zIndex: 9999 }}
          className="rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
          onMouseLeave={() => setHoverCell(null)}
        >
          <div className="mb-2 text-center text-xs text-gray-500 min-h-[1rem]">
            {hoverCell ? `${hoverCell.r} × ${hoverCell.c} Table` : 'Insert table'}
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(8, 1.25rem)' }}>
            {Array.from({ length: 8 * 8 }, (_, i) => {
              const r = Math.floor(i / 8) + 1
              const c = (i % 8) + 1
              const isHighlighted = hoverCell ? r <= hoverCell.r && c <= hoverCell.c : false
              return (
                <div
                  key={i}
                  className={`w-5 h-5 rounded-sm border transition-colors cursor-pointer ${
                    isHighlighted
                      ? 'bg-blue-100 border-blue-400'
                      : 'bg-gray-50 border-gray-200 hover:bg-blue-50 hover:border-blue-300'
                  }`}
                  onMouseEnter={() => setHoverCell({ r, c })}
                  onMouseDown={(e) => { e.preventDefault(); insertTable(r, c) }}
                />
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
    )
  }

  function stopDrag() {
    isDragging.current = false
  }

  function activeManualEditor(): HTMLElement | null {
    const activeEl = document.activeElement
    if (activeEl instanceof HTMLElement && activeEl.isContentEditable) {
      return activeEl
    }
    return manualEditRef.current?.el ?? manualShapeElementRef.current
  }

  function isFocusedWithinManualEditor(): boolean {
    const editor = activeManualEditor()
    const activeEl = document.activeElement
    return !!editor && !!activeEl && (activeEl === editor || editor.contains(activeEl))
  }

  function triggerManualUndo() {
    const editor = activeManualEditor()
    if (!editor || !isFocusedWithinManualEditor()) return false

    // Guard: only call execCommand('undo') when the editor has local unsaved changes.
    // In Safari, calling execCommand('undo') with an empty undo stack escalates to the
    // browser's native undo action (reopening closed tabs).
    const ref = manualEditRef.current
    if (ref) {
      // DOCX: compare current text against the last-saved baseline
      if (ref.el.innerText.trim() === ref.original.trim()) return false
    } else {
      // PPTX shape: compare the tracked draft against the original text
      const draft = manualShapeDraftRef.current
      const orig = editing?.original
      if (draft != null && orig != null) {
        if (draft.trim() === orig.trim()) return false
      } else if (!hasPendingEdit) {
        return false
      }
    }

    document.execCommand('undo', false, undefined)
    return true
  }

  function triggerManualRedo() {
    const editor = activeManualEditor()
    if (!editor || !isFocusedWithinManualEditor()) return false

    // Same guard as undo: don't call execCommand('redo') when there are no local
    // changes, to prevent Safari from escalating to browser-level redo.
    const ref = manualEditRef.current
    if (ref) {
      if (ref.el.innerText.trim() === ref.original.trim()) return false
    } else {
      const draft = manualShapeDraftRef.current
      const orig = editing?.original
      if (draft != null && orig != null) {
        if (draft.trim() === orig.trim()) return false
      } else if (!hasPendingEdit) {
        return false
      }
    }

    document.execCommand('redo', false, undefined)
    return true
  }

  function handleManualHistoryShortcut(e: React.KeyboardEvent<HTMLElement>) {
    if (!(e.metaKey || e.ctrlKey)) return
    const key = e.key.toLowerCase()
    const isRedo = key === 'y' || (key === 'z' && e.shiftKey)
    const isUndo = key === 'z' && !e.shiftKey
    if (!isUndo && !isRedo) return

    e.preventDefault()
    e.stopPropagation()
    if (isRedo) {
      if (!triggerManualRedo()) onRedo?.()
    } else {
      if (!triggerManualUndo()) onUndo?.()
    }
  }

  function saveEdit() {
    if (!editing) return
    const revisedText = (
      isManual && doc.file_type === 'pptx'
        ? manualShapeElementRef.current?.innerText ?? manualShapeDraftRef.current ?? editing.text
        : editing.text
    ).trim()
    const originalText = editing.original.trim()
    const formatting: CapturedFormatting = (
      isManual && doc.file_type === 'pptx' && manualShapeElementRef.current
        ? captureFormatting(manualShapeElementRef.current)
        : {}
    )

    if (revisedText !== originalText || formattingChanged(editing.originalFormatting, formatting)) {
      let scope: Revision['scope']
      if (editing.cellRef) {
        scope = doc.file_type === 'pptx'
          ? {
              type: 'table_cell',
              slide_index: currentSlide,
              table_index: editing.cellRef.t,
              row_index: editing.cellRef.r,
              cell_index: editing.cellRef.c,
            }
          : {
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
    setManualEditorActive(false)
    setEditing(null)
  }

  function cancelEdit() {
    manualShapeElementRef.current = null
    manualShapeDraftRef.current = null
    setHasPendingEdit(false)
    setManualEditorActive(false)
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

    // In manual mode paragraphs and cells should show a text cursor, not a pointer
    const manualCursorCSS = isManual ? '[data-para-index], [data-cell-ref] { cursor: text; }' : ''

    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
        {ManualToolbar()}
        <div className="flex-1 relative overflow-hidden">
          <ZoomControls />
          <div
            ref={scrollContainerRef}
            className={`h-full overflow-auto p-8 ${isManual ? '' : 'select-none'}`}
            onMouseDown={(e) => {
              if (isManual) {
                // Table cell click
                const cellEl = (e.target as Element).closest('[data-cell-ref]') as HTMLElement | null
                if (cellEl) {
                  const m = cellEl.getAttribute('data-cell-ref')?.match(/t(\d+)r(\d+)c(\d+)/)
                  if (m) startDocxEdit(cellEl, -1, e.clientX, e.clientY, { t: +m[1], r: +m[2], c: +m[3] })
                  return
                }
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
              if (toolbarInteractionRef.current) return
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
        <div className="flex-shrink-0 h-8 bg-white border-t border-gray-200 flex items-center justify-center gap-1.5 select-none">
          <span className="text-xs text-gray-400">Page</span>
          <span className="text-xs font-semibold text-gray-700">{currentPage}</span>
          <span className="text-xs text-gray-300">/</span>
          <span className="text-xs text-gray-500">{totalPages}</span>
        </div>
        {EditingPanel()}
      </div>
    )
  }

  // ── PPTX ────────────────────────────────────────────────────────────────
  const { slides } = doc.structure as PptxStructure
  const slide = slides[currentSlide]
  const slideBackgroundImageSrc = resolvePreviewImageSrc(slide?.background_image_src)

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
              backgroundColor: slide?.background ?? '#ffffff',
              backgroundImage: slideBackgroundImageSrc ? `url("${slideBackgroundImageSrc}")` : undefined,
              backgroundSize: slideBackgroundImageSrc ? '100% 100%' : undefined,
              backgroundPosition: slideBackgroundImageSrc ? 'center' : undefined,
              backgroundRepeat: slideBackgroundImageSrc ? 'no-repeat' : undefined,
              borderRadius: 4,
            }}
          >
            {renderedSlideImageSrc && slideRenderStatus !== 'failed' && (
              <img
                src={renderedSlideImageSrc}
                alt={`Slide ${currentSlide + 1}`}
                draggable={false}
                onLoad={() => setSlideRenderStatus('loaded')}
                onError={() => setSlideRenderStatus('failed')}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'fill',
                  zIndex: 0,
                  pointerEvents: 'none',
                  userSelect: 'none',
                  opacity: slideRenderStatus === 'loaded' ? 1 : 0,
                }}
              />
            )}
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
                zIndex: 1,
              }}
            >
              {slide?.shapes.length ? (
                slide.shapes.map((shape, pos) => {
                  const isImage = shape.shape_type === 'image'
                  const isTable = shape.shape_type === 'table'
                  const isDecoration = shape.shape_type === 'decoration'
                  const isInteractive = !isImage && !isTable && !isDecoration
                  const isSelected = isInteractive && !isManual && selectedIndices.includes(shape.index)
                  const isEditing = isInteractive && editing?.index === shape.index
                  const isTableSelected = isTable && !isManual && selectedTable === shape.index
                  const resolvedImageSrc = isImage ? resolvePreviewImageSrc(shape.image_src) : undefined
                  const transform = shapeTransform(shape)
                  const hideDecorationLayer = useRenderedSlideImage && isDecoration
                  const hideImageLayer = useRenderedSlideImage && isImage
                  const useGhostTextLayer = useRenderedSlideImage && isInteractive && !isEditing
                  const useGhostTableLayer = useRenderedSlideImage && isTable && !(
                    isManual && editing?.index === shape.index
                  )
                  const justify =
                    shape.vertical_anchor === 'middle' ? 'center'
                    : shape.vertical_anchor === 'bottom' ? 'flex-end'
                    : 'flex-start'
                  if (hideDecorationLayer || hideImageLayer) return null
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
                        transform,
                        transformOrigin: 'center center',
                        ...(isDecoration ? {
                          pointerEvents: 'none',
                        } : {}),
                        ...(isTable ? {
                          cursor: isManual ? 'text' : 'pointer',
                          backgroundColor: useGhostTableLayer
                            ? (isTableSelected ? 'rgba(219,234,254,0.18)' : 'transparent')
                            : (isTableSelected ? 'rgba(219,234,254,0.35)' : undefined),
                          outline: isTableSelected ? '2px solid #93c5fd' : undefined,
                          outlineOffset: 1,
                        } : {}),
                        ...(isInteractive ? {
                          padding: '4px 8px',
                          cursor: isManual ? 'text' : 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: justify,
                          backgroundColor: useGhostTextLayer
                            ? (isSelected ? 'rgba(219,234,254,0.16)' : 'transparent')
                            : isEditing
                            ? 'rgba(255,255,255,0.92)'
                            : isSelected
                            ? 'rgba(219,234,254,0.6)'
                            : (shape.fill_color ?? undefined),
                          outline: isEditing
                            ? '2px solid #3b82f6'
                            : isSelected
                            ? '1px solid #93c5fd'
                            : undefined,
                          outlineOffset: 1,
                          boxShadow: isEditing ? '0 8px 24px rgba(15,23,42,0.12)' : undefined,
                        } : {}),
                      }}
                      onMouseDown={isTable ? (e) => {
                        const cellEl = (e.target as Element).closest('[data-pptx-cell-ref]') as HTMLElement | null
                        if (isManual) {
                          if (!cellEl) return
                          const ref = cellEl.getAttribute('data-pptx-cell-ref')?.match(/t(\d+)r(\d+)c(\d+)/)
                          if (!ref) return
                          const [, tableRef, rowRef, cellRef] = ref
                          const sameCell = editing?.cellRef
                            && editing.index === shape.index
                            && editing.cellRef.t === Number(tableRef)
                            && editing.cellRef.r === Number(rowRef)
                            && editing.cellRef.c === Number(cellRef)
                          if (!sameCell) {
                            manualShapeDraftRef.current = cellEl.innerText
                            setHasPendingEdit(false)
                            setManualEditorActive(true)
                            setEditing({
                              index: shape.index,
                              original: cellEl.innerText,
                              text: cellEl.innerText,
                              originalFormatting: captureFormatting(cellEl),
                              cellRef: { t: Number(tableRef), r: Number(rowRef), c: Number(cellRef) },
                            })
                            onSelectionChange([])
                            onTableSelect?.(null)
                          }
                          return
                        }
                        onTableSelect?.(selectedTable === shape.index ? null : shape.index)
                      } : isInteractive ? (e) => {
                        if (isManual) {
                          // In manual mode: single click enters edit mode
                          if (!isEditing) {
                            manualShapeDraftRef.current = shape.text
                            setHasPendingEdit(false)
                            setManualEditorActive(true)
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
                      } : undefined}
                      onMouseEnter={!isInteractive || isManual ? undefined : () => {
                        if (!isDragging.current || anchorIdx.current === null) return
                        onSelectionChange(
                          rangeOf(anchorIdx.current, pos).map((p) => slide.shapes[p].index),
                        )
                      }}
                      onBlur={isInteractive && isManual && isEditing ? (e) => {
                        if (toolbarInteractionRef.current) return
                        manualShapeDraftRef.current = (e.currentTarget as HTMLElement).innerText
                        saveEdit()
                      } : undefined}
                      onInput={isInteractive && isManual && isEditing ? (e) => {
                        manualShapeDraftRef.current = (e.currentTarget as HTMLElement).innerText
                        setHasPendingEdit(true)
                      } : undefined}
                      onKeyDown={isInteractive && isManual && isEditing ? (e) => {
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
                      ref={isInteractive && isManual && isEditing ? (el) => {
                        manualShapeElementRef.current = el
                      } : undefined}
                    >
                      {isDecoration ? renderDecoration(shape) : isImage && resolvedImageSrc ? (
                        <img
                          src={resolvedImageSrc}
                          draggable={false}
                          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
                        />
                      ) : isTable && shape.table_data ? (
                        <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '12pt' }}>
                          <tbody>
                            {shape.table_data.map((row, ri) => (
                              <tr key={ri}>
                                {row.map((cell, ci) => (
                                  (() => {
                                    const isEditingCell = isManual
                                      && editing?.index === shape.index
                                      && editing.cellRef?.t === shape.index
                                      && editing.cellRef?.r === ri
                                      && editing.cellRef?.c === ci
                                    const isGhostCell = useGhostTableLayer && !isEditingCell
                                    return (
                                  <td
                                    key={ci}
                                    data-pptx-cell-ref={`t${shape.index}r${ri}c${ci}`}
                                    contentEditable={isEditingCell ? true : undefined}
                                    suppressContentEditableWarning={isEditingCell}
                                    onBlur={isEditingCell ? (e) => {
                                      if (toolbarInteractionRef.current) return
                                      manualShapeElementRef.current = e.currentTarget
                                      manualShapeDraftRef.current = e.currentTarget.innerText
                                      saveEdit()
                                    } : undefined}
                                    onInput={isEditingCell ? (e) => {
                                      manualShapeElementRef.current = e.currentTarget
                                      manualShapeDraftRef.current = e.currentTarget.innerText
                                      setHasPendingEdit(true)
                                    } : undefined}
                                    onKeyDown={isEditingCell ? (e) => {
                                      handleManualHistoryShortcut(e)
                                      if (e.defaultPrevented) return
                                      if (e.key === 'Escape') {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        cancelEdit()
                                      } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault()
                                        saveEdit()
                                      }
                                    } : undefined}
                                    ref={isEditingCell ? (el) => {
                                      manualShapeElementRef.current = el
                                    } : undefined}
                                    style={{
                                      border: isGhostCell ? '1px solid transparent' : '1px solid #aaa',
                                      padding: '2px 6px',
                                      backgroundColor: isGhostCell
                                        ? 'transparent'
                                        : cell.fill ?? (ri === 0 ? '#d9e1f2' : ci % 2 === 0 ? '#ffffff' : '#f2f2f2'),
                                      fontWeight: ri === 0 ? 'bold' : 'normal',
                                      verticalAlign: 'middle',
                                      overflow: 'hidden',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      outline: !isManual && isTableSelected ? '1px solid #93c5fd' : undefined,
                                      color: isGhostCell ? 'transparent' : undefined,
                                      caretColor: isGhostCell ? 'transparent' : undefined,
                                    }}
                                  >
                                    {cell.text}
                                  </td>
                                    )
                                  })()
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        shape.paragraphs.map((para, pi) => (
                          <p
                            key={pi}
                            style={{
                              margin: 0,
                              marginBottom: pi < shape.paragraphs.length - 1 ? (para.bullet ? '0.35em' : '0.18em') : 0,
                              padding: 0,
                              lineHeight: 1.25,
                              textAlign: (para.align ?? 'left') as React.CSSProperties['textAlign'],
                              minHeight: '1em',
                              display: para.bullet && !(isManual && isEditing) ? 'list-item' : undefined,
                              listStyleType: para.bullet && !(isManual && isEditing) ? 'disc' : undefined,
                              listStylePosition: para.bullet && !(isManual && isEditing) ? 'outside' : undefined,
                              marginLeft: para.bullet && !(isManual && isEditing) ? `${1.2 + (para.level ?? 0) * 1.1}em` : undefined,
                              color: useGhostTextLayer ? 'transparent' : undefined,
                            }}
                          >
                            {para.runs.map((run, ri) => (
                              <span
                                key={ri}
                                style={{
                                  fontSize: `${run.size ?? (shape.ph_idx === 0 ? 36 : 20)}pt`,
                                  fontFamily: run.font_name ?? 'sans-serif',
                                  fontWeight: run.bold ? 'bold' : 'normal',
                                  fontStyle: run.italic ? 'italic' : 'normal',
                                  textDecoration: [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
                                  color: useGhostTextLayer ? 'transparent' : (run.color ?? '#1a1a1a'),
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
