import type { Revision } from '../types'
import { useI18n } from '../i18n'

interface Props {
  revision: Revision
  index: number
  onAccept: () => void
  onReject: () => void
}

const STRUCTURAL_TYPES = new Set(['insert_paragraph', 'delete_paragraph', 'merge_paragraphs', 'insert_slide', 'delete_slide', 'duplicate_slide', 'insert_text_box'])

export default function DiffViewer({ revision, index, onAccept, onReject }: Props) {
  const { msg } = useI18n()
  const isStructural = STRUCTURAL_TYPES.has(revision.scope.type)
  const revisionLabel = (() => {
    if (revision.scope.type === 'insert_paragraph') return msg('insertParagraph')
    if (revision.scope.type === 'delete_paragraph') return msg('deleteParagraph')
    if (revision.scope.type === 'merge_paragraphs') return msg('mergeParagraphs')
    if (revision.scope.type === 'insert_slide') return msg('insertSlide')
    if (revision.scope.type === 'delete_slide') return msg('deleteSlideLabel')
    if (revision.scope.type === 'duplicate_slide') return msg('duplicateSlideLabel')
    if (revision.scope.type === 'insert_text_box') return msg('addTextBox')
    return revision.scope.type
  })()
  const formattingItems = [
    revision.font_name ? msg('formattingFont', { value: revision.font_name }) : null,
    revision.font_size ? msg('formattingSize', { value: revision.font_size }) : null,
    revision.align ? msg('formattingAlign', { value: revision.align }) : null,
    revision.bold != null ? msg('formattingToggle', { name: msg('bold'), enabled: revision.bold }) : null,
    revision.italic != null ? msg('formattingToggle', { name: msg('italic'), enabled: revision.italic }) : null,
    revision.underline != null ? msg('formattingToggle', { name: msg('underline'), enabled: revision.underline }) : null,
    revision.strike != null ? msg('formattingToggle', { name: msg('strikethrough'), enabled: revision.strike }) : null,
    revision.bullet != null ? msg('formattingToggle', { name: msg('bulletList'), enabled: revision.bullet }) : null,
  ].filter(Boolean) as string[]

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ring-1 ring-black/[0.02]">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 min-w-7 items-center justify-center rounded-full bg-gray-900 px-2 text-[11px] font-semibold text-white">
            {index + 1}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">{msg('revise')}</span>
            <span className="text-sm font-medium text-gray-800">{revisionLabel}</span>
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
                {msg('structural')}
              </span>
              <span className="font-medium text-gray-800">{revisionLabel}</span>
            </div>
            {revision.scope.type === 'insert_paragraph' && revision.scope.paragraph_index != null && (
              <span className="text-gray-500"> {msg('afterParagraph', { index: revision.scope.paragraph_index + 1 })}</span>
            )}
            {revision.scope.type === 'delete_paragraph' && revision.scope.paragraph_indices?.length === 1 && (
              <span className="text-gray-500"> {msg('paragraphNumber', { index: revision.scope.paragraph_indices[0] + 1 })}</span>
            )}
            {revision.scope.type === 'merge_paragraphs' && revision.scope.paragraph_indices?.length ? (
              <span className="text-gray-500"> {msg('paragraphsIntoOne', { count: revision.scope.paragraph_indices.length })}</span>
            ) : null}
            {revision.scope.type === 'insert_slide' && revision.scope.slide_index != null && (
              <span className="text-gray-500"> {msg('afterSlide', { index: revision.scope.slide_index + 1 })}</span>
            )}
            {revision.scope.type === 'insert_paragraph' && revision.revised && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">{msg('text')}</span>
                {revision.revised}
              </div>
            )}
            {revision.scope.type === 'delete_paragraph' && revision.original && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-600">{msg('removed')}</span>
                {revision.original}
              </div>
            )}
            {revision.scope.type === 'merge_paragraphs' && revision.original && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">{msg('source')}</span>
                {revision.original}
              </div>
            )}
            {revision.scope.type === 'merge_paragraphs' && revision.revised && (
              <div className="mt-2 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">{msg('mergedResult')}</span>
                {revision.revised}
              </div>
            )}
            {revision.scope.type === 'insert_slide' && revision.scope.slide_title && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">{msg('title')}</span>
                {revision.scope.slide_title}
              </div>
            )}
            {revision.scope.type === 'insert_slide' && revision.scope.slide_body && (
              <div className="mt-2 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">{msg('body')}</span>
                {revision.scope.slide_body}
              </div>
            )}
            {revision.scope.type === 'insert_text_box' && revision.revised && (
              <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 text-xs text-gray-700 whitespace-pre-wrap shadow-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">{msg('text')}</span>
                {revision.revised}
              </div>
            )}
          </div>
        ) : (
          <>
            {formattingItems.length > 0 && (
              <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                  {msg('formattingUpdates')}
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
            <div className="flex flex-col gap-2">
              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-400">{msg('before')}</div>
                <div className="text-sm leading-relaxed text-rose-900/60 whitespace-pre-wrap">
                  <span className="line-through decoration-rose-300/70">{revision.original || msg('noOriginalText')}</span>
                </div>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-600">{msg('after')}</div>
                <div
                  className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap"
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
                  {revision.revised || msg('noRevisedText')}
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
          {msg('reject')}
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
        >
          {msg('accept')}
        </button>
      </div>
    </div>
  )
}
