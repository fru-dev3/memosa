import { useEffect, useState } from 'react'
import type { AppView } from '../../lib/types'
import { useMemosaStore } from '../../store'

interface PaletteItem {
  id: string
  label: string
  view?: AppView
  action?: () => void
}

const actions: PaletteItem[] = []

export function CommandPalette() {
  const {
    activeView,
    commandPaletteOpen,
    hotkeys,
    setActiveView,
    setCommandPaletteOpen,
  } = useMemosaStore()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!commandPaletteOpen) {
      setQuery('')
    }
  }, [commandPaletteOpen])

  useEffect(() => {
    if (!commandPaletteOpen) return

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCommandPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commandPaletteOpen, setCommandPaletteOpen])

  const core: PaletteItem[] = [
    { id: 'today', label: 'Open Home', view: 'today' as AppView },
    { id: 'calendar', label: 'Open Calendar', view: 'calendar' as AppView },
    { id: 'projects', label: 'Open Memos', view: 'projects' as AppView },
    { id: 'search', label: 'Open Search', view: 'search' as AppView },
    { id: 'profiles', label: 'Open Profiles', view: 'profiles' as AppView },
    { id: 'templates', label: 'Open Templates', view: 'templates' as AppView },
    { id: 'privacy', label: 'Open Privacy', view: 'privacy' as AppView },
    { id: 'settings', label: 'Open Settings', view: 'settings' as AppView },
  ]

  const items = [...actions, ...core].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))

  const run = (item: PaletteItem) => {
    if (item.view) setActiveView(item.view)
    item.action?.()
    setCommandPaletteOpen(false)
    setQuery('')
  }

  if (!commandPaletteOpen) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.22)', backdropFilter: 'blur(18px)', zIndex: 999 }}
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        style={{ width: 560, margin: '8vh auto 0', borderRadius: 28, border: '1px solid var(--border)', background: 'var(--bg-surface)', boxShadow: '0 38px 80px rgba(58,45,34,0.16)', overflow: 'hidden' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: 18, borderBottom: '1px solid var(--border-subtle)' }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Jump anywhere · ${hotkeys.open_command_palette}`}
            className="search-input"
          />
        </div>
        <div style={{ maxHeight: '50vh', overflowY: 'auto', padding: 12, display: 'grid', gap: 8 }}>
          {items.length === 0 ? (
            <div className="minimal-empty-state" aria-label="No matching commands" style={{ minHeight: 96 }} />
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                onClick={() => run(item)}
                className="search-result-card"
                style={{ padding: 14, borderRadius: 18 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{item.label}</span>
                  {item.view === activeView && <span className="chip chip-success">current</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
