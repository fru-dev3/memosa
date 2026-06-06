import { useRef, useState } from 'react'
import type { Folder, Meeting } from '../../lib/types'
import { useMemosaStore } from '../../store'

interface FolderRailProps {
  meetings: Meeting[]
  selectedFolderId: string | null   // null = Inbox
  onSelectFolder: (id: string | null) => void
}

function FolderIcon({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M1 3.5A1.5 1.5 0 012.5 2h2.586a1 1 0 01.707.293L6.5 3H10.5A1.5 1.5 0 0112 4.5v6A1.5 1.5 0 0110.5 12h-8A1.5 1.5 0 011 10.5v-7z"
        fill={color}
        opacity="0.85"
      />
    </svg>
  )
}

function InboxIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="1" y="4" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1 8h2.5l1 2h4l1-2H13" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M4.5 1.5h4M6.5 1.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 140ms ease', flexShrink: 0 }}
    >
      <path d="M3.5 2.5L6.5 5l-3 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface FolderNodeProps {
  folder: Folder
  allFolders: Folder[]
  meetings: Meeting[]
  meetingFolderAssignments: Record<string, string[]>
  selectedFolderId: string | null
  onSelectFolder: (id: string | null) => void
  depth: number
  renamingId: string | null
  renameValue: string
  onRenameValueChange: (value: string) => void
  onCommitRename: () => void
  onRename: (id: string) => void
  creatingIn: string | null | 'root' | 'never'
  newFolderName: string
  onNewFolderNameChange: (value: string) => void
  onCommitCreate: (parentId: string | null) => void
  onDelete: (id: string) => void
  onCreateChild: (parentId: string) => void
  dragOverFolderId: string | null
  onDragOver: (id: string) => void
  onDragLeave: () => void
  onDrop: (folderId: string) => void
}

function FolderNode({
  folder, allFolders, meetings, meetingFolderAssignments,
  selectedFolderId, onSelectFolder, depth,
  renamingId, renameValue, onRenameValueChange, onCommitRename,
  onRename, onDelete, onCreateChild,
  creatingIn, newFolderName, onNewFolderNameChange, onCommitCreate,
  dragOverFolderId, onDragOver, onDragLeave, onDrop,
}: FolderNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const [hovered, setHovered] = useState(false)
  const children = allFolders.filter((f) => f.parentId === folder.id)
  const descendantIds = new Set<string>()
  const collectDescendants = (folderId: string) => {
    descendantIds.add(folderId)
    allFolders.filter((item) => item.parentId === folderId).forEach((item) => collectDescendants(item.id))
  }
  collectDescendants(folder.id)
  const count = meetings.filter((m) => (meetingFolderAssignments[m.id] ?? []).some((fid) => descendantIds.has(fid))).length
  const isSelected = selectedFolderId === folder.id
  const isDragOver = dragOverFolderId === folder.id
  const isRenaming = renamingId === folder.id
  const isCreatingChild = creatingIn === folder.id

  return (
    <div>
      {isRenaming ? (
        <div style={{ padding: '4px 10px', paddingLeft: 10 + depth * 14 + 26 }}>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename()
              if (e.key === 'Escape') onRenameValueChange(folder.name)
            }}
            className="library-folder-input"
          />
        </div>
      ) : (
        <div
          className={`library-folder-item ${isSelected ? 'is-selected' : ''} ${isDragOver ? 'is-drop-target' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onSelectFolder(folder.id)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onDragOver={(e) => { e.preventDefault(); onDragOver(folder.id) }}
          onDragLeave={onDragLeave}
          onDrop={(e) => { e.preventDefault(); onDrop(folder.id) }}
        >
          <button
            className="library-folder-chevron"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
            style={{ visibility: children.length > 0 ? 'visible' : 'hidden' }}
          >
            <ChevronIcon open={expanded} />
          </button>
          <FolderIcon color={folder.color} />
          <span className="library-folder-name">{folder.name}</span>
          <span className="library-folder-count">{count}</span>
          {hovered && (
            <div className="library-folder-actions" onClick={(e) => e.stopPropagation()}>
              <button title="Add subfolder" onClick={() => onCreateChild(folder.id)}>+</button>
              <button title="Rename" onClick={() => onRename(folder.id)}>✎</button>
              <button title="Delete" onClick={() => onDelete(folder.id)}>×</button>
            </div>
          )}
        </div>
      )}
      {expanded && isCreatingChild && (
        <div style={{ padding: '4px 10px', paddingLeft: 10 + depth * 14 + 26 }}>
          <input
            autoFocus
            value={newFolderName}
            placeholder="Subfolder name"
            onChange={(e) => onNewFolderNameChange(e.target.value)}
            onBlur={() => onCommitCreate(folder.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitCreate(folder.id)
              if (e.key === 'Escape') onNewFolderNameChange('')
            }}
            className="library-folder-input"
          />
        </div>
      )}
      {expanded && children.map((child) => (
        <FolderNode
          key={child.id}
          folder={child}
          allFolders={allFolders}
          meetings={meetings}
          meetingFolderAssignments={meetingFolderAssignments}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          depth={depth + 1}
          renamingId={renamingId}
          renameValue={renameValue}
          onRenameValueChange={onRenameValueChange}
          onCommitRename={onCommitRename}
          onRename={onRename}
          creatingIn={creatingIn}
          newFolderName={newFolderName}
          onNewFolderNameChange={onNewFolderNameChange}
          onCommitCreate={onCommitCreate}
          onDelete={onDelete}
          onCreateChild={onCreateChild}
          dragOverFolderId={dragOverFolderId}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />
      ))}
    </div>
  )
}

export function FolderRail({ meetings, selectedFolderId, onSelectFolder }: FolderRailProps) {
  const { folders, meetingFolderAssignments, createFolder, renameFolder, deleteFolder, assignMeetingToProject } = useMemosaStore()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creatingIn, setCreatingIn] = useState<string | null | 'root'>('never')
  const [newFolderName, setNewFolderName] = useState('')
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const dragMeetingId = useRef<string | null>(null)

  const rootFolders = folders.filter((f) => f.parentId === null)
  const inboxCount = meetings.filter((m) => !(meetingFolderAssignments[m.id]?.length)).length

  const startRename = (id: string) => {
    const folder = folders.find((f) => f.id === id)
    if (!folder) return
    setRenamingId(id)
    setRenameValue(folder.name)
  }

  const commitRename = () => {
    if (renamingId && renameValue.trim()) renameFolder(renamingId, renameValue.trim())
    setRenamingId(null)
    setRenameValue('')
  }

  const startCreate = (parentId: string | null) => {
    setCreatingIn(parentId ?? 'root')
    setNewFolderName('')
  }

  const commitCreate = (parentId: string | null) => {
    if (newFolderName.trim()) createFolder(newFolderName.trim(), parentId)
    setCreatingIn('never')
    setNewFolderName('')
  }

  const handleDrop = (folderId: string) => {
    if (dragMeetingId.current) {
      assignMeetingToProject(dragMeetingId.current, folderId)
      dragMeetingId.current = null
    }
    setDragOverFolderId(null)
  }

  const handleDropInbox = () => {
    dragMeetingId.current = null
    setDragOverFolderId(null)
  }

  // Expose drag meeting id setter for MeetingEntry drag start
  // We use a custom event on the window
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__folderRailSetDragId = (id: string) => { dragMeetingId.current = id }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5 }}>
          Organize
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
          Folders help you sort the archive. Moving a meeting here does not move the files on disk.
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>

        {/* Inbox */}
        <div
          className={`library-folder-item ${selectedFolderId === null ? 'is-selected' : ''} ${dragOverFolderId === 'inbox' ? 'is-drop-target' : ''}`}
          style={{ paddingLeft: 10 }}
          onClick={() => onSelectFolder(null)}
          onDragOver={(e) => { e.preventDefault(); setDragOverFolderId('inbox') }}
          onDragLeave={() => setDragOverFolderId(null)}
          onDrop={(e) => { e.preventDefault(); handleDropInbox() }}
        >
          <span style={{ width: 10, flexShrink: 0 }} />
          <InboxIcon />
          <span className="library-folder-name">Inbox</span>
          <span className="library-folder-count">{inboxCount}</span>
        </div>

        {/* Folder tree */}
        {rootFolders.map((folder) => (
          <FolderNode
            key={folder.id}
            folder={folder}
            allFolders={folders}
            meetings={meetings}
            meetingFolderAssignments={meetingFolderAssignments}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            depth={0}
            renamingId={renamingId}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onCommitRename={commitRename}
            onRename={startRename}
            creatingIn={creatingIn}
            newFolderName={newFolderName}
            onNewFolderNameChange={setNewFolderName}
            onCommitCreate={commitCreate}
            onDelete={deleteFolder}
            onCreateChild={(parentId) => startCreate(parentId)}
            dragOverFolderId={dragOverFolderId}
            onDragOver={setDragOverFolderId}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={handleDrop}
          />
        ))}

        {/* New root folder inline input */}
        {creatingIn === 'root' && (
          <div style={{ padding: '4px 10px' }}>
            <input
              autoFocus
              value={newFolderName}
              placeholder="Folder name"
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={() => commitCreate(null)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitCreate(null); if (e.key === 'Escape') setCreatingIn('never') }}
              className="library-folder-input"
            />
          </div>
        )}

      </div>

      {/* New folder button */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <button className="library-folder-new-btn" onClick={() => startCreate(null)}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          <span>New folder</span>
        </button>
      </div>
    </div>
  )
}
