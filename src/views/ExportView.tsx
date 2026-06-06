import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/tauri'
import type { MarkdownExportMode, MarkdownExportResult, Folder, Meeting } from '../lib/types'
import { useMemosaStore } from '../store'

type ExportTab = 'collection' | 'daterange'

function buildFolderTree(folders: Folder[]): Array<Folder & { depth: number }> {
  const result: Array<Folder & { depth: number }> = []
  const childrenMap = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const key = f.parentId ?? null
    if (!childrenMap.has(key)) childrenMap.set(key, [])
    childrenMap.get(key)!.push(f)
  }
  function walk(parentId: string | null, depth: number) {
    const children = childrenMap.get(parentId) ?? []
    for (const child of children) {
      result.push({ ...child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0m'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function collectSubfolderIds(folderId: string, folders: Folder[]): Set<string> {
  const result = new Set<string>()
  result.add(folderId)
  const queue = [folderId]
  while (queue.length) {
    const parent = queue.shift()!
    for (const f of folders) {
      if (f.parentId === parent && !result.has(f.id)) {
        result.add(f.id)
        queue.push(f.id)
      }
    }
  }
  return result
}

// ── Icons ──

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FolderIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 4a1 1 0 011-1h3.586a1 1 0 01.707.293L8 4h5a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
        fill={color || 'var(--text-muted)'} opacity="0.85" />
    </svg>
  )
}

function StarIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.3l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 12l-4.2 2.3.8-4.7L1.2 6.3l4.7-.7z" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
      style={{ transition: 'transform 0.15s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)' }}>
      <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.2 10.2l3.3 3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// Animated destination card with hover lift
function DestinationCard({ label, icon, delay }: { label: string; icon: string; delay: number }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      padding: '14px 10px 12px', borderRadius: 12, flex: 1, minWidth: 80,
      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      cursor: 'default', transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      animation: `fadeIn 0.4s ease ${delay}s both`,
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)' }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  )
}

// ── Main Component ──

export function ExportView() {
  const { meetings, folders, meetingFolderAssignments } = useMemosaStore()
  const [tab, setTab] = useState<ExportTab>('collection')
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())
  const [includeSubfolders, setIncludeSubfolders] = useState(true)
  const [starredOnly, setStarredOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<MarkdownExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setResult(null); setError(null) }, [tab])

  const folderTree = useMemo(() => buildFolderTree(folders), [folders])
  const meetingMap = useMemo(() => new Map(meetings.map(m => [m.id, m])), [meetings])

  // Map folder → meetings
  const folderMeetings = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const f of folders) {
      const targetIds = includeSubfolders ? collectSubfolderIds(f.id, folders) : new Set([f.id])
      const memos: Meeting[] = []
      for (const [mid, fids] of Object.entries(meetingFolderAssignments)) {
        if (fids.some(fid => targetIds.has(fid))) {
          const m = meetingMap.get(mid)
          if (m) {
            if (starredOnly && !m.is_favorite) continue
            memos.push(m)
          }
        }
      }
      memos.sort((a, b) => b.date.localeCompare(a.date) || b.start_time.localeCompare(a.start_time))
      map.set(f.id, memos)
    }
    return map
  }, [folders, meetingMap, meetingFolderAssignments, includeSubfolders, starredOnly])

  // Per-folder metadata
  const folderMeta = useMemo(() => {
    const meta = new Map<string, { memoCount: number; totalDuration: number; starredCount: number }>()
    for (const f of folders) {
      const memos = folderMeetings.get(f.id) ?? []
      const totalDuration = memos.reduce((sum, m) => sum + m.duration_seconds, 0)
      const starredCount = memos.filter(m => m.is_favorite).length
      meta.set(f.id, { memoCount: memos.length, totalDuration, starredCount })
    }
    return meta
  }, [folders, folderMeetings])

  // Search filtering — filters folders and auto-selects matches
  const filteredFolderTree = useMemo(() => {
    if (!searchQuery.trim()) return folderTree
    const q = searchQuery.toLowerCase()
    return folderTree.filter(f => {
      // Match folder name
      if (f.name.toLowerCase().includes(q)) return true
      // Match any memo title in the folder
      const memos = folderMeetings.get(f.id) ?? []
      return memos.some(m => m.title.toLowerCase().includes(q))
    })
  }, [folderTree, searchQuery, folderMeetings])

  // Auto-select when searching
  useEffect(() => {
    if (!searchQuery.trim()) return
    const matchIds = new Set(filteredFolderTree.map(f => f.id))
    setSelectedFolderIds(matchIds)
  }, [searchQuery, filteredFolderTree])

  // Summary
  const selectionSummary = useMemo(() => {
    if (tab === 'collection') {
      const allTargetFolders = new Set<string>()
      for (const fid of selectedFolderIds) {
        const targets = includeSubfolders ? collectSubfolderIds(fid, folders) : new Set([fid])
        targets.forEach(id => allTargetFolders.add(id))
      }
      const memoIds = new Set<string>()
      for (const [mid, fids] of Object.entries(meetingFolderAssignments)) {
        if (fids.some(fid => allTargetFolders.has(fid))) memoIds.add(mid)
      }
      let totalDuration = 0
      let totalSize = 0
      let effectiveCount = 0
      for (const mid of memoIds) {
        const m = meetingMap.get(mid)
        if (m) {
          if (starredOnly && !m.is_favorite) continue
          effectiveCount++
          totalDuration += m.duration_seconds
          totalSize += m.duration_seconds * 600
        }
      }
      return { collectionCount: selectedFolderIds.size, memoCount: effectiveCount, totalDuration, totalSize }
    } else {
      const matched = meetings.filter(m => {
        if (fromDate && m.date < fromDate) return false
        if (toDate && m.date > toDate) return false
        if (starredOnly && !m.is_favorite) return false
        return true
      })
      let totalDuration = 0
      let totalSize = 0
      for (const m of matched) { totalDuration += m.duration_seconds; totalSize += m.duration_seconds * 600 }
      return { collectionCount: 0, memoCount: matched.length, totalDuration, totalSize }
    }
  }, [tab, selectedFolderIds, includeSubfolders, starredOnly, folders, meetings, meetingMap, meetingFolderAssignments, fromDate, toDate])

  const canExport = selectionSummary.memoCount > 0

  const toggleFolder = useCallback((folderId: string) => {
    setSelectedFolderIds(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId)
      return next
    })
  }, [])

  const toggleExpand = useCallback((folderId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedFolderIds(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    if (selectedFolderIds.size === filteredFolderTree.length) setSelectedFolderIds(new Set())
    else setSelectedFolderIds(new Set(filteredFolderTree.map(f => f.id)))
  }, [filteredFolderTree, selectedFolderIds.size])

  const handleExport = useCallback(async () => {
    setExporting(true); setError(null); setResult(null)
    try {
      let mode: MarkdownExportMode
      let request: Parameters<typeof api.exportMeetingsMarkdown>[0]
      if (tab === 'collection') {
        mode = 'by_folder'
        request = { mode, folder_ids: Array.from(selectedFolderIds), include_subfolders: includeSubfolders, starred_only: starredOnly || undefined }
      } else {
        mode = 'by_date_range'
        request = { mode, from_date: fromDate || undefined, to_date: toDate || undefined, starred_only: starredOnly || undefined }
      }
      const res = await api.exportMeetingsMarkdown(request)
      setResult(res)
    } catch (e) {
      const msg = String(e)
      if (!msg.includes('cancelled')) setError(msg)
    }
    finally { setExporting(false) }
  }, [tab, selectedFolderIds, includeSubfolders, starredOnly, fromDate, toDate])

  const allSelected = selectedFolderIds.size === filteredFolderTree.length && filteredFolderTree.length > 0
  const totalStarred = useMemo(() => meetings.filter(m => m.is_favorite).length, [meetings])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '28px 32px' }}>

      {/* ── Hero section ── */}
      <div style={{
        marginBottom: 28, padding: '24px 28px 20px', borderRadius: 16,
        background: 'var(--bg-hero)', border: '1px solid var(--border-subtle)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Subtle animated accent orb */}
        <div style={{
          position: 'absolute', top: -30, right: -30, width: 120, height: 120,
          borderRadius: '50%', background: 'var(--accent-dim)', opacity: 0.5,
          animation: 'quiet-breathe 6s ease-in-out infinite',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            Export
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, lineHeight: 1.25, color: 'var(--text-primary)' }}>
            Your memos. Your tools. Zero lock-in.
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 10, marginBottom: 0, lineHeight: 1.65, maxWidth: 520 }}>
            Everything stays on your Mac. Memosa never sends data to third-party services —
            your transcript is yours the moment it's captured. Export once, use everywhere.
          </p>

          {/* Visual flow: Memosa → .md → anywhere */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginTop: 18, padding: '10px 14px', borderRadius: 10,
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            width: 'fit-content',
          }}>
            <div style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: 'var(--accent)', color: '#fff', letterSpacing: '0.02em',
            }}>
              Memosa
            </div>
            <svg width="20" height="12" viewBox="0 0 20 12" fill="none" style={{ flexShrink: 0, animation: 'quiet-breathe 3s ease-in-out infinite' }}>
              <path d="M1 6h16M13 2l4 4-4 4" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono, monospace)',
            }}>
              .md
            </div>
            <svg width="20" height="12" viewBox="0 0 20 12" fill="none" style={{ flexShrink: 0, animation: 'quiet-breathe 3s ease-in-out 0.5s infinite' }}>
              <path d="M1 6h16M13 2l4 4-4 4" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
            }}>
              Anywhere
            </div>
          </div>
        </div>
      </div>

      {/* ── Destination grid ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
          Works with
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <DestinationCard icon="🧠" label="NotebookLM" delay={0} />
          <DestinationCard icon="💬" label="Claude" delay={0.05} />
          <DestinationCard icon="✨" label="ChatGPT" delay={0.1} />
          <DestinationCard icon="📝" label="Obsidian" delay={0.15} />
          <DestinationCard icon="📁" label="Google Drive" delay={0.2} />
          <DestinationCard icon="📄" label="Any .md tool" delay={0.25} />
        </div>
      </div>

      {/* ── Controls row: mode toggle + filters ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{
          display: 'inline-flex', gap: 2, padding: 3,
          background: 'var(--bg-hover)', borderRadius: 10,
        }}>
          {([
            { key: 'collection' as const, label: 'By Collection' },
            { key: 'daterange' as const, label: 'By Date Range' },
          ]).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '7px 16px', fontSize: 12, fontWeight: tab === key ? 600 : 400,
              borderRadius: 8, border: 'none', cursor: 'pointer',
              background: tab === key ? 'var(--bg-elevated)' : 'transparent',
              color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease',
            }}>
              {label}
            </button>
          ))}
        </div>

        {totalStarred > 0 && (
          <button onClick={() => setStarredOnly(!starredOnly)} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', fontSize: 11, fontWeight: 500, borderRadius: 8,
            border: starredOnly ? '1px solid var(--upcoming-border)' : '1px solid var(--border)',
            background: starredOnly ? 'var(--upcoming-dim)' : 'transparent',
            color: starredOnly ? 'var(--warning-amber)' : 'var(--text-muted)',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}>
            <StarIcon size={11} />
            Starred only
          </button>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeSubfolders} onChange={e => setIncludeSubfolders(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          Include sub-collections
        </label>
      </div>

      {/* ── Two-column layout ── */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* Left: Selection panel */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* ── Collection tab ── */}
          {tab === 'collection' && (
            <div>
              {/* Search */}
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                  <SearchIcon />
                </div>
                <input
                  type="text"
                  placeholder="Search collections or memos..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px 8px 30px', fontSize: 12,
                    borderRadius: 9, border: '1px solid var(--border)',
                    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                    padding: 0, fontSize: 14, lineHeight: 1,
                  }}>×</button>
                )}
              </div>

              {/* Select all / count */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <button onClick={selectAll} style={{
                  fontSize: 11, fontWeight: 500, color: 'var(--accent)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                }}>
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {selectedFolderIds.size} of {filteredFolderTree.length} selected
                </span>
              </div>

              {/* Folder list */}
              <div style={{
                borderRadius: 12, border: '1px solid var(--border)',
                background: 'var(--bg-elevated)', overflow: 'hidden',
                maxHeight: 440, overflowY: 'auto',
              }}>
                {filteredFolderTree.length === 0 && (
                  <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                    {searchQuery ? 'No matching collections.' : 'No collections yet. Create folders to organise your memos.'}
                  </div>
                )}
                {filteredFolderTree.map((f, i) => {
                  const isSelected = selectedFolderIds.has(f.id)
                  const isExpanded = expandedFolderIds.has(f.id)
                  const meta = folderMeta.get(f.id)
                  const memoCount = meta?.memoCount ?? 0
                  const duration = meta?.totalDuration ?? 0
                  const starredCount = meta?.starredCount ?? 0
                  const memos = folderMeetings.get(f.id) ?? []

                  return (
                    <div key={f.id}>
                      {/* Folder row */}
                      <div
                        onClick={() => toggleFolder(f.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '9px 12px', paddingLeft: 12 + f.depth * 18,
                          cursor: 'pointer',
                          background: isSelected ? 'var(--accent-dim)' : 'transparent',
                          borderBottom: (i < filteredFolderTree.length - 1 && !isExpanded) ? '1px solid var(--border-subtle)' : 'none',
                          transition: 'background 0.1s ease',
                        }}
                      >
                        {/* Expand chevron */}
                        <button
                          onClick={(e) => toggleExpand(f.id, e)}
                          style={{
                            border: 'none', background: 'none', padding: 2, cursor: 'pointer',
                            color: memoCount > 0 ? 'var(--text-secondary)' : 'var(--border-strong)',
                            flexShrink: 0, display: 'flex', alignItems: 'center',
                          }}
                          title={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          <ChevronIcon open={isExpanded} />
                        </button>

                        {/* Checkbox */}
                        <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border-strong)',
                          background: isSelected ? 'var(--accent)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', transition: 'all 0.1s ease',
                        }}>
                          {isSelected && <CheckIcon />}
                        </div>

                        <FolderIcon color={f.color} />

                        <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.name}
                        </span>

                        {/* Folder metadata */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                          {starredCount > 0 && !starredOnly && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: '#d97706' }}>
                              <StarIcon size={9} />{starredCount}
                            </span>
                          )}
                          <span>{memoCount}</span>
                          {duration > 0 && (
                            <>
                              <span style={{ opacity: 0.3 }}>·</span>
                              <span>{formatDuration(duration)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Expanded memo list */}
                      {isExpanded && memos.length > 0 && (
                        <div style={{
                          background: 'var(--bg-hover)',
                          borderBottom: i < filteredFolderTree.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        }}>
                          {memos.map((m, mi) => (
                            <div key={m.id} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 12px', paddingLeft: 28 + f.depth * 18,
                              borderTop: mi === 0 ? '1px solid var(--border-subtle)' : 'none',
                              borderBottom: mi < memos.length - 1 ? '1px solid rgba(0,0,0,0.03)' : 'none',
                              fontSize: 12,
                            }}>
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--text-muted)', opacity: 0.5 }}>
                                <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                              </svg>
                              <span style={{ flex: 1, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.title}
                              </span>
                              {m.is_favorite && (
                                <span style={{ color: '#d97706', flexShrink: 0 }}><StarIcon size={9} /></span>
                              )}
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                                {m.date}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>
                                {formatDuration(m.duration_seconds)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {isExpanded && memos.length === 0 && (
                        <div style={{
                          padding: '8px 12px', paddingLeft: 28 + f.depth * 18,
                          fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
                          background: 'var(--bg-hover)',
                          borderBottom: i < filteredFolderTree.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        }}>
                          No memos{starredOnly ? ' (starred)' : ''}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Date range tab ── */}
          {tab === 'daterange' && (
            <div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>From</label>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{
                    width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none',
                  }} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingBottom: 12 }}>–</div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>To</label>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{
                    width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none',
                  }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                {[
                  { label: '7 days', days: 7 }, { label: '30 days', days: 30 },
                  { label: '90 days', days: 90 }, { label: '1 year', days: 365 },
                  { label: 'All time', days: 0 },
                ].map(({ label, days }) => (
                  <button key={label} onClick={() => {
                    if (days === 0) { setFromDate(''); setToDate('') }
                    else {
                      const to = new Date(); const from = new Date()
                      from.setDate(from.getDate() - days)
                      setFromDate(from.toISOString().slice(0, 10)); setToDate(to.toISOString().slice(0, 10))
                    }
                  }} style={{
                    padding: '5px 12px', fontSize: 11, fontWeight: 500, borderRadius: 7,
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.12s ease',
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Summary panel */}
        <div style={{ width: 240, flexShrink: 0 }}>
          {/* Export summary card */}
          <div style={{
            padding: '20px 18px', borderRadius: 14,
            background: canExport ? 'var(--accent-dim)' : 'var(--bg-surface)',
            border: `1px solid ${canExport ? 'var(--accent-border)' : 'var(--border)'}`,
            transition: 'all 0.2s ease',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
              Export summary
            </div>

            <div style={{ fontSize: 28, fontWeight: 700, color: canExport ? 'var(--accent)' : 'var(--text-muted)', lineHeight: 1 }}>
              {selectionSummary.memoCount}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              memo{selectionSummary.memoCount !== 1 ? 's' : ''} selected
              {starredOnly && <span style={{ color: 'var(--warning-amber)' }}> (starred)</span>}
            </div>

            {selectionSummary.memoCount > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                {tab === 'collection' && selectionSummary.collectionCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Collections</span>
                    <span style={{ fontWeight: 600 }}>{selectionSummary.collectionCount}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Duration</span>
                  <span style={{ fontWeight: 600 }}>{formatDuration(selectionSummary.totalDuration)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Est. size</span>
                  <span style={{ fontWeight: 600 }}>~{formatBytes(selectionSummary.totalSize)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Format</span>
                  <span style={{ fontWeight: 600 }}>.md</span>
                </div>
              </div>
            )}

            <button
              disabled={!canExport || exporting}
              onClick={handleExport}
              style={{
                width: '100%', marginTop: 16, padding: '10px 0', fontSize: 13, fontWeight: 600,
                borderRadius: 9, border: 'none', cursor: canExport && !exporting ? 'pointer' : 'default',
                background: canExport ? 'var(--accent)' : 'var(--bg-hover)',
                color: canExport ? '#fff' : 'var(--text-muted)',
                opacity: exporting ? 0.6 : 1, transition: 'all 0.15s ease',
              }}
            >
              {exporting ? 'Exporting...' : 'Export Markdown'}
            </button>
          </div>

          {/* Result */}
          {result && (
            <div style={{
              marginTop: 12, padding: '14px 16px', borderRadius: 12,
              background: 'rgba(15, 190, 128, 0.06)', border: '1px solid rgba(15, 190, 128, 0.18)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="var(--accent)" strokeWidth="1.5" />
                  <path d="M5 8l2 2 4-4" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Done</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                {result.meeting_count} memo{result.meeting_count !== 1 ? 's' : ''} · {formatBytes(result.total_bytes)}
              </div>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)', marginTop: 6,
                fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all',
                padding: '5px 6px', background: 'var(--bg-hover)', borderRadius: 5,
              }}>
                {result.output_path}
              </div>
              <button onClick={() => api.revealExportInFinder(result.output_path).catch(() => {})} style={{
                marginTop: 8, padding: '5px 12px', fontSize: 11, fontWeight: 500, borderRadius: 7,
                border: '1px solid var(--accent-border)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer',
              }}>
                Open in Finder
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 10,
              background: 'rgba(231, 76, 60, 0.06)', border: '1px solid rgba(231, 76, 60, 0.16)',
              fontSize: 11, color: '#c0392b',
            }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* ── Why no integrations — intentional design section ── */}
      <div style={{ marginTop: 36, paddingTop: 28, borderTop: '1px solid var(--border-subtle)' }}>

        {/* Philosophy header */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" stroke="var(--accent)" strokeWidth="1.5" />
              <path d="M12 16v-4M12 8h.01" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, lineHeight: 1.3 }}>
              No integrations — by design.
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65, maxWidth: 480 }}>
              We don't pipe your transcripts into third-party services.
              We don't manage OAuth tokens or API keys. Instead, you
              get a clean <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-hover)' }}>.md</span> file
              that works everywhere — because Markdown is universal.
            </div>
          </div>
        </div>

        {/* Three-step visual flow */}
        <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', marginBottom: 24 }}>
          {[
            {
              num: '1',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v10M8 11l4 4 4-4" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5 17v2a1 1 0 001 1h12a1 1 0 001-1v-2" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ),
              title: 'Download',
              desc: 'Export your selection as a single .md file to your Mac.',
            },
            {
              num: '2',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="3" width="14" height="18" rx="2" stroke="var(--accent)" strokeWidth="1.5" />
                  <path d="M9 7h6M9 11h6M9 15h3" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ),
              title: 'Copy or drag',
              desc: 'Open it, copy the contents, or drag the file into any app.',
            },
            {
              num: '3',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13M22 2l-7 20-3-9-9-3 20-7z" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
              title: 'Use anywhere',
              desc: 'NotebookLM, Claude, ChatGPT, Obsidian — your data, your choice.',
            },
          ].map(({ num, icon, title, desc }, i) => (
            <div key={num} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{
                flex: 1, padding: '16px', borderRadius: 12,
                background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', top: 10, right: 12,
                  fontSize: 26, fontWeight: 800, color: 'var(--border-subtle)',
                  lineHeight: 1, fontFamily: 'var(--font-display)',
                }}>
                  {num}
                </div>
                <div style={{ marginBottom: 8 }}>{icon}</div>
                <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {desc}
                </div>
              </div>
              {i < 2 && (
                <div style={{ padding: '0 4px', color: 'var(--text-muted)', opacity: 0.3, flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'quiet-breathe 4s ease-in-out infinite' }}>
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Feedback callout — styled as a distinct banner */}
        <div style={{
          padding: '18px 22px', borderRadius: 14,
          background: 'linear-gradient(135deg, var(--accent-dim) 0%, var(--bg-surface) 100%)',
          border: '1px solid var(--accent-border)',
          display: 'flex', alignItems: 'center', gap: 18,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: 'var(--accent)', opacity: 0.9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'quiet-breathe 5s ease-in-out infinite',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
                stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Want scheduled exports or cloud sync?
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              We're considering automation features — scheduled exports, cloud sync, API access, Zapier.
              Tell us what would be useful and it will shape what we build next.
            </div>
          </div>
          <a
            href="https://www.memosa.dev"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 9,
              background: 'var(--accent)', color: '#fff',
              textDecoration: 'none', flexShrink: 0,
              transition: 'all 0.15s ease', border: 'none',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = 'var(--accent-hover)' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'var(--accent)' }}
          >
            Share feedback
          </a>
        </div>
      </div>
    </div>
  )
}
