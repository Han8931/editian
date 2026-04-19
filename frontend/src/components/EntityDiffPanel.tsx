import { useState } from 'react'
import { AlertCircle, GitCompare, Loader2, RefreshCcw } from 'lucide-react'
import { extractCompareEntities } from '../api/client'
import { useI18n } from '../i18n'
import type { CompareEntitiesResponse, CompareSlot, EntityDiffItem, EntityDiffStatus, LLMConfig } from '../types'



interface Props {
  slotA: CompareSlot
  slotB: CompareSlot
  llm: LLMConfig
  onExtracted?: (diff: EntityDiffItem[], fullData: CompareEntitiesResponse) => void
}

const STATUS_STYLES: Record<EntityDiffStatus, string> = {
  changed:   'bg-yellow-100 text-yellow-800 border-yellow-200',
  added:     'bg-green-100  text-green-800  border-green-200',
  removed:   'bg-red-100    text-red-800    border-red-200',
  unchanged: 'bg-gray-100   text-gray-600   border-gray-200',
}

function ParaBadges({ indices, label }: { indices: number[]; label: string }) {
  if (!indices.length) return <span className="text-gray-300">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {indices.slice(0, 4).map((i) => (
        <span key={i} className="rounded px-1 py-0.5 text-[10px] font-mono bg-blue-50 text-blue-600 border border-blue-100">
          {label}{i}
        </span>
      ))}
      {indices.length > 4 && (
        <span className="text-[10px] text-gray-400">+{indices.length - 4}</span>
      )}
    </span>
  )
}

function StatusBadge({ status, label }: { status: EntityDiffStatus; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[status]}`}>
      {label}
    </span>
  )
}

function EntityRow({ item, paraHint, statusLabel }: { item: EntityDiffItem; paraHint: string; statusLabel: string }) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="px-3 py-2.5 text-sm font-medium text-gray-900 whitespace-nowrap">{item.name}</td>
      <td className="px-3 py-2.5">
        <span className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{item.type}</span>
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-700">
        {item.value_a != null ? (
          <div>
            <div className="text-sm">{item.value_a || <span className="text-gray-400 italic">—</span>}</div>
            <ParaBadges indices={item.para_indices_a} label={`${paraHint} `} />
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-700">
        {item.value_b != null ? (
          <div>
            <div className="text-sm">{item.value_b || <span className="text-gray-400 italic">—</span>}</div>
            <ParaBadges indices={item.para_indices_b} label={`${paraHint} `} />
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={item.status} label={statusLabel} />
      </td>
    </tr>
  )
}

export default function EntityDiffPanel({ slotA, slotB, llm, onExtracted }: Props) {
  const { msg } = useI18n()
  const [result, setResult] = useState<CompareEntitiesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExtract() {
    setLoading(true)
    setError(null)
    try {
      const data = await extractCompareEntities({
        file_a_id: slotA.doc.file_id,
        file_b_id: slotB.doc.file_id,
        llm,
      })
      setResult(data)
      onExtracted?.(data.diff, data)
    } catch (e) {
      setError(e instanceof Error ? e.message : msg('entityDiffError'))
    } finally {
      setLoading(false)
    }
  }

  const statusLabel = (status: EntityDiffStatus): string => {
    const map: Record<EntityDiffStatus, string> = {
      changed:   msg('entityDiffStatusChanged'),
      added:     msg('entityDiffStatusAdded'),
      removed:   msg('entityDiffStatusRemoved'),
      unchanged: msg('entityDiffStatusUnchanged'),
    }
    return map[status]
  }

  if (!result && !loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-col items-center justify-center text-center px-8 py-16">
        <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-4">
          <GitCompare size={22} />
        </div>
        <h2 className="text-base font-semibold text-gray-900">{msg('entityDiffTab')}</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-md leading-relaxed">{msg('entityDiffDescription')}</p>
        <button
          type="button"
          onClick={() => void handleExtract()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 transition-colors"
        >
          <GitCompare size={15} />
          {msg('entityDiffExtract')}
        </button>
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-col items-center justify-center text-center px-8 py-16">
        <Loader2 size={28} className="animate-spin text-indigo-500 mb-4" />
        <p className="text-sm text-gray-600">{msg('entityDiffExtracting')}</p>
      </div>
    )
  }

  const changedCount = result!.diff.filter((d) => d.status !== 'unchanged').length
  const visibleItems: EntityDiffItem[] = result!.diff.filter((d) => d.status !== 'unchanged')
  const unchangedItems: EntityDiffItem[] = result!.diff.filter((d) => d.status === 'unchanged')

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompare size={16} className="text-indigo-500" />
          <span className="text-sm font-semibold text-gray-800">{msg('entityDiffTab')}</span>
          {changedCount > 0 && (
            <span className="rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200 px-2 py-0.5 text-xs font-semibold">
              {msg('entityDiffChanges', { count: changedCount })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleExtract()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <RefreshCcw size={12} />
          {msg('entityDiffReExtract')}
        </button>
      </div>

      {result!.diff.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400 py-16">
          {msg('entityDiffEmpty')}
        </div>
      ) : (
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{msg('entityDiffEntityCol')}</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">{msg('entityDiffTypeCol')}</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">{msg('entityDiffDocACol')}</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">{msg('entityDiffDocBCol')}</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">{msg('entityDiffStatusCol')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <EntityRow
                  key={item.name}
                  item={item}
                  paraHint={msg('entityDiffParaHint')}
                  statusLabel={statusLabel(item.status)}
                />
              ))}
              {unchangedItems.length > 0 && (
                <>
                  <tr>
                    <td colSpan={5} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 border-t border-gray-100">
                      {msg('entityDiffStatusUnchanged')} ({unchangedItems.length})
                    </td>
                  </tr>
                  {unchangedItems.map((item) => (
                    <EntityRow
                      key={item.name}
                      item={item}
                      paraHint={msg('entityDiffParaHint')}
                      statusLabel={statusLabel(item.status)}
                    />
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-2 text-sm text-red-600 bg-red-50">
          <AlertCircle size={13} />
          {error}
        </div>
      )}
    </div>
  )
}
