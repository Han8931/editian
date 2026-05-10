import type { CSSProperties } from 'react'
import { PenLine } from 'lucide-react'
import type { UploadResponse } from '../types'
import { useI18n } from '../i18n'

interface Props {
  doc: UploadResponse
  style?: CSSProperties
}

export default function ModePanel({ doc, style }: Props) {
  const { msg } = useI18n()
  const isPptx = doc.file_type === 'pptx'
  const isMarkdown = doc.file_type === 'markdown'
  const undoLabel = msg('undo')
  const cancelEditLabel = msg('cancelEdit')

  return (
    <aside className="flex-shrink-0 bg-white border-l border-gray-200 h-full flex flex-col" style={style}>

      {/* Header — matches Sidebar h-12 bar */}
      <div className="h-12 px-4 border-b border-gray-200 flex items-center flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gray-700 flex items-center justify-center flex-shrink-0">
            <PenLine size={13} className="text-white" />
          </div>
          <span className="font-semibold text-sm text-gray-800">{msg('manualEditTitle')}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">

        {/* How to edit */}
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">{msg('howToEdit')}</div>
          <div className="space-y-1.5 text-sm text-blue-900">
            <p>{isPptx ? msg('clickToEditTextBox') : isMarkdown ? msg('clickToEditMarkdownBlock') : msg('clickToEditParagraph')}</p>
            <p>{isMarkdown ? msg('editMarkdownSource') : msg('typeToEditAutoSave')}</p>
            <p>{isMarkdown ? msg('discardCurrentBlock') : msg('discardCurrentElement')}</p>
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{msg('shortcuts')}</div>
          <div className="space-y-2 text-sm">
            {[
              [msg('bold'),        '⌘ B'],
              [msg('italic'),      '⌘ I'],
              [msg('underline'),   '⌘ U'],
              [undoLabel,          '⌘ Z'],
              [cancelEditLabel,    'Esc'],
            ].filter(([label]) => !isMarkdown || [undoLabel, cancelEditLabel].includes(label)).map(([label, key]) => (
              <div key={label} className="flex justify-between items-center">
                <span className="text-gray-600">{label}</span>
                <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs font-mono text-gray-700">{key}</kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-xl border border-gray-200 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{msg('notes')}</div>
          <div className="space-y-2 text-sm text-gray-500">
            {!isMarkdown && <p>{msg('manualNotesRichText')}</p>}
            {isMarkdown && <p>{msg('manualNotesMarkdown')}</p>}
            <p>{msg('manualNotesAi')}</p>
          </div>
        </div>

      </div>
    </aside>
  )
}
