import type { CSSProperties } from 'react'
import type { UploadResponse } from '../types'

interface Props {
  doc: UploadResponse
  style?: CSSProperties
}

export default function ModePanel({ doc, style }: Props) {
  const isPptx = doc.file_type === 'pptx'

  return (
    <aside className="flex-shrink-0 bg-white border-l border-gray-200 h-full flex flex-col" style={style}>
      <div className="px-5 py-5 border-b border-gray-200">
        <div className="text-xs font-semibold text-blue-600 uppercase tracking-[0.18em]">Manual Mode</div>
        <h2 className="mt-2 text-lg font-semibold text-gray-900">Edit directly in the document</h2>
        <p className="mt-2 text-sm text-gray-500 leading-6">
          Click anywhere in the document to place a cursor and type — just like Word or Pages.
          Changes save automatically when you move to another element or click outside.
        </p>
      </div>

      <div className="px-5 py-5 flex flex-col gap-4 text-sm text-gray-600 overflow-y-auto">
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-700">How to edit</div>
          <div className="mt-2 space-y-1.5 text-sm text-blue-900">
            <p>Click on any {isPptx ? 'text box' : 'paragraph'} to place the cursor.</p>
            <p>Type to edit — the cursor appears at your click position.</p>
            <p>Click elsewhere or press <kbd className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">Esc</kbd> to finish.</p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Keyboard shortcuts</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Bold</span>
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs font-mono text-gray-700">⌘ B</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Italic</span>
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs font-mono text-gray-700">⌘ I</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Underline</span>
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs font-mono text-gray-700">⌘ U</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Cancel edit</span>
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs font-mono text-gray-700">Esc</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Undo</span>
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs font-mono text-gray-700">⌘ Z</kbd>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Notes</div>
          <div className="mt-3 space-y-2 text-sm text-gray-500">
            <p>Inline formatting (bold, italic, etc.) is visible while editing but only plain text is preserved on save.</p>
            {!isPptx && <p>Table cells are not editable in manual mode — switch to AI mode for table edits.</p>}
            <p>Use <span className="font-medium text-gray-700">AI mode</span> for instruction-based revisions, formatting changes, and batch edits.</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
