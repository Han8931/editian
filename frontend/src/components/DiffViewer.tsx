import type { Revision } from '../types'

interface Props {
  revision: Revision
  index: number
  onAccept: () => void
  onReject: () => void
}

export default function DiffViewer({ revision, index, onAccept, onReject }: Props) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="bg-gray-50 px-3 py-2 flex items-center justify-between border-b">
        <span className="text-xs font-medium text-gray-500">
          Revision {index + 1}
        </span>
        <span className="text-xs text-gray-400">{revision.scope.type}</span>
      </div>

      <div className="p-3 flex flex-col gap-2">
        {(revision.font_name || revision.font_size || revision.bold != null || revision.italic != null || revision.underline != null || revision.strike != null) && (
          <div className="text-xs bg-blue-50 text-blue-700 rounded-lg px-2 py-1.5 flex flex-wrap gap-3">
            {revision.font_name && <span>Font: <span className="font-semibold">{revision.font_name}</span></span>}
            {revision.font_size && <span>Size: <span className="font-semibold">{revision.font_size}pt</span></span>}
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
            ...(revision.bold       ? { fontWeight:  'bold' }                       : {}),
            ...(revision.italic     ? { fontStyle:   'italic' }                     : {}),
            ...((revision.underline || revision.strike) ? { textDecoration: [revision.underline ? 'underline' : '', revision.strike ? 'line-through' : ''].filter(Boolean).join(' ') } : {}),
          }}
          >
            {revision.revised}
          </div>
        </div>
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
