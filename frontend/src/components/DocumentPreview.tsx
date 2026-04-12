import React, { useEffect, useRef, useState } from 'react'
import type { UploadResponse, PptxStructure, DocxStructure, Revision } from '../types'

interface CellRef { t: number; r: number; c: number }

interface Props {
  doc: UploadResponse
  currentSlide: number
  onSlideChange: (index: number) => void
  selectedIndices: number[]
  onSelectionChange: (indices: number[]) => void
  selectedTable?: number | null
  onTableSelect?: (tableIndex: number | null) => void
  onDirectEdit?: (revision: Revision) => void
}

type EditingState = {
  index: number
  original: string
  text: string
  cellRef?: { t: number; r: number; c: number }
} | null

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

export default function DocumentPreview({
  doc,
  currentSlide,
  onSlideChange,
  selectedIndices,
  onSelectionChange,
  selectedTable,
  onTableSelect,
  onDirectEdit,
}: Props) {
  const isDragging = useRef(false)
  const anchorIdx = useRef<number | null>(null)
  const [editing, setEditing] = useState<EditingState>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [zoom, setZoom] = useState(100)

  // PPTX: auto-scale slide canvas to fit container width
  const slideContainerRef = useRef<HTMLDivElement>(null)
  const [slideScale, setSlideScale] = useState(1)
  const pptxStructure = doc.file_type === 'pptx' ? (doc.structure as import('../types').PptxStructure) : null
  const naturalW = pptxStructure ? pptxStructure.slide_width / 12700 : 960
  const naturalH = pptxStructure ? pptxStructure.slide_height / 12700 : 540

  // Focus the edit textarea and place cursor at end when editing starts
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

  function stopDrag() {
    isDragging.current = false
  }

  function saveEdit() {
    if (!editing) return
    if (editing.text !== editing.original) {
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
      onDirectEdit?.({ scope, original: editing.original, revised: editing.text })
    }
    setEditing(null)
  }

  function cancelEdit() {
    setEditing(null)
  }

  // Shared editing panel rendered at the bottom of the preview
  function EditingPanel() {
    if (!editing) return null
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
      selectedIndices.length > 0
        ? selectedIndices.map((i) => `[data-para-index="${i}"]`).join(',') +
          '{ background-color: #dbeafe !important; outline: 1px solid #93c5fd; border-radius: 3px; }'
        : ''

    // Highlight every cell in the selected table using prefix match on data-cell-ref
    const cellHighlightCSS =
      selectedTable != null
        ? `[data-cell-ref^="t${selectedTable}r"] { background-color: #dbeafe !important; outline: 1px solid #93c5fd; }`
        : ''

    // Highlight the element being edited (overrides table selection)
    const editHighlightCSS = editing
      ? editing.cellRef
        ? `[data-cell-ref="t${editing.cellRef.t}r${editing.cellRef.r}c${editing.cellRef.c}"] { outline: 2px solid #3b82f6 !important; background-color: #eff6ff !important; border-radius: 3px; }`
        : `[data-para-index="${editing.index}"] { outline: 2px solid #3b82f6 !important; border-radius: 3px; }`
      : ''

    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
        <div className="flex-1 relative overflow-hidden">
        <ZoomControls />
        <div
          className="h-full overflow-auto p-8 select-none"
          onMouseDown={(e) => {
            if (editing) return
            // Table cell click → select whole table
            const cellEl = (e.target as Element).closest('[data-cell-ref]')
            if (cellEl) {
              const ref = cellEl.getAttribute('data-cell-ref')!
              const m = ref.match(/t(\d+)/)
              if (m) {
                const tableIdx = +m[1]
                onTableSelect?.(selectedTable === tableIdx ? null : tableIdx)
                onSelectionChange([])
              }
              return
            }
            const idx = paraIndexAt(e.clientX, e.clientY)
            if (idx === null || !structureIndices.has(idx)) return
            isDragging.current = true
            anchorIdx.current = idx
            onSelectionChange(
              selectedIndices.length === 1 && selectedIndices[0] === idx ? [] : [idx],
            )
            onTableSelect?.(null)
          }}
          onMouseMove={(e) => {
            if (!isDragging.current || anchorIdx.current === null) return
            const idx = paraIndexAt(e.clientX, e.clientY)
            if (idx === null) return
            onSelectionChange(rangeOf(anchorIdx.current, idx).filter((i) => structureIndices.has(i)))
          }}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          onDoubleClick={(e) => {
            // Table cell editing
            const cellEl = (e.target as Element).closest('[data-cell-ref]')
            if (cellEl) {
              const ref = cellEl.getAttribute('data-cell-ref')!
              const m = ref.match(/t(\d+)r(\d+)c(\d+)/)
              if (m) {
                const text = (cellEl as HTMLElement).innerText?.trim() ?? ''
                setEditing({ index: -1, original: text, text, cellRef: { t: +m[1], r: +m[2], c: +m[3] } })
                onSelectionChange([])
              }
              return
            }
            // Paragraph editing
            const el = (e.target as Element).closest('[data-para-index]')
            if (!el) return
            const idx = Number(el.getAttribute('data-para-index'))
            const para = paragraphs.find((p) => p.index === idx)
            if (!para) return
            setEditing({ index: idx, original: para.text, text: para.text })
            onSelectionChange([])
          }}
        >
          {highlightCSS && <style>{highlightCSS}</style>}
          {cellHighlightCSS && <style>{cellHighlightCSS}</style>}
          {editHighlightCSS && <style>{editHighlightCSS}</style>}
          <div
            className="max-w-3xl mx-auto bg-white shadow-md rounded-xl p-12 min-h-[calc(100vh-8rem)] docx-preview"
            style={{ zoom: `${zoom}%` }}
          >
            <div dangerouslySetInnerHTML={{ __html: doc.html ?? '' }} />
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
      {/* Slide canvas area */}
      <div
        className="flex-1 flex items-center justify-center p-6 overflow-auto"
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <div className="w-full max-w-4xl">
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
                  const isSelected = !isImage && selectedIndices.includes(shape.index)
                  const isEditing = !isImage && editing?.index === shape.index
                  const justify =
                    shape.vertical_anchor === 'middle' ? 'center'
                    : shape.vertical_anchor === 'bottom' ? 'flex-end'
                    : 'flex-start'
                  return (
                    <div
                      key={`${shape.index}-${pos}`}
                      style={{
                        position: 'absolute',
                        left: shape.left / 12700,
                        top: shape.top / 12700,
                        width: shape.width / 12700,
                        height: shape.height / 12700,
                        boxSizing: 'border-box',
                        ...(isImage ? {} : {
                          padding: '4px 8px',
                          cursor: 'pointer',
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
                      onMouseDown={isImage ? undefined : () => {
                        if (isEditing) return
                        isDragging.current = true
                        anchorIdx.current = pos
                        onSelectionChange(
                          selectedIndices.length === 1 && selectedIndices[0] === shape.index
                            ? []
                            : [shape.index],
                        )
                        onTableSelect?.(null)
                      }}
                      onMouseEnter={isImage ? undefined : () => {
                        if (!isDragging.current || anchorIdx.current === null) return
                        onSelectionChange(
                          rangeOf(anchorIdx.current, pos).map((p) => slide.shapes[p].index),
                        )
                      }}
                      onDoubleClick={isImage ? undefined : (e) => {
                        e.stopPropagation()
                        setEditing({ index: shape.index, original: shape.text, text: shape.text })
                        onSelectionChange([])
                      }}
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
                                  fontWeight: run.bold ? 'bold' : 'normal',
                                  fontStyle: run.italic ? 'italic' : 'normal',
                                  textDecoration: run.underline ? 'underline' : undefined,
                                  color: run.color ?? '#1a1a1a',
                                  fontFamily: 'sans-serif',
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
