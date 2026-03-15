import { useEffect, useState } from 'react'
import memosaIcon from '../assets/memosa-icon.png'
import * as api from '../lib/tauri'
import { useMemosaStore } from '../store'

const QUOTES = [
  { text: "The faintest ink is mightier than the best memory.", attr: "Chinese proverb" },
  { text: "You were in the room. Now the room stays with you.", attr: "Memosa" },
  { text: "Every meeting is an archive. Most people just don't have the key.", attr: "Memosa" },
  { text: "Your best ideas don't send calendar invites.", attr: "Memosa" },
  { text: "What was said is what happened. Your notes are the record.", attr: "Memosa" },
  { text: "If it mattered enough to meet about, it matters enough to remember.", attr: "Memosa" },
  { text: "The call ends. The context stays.", attr: "Memosa" },
  { text: "Capture first. Think later. AI can wait.", attr: "Memosa" },
]

export function SetupView() {
  const { settings, setSettings, setMeetings } = useMemosaStore()
  // null = user has not yet picked via the native dialog (no security-scoped bookmark)
  const [storagePath, setStoragePath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [quoteIndex, setQuoteIndex] = useState(0)
  const [quoteVisible, setQuoteVisible] = useState(true)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    api.getAppVersion().then(setAppVersion).catch(() => {})
  }, [])

  // Cycle quotes every 4s with fade transition
  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteVisible(false)
      setTimeout(() => {
        setQuoteIndex((i) => (i + 1) % QUOTES.length)
        setQuoteVisible(true)
      }, 400)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const handlePickFolder = async () => {
    // Always go through the native folder dialog so macOS grants a
    // security-scoped bookmark for the selected location (App Sandbox 2.4.5)
    const picked = await api.pickStorageFolder(storagePath ?? undefined)
    if (picked) setStoragePath(picked)
  }

  const handleGetStarted = async () => {
    if (!settings || !storagePath) return
    setSaving(true)
    try {
      const updated = { ...settings, storage_path: storagePath, has_completed_setup: true }
      await api.saveSettings(updated)
      setSettings(updated)
      const meetings = await api.getMeetings({})
      setMeetings(meetings)
    } finally {
      setSaving(false)
    }
  }

  const quote = QUOTES[quoteIndex]

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(10, 22, 14, 0.62)',
      backdropFilter: 'blur(28px)',
      WebkitBackdropFilter: 'blur(28px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: 460,
        maxWidth: 'calc(100vw - 48px)',
        background: 'rgba(247, 243, 236, 0.97)',
        border: '1px solid rgba(255,255,255,0.5)',
        borderRadius: 28,
        overflow: 'hidden',
        boxShadow: '0 40px 80px rgba(0,0,0,0.36), 0 1px 0 rgba(255,255,255,0.8) inset',
      }}>

        {/* Quote strip at top */}
        <div style={{
          padding: '18px 28px 16px',
          borderBottom: '1px solid rgba(18, 77, 45, 0.1)',
          background: 'rgba(18, 77, 45, 0.04)',
          minHeight: 72,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}>
          <div style={{
            opacity: quoteVisible ? 1 : 0,
            transition: 'opacity 400ms ease',
          }}>
            <p style={{
              margin: 0,
              fontSize: 13,
              fontStyle: 'italic',
              color: '#124d2d',
              lineHeight: 1.55,
              fontWeight: 500,
            }}>
              "{quote.text}"
            </p>
            <p style={{
              margin: '5px 0 0',
              fontSize: 11,
              color: '#218048',
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}>
              — {quote.attr}
            </p>
          </div>
        </div>

        {/* Main body */}
        <div style={{
          padding: '32px 28px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          textAlign: 'center',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <img
              src={memosaIcon}
              alt="Memosa"
              style={{ width: 72, height: 48, objectFit: 'contain', display: 'block' }}
            />
            <div style={{
              fontSize: 34,
              fontWeight: 750,
              color: '#124d2d',
              letterSpacing: '-0.06em',
              lineHeight: 1,
              fontFamily: '"Avenir Next", "SF Pro Display", system-ui, sans-serif',
            }}>
              Memosa
            </div>
            <div style={{ fontSize: 13, color: '#218048', fontWeight: 500, lineHeight: 1.5 }}>
              Local recording. On-device transcription. Any AI.
            </div>
            {appVersion && (
              <div style={{ fontSize: 11, fontWeight: 600, color: '#218048', opacity: 0.5, letterSpacing: '0.04em' }}>
                v{appVersion}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ width: '100%', height: 1, background: 'rgba(18, 77, 45, 0.1)' }} />

          {/* Storage picker */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: '#124d2d' }}>
              Where should your memos live?
            </div>
            <div style={{ fontSize: 12, color: '#218048', lineHeight: 1.6, opacity: 0.8 }}>
              Choose a folder on your Mac to store recordings, transcripts, and notes.
            </div>

            {storagePath ? (
              /* Folder selected — show path with change option */
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(18, 77, 45, 0.18)',
                borderRadius: 10,
                padding: '8px 10px 8px 14px',
              }}>
                <span style={{
                  flex: 1,
                  fontSize: 12,
                  color: '#124d2d',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                  opacity: 0.8,
                }}>
                  {storagePath}
                </span>
                <button
                  className="ghost-pill"
                  style={{ flexShrink: 0 }}
                  onClick={() => void handlePickFolder()}
                >
                  Change
                </button>
              </div>
            ) : (
              /* No folder selected yet — show choose button */
              <button
                className="ghost-pill"
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 10,
                  border: '1px solid rgba(18, 77, 45, 0.25)',
                  background: 'rgba(255,255,255,0.7)',
                  color: '#124d2d',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
                onClick={() => void handlePickFolder()}
              >
                Choose folder...
              </button>
            )}

            <div style={{ fontSize: 11, color: '#218048', opacity: 0.65, textAlign: 'center' }}>
              You can change this at any time in Settings → Storage
            </div>
          </div>

          {/* CTA — only enabled after a folder is picked via native dialog */}
          <button
            style={{
              width: '100%',
              padding: '13px 32px',
              fontSize: 15,
              fontWeight: 650,
              borderRadius: 999,
              border: 'none',
              background: storagePath
                ? 'linear-gradient(135deg, #1a6b3a 0%, #0f4d28 100%)'
                : 'linear-gradient(135deg, #8aab96 0%, #6b8e7b 100%)',
              color: '#fff',
              cursor: saving || !storagePath ? 'default' : 'pointer',
              opacity: saving ? 0.7 : 1,
              fontFamily: 'inherit',
              transition: 'opacity 140ms ease, transform 100ms ease',
              letterSpacing: '-0.01em',
              boxShadow: storagePath
                ? '0 4px 16px rgba(18, 77, 45, 0.3)'
                : '0 2px 8px rgba(18, 77, 45, 0.15)',
            }}
            onMouseEnter={(e) => { if (!saving && storagePath) e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none' }}
            disabled={saving || !storagePath}
            onClick={() => void handleGetStarted()}
          >
            {saving ? 'Setting up…' : 'Start capturing →'}
          </button>

          {/* Fine print */}
          <div style={{ fontSize: 11, color: '#218048', opacity: 0.5, lineHeight: 1.6 }}>
            No account. No subscription. Runs locally.
          </div>
        </div>
      </div>
    </div>
  )
}
