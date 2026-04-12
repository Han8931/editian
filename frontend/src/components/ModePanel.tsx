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
        <h2 className="mt-2 text-lg font-semibold text-gray-900">Edit directly in the preview</h2>
        <p className="mt-2 text-sm text-gray-500 leading-6">
          Click into any {isPptx ? 'text box' : 'paragraph or table cell'} and type directly in the preview. Changes
          are applied to the active workspace when focus leaves the field or when you confirm with the keyboard.
        </p>
      </div>

      <div className="px-5 py-5 flex flex-col gap-4 text-sm text-gray-600">
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-700">Editing flow</div>
          <div className="mt-1 text-sm font-medium text-blue-900">No selection step required</div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">How to use</div>
          <div className="mt-3 space-y-2">
            <p>Click directly into the document to place the cursor and start editing.</p>
            <p>Use the toolbar above the preview for basic formatting.</p>
            <p>Blur or press <span className="font-medium text-gray-900">Cmd/Ctrl + Enter</span> to save.</p>
            <p>Press <span className="font-medium text-gray-900">Esc</span> to cancel the active edit.</p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Switch modes</div>
          <p className="mt-3 leading-6">
            Return to AI mode when you want instruction-based revisions, batch suggestions, or model settings.
          </p>
        </div>
      </div>
    </aside>
  )
}
