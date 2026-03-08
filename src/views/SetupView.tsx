import { useState } from 'react'
import * as api from '../lib/tauri'
import { useMemosaStore } from '../store'

export function SetupView() {
  const { settings, setSettings, setMeetings } = useMemosaStore()
  const defaultPath = settings?.storage_path ?? '~/Documents/Memosa'
  const [storagePath, setStoragePath] = useState(defaultPath)
  const [saving, setSaving] = useState(false)

  const handleBrowse = async () => {
    const picked = await api.pickStorageFolder(storagePath)
    if (picked) setStoragePath(picked)
  }

  const handleGetStarted = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const updated = { ...settings, storage_path: storagePath, has_completed_setup: true }
      await api.saveSettings(updated)
      setSettings(updated)
      // Reload meetings from the chosen storage location
      const meetings = await api.getMeetings({})
      setMeetings(meetings)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0,0,0,0.45)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 28,
        width: 400,
        maxWidth: 'calc(100vw - 48px)',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '40px 36px',
        boxShadow: '0 32px 64px rgba(0,0,0,0.22)',
        textAlign: 'center',
      }}>
        {/* Icon */}
        <div style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </div>

        {/* Heading */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            Where should Memosa save your recordings?
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            All recordings, transcripts, and notes are stored locally on your Mac.
            You can change this at any time in Settings.
          </div>
        </div>

        {/* Path picker */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            minWidth: 0,
          }}>
            <span style={{
              flex: 1,
              fontSize: 12,
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'monospace',
            }}>
              {storagePath}
            </span>
            <button
              className="ghost-pill"
              style={{ flexShrink: 0 }}
              onClick={() => void handleBrowse()}
            >
              Browse
            </button>
          </div>
        </div>

        {/* CTA */}
        <button
          style={{
            padding: '10px 32px',
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 999,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
            fontFamily: 'inherit',
            transition: 'opacity 140ms ease',
          }}
          disabled={saving}
          onClick={() => void handleGetStarted()}
        >
          {saving ? 'Saving…' : 'Get Started'}
        </button>
      </div>
    </div>
  )
}
