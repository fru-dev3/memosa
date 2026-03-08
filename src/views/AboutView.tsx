import { useState } from 'react'
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
    title: 'Quiet capture',
    copy: 'Record calls and meetings on your Mac. No bots, no extra participants. Nobody else knows you\'re recording.',
    Icon: RecordIcon,
  },
  {
    title: 'Local first',
    copy: 'Audio and transcripts stay on your machine. Nothing leaves unless you choose to move it.',
    Icon: PrivacyIcon,
  },
  {
    title: 'AI agnostic',
    copy: 'Bring your own model. ChatGPT, Claude, Gemini, NotebookLM — your pick, your terms.',
    Icon: OpenIcon,
  },
] as const

const USE_CASES = ['Customer calls', 'Team meetings', 'Interviews', 'Sales calls', 'Investor calls', 'Coaching sessions', 'Ambient work'] as const

const ABOUT_FLOW = [
  { label: 'Capture', note: 'Record quietly on your Mac. No bots, no accounts, no notifications to others.' },
  { label: 'Organise', note: 'Folders, tags, search, and full transcripts — all stored locally.' },
  { label: 'Take it anywhere', note: 'Your files. Your AI. Your workflow. No lock-in, no subscription.' },
] as const

const INTEGRATION_GROUPS = [
  {
    heading: 'Cloud sync',
    items: [
      { name: 'Google Drive', detail: 'Sync your Memosa folder to Drive, then point any model at it.' },
      { name: 'Dropbox', detail: 'Files in Dropbox become accessible from any device or AI tool.' },
      { name: 'iCloud Drive', detail: 'Already in iCloud? Point Memosa there and it just works.' },
      { name: 'OneDrive', detail: 'Works for teams already in the Microsoft ecosystem.' },
    ],
  },
  {
    heading: 'AI and knowledge tools',
    items: [
      { name: 'NotebookLM', detail: 'Upload transcripts and build a notebook on your own meetings.' },
      { name: 'ChatGPT', detail: 'Drop a transcript into a conversation. Ask it anything.' },
      { name: 'Claude', detail: 'Summarise a week of calls. Pull out action items. Write follow-ups.' },
      { name: 'Gemini', detail: 'Google\'s model works well with Drive-synced transcripts.' },
    ],
  },
  {
    heading: 'Notes and PKM',
    items: [
      { name: 'Obsidian', detail: 'Transcripts are markdown files. Drop them straight into your vault.' },
      { name: 'Notion', detail: 'Paste or automate. The transcript is just text — works anywhere.' },
      { name: 'Logseq', detail: 'Plain text files work natively in Logseq\'s graph database.' },
      { name: 'Apple Notes', detail: 'Copy and paste is a valid integration. You own the file.' },
    ],
  },
] as const

const WHY_REASONS = [
  {
    heading: 'Every other tool sends your voice to the cloud.',
    body: 'Zoom AI, Otter, Fireflies — they all stream your audio to a server you don\'t control. That\'s your strategy, your clients, your negotiations. Memosa never connects to anyone\'s server. The audio stays on your Mac.',
  },
  {
    heading: 'A bot joining your call changes the call.',
    body: 'The moment a participant named "Notetaker" appears, people get careful. Memosa captures from the OS level — no bot, no extra account, no notification to anyone else. You record as naturally as you take notes.',
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

// ─── Tab panels ───────────────────────────────────────────────────────────────

function OverviewPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '16px 0 4px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Local-first recording</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-primary)', marginBottom: 8 }}>Capture quietly.<br />Own what's yours.</div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          Record calls and meetings on your Mac with no bots, no cloud upload, and no account required. Everything lives on your machine until you decide to move it.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {ABOUT_POINTS.map(({ title, copy, Icon }) => (
          <div key={title} style={{ padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
            <div style={{ marginBottom: 6, color: 'var(--accent)' }}><Icon /></div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{copy}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>What people capture</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {USE_CASES.map((uc) => <span key={uc} className="chip chip-muted">{uc}</span>)}
        </div>
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

function IntegrationsPanel({ onRequest }: { onRequest: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '16px 0 4px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Open by design</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-primary)', marginBottom: 8 }}>Your data. Your tools.</div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          Every recording and transcript is a file in a folder on your Mac. Sync that folder to any cloud service and every tool that can read files can use your data. No API keys, no special exports.
        </p>
      </div>

      {INTEGRATION_GROUPS.map(({ heading, items }) => (
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
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Native integrations — based on demand</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>We may build native push integrations if demand is there. Tell us what you need.</div>
        </div>
        <button className="ghost-pill is-selected-pill" style={{ flexShrink: 0 }} onClick={onRequest}>Request</button>
      </div>
    </div>
  )
}

function WhyPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: '16px 0 4px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>The honest answer</div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.55, color: 'var(--text-primary)' }}>
          Most tools that record your meetings are built around keeping you dependent on their cloud. Memosa is built around the opposite idea.
        </p>
      </div>

      {WHY_REASONS.map(({ heading, body }) => (
        <div key={heading} style={{ padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 5, lineHeight: 1.4 }}>{heading}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{body}</div>
        </div>
      ))}

      <div style={{ padding: '12px 14px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>The commitment</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          No audio ever leaves your machine. No account required. No subscription to access your own recordings. That's not a pricing decision — it's the whole point.
        </div>
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
          Configure a system-wide shortcut to start and stop recording from any app — even when Memosa is in the background. Set it in Settings → Recording.
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type AboutTab = 'overview' | 'how' | 'integrations' | 'why' | 'shortcuts'
const TABS: { id: AboutTab; label: string; icon: string }[] = [
  { id: 'overview',     label: 'Overview',     icon: '✦' },
  { id: 'how',          label: 'How it works', icon: '→' },
  { id: 'integrations', label: 'Integrations', icon: '⟡' },
  { id: 'why',          label: 'Why Memosa',   icon: '◎' },
  { id: 'shortcuts',    label: 'Shortcuts',    icon: '⌘' },
]

export function AboutView() {
  const { setActiveView } = useMemosaStore()
  const [activeTab, setActiveTab] = useState<AboutTab>('overview')

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
            {activeTab === 'integrations' && <IntegrationsPanel onRequest={() => void api.openExternalUrl(WEBSITE_URL)} />}
            {activeTab === 'why' && <WhyPanel />}
            {activeTab === 'shortcuts' && <ShortcutsPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
