import type { Revision } from '../types'

interface Props {
  revision: Revision
  index: number
  onAccept: () => void
  onReject: () => void
}

function slideLabel(type: string): string {
  if (type === 'insert_paragraph') return 'Insert paragraph'
  if (type === 'delete_paragraph') return 'Delete paragraph'
  if (type === 'merge_paragraphs') return 'Merge paragraphs'
  if (type === 'insert_slide') return 'Insert slide'
  if (type === 'delete_slide') return 'Delete slide'
  if (type === 'duplicate_slide') return 'Duplicate slide'
  if (type === 'insert_text_box') return 'Add text box'
  return type
}

const STRUCTURAL_TYPES = new Set(['insert_paragraph', 'delete_paragraph', 'merge_paragraphs', 'insert_slide', 'delete_slide', 'duplicate_slide', 'insert_text_box'])

export default function DiffViewer({ revision, index, onAccept, onReject }: Props) {
  const isStructural = STRUCTURAL_TYPES.has(revision.scope.type)
  const formattingItems = [
    revision.font_name ? `Font ${revision.font_name}` : null,
    revision.font_size ? `Size ${revision.font_size}pt` : null,
    revision.align ? `Align ${revision.align}` : null,
    revision.bold != null ? `Bold ${revision.bold ? 'on' : 'off'}` : null,
    revision.italic != null ? `Italic ${revision.italic ? 'on' : 'off'}` : null,
    revision.underline != null ? `Underline ${revision.underline ? 'on' : 'off'}` : null,
    revision.strike != null ? `Strike ${revision.strike ? 'on' : 'off'}` : null,
    revision.bullet != null ? `Bullet ${revision.bullet ? 'on' : 'off'}` : null,
  ].filter(Boolean) as string[]

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ring-1 ring-black/[0.02]">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 min-w-7 items-center justify-center rounded-full bg-gray-900 px-2 text-[11px] font-semibold text-white">
            {index + 1}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Revision</span>
            <span className="text-sm font-medium text-gray-800">{slideLabel(revision.scope.type)}</span>
          </div>
        </div>
        <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500">
          {revision.scope.type}
        </span>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {isStructural ? (
          <div className="rounded-2xl border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fbff_100%)] p-4 text-sm leading-relaxed text-gray-700">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                Structural
              </span>
              <span className="font-medium text-gray-800">{slideLabel(revision.scope.type)}</span>
            </div>
            {revision.scope.type === 'insert_paragraph' && revision.scope.paragraph_index != null && (
              <span className="text-gray-500"> after paragraph {revision.scope.paragraph_index + 1}</span>
            )}
            {revision.scope.type === 'delete_paragraph' && revision.scope.paragraph_indices?.length === 1 && (
              <span className="text-gray-500"> paragraph {revision.scope.paragraph_indices[0] + 1}</span>
            )}
            {revision.scope.type === 'merge_paragraphs' && revision.scope.paragraph_indices?.length ? (
              <span className="text-gray-500"> {revision.scope.paragraph_indices.length} paragraphs into one</span>
            ) : null}
            {revision.scope.type === 'insert_slide' && revision.scope.slide_index != null && (
              <span className="text-gray-500"> after slide {revision.scope.slide_index + 1}</span>
            )}
            {revision.scope.type === 'insert_paragraph' && revision.revised && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">Text</span>
                {revision.revised}
              </div>
            )}
            {revision.scope.type === 'delete_paragraph' && revision.original && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-600">Removed</span>
                {revision.original}
              </div>
            )}
            {revision.scope.type === 'merge_paragraphs' && revision.original && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">Source</span>
                {revision.original}
              </div>
            )}
            {revision.scope.type === 'merge_paragraphs' && revision.revised && (
              <div className="mt-2 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">Merged Result</span>
                {revision.revised}
              </div>
            )}
            {revision.scope.type === 'insert_slide' && revision.scope.slide_title && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">Title</span>
                {revision.scope.slide_title}
              </div>
            )}
            {revision.scope.type === 'insert_slide' && revision.scope.slide_body && (
              <div className="mt-2 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">Body</span>
                {revision.scope.slide_body}
              </div>
            )}
            {revision.scope.type === 'insert_text_box' && revision.revised && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">Text</span>
                {revision.revised}
              </div>
            )}
          </div>
        ) : (
          <>
            {formattingItems.length > 0 && (
              <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                  Formatting Updates
                </div>
                <div className="flex flex-wrap gap-2">
                  {formattingItems.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-700 shadow-sm"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-600">Before</div>
                  <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-rose-500">Original</span>
                </div>
                <div className="rounded-xl border border-rose-100 bg-white/80 p-3 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap line-through decoration-rose-300 decoration-2">
                  {revision.original || 'No original text'}
                </div>
              </div>
              <div
                className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-600">After</div>
                  <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-emerald-600">Revised</span>
                </div>
                <div
                  className="rounded-xl border border-emerald-100 bg-white/85 p-3 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap shadow-sm"
                  style={{
                    ...(revision.font_name ? { fontFamily: revision.font_name } : {}),
                    ...(revision.font_size ? { fontSize: `${revision.font_size}pt` } : {}),
                    ...(revision.align ? { textAlign: revision.align } : {}),
                    ...(revision.bold ? { fontWeight: 'bold' } : {}),
                    ...(revision.italic ? { fontStyle: 'italic' } : {}),
                    ...((revision.underline || revision.strike)
                      ? { textDecoration: [revision.underline ? 'underline' : '', revision.strike ? 'line-through' : ''].filter(Boolean).join(' ') }
                      : {}),
                  }}
                >
                  {revision.revised || 'No revised text'}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex border-t border-gray-100 bg-gray-50/70">
        <button
          onClick={onReject}
          className="flex-1 border-r border-gray-200 py-3 text-sm font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-700"
        >
          Reject
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
        >
          Accept
        </button>
      </div>
    </div>
  )
}
