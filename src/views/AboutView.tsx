import { useEffect, useState } from 'react'
import * as api from '../lib/tauri'
import { useMemosaStore } from '../store'

// ─── Icons ────────────────────────────────────────────────────────────────────

function RecordIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="2.5" fill="currentColor" />
    </svg>
  )
}

function PrivacyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.5L14 4.4V8.2C14 11.3 12.1 13.6 9 14.7C5.9 13.6 4 11.3 4 8.2V4.4L9 2.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.2 9.1L8.4 10.3L10.9 7.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 9h6M9 6l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Content ──────────────────────────────────────────────────────────────────

const ABOUT_POINTS = [
  {
    title: 'On-device recording',
    copy: 'Record calls and meetings on your Mac. No bots, no extra participants — just you and your audio.',
    Icon: RecordIcon,
  },
  {
    title: 'Local first',
    copy: 'Audio and transcripts stay on your machine. Nothing leaves unless you choose to move it.',
    Icon: PrivacyIcon,
  },
  {
    title: 'Your files, your choice',
    copy: 'Transcripts are plain files on your Mac. Copy them into any tool you like — nothing is sent automatically.',
    Icon: OpenIcon,
  },
] as const

const USE_CASES = ['Customer calls', 'Team meetings', 'Interviews', 'Sales calls', 'Investor calls', 'Coaching sessions'] as const

const ABOUT_FLOW = [
  { label: 'Record', note: 'Start a recording on your Mac. No bots join, no accounts needed.' },
  { label: 'Organise', note: 'Folders, tags, search, and full transcripts — all stored locally.' },
  { label: 'Take it anywhere', note: 'Your files, your workflow. Export or copy to any tool you choose. No lock-in.' },
] as const

const COMPATIBILITY_GROUPS = [
  {
    heading: 'Cloud sync (manual)',
    items: [
      { name: 'Google Drive', detail: 'Point your Memosa folder at Drive to sync files across devices.' },
      { name: 'Dropbox', detail: 'Place your storage folder in Dropbox for automatic backup.' },
      { name: 'iCloud Drive', detail: 'Already using iCloud? Set Memosa\'s storage folder there.' },
      { name: 'OneDrive', detail: 'Works for teams already in the Microsoft ecosystem.' },
    ],
  },
  {
    heading: 'External tools (copy & paste)',
    items: [
      { name: 'NotebookLM', detail: 'Upload transcript files to build a notebook on your meetings.' },
      { name: 'ChatGPT', detail: 'Copy a transcript into a conversation. Memosa never sends data automatically.' },
      { name: 'Claude', detail: 'Paste transcripts to summarise calls. You choose what to share, manually.' },
      { name: 'Gemini', detail: 'Works with Drive-synced transcript files you place there yourself.' },
    ],
  },
  {
    heading: 'Notes and PKM',
    items: [
      { name: 'Obsidian', detail: 'Transcripts are markdown files. Drop them straight into your vault.' },
      { name: 'Notion', detail: 'Copy and paste. The transcript is just text — works anywhere.' },
      { name: 'Logseq', detail: 'Plain text files work natively in Logseq\'s graph database.' },
      { name: 'Apple Notes', detail: 'Copy and paste from your Memosa folder. You own the file.' },
    ],
  },
] as const

const WHY_REASONS = [
  {
    heading: 'Every other tool sends your voice to the cloud.',
    body: 'Zoom AI, Otter, Fireflies — they all stream your audio to a server you don\'t control. Memosa processes everything locally using Whisper. Your recordings stay on your Mac unless you choose to move them.',
  },
  {
    heading: 'No bots in your meetings.',
    body: 'Other tools add a visible participant to record. Memosa captures audio directly on your Mac — no extra account, no cloud dependency. You keep full control of your recordings.',
  },
  {
    heading: 'Transcription is infrastructure, not a product.',
    body: 'Whisper runs locally using your GPU. The transcript is a text file you own. You can take it to ChatGPT, Claude, NotebookLM, or just grep it. Memosa doesn\'t try to be your AI. It feeds the AI you already trust.',
  },
  {
    heading: 'Privacy and productivity shouldn\'t be a trade-off.',
    body: 'Fast, offline, private, and no subscription needed to keep your own recordings. What you capture is yours forever.',
  },
] as const

const WEBSITE_URL = 'https://www.memosa.dev'

const SHORTCUTS = [
  {
    group: 'Navigation',
    rows: [
      { keys: ['⌘', '1'], label: 'Home' },
      { keys: ['⌘', '2'], label: 'Memos' },
      { keys: ['⌘', '3'], label: 'Search' },
    ],
  },
  {
    group: 'Recording',
    rows: [
      { keys: ['⇧', '⌘', 'R'], label: 'Start / stop recording' },
      { keys: ['⌘', 'K'], label: 'Open command palette' },
    ],
  },
] as const

const CONSENT_NOTE = 'Important: Always inform other participants that a call is being recorded. Many jurisdictions require all-party consent for recording conversations.' as const

// ─── Tab panels ───────────────────────────────────────────────────────────────

function OverviewPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Editorial hero ── */}
      <div style={{ padding: '20px 0 8px', maxWidth: 640 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 18 }}>
          Local-first recording
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 42, fontWeight: 600, lineHeight: 1.05, margin: 0, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
          Record. Transcribe.<br />
          <span style={{ color: 'var(--accent)' }}>Own what's yours.</span>
        </h1>
        <p style={{ margin: '20px 0 0', fontSize: 16, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
          Record calls and meetings on your Mac — no bots join, no cloud upload, no account required.
          Everything stays on your machine until <em style={{ fontStyle: 'italic', color: 'var(--text-primary)' }}>you</em> decide to move it.
        </p>
      </div>

      {/* ── Three principles, set like chapter points ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, margin: '36px 0 8px', borderTop: '1px solid var(--border-subtle)' }}>
        {ABOUT_POINTS.map(({ title, copy, Icon }, i) => (
          <div
            key={title}
            style={{
              padding: '22px 22px 24px',
              borderLeft: i > 0 ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--accent)', opacity: 0.5 }}>
                0{i + 1}
              </span>
              <span style={{ color: 'var(--accent)' }}><Icon /></span>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, marginBottom: 7, color: 'var(--text-primary)' }}>{title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.65 }}>{copy}</div>
          </div>
        ))}
      </div>

      {/* ── What people capture — as flowing prose ── */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '24px 0 4px', maxWidth: 680 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)', marginRight: 10 }}>
          What people capture
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 500, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          {USE_CASES.slice(0, -1).map((uc) => uc.toLowerCase()).join(', ')}, and {USE_CASES[USE_CASES.length - 1].toLowerCase()}.
        </span>
      </div>

      {/* ── Consent note as a quiet margin footnote ── */}
      <div style={{ marginTop: 28, paddingLeft: 14, borderLeft: '2px solid var(--accent-border)', maxWidth: 640 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>{CONSENT_NOTE}</div>
      </div>
    </div>
  )
}

function HowPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '16px 0 4px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>How it works</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-primary)' }}>Three steps, no lock-in.</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {ABOUT_FLOW.map(({ label, note }, i) => (
          <div key={label} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 0', borderBottom: i < ABOUT_FLOW.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{note}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What happens to your transcript</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          Whisper runs entirely on your Mac. The transcript is a plain text file sitting in your Memosa folder — readable by any app, searchable with any tool, owned by you. No third-party transcription service is ever involved.
        </div>
      </div>
    </div>
  )
}

function CompatibilityPanel({ onRequest }: { onRequest: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, marginBottom: 2 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Memosa does not send your data to any third-party service</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          All recording and transcription happens locally on this Mac. The tools listed below are external apps you can manually use with your exported files — Memosa has no connection to them and never transmits data on your behalf.
        </div>
      </div>

      <div style={{ padding: '16px 0 4px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Open by design</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-primary)', marginBottom: 8 }}>Your data. Your tools.</div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          Every recording and transcript is a file in a folder on your Mac. You can manually copy or sync files to any tool you choose. Memosa never sends data anywhere automatically.
        </p>
      </div>

      {COMPATIBILITY_GROUPS.map(({ heading, items }) => (
        <div key={heading}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>{heading}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {items.map(({ name, detail }) => (
              <div key={name} style={{ padding: '10px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 9 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>{name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{detail}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ padding: '12px 14px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Feature requests welcome</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>Tell us what tools you want to use with your Memosa files.</div>
        </div>
        <button className="ghost-pill is-selected-pill" style={{ flexShrink: 0 }} onClick={onRequest}>Request</button>
      </div>
    </div>
  )
}

function WhyPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Pull-quote lead ── */}
      <div style={{ padding: '20px 0 8px', maxWidth: 680 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 20 }}>
          The honest answer
        </div>
        <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 27, fontWeight: 500, lineHeight: 1.32, letterSpacing: '-0.005em', color: 'var(--text-primary)' }}>
          Most tools that record your meetings are built around keeping you dependent on their cloud.
          {' '}<span style={{ color: 'var(--accent)' }}>Memosa is built around the opposite idea.</span>
        </p>
      </div>

      {/* ── Reasons as a numbered editorial list ── */}
      <div style={{ margin: '32px 0 0' }}>
        {WHY_REASONS.map(({ heading, body }, i) => (
          <div
            key={heading}
            style={{
              display: 'grid',
              gridTemplateColumns: '44px 1fr',
              gap: 16,
              padding: '20px 0',
              borderTop: '1px solid var(--border-subtle)',
              maxWidth: 720,
            }}
          >
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--accent)', opacity: 0.45, lineHeight: 1.3 }}>
              0{i + 1}
            </span>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.35 }}>{heading}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Closing commitment, set like a signed statement ── */}
      <div style={{ marginTop: 28, padding: '22px 24px', borderRadius: 14, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', maxWidth: 720 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>The commitment</div>
        <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 500, lineHeight: 1.55, color: 'var(--text-primary)' }}>
          Audio and transcripts stay on your Mac by default. No account. No subscription to reach your own
          recordings. That's not a pricing decision — it's the whole point.
        </p>
      </div>
    </div>
  )
}

function ShortcutsPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '16px 0 4px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Keyboard shortcuts</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-primary)' }}>Work faster with your hands.</div>
      </div>
      {SHORTCUTS.map(({ group, rows }) => (
        <div key={group}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>{group}</div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, overflow: 'hidden' }}>
            {rows.map(({ keys, label }, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
                <span style={{ display: 'flex', gap: 3 }}>
                  {keys.map((k) => (
                    <kbd key={k} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, padding: '2px 5px', background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', color: 'var(--text-secondary)', boxShadow: '0 1px 0 var(--border-subtle)' }}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Global shortcuts</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          System-wide shortcuts to start and stop recording from any app are planned for a future update.
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type AboutTab = 'overview' | 'how' | 'works-with' | 'why' | 'shortcuts'
const TABS: { id: AboutTab; label: string; icon: string }[] = [
  { id: 'overview',     label: 'Overview',     icon: '✦' },
  { id: 'how',          label: 'How it works', icon: '→' },
  { id: 'works-with', label: 'Works with', icon: '⟡' },
  { id: 'why',          label: 'Why Memosa',   icon: '◎' },
  { id: 'shortcuts',    label: 'Shortcuts',    icon: '⌘' },
]

export function AboutView() {
  const { setActiveView } = useMemosaStore()
  const [activeTab, setActiveTab] = useState<AboutTab>('overview')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    api.getAppVersion().then(setAppVersion).catch(() => {})
  }, [])

  return (
    <div className="settings-modal-backdrop" onClick={() => setActiveView('today')}>
      <div className="cfg-scene" onClick={(e) => e.stopPropagation()}>
        <div className="cfg-sheet">
          {/* Header */}
          <div className="cfg-header">
            <div style={{ display: 'flex', gap: 2 }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={`cfg-tab${activeTab === t.id ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <span style={{ marginRight: 5, fontSize: 11, opacity: 0.8 }}>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12 }}>
              {appVersion && (
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
                  v{appVersion}
                </span>
              )}
              <button className="ghost-pill is-selected-pill" onClick={() => void api.openExternalUrl(WEBSITE_URL)}>
                memosa.dev ↗
              </button>
              <button className="ghost-pill" onClick={() => setActiveView('today')}>Done</button>
            </div>
          </div>

          {/* Body */}
          <div className="cfg-body">
            {activeTab === 'overview' && <OverviewPanel />}
            {activeTab === 'how' && <HowPanel />}
            {activeTab === 'works-with' && <CompatibilityPanel onRequest={() => void api.openExternalUrl(WEBSITE_URL)} />}
            {activeTab === 'why' && <WhyPanel />}
            {activeTab === 'shortcuts' && <ShortcutsPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
