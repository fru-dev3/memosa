import { useEffect, useRef, useState } from 'react'
import * as api from '../../lib/tauri'
import type { VoiceMemoEntry } from '../../lib/tauri'
import { useMemosaStore } from '../../store'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number) {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m < 60) return s > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${m}:00`
  const h = Math.floor(m / 60); const rm = m % 60
  return `${h}:${String(rm).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
}

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtRelativeDate(date: string) {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (date === today) return 'Today'
  if (date === yesterday) return 'Yesterday'
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// Waveform bars — decorative, represents audio
function MiniWaveform({ seed = 0, color = 'currentColor' }: { seed?: number; color?: string }) {
  const bars = Array.from({ length: 20 }, (_, i) => {
    const h = 4 + Math.abs(Math.sin((i + seed) * 1.7 + seed * 0.3)) * 20
    return Math.round(h)
  })
  return (
    <svg width="44" height="24" viewBox="0 0 44 24" fill="none" aria-hidden="true">
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 2.2}
          y={(24 - h) / 2}
          width={1.4}
          height={h}
          rx={0.7}
          fill={color}
          opacity={0.7 + (i % 3) * 0.1}
        />
      ))}
    </svg>
  )
}

// Big decorative waveform for empty/idle state
function HeroWaveform() {
  const bars = Array.from({ length: 48 }, (_, i) => {
    const h = 8 + Math.abs(Math.sin(i * 0.55) * 48 + Math.sin(i * 1.3) * 16)
    return Math.round(h)
  })
  return (
    <svg width="280" height="64" viewBox="0 0 280 64" fill="none" aria-hidden="true" style={{ opacity: 0.18 }}>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 5.8 + 1}
          y={(64 - h) / 2}
          width={3.6}
          height={h}
          rx={1.8}
          fill="var(--accent)"
        />
      ))}
    </svg>
  )
}

type Phase = 'idle' | 'scanning' | 'selecting' | 'importing' | 'done'

export function VoiceMemosImport() {
  const { upsertMeeting } = useMemosaStore()
  const [phase, setPhase] = useState<Phase>('idle')
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<VoiceMemoEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ current: number; total: number; title: string } | null>(null)
  const [importedCount, setImportedCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const unlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    api.onImportProgress((data) => setProgress(data)).then((u) => { unlistenRef.current = u })
    return () => unlistenRef.current?.()
  }, [])

  const handlePickAndScan = async () => {
    setError(null)
    setPhase('scanning')
    try {
      const path = await api.pickImportFolder()
      if (!path) { setPhase('idle'); return }
      setFolderPath(path)
      const found = await api.scanVoiceMemos(path)
      setEntries(found)
      setSelected(new Set(found.filter(e => !e.already_imported).map(e => e.id)))
      setPhase('selecting')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  const toggle = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggleAll = () => {
    const unimported = entries.filter(e => !e.already_imported)
    setSelected(selected.size === unimported.length ? new Set() : new Set(unimported.map(e => e.id)))
  }

  const handleImport = async () => {
    const toImport = entries.filter(e => selected.has(e.id)).map(e => ({
      title: e.title, path: e.path, date: e.date,
      start_time: e.start_time, duration_seconds: e.duration_seconds,
    }))
    if (!toImport.length) return
    setPhase('importing')
    setProgress({ current: 0, total: toImport.length, title: '' })
    try {
      const imported = await api.importVoiceMemos(toImport)
      imported.forEach(m => upsertMeeting(m))
      setImportedCount(imported.length)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('selecting')
    }
  }

  const handleReset = () => {
    setPhase('idle'); setFolderPath(null); setEntries([])
    setSelected(new Set()); setProgress(null); setImportedCount(0); setError(null)
  }

  const unimported = entries.filter(e => !e.already_imported)
  const alreadyCount = entries.filter(e => e.already_imported).length
  const allSelected = unimported.length > 0 && selected.size === unimported.length
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  // ── idle ──────────────────────────────────────────────────────────────────
  if (phase === 'idle' || phase === 'scanning') {
    return (
      <div style={{
        borderRadius: 18, border: '1px solid var(--border-subtle)',
        background: 'linear-gradient(160deg, rgba(33,128,72,0.04), transparent 60%), var(--bg-surface)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '28px 24px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 0 }}>
          <HeroWaveform />
          <div style={{ marginTop: -8, fontSize: 22, marginBottom: 6 }}>🎙️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Import Voice Memos
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 280 }}>
            Bring in recordings from Mac Voice Memos or any folder.
            Originals are never moved or deleted.
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 280, opacity: 0.75 }}>
            Tip: To find your Apple Voice Memos, open Voice Memos, drag a recording to a folder on your Mac, then select that folder here.
          </div>
          {error && (
            <div className="settings-message is-error" style={{ marginTop: 14, textAlign: 'left', width: '100%' }}>{error}</div>
          )}
          <button
            className="ghost-pill is-selected-pill"
            onClick={handlePickAndScan}
            disabled={phase === 'scanning'}
            style={{ marginTop: 18, gap: 6 }}
          >
            {phase === 'scanning' ? (
              <>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 13 }}>⟳</span>
                Scanning…
              </>
            ) : (
              <>Choose folder</>
            )}
          </button>
        </div>
      </div>
    )
  }

  // ── done ─────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div style={{
        borderRadius: 18, border: '1px solid var(--accent-border)',
        background: 'linear-gradient(160deg, var(--accent-dim), transparent 70%)',
        padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10,
      }}>
        <div style={{ fontSize: 28 }}>✓</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
          {importedCount} memo{importedCount !== 1 ? 's' : ''} imported
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Find them in Memos — ready to transcribe.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="ghost-pill is-selected-pill" onClick={handleReset}>Done</button>
          <button className="ghost-pill" onClick={() => { setPhase('selecting'); setProgress(null) }}>Import more</button>
        </div>
      </div>
    )
  }

  // ── importing ────────────────────────────────────────────────────────────
  if (phase === 'importing') {
    return (
      <div style={{
        borderRadius: 18, border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', padding: '24px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 18 }}>📥</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Importing {progress?.current ?? 0} of {progress?.total}…
            </div>
            {progress?.title && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                {progress.title}
              </div>
            )}
          </div>
        </div>
        <div style={{ height: 5, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 999, background: 'var(--accent)', width: `${pct}%`, transition: 'width 280ms ease' }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{pct}%</div>
      </div>
    )
  }

  // ── selecting ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Folder pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        borderRadius: 10, padding: '7px 10px',
      }}>
        <span style={{ fontSize: 13 }}>📁</span>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {folderPath?.split('/').slice(-3).join('/')}
        </span>
        <button className="ghost-pill" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }} onClick={handlePickAndScan}>Change</button>
      </div>

      {error && <div className="settings-message is-error">{error}</div>}

      {/* Summary bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{entries.length}</strong> found
          {alreadyCount > 0 && <span style={{ color: 'var(--text-muted)' }}> · {alreadyCount} already imported</span>}
        </span>
        <button
          className="ghost-pill"
          style={{ fontSize: 11 }}
          onClick={toggleAll}
          disabled={unimported.length === 0}
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      {/* Memo list — Voice Memos style */}
      {entries.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          No audio files found in this folder.
        </div>
      ) : (
        <div style={{
          border: '1px solid var(--border-subtle)', borderRadius: 14,
          overflow: 'hidden', maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg-surface)',
        }}>
          {entries.map((entry, i) => {
            const isSelected = selected.has(entry.id)
            const disabled = entry.already_imported
            return (
              <div
                key={entry.id}
                onClick={() => !disabled && toggle(entry.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px',
                  borderBottom: i < entries.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  background: isSelected ? 'var(--accent-dim)' : 'transparent',
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled ? 0.55 : 1,
                  transition: 'background 100ms',
                }}
              >
                {/* Checkbox */}
                <div
                  style={{
                    width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                    border: `2px solid ${isSelected && !disabled ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSelected && !disabled ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 120ms',
                  }}
                  onClick={(e) => { e.stopPropagation(); if (!disabled) toggle(entry.id) }}
                >
                  {isSelected && !disabled && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>

                {/* Waveform visual */}
                <div style={{ flexShrink: 0, color: isSelected ? 'var(--accent)' : 'var(--text-muted)' }}>
                  <MiniWaveform seed={i} color={isSelected && !disabled ? 'var(--accent)' : 'var(--border)'} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600,
                    color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {entry.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {fmtRelativeDate(entry.date)}
                    {entry.start_time && ` at ${entry.start_time}`}
                  </div>
                </div>

                {/* Duration + size */}
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  {entry.already_imported ? (
                    <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 999, padding: '2px 7px' }}>
                      imported
                    </span>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDuration(entry.duration_seconds)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                        {fmtSize(entry.size_bytes)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
        <button
          className="ghost-pill is-selected-pill"
          onClick={handleImport}
          disabled={selected.size === 0}
        >
          {selected.size > 0 ? `Import ${selected.size} memo${selected.size !== 1 ? 's' : ''}` : 'Select memos to import'}
        </button>
        <button className="ghost-pill" onClick={handleReset}>Cancel</button>
      </div>
    </div>
  )
}
