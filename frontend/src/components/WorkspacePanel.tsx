import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { Plus, Trash2, FileText, Pencil, GitBranch } from 'lucide-react'
import type { Workspace } from '../types'

interface Props {
  workspaces: Workspace[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onBranch: (id: string) => void
  style?: CSSProperties
}

interface TreeNode {
  ws: Workspace
  depth: number
  isLast: boolean
}

/** Depth-first tree traversal preserving insertion order within each level. */
function buildTree(workspaces: Workspace[]): TreeNode[] {
  const ids = new Set(workspaces.map((w) => w.id))
  const result: TreeNode[] = []

  function visit(ws: Workspace, depth: number, siblings: Workspace[], idx: number) {
    const children = workspaces.filter((w) => w.parentId === ws.id)
    result.push({ ws, depth, isLast: idx === siblings.length - 1 && children.length === 0 })
    children.forEach((child, i) => visit(child, depth + 1, children, i))
  }

  const roots = workspaces.filter((w) => !w.parentId || !ids.has(w.parentId))
  roots.forEach((ws, i) => visit(ws, 0, roots, i))
  return result
}

export default function WorkspacePanel({
  workspaces, activeId, onSelect, onCreate, onDelete, onRename, onBranch, style,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editingId) inputRef.current?.select() }, [editingId])

  function startRename(ws: Workspace) { setEditingId(ws.id); setDraft(ws.name) }
  function commitRename() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim())
    setEditingId(null)
  }

  const tree = buildTree(workspaces)

  return (
    <div className="flex-shrink-0 bg-gray-900 flex flex-col h-full border-r border-gray-800 overflow-hidden" style={style}>
      {/* Header */}
      <div className="p-3 border-b border-gray-800 flex-shrink-0">
        <button
          onClick={onCreate}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors"
        >
          <Plus size={14} />
          New workspace
        </button>
      </div>

      {/* Tree list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
        {tree.map(({ ws, depth }) => {
          const isActive  = ws.id === activeId
          const isEditing = editingId === ws.id
          const isBranch  = !!ws.parentId

          return (
            <div
              key={ws.id}
              onClick={() => !isEditing && onSelect(ws.id)}
              style={{ paddingLeft: depth * 16 + 8 }}
              className={`group relative flex items-center gap-1.5 pr-2 py-2 rounded-lg cursor-pointer transition-colors ${
                isActive ? 'bg-gray-700' : 'hover:bg-gray-800'
              }`}
            >
              {/* Branch connector */}
              {isBranch && (
                <span className="flex-shrink-0 text-gray-600 text-xs leading-none select-none">└</span>
              )}

              {/* Icon */}
              {isBranch
                ? <GitBranch size={12} className="flex-shrink-0 text-blue-400 opacity-70" />
                : <FileText  size={13} className="flex-shrink-0 text-gray-500" />
              }

              {isEditing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditingId(null)
                    e.stopPropagation()
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-gray-600 text-white text-xs rounded px-1 py-0.5 outline-none"
                />
              ) : (
                <span className={`flex-1 min-w-0 truncate text-xs ${isActive ? 'text-white' : 'text-gray-400'}`}>
                  {ws.name}
                </span>
              )}

              {/* Action buttons */}
              {!isEditing && (
                <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {ws.doc && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onBranch(ws.id) }}
                      className="p-0.5 text-gray-500 hover:text-blue-400 transition-colors"
                      title="Branch from here"
                    >
                      <GitBranch size={11} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(ws) }}
                    className="p-0.5 text-gray-500 hover:text-gray-200 transition-colors"
                    title="Rename"
                  >
                    <Pencil size={11} />
                  </button>
                  {workspaces.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(ws.id) }}
                      className="p-0.5 text-gray-500 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
