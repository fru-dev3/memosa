import { useState } from 'react'
import type { Meeting } from '../../lib/types'

// ─── Icon helpers ─────────────────────────────────────────────────

function IconTranscribed() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-label="Transcribed">
      <rect x="1" y="1" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M3 4h5M3 6.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="9.5" cy="9.5" r="2.5" fill="var(--accent)"/>
      <path d="M8.4 9.5l.8.8 1.3-1.3" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function IconFailed() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-label="Transcription failed">
      <circle cx="6" cy="6" r="5" stroke="var(--live)" strokeWidth="1.3"/>
      <path d="M4.5 4.5l3 3M7.5 4.5l-3 3" stroke="var(--live)" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}
function IconLocalOnly() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-label="Local only">
      <rect x="1.5" y="5" width="8" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M3.5 5V3.5a2 2 0 014 0V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

// ─── Status icon ──────────────────────────────────────────────────

export function StatusIcon({ status, progress }: { status: Meeting['transcription_status']; progress?: number }) {
  if (status === 'complete') {
    return (
      <span title="Transcribed" style={{ display: 'inline-flex', color: 'var(--accent)' }}>
        <IconTranscribed />
      </span>
    )
  }
  if (status === 'processing') {
    return (
      <span title={progress != null ? `Transcribing ${Math.round(progress * 100)}%` : 'Transcribing…'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent)', fontSize: 9, fontWeight: 600 }}>
        <span
          className="spinner"
          style={{
            width: 8, height: 8, borderRadius: '50%',
            border: '1.5px solid rgba(15,190,128,0.3)',
            borderTopColor: 'var(--accent)',
            display: 'inline-block', flexShrink: 0,
          }}
        />
        {progress != null && `${Math.round(progress * 100)}%`}
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span title="Transcription failed" style={{ display: 'inline-flex' }}>
        <IconFailed />
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

function formatDate(date: string, time: string): string {
  const d = new Date(`${date}T${time}`)
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
        className="library-entry-row"
        style={{
          padding: '12px 14px',
          cursor: 'pointer',
          background: selected ? 'var(--bg-selected)' : 'transparent',
          borderLeft: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
          borderBottom: '1px solid var(--border-subtle)',
          transition: 'background 120ms ease, transform 120ms ease',
        }}
        onMouseEnter={e => {
          if (!selected) {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'var(--bg-hover)'
            el.style.transform = 'translateX(1px)'
          }
        }}
        onMouseLeave={e => {
          if (!selected) {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'transparent'
            el.style.transform = 'translateX(0)'
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {selecting && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleChecked?.(meeting.id) }}
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                background: checked ? 'var(--accent)' : 'transparent',
                flexShrink: 0,
                marginTop: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                cursor: 'pointer',
                transition: 'background 120ms ease, border-color 120ms ease',
              }}
              aria-checked={checked}
            >
              {checked && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: '0 0 3px',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.3,
        }}>
          {meeting.title}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
          {meeting.source_app && <span className="chip chip-muted" style={{ fontSize: 9 }}>{meeting.source_app}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {formatDate(meeting.date, meeting.start_time)}
            </span>
            {meeting.duration_seconds > 0 && (
              <>
                <span style={{ color: 'var(--border-strong)', fontSize: 10 }}>·</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatDuration(meeting.duration_seconds)}
                </span>
              </>
            )}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, color: 'var(--text-muted)' }}>
            {meeting.local_only !== false && (
              <span title="Local only"><IconLocalOnly /></span>
            )}
            <StatusIcon status={meeting.transcription_status} progress={progress} />
          </div>
        </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(meeting.id) }}
            style={{
              border: 'none',
              background: 'transparent',
              color: meeting.is_favorite ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              fontSize: 15,
            }}
            aria-label={meeting.is_favorite ? 'Remove favorite' : 'Add favorite'}
          >
            ★
          </button>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 50,
            borderRadius: 16,
            padding: '6px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 24px 40px rgba(58,45,34,0.14)',
            minWidth: 168,
          }}>
            <button
              style={{
                width: '100%', display: 'block', textAlign: 'left',
                padding: '6px 10px', borderRadius: 6, border: 'none',
                background: 'transparent', color: 'var(--text-primary)',
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              onClick={() => { onOpenFolder?.(meeting.id); setContextMenu(null) }}
            >
              Open in Finder
            </button>
            <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
            <button
              style={{
                width: '100%', display: 'block', textAlign: 'left',
                padding: '6px 10px', borderRadius: 6, border: 'none',
                background: 'transparent', color: 'var(--live)',
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--live-dim)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              onClick={() => { onDelete?.(meeting.id); setContextMenu(null) }}
            >
              Delete Recording
            </button>
          </div>
        </>
      )}
    </>
  )
}
