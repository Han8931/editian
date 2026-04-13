import type { CSSProperties } from 'react'
import { PenLine } from 'lucide-react'
import type { UploadResponse } from '../types'

interface Props {
  doc: UploadResponse
  style?: CSSProperties
}

export default function ModePanel({ doc, style }: Props) {
  const isPptx = doc.file_type === 'pptx'

  return (
    <aside className="flex-shrink-0 bg-white border-l border-gray-200 h-full flex flex-col" style={style}>

      {/* Header — matches Sidebar h-12 bar */}
      <div className="h-12 px-4 border-b border-gray-200 flex items-center flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gray-700 flex items-center justify-center flex-shrink-0">
            <PenLine size={13} className="text-white" />
          </div>
          <span className="font-semibold text-sm text-gray-800">Manual Edit</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">

        {/* How to edit */}
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">How to edit</div>
          <div className="space-y-1.5 text-sm text-blue-900">
            <p>Click on any {isPptx ? 'text box' : 'paragraph'} to place the cursor.</p>
            <p>Type to edit — changes save automatically.</p>
            <p>
              Press{' '}
              <kbd className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">Esc</kbd>
              {' '}to discard changes to the current element.
            </p>
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Shortcuts</div>
          <div className="space-y-2 text-sm">
            {[
              ['Bold',        '⌘ B'],
              ['Italic',      '⌘ I'],
              ['Underline',   '⌘ U'],
              ['Undo',        '⌘ Z'],
              ['Cancel edit', 'Esc'],
            ].map(([label, key]) => (
              <div key={label} className="flex justify-between items-center">
                <span className="text-gray-600">{label}</span>
                <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs font-mono text-gray-700">{key}</kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-xl border border-gray-200 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Notes</div>
          <div className="space-y-2 text-sm text-gray-500">
            <p>Block-level formatting (bold, italic, underline, font size) is preserved when the edited block uses one consistent style.</p>
            {!isPptx && <p>Table cells are not editable in manual mode — switch to AI mode for table edits.</p>}
            <p>Use <span className="font-medium text-gray-700">AI mode</span> for instruction-based revisions and batch edits.</p>
          </div>
        </div>

      </div>
    </aside>
  )
}
