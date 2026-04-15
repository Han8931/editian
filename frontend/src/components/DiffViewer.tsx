import type { Revision } from '../types'

interface Props {
  revision: Revision
  index: number
  onAccept: () => void
  onReject: () => void
}

function slideLabel(type: string): string {
  if (type === 'insert_slide') return 'Insert slide'
  if (type === 'delete_slide') return 'Delete slide'
  if (type === 'duplicate_slide') return 'Duplicate slide'
  if (type === 'insert_text_box') return 'Add text box'
  return type
}

const STRUCTURAL_SLIDE_TYPES = new Set(['insert_slide', 'delete_slide', 'duplicate_slide', 'insert_text_box'])

export default function DiffViewer({ revision, index, onAccept, onReject }: Props) {
  const isStructural = STRUCTURAL_SLIDE_TYPES.has(revision.scope.type)

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="bg-gray-50 px-3 py-2 flex items-center justify-between border-b">
        <span className="text-xs font-medium text-gray-500">
          Revision {index + 1}
        </span>
        <span className="text-xs text-gray-400">{revision.scope.type}</span>
      </div>

      <div className="p-3 flex flex-col gap-2">
        {isStructural ? (
          <div className="text-sm text-gray-700 bg-blue-50 rounded-lg p-2 leading-relaxed">
            <span className="font-medium">{slideLabel(revision.scope.type)}</span>
            {revision.scope.type === 'insert_slide' && revision.scope.slide_index != null && (
              <span className="text-gray-500"> after slide {revision.scope.slide_index + 1}</span>
            )}
            {revision.scope.type === 'insert_slide' && revision.scope.slide_title && (
              <div className="mt-1 text-xs text-gray-600">
                <span className="font-medium">Title:</span> {revision.scope.slide_title}
              </div>
            )}
            {revision.scope.type === 'insert_slide' && revision.scope.slide_body && (
              <div className="mt-0.5 text-xs text-gray-600">
                <span className="font-medium">Body:</span> {revision.scope.slide_body}
              </div>
            )}
            {revision.scope.type === 'insert_text_box' && revision.revised && (
              <div className="mt-1 text-xs text-gray-600">
                <span className="font-medium">Text:</span> {revision.revised}
              </div>
            )}
          </div>
        ) : (
          <>
            {(revision.font_name || revision.font_size || revision.align || revision.bold != null || revision.italic != null || revision.underline != null || revision.strike != null) && (
              <div className="text-xs bg-blue-50 text-blue-700 rounded-lg px-2 py-1.5 flex flex-wrap gap-3">
                {revision.font_name && <span>Font: <span className="font-semibold">{revision.font_name}</span></span>}
                {revision.font_size && <span>Size: <span className="font-semibold">{revision.font_size}pt</span></span>}
                {revision.align && <span>Align: <span className="font-semibold capitalize">{revision.align}</span></span>}
                {revision.bold != null && <span>Bold: <span className="font-semibold">{revision.bold ? 'on' : 'off'}</span></span>}
                {revision.italic != null && <span>Italic: <span className="font-semibold">{revision.italic ? 'on' : 'off'}</span></span>}
                {revision.underline != null && <span>Underline: <span className="font-semibold">{revision.underline ? 'on' : 'off'}</span></span>}
                {revision.strike != null && <span>Strike: <span className="font-semibold">{revision.strike ? 'on' : 'off'}</span></span>}
              </div>
            )}
            <div>
              <div className="text-xs font-medium text-red-500 mb-1">Before</div>
              <div className="text-sm text-gray-600 bg-red-50 rounded-lg p-2 whitespace-pre-wrap leading-relaxed line-through decoration-red-300">
                {revision.original}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-green-600 mb-1">After</div>
              <div
                className="text-sm text-gray-800 bg-green-50 rounded-lg p-2 whitespace-pre-wrap leading-relaxed"
                style={{
                ...(revision.font_name  ? { fontFamily:  revision.font_name }          : {}),
                ...(revision.font_size  ? { fontSize:    `${revision.font_size}pt` }   : {}),
                ...(revision.align      ? { textAlign:   revision.align }               : {}),
                ...(revision.bold       ? { fontWeight:  'bold' }                       : {}),
                ...(revision.italic     ? { fontStyle:   'italic' }                     : {}),
                ...((revision.underline || revision.strike) ? { textDecoration: [revision.underline ? 'underline' : '', revision.strike ? 'line-through' : ''].filter(Boolean).join(' ') } : {}),
              }}
              >
                {revision.revised}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex border-t border-gray-200">
        <button
          onClick={onReject}
          className="flex-1 py-2.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors border-r border-gray-200"
        >
          Reject
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-2.5 text-sm font-medium text-green-600 hover:bg-green-50 transition-colors"
        >
          Accept
        </button>
      </div>
    </div>
  )
}
