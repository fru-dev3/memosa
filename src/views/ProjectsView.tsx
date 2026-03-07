import { useEffect, useRef, useState } from 'react'
import { TranscriptViewer } from '../components/library/TranscriptViewer'
import { Waveform } from '../components/recording/Waveform'
import * as api from '../lib/tauri'
import type { Folder, Meeting } from '../lib/types'
import { useMemosaStore } from '../store'

// ── icons ────────────────────────────────────────────────────────────────────

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {open ? (
        <path d="M2 5C2 4.17 2.67 3.5 3.5 3.5H6.5L8 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      ) : (
        <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6.5L8 4.5H12.5C13.33 4.5 14 5.17 14 6V12C14 12.83 13.33 13.5 12.5 13.5H3.5C2.67 13.5 2 12.83 2 12V4.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      )}
    </svg>
  )
}
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease', display: 'block' }}>
      <path d="M3.5 2.5L6.5 5L3.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function PlusIcon() {
  return <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1.5V9.5M1.5 5.5H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
}
function TrashIcon() {
  return <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 2.5H9.5M4 2.5V1.5H7V2.5M2.5 2.5L3 9.5H8L8.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function PencilIcon() {
  return <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 8.5L7.5 3L9 4.5L3.5 10H2V8.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M6.5 2L9 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
}
function DotsIcon() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="2.5" r="1.1" fill="currentColor"/><circle cx="6.5" cy="6.5" r="1.1" fill="currentColor"/><circle cx="6.5" cy="10.5" r="1.1" fill="currentColor"/></svg>
}

const FOLDER_COLORS = [
  '#0FBE80', '#3B82F6', '#8B5CF6', '#F59E0B',
  '#EF4444', '#EC4899', '#14B8A6', '#F97316',
  '#6366F1', '#84CC16', '#06B6D4', '#A78BFA',
]

function FolderMenu({
  folder,
  onRename,
  onAddChild,
  onDelete,
  onClose,
}: {
  folder: Folder
  onRename: () => void
  onAddChild: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { setFolderColor } = useMemosaStore()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="proj-folder-menu" onClick={(e) => e.stopPropagation()}>
      <button className="proj-folder-menu-item" onClick={() => { onRename(); onClose() }}>
        <PencilIcon /> Rename
      </button>
      <button className="proj-folder-menu-item" onClick={() => { onAddChild(); onClose() }}>
        <PlusIcon /> Add sub-folder
      </button>
      <div className="proj-folder-menu-divider" />
      <div className="proj-folder-menu-label">Color</div>
      <div className="proj-folder-color-grid">
        {FOLDER_COLORS.map((c) => (
          <button
            key={c}
            className={`proj-folder-color-dot${folder.color === c ? ' is-active' : ''}`}
            style={{ background: c }}
            onClick={() => { setFolderColor(folder.id, c); onClose() }}
          />
        ))}
      </div>
      <div className="proj-folder-menu-divider" />
      <button className="proj-folder-menu-item is-danger" onClick={() => { onDelete(); onClose() }}>
        <TrashIcon /> Delete
      </button>
    </div>
  )
}
function AllIcon() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="8" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M10 4.5l4-1.5v10l-4 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function GrabIcon() {
  return <svg width="10" height="14" viewBox="0 0 10 14" fill="none"><circle cx="3" cy="3" r="1" fill="currentColor"/><circle cx="7" cy="3" r="1" fill="currentColor"/><circle cx="3" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="3" cy="11" r="1" fill="currentColor"/><circle cx="7" cy="11" r="1" fill="currentColor"/></svg>
}

// ── folder tree node ──────────────────────────────────────────────────────────

function FolderNode({
  folder, depth, allFolders, selectedId, dragOverId,
  onSelect, onDelete, onAddChild, meetingCount, expandedSet, onToggleExpand,
  onFolderMouseDown, isLive,
}: {
  folder: Folder
  depth: number
  allFolders: Folder[]
  selectedId: string | null
  dragOverId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onAddChild: (parentId: string) => void
  meetingCount: (id: string) => number
  expandedSet: Set<string>
  onToggleExpand: (id: string) => void
  onFolderMouseDown: (folder: Folder, e: React.MouseEvent) => void
  isLive?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(folder.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { renameFolder } = useMemosaStore()
  const children = allFolders.filter((f) => f.parentId === folder.id)
  const count = meetingCount(folder.id)
  const isSelected = selectedId === folder.id
  const isDragOver = dragOverId === folder.id && activeFolderDragId !== folder.id
  const isExpanded = expandedSet.has(folder.id)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const startEdit = () => { setEditing(true); setEditVal(folder.name) }
  const commitRename = () => {
    const trimmed = editVal.trim()
    if (trimmed && trimmed !== folder.name) renameFolder(folder.id, trimmed)
    setEditing(false)
  }

  return (
    <div>
      <div
        data-folder-id={folder.id}
        className={`proj-folder-row${isSelected ? ' is-selected' : ''}${isDragOver ? ' is-drag-over' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => !editing && onSelect(folder.id)}
        onMouseDown={(e) => !editing && onFolderMouseDown(folder, e)}
      >
        <button
          className="proj-icon-btn"
          style={{ padding: 1, opacity: children.length ? 1 : 0, pointerEvents: children.length ? 'auto' : 'none' }}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(folder.id) }}
        >
          <ChevronIcon expanded={isExpanded} />
        </button>

        {/* Folder icon */}
        <span style={{ color: folder.color || 'var(--accent)', flexShrink: 0, pointerEvents: 'none', display: 'inline-flex' }}>
          <FolderIcon open={isExpanded && children.length > 0} />
        </span>

        {editing ? (
          <input ref={inputRef} className="proj-folder-input" value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false) }}
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="proj-folder-name" style={{ pointerEvents: 'none' }}>{folder.name}</span>
        )}

        {isLive && !editing && (
          <div style={{ width: 36, height: 16, flexShrink: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <Waveform color="var(--live)" height={16} />
          </div>
        )}

        {count > 0 && !editing && (
          <span className="proj-folder-count" style={{ pointerEvents: 'none' }}>{count}</span>
        )}

        {/* ⋮ menu trigger — only visible on hover */}
        {!editing && (
          <div className="proj-folder-actions" style={{ position: 'relative' }}>
            <button
              className="proj-icon-btn"
              title="Options"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            >
              <DotsIcon />
            </button>
            {menuOpen && (
              <FolderMenu
                folder={folder}
                onRename={startEdit}
                onAddChild={() => onAddChild(folder.id)}
                onDelete={() => onDelete(folder.id)}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>
        )}
      </div>
      {isExpanded && children.map((child) => (
        <FolderNode key={child.id} folder={child} depth={depth + 1} allFolders={allFolders}
          selectedId={selectedId} dragOverId={dragOverId}
          onSelect={onSelect} onDelete={onDelete} onAddChild={onAddChild}
          meetingCount={meetingCount} expandedSet={expandedSet} onToggleExpand={onToggleExpand}
          onFolderMouseDown={onFolderMouseDown}
          isLive={isLive} />
      ))}
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

// Module-level ref for the folder being dragged (HTML5 drag API)
let activeFolderDragId: string | null = null

// Folder breadcrumb trail
function FolderBreadcrumb({ folderId, allFolders, onClick }: { folderId: string; allFolders: Folder[]; onClick?: (id: string) => void }) {
  const path: Folder[] = []
  let current: Folder | undefined = allFolders.find((f) => f.id === folderId)
  while (current) {
    path.unshift(current)
    const parentId = current.parentId
    current = parentId ? allFolders.find((f) => f.id === parentId) : undefined
  }
  if (path.length === 0) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11 }}>
      {path.map((f, i) => (
        <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {i > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>›</span>}
          <button
            type="button"
            onClick={() => onClick?.(f.id)}
            style={{ margin: 0, padding: 0, border: 'none', background: 'transparent', fontSize: 11, color: f.color || 'var(--accent)', cursor: onClick ? 'pointer' : 'default', fontFamily: 'inherit' }}
          >
            {f.name}
          </button>
        </span>
      ))}
    </span>
  )
}

// Find closest ancestor (or self) with data-folder-id
function folderIdAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)
  let node: Element | null = el
  while (node) {
    const fid = (node as HTMLElement).dataset?.folderId
    if (fid) return fid
    node = node.parentElement
  }
  return null
}

function isRootDropAtPoint(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y)
  let node: Element | null = el
  while (node) {
    if ((node as HTMLElement).dataset?.rootDrop) return true
    node = node.parentElement
  }
  return false
}

// ── main view ─────────────────────────────────────────────────────────────────

interface DragState {
  type: 'meeting' | 'folder'
  id: string
  title: string
  startX: number
  startY: number
  active: boolean
}

export function ProjectsView() {
  const {
    meetings, folders, meetingFolderAssignments,
    currentMeeting, recordingStatus,
    setMeetings, createFolder, deleteFolder,
    assignMeetingToProject, removeMeetingFromProject,
    setActiveFolderId, moveFolder,
  } = useMemosaStore()

  const liveMeetingId = recordingStatus.is_recording ? recordingStatus.meeting_id : null
  const liveFolderIds = liveMeetingId ? (meetingFolderAssignments[liveMeetingId] ?? []) : []

  const [selectedFolderId, setSelectedFolderIdLocal] = useState<string | null>(null)

  const setSelectedFolderId = (id: string | null) => {
    setSelectedFolderIdLocal(id)
    setActiveFolderId(id)
  }
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)
  const [showFolderPanel, setShowFolderPanel] = useState(true)
  const [showMeetingPanel, setShowMeetingPanel] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [dragType, setDragType] = useState<'meeting' | 'folder' | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [rootDropHover, setRootDropHover] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  // Use refs for drag state to avoid stale closures in event handlers
  const dragRef = useRef<DragState | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)

  useEffect(() => { api.getMeetings({}).then(setMeetings).catch(() => {}) }, [setMeetings])

  // After a recording stops, auto-select the new meeting in the detail panel
  useEffect(() => {
    if (!currentMeeting) return
    setSelectedMeeting(currentMeeting)
  }, [currentMeeting?.id])

  // Auto-expand newly created folders
  useEffect(() => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      folders.forEach((f) => next.add(f.id))
      return next
    })
  }, [folders])

  // Global mouse move + up for custom drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return

      // Activate after 6px movement
      if (!d.active) {
        const dist = Math.sqrt((e.clientX - d.startX) ** 2 + (e.clientY - d.startY) ** 2)
        if (dist < 6) return
        d.active = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
        setIsDragging(true)
        setDragType(d.type)
      }

      // Move ghost directly via DOM (no React re-render per frame)
      if (ghostRef.current) {
        ghostRef.current.style.left = `${e.clientX + 16}px`
        ghostRef.current.style.top = `${e.clientY - 14}px`
      }

      // Detect which folder we're over (and root drop zone for folder drags)
      const fid = folderIdAtPoint(e.clientX, e.clientY)
      setDragOverFolderId((prev) => (prev === fid ? prev : fid))
      if (d.type === 'folder') setRootDropHover(isRootDropAtPoint(e.clientX, e.clientY))
    }

    const onUp = (e: MouseEvent) => {
      const d = dragRef.current
      if (d?.active) {
        const fid = folderIdAtPoint(e.clientX, e.clientY)
        if (d.type === 'meeting') {
          if (fid) assignMeetingToProject(d.id, fid)
        } else if (d.type === 'folder') {
          if (isRootDropAtPoint(e.clientX, e.clientY)) {
            moveFolder(d.id, null)
          } else if (fid && fid !== d.id) {
            moveFolder(d.id, fid)
            setExpandedFolders((prev) => { const next = new Set(prev); next.add(fid); return next })
          }
        }
      }
      activeFolderDragId = null
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsDragging(false)
      setDragType(null)
      setRootDropHover(false)
      setDragOverFolderId(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [assignMeetingToProject, moveFolder])

  const handleMeetingMouseDown = (meeting: Meeting, e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    dragRef.current = { type: 'meeting', id: meeting.id, title: meeting.title || 'Untitled', startX: e.clientX, startY: e.clientY, active: false }
  }

  const handleFolderMouseDown = (folder: Folder, e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    activeFolderDragId = folder.id
    dragRef.current = { type: 'folder', id: folder.id, title: folder.name, startX: e.clientX, startY: e.clientY, active: false }
  }

  const meetingCount = (folderId: string) =>
    Object.values(meetingFolderAssignments).filter((fids) => fids.includes(folderId)).length

  const rootFolders = folders.filter((f) => f.parentId === null)

  const visibleMeetings = selectedFolderId === null
    ? meetings
    : meetings.filter((m) => (meetingFolderAssignments[m.id] ?? []).includes(selectedFolderId))

  const handleAddRoot = () => {
    createFolder('New Folder')
    setTimeout(() => {
      const fs = useMemosaStore.getState().folders
      const created = fs[fs.length - 1]
      if (created) setSelectedFolderId(created.id)
    }, 50)
  }

  const handleToggleExpand = (id: string) =>
    setExpandedFolders((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <div className="page-header" style={{ padding: '24px 24px 0', marginBottom: 18 }}>
        <div>
          <div className="eyebrow">Folders</div>
          <h1 className="page-title" style={{ fontSize: 28 }}>Organise your memos.</h1>
        </div>
      </div>

    <div className="proj-root" style={{ userSelect: isDragging ? 'none' : undefined, flex: 1, overflow: 'hidden' }}>

      {/* ── folder panel ── */}
      {!showFolderPanel ? (
        <button className="proj-panel-tab" onClick={() => setShowFolderPanel(true)} title="Show projects">
          <span style={{ fontSize: 13 }}>›</span>
          <span style={{ writingMode: 'vertical-rl', fontSize: 10, fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase', userSelect: 'none' }}>Folders</span>
        </button>
      ) : (
      <div className="proj-folder-panel">
        <div className="proj-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="proj-panel-label">Folders</span>
            <button className="proj-icon-btn" title="New folder" onClick={handleAddRoot}><PlusIcon /></button>
          </div>
          <button className="proj-icon-btn" title="Collapse" onClick={() => setShowFolderPanel(false)} style={{ fontSize: 13, lineHeight: 1 }}>‹</button>
        </div>
        <div className="proj-folder-tree">
          <button
            data-root-drop="true"
            className={`proj-all-row${selectedFolderId === null ? ' is-selected' : ''}${rootDropHover ? ' is-drag-over' : ''}`}
            onClick={() => setSelectedFolderId(null)}
          >
            <span style={{ display: 'inline-flex', color: selectedFolderId === null ? 'var(--accent)' : 'var(--text-muted)' }}><AllIcon /></span>
            <span className="proj-folder-name">{dragType === 'folder' ? 'Move to top level' : 'All Memos'}</span>
            <span className="proj-folder-count">{meetings.length}</span>
          </button>
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 10px' }} />
          {rootFolders.map((folder) => (
            <FolderNode key={folder.id} folder={folder} depth={0} allFolders={folders}
              selectedId={selectedFolderId} dragOverId={dragOverFolderId}
              onSelect={setSelectedFolderId}
              onDelete={(id) => { deleteFolder(id); if (selectedFolderId === id) setSelectedFolderId(null) }}
              onAddChild={(parentId) => createFolder('New Folder', parentId)}
              meetingCount={meetingCount} expandedSet={expandedFolders} onToggleExpand={handleToggleExpand}
              onFolderMouseDown={handleFolderMouseDown}
              isLive={liveFolderIds.includes(folder.id)} />
          ))}
        </div>

        {isDragging && (
          <div className="proj-drag-hint">
            {dragRef.current?.type === 'folder'
              ? (dragOverFolderId && dragOverFolderId !== dragRef.current.id
                  ? `Move into "${folders.find((f) => f.id === dragOverFolderId)?.name ?? ''}"`
                  : 'Drag onto another folder to move it inside')
              : (dragOverFolderId
                  ? `Drop to add to "${folders.find((f) => f.id === dragOverFolderId)?.name ?? ''}"`
                  : 'Drag over a folder to assign')}
          </div>
        )}
      </div>
      )}

      {/* ── meeting list panel ── */}
      {!showMeetingPanel ? (
        <button className="proj-panel-tab" onClick={() => setShowMeetingPanel(true)} title="Show memos list">
          <span style={{ fontSize: 13 }}>›</span>
          <span style={{ writingMode: 'vertical-rl', fontSize: 10, fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase', userSelect: 'none' }}>Memos</span>
        </button>
      ) : (
      <div className="proj-meeting-panel">
        <div className="proj-panel-header">
          <span className="proj-panel-label">
            {selectedFolderId === null ? 'All Memos' : (folders.find((f) => f.id === selectedFolderId)?.name ?? 'Folder')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visibleMeetings.length}</span>
            <button className="proj-icon-btn" title="Collapse" onClick={() => setShowMeetingPanel(false)} style={{ fontSize: 13, lineHeight: 1 }}>‹</button>
          </div>
        </div>

        {visibleMeetings.length === 0 ? (
          <div className="proj-empty-state">
            {selectedFolderId === null ? <p>No memos yet.</p> : (
              <>
                <p>No memos in this folder.</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  Select "All Memos" and drag any memo onto this folder.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="proj-meeting-list">
            {selectedFolderId === null && folders.length > 0 && (
              <div className="proj-drag-tip">Hold and drag a memo onto any folder to assign it</div>
            )}
            {visibleMeetings.map((meeting) => {
              const assignedIds = meetingFolderAssignments[meeting.id] ?? []
              const assignedNames = assignedIds
                .map((fid) => folders.find((f) => f.id === fid)?.name)
                .filter(Boolean) as string[]
              const isSelected = selectedMeeting?.id === meeting.id
              const isLiveMeeting = liveMeetingId === meeting.id
              return (
                <div
                  key={meeting.id}
                  className={`proj-meeting-row${isSelected ? ' is-selected' : ''}${isLiveMeeting ? ' is-live' : ''}`}
                  onMouseDown={(e) => handleMeetingMouseDown(meeting, e)}
                  onClick={() => setSelectedMeeting(meeting)}
                  style={{ cursor: 'grab' }}
                >
                  <span className="proj-grab-handle" title="Drag to assign to a folder"><GrabIcon /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="proj-meeting-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meeting.title || 'Untitled'}</span>
                      {isLiveMeeting ? (
                        <div style={{ width: 40, height: 14, flexShrink: 0, overflow: 'hidden' }}>
                          <Waveform color="var(--live)" height={14} />
                        </div>
                      ) : (meeting.transcription_status === 'processing') && (
                        <span className="proj-transcribing-badge" title="Transcribing…">
                          <span className="proj-transcribing-spinner" />
                          <span>Transcribing</span>
                        </span>
                      )}
                    </div>
                    <div className="proj-meeting-meta">
                      <span>{meeting.date}</span>
                      {meeting.duration_seconds > 0 && <span>{fmtDuration(meeting.duration_seconds)}</span>}
                      {assignedNames.map((name) => (
                        <span key={name} className="proj-meeting-tag-count">{name}</span>
                      ))}
                    </div>
                  </div>
                  {selectedFolderId !== null && (
                    <button
                      className="proj-remove-btn"
                      title="Remove from this project"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeMeetingFromProject(meeting.id, selectedFolderId)
                        if (selectedMeeting?.id === meeting.id) setSelectedMeeting(null)
                      }}
                    >×</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* ── detail panel ── */}
      <div className="proj-detail-panel">
        {selectedMeeting ? (
          <>
            {(() => {
              const assignedIds = meetingFolderAssignments[selectedMeeting.id] ?? []
              if (assignedIds.length === 0) return null
              return (
                <div style={{ padding: '10px 16px 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {assignedIds.map((fid) => (
                    <FolderBreadcrumb
                      key={fid}
                      folderId={fid}
                      allFolders={folders}
                      onClick={(id) => setSelectedFolderId(id)}
                    />
                  ))}
                </div>
              )
            })()}
            <TranscriptViewer meeting={selectedMeeting} />
          </>
        ) : (
          <div className="proj-empty-state">
            <p>Select a memo to view its details.</p>
          </div>
        )}
      </div>

      {/* ── drag ghost (follows cursor, no React re-render per frame) ── */}
      {isDragging && (
        <div
          ref={ghostRef}
          className="proj-drag-ghost"
          style={{ position: 'fixed', top: -999, left: -999, pointerEvents: 'none', zIndex: 9999 }}
        >
          {dragRef.current?.title ?? ''}
        </div>
      )}
    </div>
    </div>
  )
}
