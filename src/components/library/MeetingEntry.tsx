import { useState } from 'react'
import type { Meeting } from '../../lib/types'

// ─── Left icon ────────────────────────────────────────────────────

function iconBg(status: Meeting['transcription_status']): string {
  if (status === 'complete') return '#22c55e'
  if (status === 'processing') return 'var(--accent)'
  if (status === 'failed') return '#ef4444'
  return '#e5e7eb'
}

function iconColor(status: Meeting['transcription_status']): string {
  return status === 'not_started' ? '#9ca3af' : '#fff'
}

export function MemoIcon({ status, progress }: { status: Meeting['transcription_status']; progress?: number }) {
  const bg = iconBg(status)
  const fg = iconColor(status)

  const inner = status === 'processing' ? (
    // Waveform bars
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="6" width="2" height="4" rx="1" fill={fg} />
      <rect x="5.5" y="3.5" width="2" height="9" rx="1" fill={fg} />
      <rect x="9" y="5" width="2" height="6" rx="1" fill={fg} />
      <rect x="12.5" y="7" width="2" height="3" rx="1" fill={fg} />
    </svg>
  ) : status === 'complete' ? (
    // Document with checkmark
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="1.5" width="8" height="10" rx="1.5" stroke={fg} strokeWidth="1.3" />
      <path d="M5 6h4M5 8.5h2.5" stroke={fg} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" fill={fg} fillOpacity="0.25" />
      <path d="M10.5 12l1 1 2-2" stroke={fg} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : status === 'failed' ? (
    // Document with X
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="1.5" width="8" height="10" rx="1.5" stroke={fg} strokeWidth="1.3" />
      <path d="M5.5 5.5l3 3M8.5 5.5l-3 3" stroke={fg} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ) : (
    // Plain document
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="1.5" width="8" height="11" rx="1.5" stroke={fg} strokeWidth="1.3" />
      <path d="M5 5.5h4M5 8h4M5 10.5h2.5" stroke={fg} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )

  return (
    <div style={{
      width: 30, height: 30, borderRadius: 8, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      transition: 'background 120ms ease',
    }}>
      {inner}
    </div>
  )
}

// ─── Exported StatusIcon (used elsewhere) ─────────────────────────

export function StatusIcon({ status, progress }: { status: Meeting['transcription_status']; progress?: number }) {
  if (status === 'processing') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontSize: 10, fontWeight: 600 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          border: '1.5px solid rgba(15,190,128,0.3)',
          borderTopColor: 'var(--accent)',
          display: 'inline-block', flexShrink: 0,
          animation: 'spin 0.8s linear infinite',
        }} />
        {progress != null ? `${Math.round(progress * 100)}%` : 'Transcribing…'}
      </span>
    )
  }
  return null
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}

function formatDate(date: string, startTime?: string): string {
  const d = new Date(`${date}T12:00:00`)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const timePart = startTime ? ` · ${formatTime(startTime)}` : ''
  if (d.toDateString() === today.toDateString()) return `Today${timePart}`
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday${timePart}`
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${mm}/${dd}/${yyyy}${timePart}`
}

function formatTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  let h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

// ─── MeetingEntry ─────────────────────────────────────────────────

interface MeetingEntryProps {
  meeting: Meeting
  selected?: boolean
  progress?: number
  selecting?: boolean
  checked?: boolean
  onClick?: () => void
  onDelete?: (id: string) => void
  onOpenFolder?: (id: string) => void
  onToggleFavorite?: (id: string) => void
  onToggleChecked?: (id: string) => void
}

export function MeetingEntry({
  meeting,
  selected = false,
  progress,
  selecting = false,
  checked = false,
  onClick,
  onDelete,
  onOpenFolder,
  onToggleFavorite,
  onToggleChecked,
}: MeetingEntryProps) {
  const [hovered, setHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [pendingDelete, setPendingDelete] = useState(false)

  const dateLabel = formatDate(meeting.date, meeting.start_time)
  const duration = meeting.duration_seconds > 0 ? formatDuration(meeting.duration_seconds) : null

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 11,
          padding: '10px 12px 10px 14px',
          cursor: 'pointer',
          background: selected ? 'var(--bg-selected)' : hovered ? 'var(--bg-hover)' : 'transparent',
          borderBottom: '1px solid var(--border-subtle)',
          borderLeft: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
          transition: 'background 100ms ease',
        }}
      >
        {/* Checkbox (select mode) */}
        {selecting && (
          <button
            onClick={e => { e.stopPropagation(); onToggleChecked?.(meeting.id) }}
            style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
              background: checked ? 'var(--accent)' : 'transparent',
              padding: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-checked={checked}
          >
            {checked && (
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                <path d="M1.5 4.5l2 2L7.5 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}

        {/* Left icon */}
        <MemoIcon status={meeting.transcription_status} progress={progress} />

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.3, marginBottom: 3,
          }}>
            {meeting.title || 'Untitled'}
          </div>

          {/* Date · duration · tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {dateLabel}{duration ? ` · ${duration}` : ''}
            </span>
            {meeting.transcription_status === 'processing' && (
              <StatusIcon status={meeting.transcription_status} progress={progress} />
            )}
          </div>
          {meeting.transcription_status === 'complete' && ((meeting.people?.length ?? 0) > 0 || (meeting.themes?.length ?? 0) > 0) && (
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {[...(meeting.people ?? []).slice(0, 2), ...(meeting.themes ?? []).slice(0, 2)].join(' · ')}
            </div>
          )}
        </div>

        {/* Right side: star + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {(meeting.is_favorite || hovered || selected) && (
            <button
              onClick={e => { e.stopPropagation(); onToggleFavorite?.(meeting.id) }}
              style={{
                border: 'none', background: 'transparent', padding: '2px 3px',
                cursor: 'pointer', lineHeight: 1, fontSize: 13,
                color: meeting.is_favorite ? '#f59e0b' : 'var(--text-muted)',
                transition: 'color 100ms ease',
              }}
              aria-label={meeting.is_favorite ? 'Remove star' : 'Star'}
            >★</button>
          )}
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none" style={{ color: 'var(--border-strong)', flexShrink: 0 }}>
            <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => { setContextMenu(null); setPendingDelete(false) }} />
          <div style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 50,
            borderRadius: 12, padding: 5,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
            boxShadow: '0 16px 32px rgba(58,45,34,0.14)', minWidth: 160,
          }}>
            {[
              { label: 'Open in Finder', color: 'var(--text-primary)', fn: () => { onOpenFolder?.(meeting.id); setContextMenu(null) } },
              null,
              pendingDelete
                ? { label: 'Confirm — delete forever', color: 'var(--live)', fn: () => { onDelete?.(meeting.id); setContextMenu(null); setPendingDelete(false) } }
                : { label: 'Delete…', color: 'var(--live)', fn: () => setPendingDelete(true) },
            ].map((item, i) =>
              item === null
                ? <div key={i} style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
                : (
                  <button key={i} onClick={item.fn}
                    style={{
                      width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 7,
                      border: 'none', background: 'transparent', color: item.color,
                      fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'block',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >{item.label}</button>
                )
            )}
          </div>
        </>
      )}
    </>
  )
}
