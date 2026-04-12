import { useState, useRef, useCallback, useEffect } from 'react'
import FileUpload from './components/FileUpload'
import DocumentPreview from './components/DocumentPreview'
import Sidebar from './components/Sidebar'
import ModePanel from './components/ModePanel'
import WorkspacePanel from './components/WorkspacePanel'
import { deleteFile, getFile, branchFile, getDownloadUrl, applyRevisions, undoRevision, redoRevision } from './api/client'
import type { UploadResponse, Revision, Workspace } from './types'

const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 600
const SIDEBAR_DEFAULT = 320

const WORKSPACE_MIN = 160
const WORKSPACE_MAX = 380
const WORKSPACE_DEFAULT = 208

const LS_WORKSPACES = 'editian_workspaces'
const LS_ACTIVE     = 'editian_active_workspace'
const LS_WS_WIDTH   = 'editian_workspace_width'
const LS_MODE       = 'editian_mode'

// Stored shape: minimal — no doc (too large for localStorage)
interface StoredWorkspace { id: string; name: string; fileId: string | null; parentId?: string }

function newWorkspace(): Workspace {
  return { id: crypto.randomUUID(), name: 'New workspace', doc: null, currentSlide: 0, selectedIndices: [], selectedTable: null }
}

function loadStoredWorkspaces(): StoredWorkspace[] {
  try { return JSON.parse(localStorage.getItem(LS_WORKSPACES) ?? '[]') } catch { return [] }
}

export default function App() {
  // ── Workspace state ────────────────────────────────────────────────────
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    const stored = loadStoredWorkspaces()
    if (stored.length === 0) return [newWorkspace()]
    return stored.map((s) => ({ id: s.id, name: s.name, doc: null, currentSlide: 0, selectedIndices: [], selectedTable: null, parentId: s.parentId }))
  })

  const [activeId, setActiveId] = useState<string>(() => {
    const stored = loadStoredWorkspaces()
    const savedActive = localStorage.getItem(LS_ACTIVE) ?? ''
    return stored.find((s) => s.id === savedActive)?.id ?? stored[0]?.id ?? workspaces[0].id
  })

  // Restore docs from server on mount
  useEffect(() => {
    const stored = loadStoredWorkspaces()
    stored.forEach(async ({ id, fileId }) => {
      if (!fileId) return
      try {
        const doc = await getFile(fileId)
        setWorkspaces((prev) => prev.map((w) => w.id === id ? { ...w, doc } : w))
      } catch {
        // File missing (server restarted) — workspace stays empty, user can re-upload
      }
    })
  }, [])

  // Persist workspace list whenever it changes
  useEffect(() => {
    const toStore: StoredWorkspace[] = workspaces.map((w) => ({ id: w.id, name: w.name, fileId: w.doc?.file_id ?? null, parentId: w.parentId }))
    localStorage.setItem(LS_WORKSPACES, JSON.stringify(toStore))
  }, [workspaces])

  // Persist active workspace id
  useEffect(() => {
    localStorage.setItem(LS_ACTIVE, activeId)
  }, [activeId])

  // ── Panel widths ───────────────────────────────────────────────────────
  const [workspaceWidth, setWorkspaceWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(LS_WS_WIDTH) ?? '', 10)
    return isNaN(saved) ? WORKSPACE_DEFAULT : saved
  })
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)

  useEffect(() => { localStorage.setItem(LS_WS_WIDTH, String(workspaceWidth)) }, [workspaceWidth])

  // ── Mode ───────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'ai' | 'manual'>(() => {
    const saved = localStorage.getItem(LS_MODE)
    return saved === 'manual' ? 'manual' : 'ai'
  })
  useEffect(() => { localStorage.setItem(LS_MODE, mode) }, [mode])

  // ── UI state ───────────────────────────────────────────────────────────
  const [showDownload, setShowDownload] = useState(false)
  const [downloadName, setDownloadName] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  const isDraggingWorkspace = useRef(false)
  const isDraggingSidebar   = useRef(false)
  const containerRef        = useRef<HTMLDivElement>(null)
  const downloadInputRef    = useRef<HTMLInputElement>(null)
  const downloadAnchorRef   = useRef<HTMLAnchorElement>(null)

  // ── Derived ────────────────────────────────────────────────────────────
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0]
  const doc    = active.doc

  function patchActive(patch: Partial<Workspace>) {
    setWorkspaces((prev) => prev.map((w) => w.id === activeId ? { ...w, ...patch } : w))
  }

  // ── Workspace management ───────────────────────────────────────────────

  function handleCreateWorkspace() {
    const w = newWorkspace()
    setWorkspaces((prev) => [...prev, w])
    setActiveId(w.id)
    setShowDownload(false)
    setEditError(null)
  }

  function handleSwitchWorkspace(id: string) {
    setActiveId(id)
    setShowDownload(false)
    setEditError(null)
  }

  async function handleDeleteWorkspace(id: string) {
    const ws = workspaces.find((w) => w.id === id)
    if (ws?.doc) await deleteFile(ws.doc.file_id).catch(() => {})
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.id !== id)
      if (next.length === 0) {
        const fresh = newWorkspace()
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) setActiveId(next[next.length - 1].id)
      return next
    })
  }

  function handleRenameWorkspace(id: string, name: string) {
    setWorkspaces((prev) => prev.map((w) => w.id === id ? { ...w, name } : w))
  }

  async function handleBranchWorkspace(id: string) {
    const ws = workspaces.find((w) => w.id === id)
    if (!ws?.doc) return
    try {
      const branchedDoc = await branchFile(ws.doc.file_id)
      const siblingCount = workspaces.filter((w) => w.parentId === id).length
      const branch: Workspace = {
        id: crypto.randomUUID(),
        name: `${ws.name} — branch ${siblingCount + 1}`,
        doc: branchedDoc,
        currentSlide: ws.currentSlide,
        selectedIndices: [],
        selectedTable: null,
        parentId: id,
      }
      setWorkspaces((prev) => [...prev, branch])
      setActiveId(branch.id)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Branch failed.')
    }
  }

  // ── Document handlers ──────────────────────────────────────────────────

  function handleUpload(uploaded: UploadResponse) {
    patchActive({ doc: uploaded, name: uploaded.name, currentSlide: 0, selectedIndices: [], selectedTable: null })
  }

  function handleDocumentUpdate(updated: UploadResponse) {
    patchActive({ doc: updated, selectedIndices: [], selectedTable: null })
  }

  async function handleDirectEdit(revision: Revision) {
    if (!doc) return
    // Capture IDs before the await — activeId may change if user switches workspaces
    // while the API call is in flight.
    const targetId = activeId
    const fileId   = doc.file_id
    setEditError(null)
    try {
      const newDoc = await applyRevisions(fileId, [revision])
      setWorkspaces((prev) =>
        prev.map((w) => w.id === targetId ? { ...w, doc: newDoc, selectedIndices: [] } : w)
      )
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Edit failed.')
    }
  }

  async function handleUndo() {
    if (!doc) return
    try { patchActive({ doc: await undoRevision(doc.file_id) }) }
    catch (e) { setEditError(e instanceof Error ? e.message : 'Undo failed.') }
  }

  async function handleRedo() {
    if (!doc) return
    try { patchActive({ doc: await redoRevision(doc.file_id) }) }
    catch (e) { setEditError(e instanceof Error ? e.message : 'Redo failed.') }
  }

  async function handleCloseDoc() {
    if (doc) await deleteFile(doc.file_id).catch(() => {})
    patchActive({ doc: null, name: 'New workspace', currentSlide: 0, selectedIndices: [], selectedTable: null })
    setShowDownload(false)
  }

  // ── Download ───────────────────────────────────────────────────────────

  function openDownload() {
    if (!doc) return
    setDownloadName(`revised_${doc.name}`)
    setShowDownload(true)
  }

  async function triggerDownload() {
    const url  = getDownloadUrl(doc!.file_id)
    const name = downloadName || `revised_${doc!.name}`
    const ext  = name.split('.').pop()?.toLowerCase() ?? 'docx'
    const mime = ext === 'pptx'
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({ suggestedName: name, types: [{ description: `${ext.toUpperCase()} file`, accept: { [mime]: [`.${ext}`] } }] })
        const blob = await fetch(url).then((r) => r.blob())
        const w = await handle.createWritable()
        await w.write(blob); await w.close()
        setShowDownload(false); return
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return
      }
    }
    downloadAnchorRef.current?.click()
    setShowDownload(false)
  }

  // ── Drag-to-resize ─────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (isDraggingWorkspace.current) {
      setWorkspaceWidth(Math.min(WORKSPACE_MAX, Math.max(WORKSPACE_MIN, e.clientX - rect.left)))
    }
    if (isDraggingSidebar.current) {
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, rect.right - e.clientX)))
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    isDraggingWorkspace.current = false
    isDraggingSidebar.current   = false
    document.body.style.cursor     = ''
    document.body.style.userSelect = ''
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setShowDownload(false); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && doc) { e.preventDefault(); handleUndo() }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && doc) { e.preventDefault(); handleRedo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, activeId])

  useEffect(() => {
    if (showDownload && downloadInputRef.current) {
      const el = downloadInputRef.current
      el.focus()
      const dot = downloadName.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : downloadName.length)
    }
  }, [showDownload])

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">

      {/* Top bar */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center px-5 gap-3 flex-shrink-0 shadow-sm z-10">
        <span className="font-semibold text-gray-800 text-sm">Editian</span>
        {doc && (
          <>
            <span className="text-gray-300">|</span>
            <span className="text-sm text-gray-500 truncate max-w-xs">{doc.name}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button onClick={handleUndo} disabled={!doc?.can_undo} title="Undo (⌘Z)"
              className="w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm">↩</button>
            <button onClick={handleRedo} disabled={!doc?.can_redo} title="Redo (⌘⇧Z)"
              className="w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm">↪</button>
          </div>
          {doc && (
            <>
              <div className="w-px h-4 bg-gray-200" />
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                {(['ai', 'manual'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      mode === m
                        ? 'bg-white text-gray-800 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {m === 'ai' ? 'AI' : 'Manual'}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="w-px h-4 bg-gray-200" />
          {doc && (
            <div className="relative">
              <button onClick={openDownload} className="text-sm text-blue-500 hover:text-blue-700 font-medium transition-colors">Download</button>
              {showDownload && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowDownload(false)} />
                  <div className="absolute right-0 top-8 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-72">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">File name</p>
                    <input ref={downloadInputRef} type="text" value={downloadName} onChange={(e) => setDownloadName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') triggerDownload() }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3" spellCheck={false} />
                    <div className="flex gap-2">
                      <button onClick={triggerDownload} className="flex-1 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors">Download</button>
                      <button onClick={() => setShowDownload(false)} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
                    </div>
                    <a ref={downloadAnchorRef} href={getDownloadUrl(doc.file_id)} download={downloadName || `revised_${doc.name}`} className="hidden" />
                  </div>
                </>
              )}
            </div>
          )}
          {doc && <button onClick={handleCloseDoc} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Close</button>}
        </div>
      </header>

      {/* Error banner */}
      {editError && (
        <div className="flex-shrink-0 bg-red-50 border-b border-red-200 px-5 py-2 flex items-center gap-3 text-sm text-red-700 z-10">
          <span className="flex-1">{editError}</span>
          <button onClick={() => setEditError(null)} className="text-red-400 hover:text-red-600 font-medium">✕</button>
        </div>
      )}

      {/* Body */}
      <div
        ref={containerRef}
        className="flex-1 flex overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Workspace panel */}
        <WorkspacePanel
          workspaces={workspaces}
          activeId={activeId}
          onSelect={handleSwitchWorkspace}
          onCreate={handleCreateWorkspace}
          onDelete={handleDeleteWorkspace}
          onRename={handleRenameWorkspace}
          onBranch={handleBranchWorkspace}
          style={{ width: workspaceWidth, minWidth: workspaceWidth }}
        />

        {/* Workspace panel resize handle */}
        <div
          className="w-1 flex-shrink-0 bg-gray-700 hover:bg-blue-500 active:bg-blue-600 cursor-col-resize transition-colors"
          onMouseDown={() => {
            isDraggingWorkspace.current = true
            document.body.style.cursor     = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
        />

        {/* Main content */}
        {!doc ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <FileUpload onUpload={handleUpload} />
          </div>
        ) : (
          <>
            <DocumentPreview
              doc={doc}
              mode={mode}
              currentSlide={active.currentSlide}
              onSlideChange={(i) => patchActive({ currentSlide: i, selectedIndices: [] })}
              selectedIndices={active.selectedIndices}
              onSelectionChange={(indices) => patchActive({ selectedIndices: indices, selectedTable: null })}
              selectedTable={active.selectedTable}
              onTableSelect={(idx) => patchActive({ selectedTable: idx, selectedIndices: [] })}
              onDirectEdit={handleDirectEdit}
            />

            {/* Edit sidebar resize handle */}
            <div
              className="w-1 flex-shrink-0 bg-gray-200 hover:bg-blue-400 active:bg-blue-500 cursor-col-resize transition-colors"
              onMouseDown={() => {
                isDraggingSidebar.current = true
                document.body.style.cursor     = 'col-resize'
                document.body.style.userSelect = 'none'
              }}
            />

            {mode === 'manual' ? (
              <ModePanel
                doc={doc}
                style={{ width: sidebarWidth, minWidth: sidebarWidth }}
              />
            ) : (
              <Sidebar
                doc={doc}
                currentSlide={active.currentSlide}
                onSlideChange={(i) => patchActive({ currentSlide: i, selectedIndices: [] })}
                onDocumentUpdate={handleDocumentUpdate}
                selectedIndices={active.selectedIndices}
                selectedTable={active.selectedTable}
                style={{ width: sidebarWidth, minWidth: sidebarWidth }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
