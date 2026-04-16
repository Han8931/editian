import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { Plus, Trash2, FileText, Pencil, GitBranch, FolderOpen, Folder, FolderPlus, ChevronRight, ChevronDown } from 'lucide-react'
import type { Workspace, Directory } from '../types'

interface Props {
  workspaces: Workspace[]
  directories: Directory[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onBranch: (id: string) => void
  onCreateDirectory: () => void
  onDeleteDirectory: (id: string) => void
  onRenameDirectory: (id: string, name: string) => void
  onMoveWorkspace: (workspaceId: string, directoryId: string | null) => void
  style?: CSSProperties
}

interface WorkspaceNode {
  ws: Workspace
  depth: number
}

/** Returns a workspace and all its branch descendants, in tree order. */
function flattenBranches(root: Workspace, all: Workspace[], depth = 0): WorkspaceNode[] {
  const nodes: WorkspaceNode[] = [{ ws: root, depth }]
  all.filter((w) => w.parentId === root.id).forEach((child) => {
    nodes.push(...flattenBranches(child, all, depth + 1))
  })
  return nodes
}

/** Root workspaces (no parentId, or parent no longer exists) for a given directoryId. */
function rootWorkspacesIn(all: Workspace[], directoryId: string | null): Workspace[] {
  const ids = new Set(all.map((w) => w.id))
  return all.filter((w) =>
    (!w.parentId || !ids.has(w.parentId)) &&
    (directoryId === null ? !w.directoryId : w.directoryId === directoryId),
  )
}

function FileBadge({ type }: { type: 'docx' | 'pptx' | 'markdown' }) {
  return (
    <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-px rounded ${
      type === 'docx'
        ? 'bg-blue-900/60 text-blue-300'
        : type === 'pptx'
        ? 'bg-orange-900/60 text-orange-300'
        : 'bg-emerald-900/60 text-emerald-300'
    }`}>
      {type === 'markdown' ? 'md' : type}
    </span>
  )
}

export default function WorkspacePanel({
  workspaces, directories, activeId, onSelect, onCreate, onDelete, onRename, onBranch,
  onCreateDirectory, onDeleteDirectory, onRenameDirectory, onMoveWorkspace, style,
}: Props) {
  // Workspace rename
  const [editingWsId, setEditingWsId] = useState<string | null>(null)
  const [wsDraft, setWsDraft] = useState('')
  const wsInputRef = useRef<HTMLInputElement>(null)

  // Directory rename
  const [editingDirId, setEditingDirId] = useState<string | null>(null)
  const [dirDraft, setDirDraft] = useState('')
  const dirInputRef = useRef<HTMLInputElement>(null)

  // Collapsed directories
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Drag state — ref to avoid stale closures in event handlers
  const draggedIdRef = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | 'root' | null>(null)

  useEffect(() => { if (editingWsId) wsInputRef.current?.select() }, [editingWsId])
  useEffect(() => { if (editingDirId) {
    dirInputRef.current?.select()
    dirInputRef.current?.focus()
  }}, [editingDirId])

  function startRenameWs(ws: Workspace) { setEditingWsId(ws.id); setWsDraft(ws.name) }
  function commitRenameWs() {
    if (editingWsId && wsDraft.trim()) onRename(editingWsId, wsDraft.trim())
    setEditingWsId(null)
  }

  function startRenameDir(dir: Directory) { setEditingDirId(dir.id); setDirDraft(dir.name) }
  function commitRenameDir() {
    if (editingDirId && dirDraft.trim()) onRenameDirectory(editingDirId, dirDraft.trim())
    setEditingDirId(null)
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Drag helpers ──────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, wsId: string) {
    draggedIdRef.current = wsId
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', wsId)
    // Slight delay so the ghost renders before we change style
    setTimeout(() => {
      const el = document.getElementById(`ws-row-${wsId}`)
      if (el) el.style.opacity = '0.4'
    }, 0)
  }

  function onDragEnd(wsId: string) {
    draggedIdRef.current = null
    setDragOver(null)
    const el = document.getElementById(`ws-row-${wsId}`)
    if (el) el.style.opacity = ''
  }

  function onDropOn(target: string | 'root') {
    const id = draggedIdRef.current
    if (!id) return
    onMoveWorkspace(id, target === 'root' ? null : target)
    setDragOver(null)
  }

  // ── Render helpers ────────────────────────────────────────────────────

  function WorkspaceRow({ ws, depth }: WorkspaceNode) {
    const isActive  = ws.id === activeId
    const isEditing = editingWsId === ws.id
    const isBranch  = !!ws.parentId
    const isDraggable = !isBranch

    return (
      <div
        id={`ws-row-${ws.id}`}
        onClick={() => !isEditing && onSelect(ws.id)}
        draggable={isDraggable}
        onDragStart={isDraggable ? (e) => onDragStart(e, ws.id) : undefined}
        onDragEnd={isDraggable ? () => onDragEnd(ws.id) : undefined}
        style={{ paddingLeft: depth * 14 + 10 }}
        className={`group relative flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer transition-colors ${
          isActive ? 'bg-gray-700/70' : 'hover:bg-gray-800/60'
        } ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {isBranch && (
          <span className="flex-shrink-0 text-gray-600 text-xs leading-none select-none" style={{ marginLeft: -4 }}>└</span>
        )}
        {isBranch
          ? <GitBranch size={11} className="flex-shrink-0 text-blue-400/80" />
          : <FileText  size={12} className={`flex-shrink-0 ${ws.doc ? 'text-gray-400' : 'text-gray-600'}`} />
        }

        {isEditing ? (
          <input
            ref={wsInputRef}
            value={wsDraft}
            onChange={(e) => setWsDraft(e.target.value)}
            onBlur={commitRenameWs}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRenameWs()
              if (e.key === 'Escape') setEditingWsId(null)
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-gray-600 text-white text-xs rounded px-1 py-0.5 outline-none"
          />
        ) : (
          <span className={`flex-1 min-w-0 truncate text-xs font-medium ${isActive ? 'text-white' : 'text-gray-300'}`}>
            {ws.name}
          </span>
        )}

        {ws.doc && <FileBadge type={ws.doc.file_type} />}

        {!isEditing && (
          <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {ws.doc && (
              <button onClick={(e) => { e.stopPropagation(); onBranch(ws.id) }} className="p-0.5 text-gray-600 hover:text-blue-400 transition-colors" title="Branch">
                <GitBranch size={11} />
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); startRenameWs(ws) }} className="p-0.5 text-gray-600 hover:text-gray-200 transition-colors" title="Rename">
              <Pencil size={11} />
            </button>
            {workspaces.length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(ws.id) }} className="p-0.5 text-gray-600 hover:text-red-400 transition-colors" title="Delete">
                <Trash2 size={11} />
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  function renderWorkspaces(roots: Workspace[], baseDepth = 0) {
    return roots.flatMap((root) =>
      flattenBranches(root, workspaces, baseDepth).map((node) => (
        <WorkspaceRow key={node.ws.id} {...node} />
      ))
    )
  }

  const docCount = workspaces.filter((w) => w.doc).length
  const hasDirs = directories.length > 0

  return (
    <div
      className="flex-shrink-0 bg-gray-900 flex flex-col h-full border-r border-gray-800 overflow-hidden"
      style={style}
      // Root drop zone — only fires when not over a directory
      onDragOver={(e) => {
        if (!draggedIdRef.current) return
        e.preventDefault()
        if (dragOver !== 'root') setDragOver('root')
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
      }}
      onDrop={(e) => {
        if (dragOver === 'root') { e.preventDefault(); onDropOn('root') }
      }}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-800 flex-shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <FolderOpen size={13} className="text-gray-500" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Workspaces</span>
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-xs text-gray-600 mr-1">{workspaces.length}</span>
            <button onClick={onCreateDirectory} className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors" title="New folder">
              <FolderPlus size={13} />
            </button>
            <button onClick={onCreate} className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors" title="New workspace">
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="text-[10px] text-gray-600 leading-none">
          {docCount === 0 ? 'No documents loaded' : `${docCount} document${docCount > 1 ? 's' : ''} loaded`}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">

        {/* Directories */}
        {directories.map((dir) => {
          const isOpen    = !collapsed.has(dir.id)
          const isOver    = dragOver === dir.id
          const isEditing = editingDirId === dir.id
          const roots     = rootWorkspacesIn(workspaces, dir.id)

          return (
            <div
              key={dir.id}
              // Directory drop zone
              onDragOver={(e) => {
                if (!draggedIdRef.current) return
                e.preventDefault()
                e.stopPropagation()
                if (dragOver !== dir.id) setDragOver(dir.id)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dragOver === dir.id) setDragOver(null)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDropOn(dir.id)
              }}
            >
              {/* Directory header */}
              <div className={`group flex items-center gap-1.5 px-2 py-1.5 transition-colors ${
                isOver
                  ? 'bg-blue-600/20 ring-1 ring-inset ring-blue-500/40'
                  : 'hover:bg-gray-800/60'
              }`}>
                <button
                  onClick={() => toggleCollapse(dir.id)}
                  className="flex-shrink-0 text-gray-600 hover:text-gray-300 transition-colors"
                >
                  {isOpen
                    ? <ChevronDown size={12} />
                    : <ChevronRight size={12} />
                  }
                </button>

                {isOver
                  ? <FolderOpen size={13} className="flex-shrink-0 text-blue-400" />
                  : <Folder     size={13} className="flex-shrink-0 text-gray-500 group-hover:text-gray-400" />
                }

                {isEditing ? (
                  <input
                    ref={dirInputRef}
                    value={dirDraft}
                    onChange={(e) => setDirDraft(e.target.value)}
                    onBlur={commitRenameDir}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRenameDir()
                      if (e.key === 'Escape') setEditingDirId(null)
                      e.stopPropagation()
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-gray-600 text-white text-xs rounded px-1 py-0.5 outline-none"
                  />
                ) : (
                  <span className={`flex-1 min-w-0 truncate text-xs font-medium ${isOver ? 'text-blue-300' : 'text-gray-400'}`}>
                    {dir.name}
                  </span>
                )}

                {!isEditing && (
                  <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[10px] text-gray-600 mr-0.5">{roots.length}</span>
                    <button onClick={(e) => { e.stopPropagation(); startRenameDir(dir) }} className="p-0.5 text-gray-600 hover:text-gray-200 transition-colors" title="Rename folder">
                      <Pencil size={11} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onDeleteDirectory(dir.id) }} className="p-0.5 text-gray-600 hover:text-red-400 transition-colors" title="Delete folder">
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>

              {/* Workspaces inside directory */}
              {isOpen && (
                <div>
                  {roots.length === 0 ? (
                    <div className={`px-6 py-1.5 text-[10px] italic transition-colors ${isOver ? 'text-blue-400/60' : 'text-gray-700'}`}>
                      {isOver ? 'Drop here' : 'Empty folder'}
                    </div>
                  ) : (
                    renderWorkspaces(roots, 1)
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Root section separator (only when directories exist) */}
        {hasDirs && (
          <div className={`mx-2 my-1 flex items-center gap-2 transition-colors ${
            dragOver === 'root' ? 'text-blue-400' : 'text-gray-700'
          }`}>
            <div className={`flex-1 h-px ${dragOver === 'root' ? 'bg-blue-500/40' : 'bg-gray-800'}`} />
            <span className="text-[9px] uppercase tracking-widest select-none">No folder</span>
            <div className={`flex-1 h-px ${dragOver === 'root' ? 'bg-blue-500/40' : 'bg-gray-800'}`} />
          </div>
        )}

        {/* Root workspaces */}
        {renderWorkspaces(rootWorkspacesIn(workspaces, null))}

      </div>
    </div>
  )
}
