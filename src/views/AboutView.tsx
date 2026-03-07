import React, { useState } from 'react'
import * as api from '../lib/tauri'
import { useMemosaStore } from '../store'

function RecordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="2.5" fill="currentColor" />
    </svg>
  )
}

function PrivacyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.5L14 4.4V8.2C14 11.3 12.1 13.6 9 14.7C5.9 13.6 4 11.3 4 8.2V4.4L9 2.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.2 9.1L8.4 10.3L10.9 7.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function OpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 9h6M9 6l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FlowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="4" cy="5" r="1.5" fill="currentColor" />
      <circle cx="4" cy="9" r="1.5" fill="currentColor" />
      <circle cx="4" cy="13" r="1.5" fill="currentColor" />
      <path d="M7 5h6M7 9h6M7 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3v9M5 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IntegrationsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 6.5h3.2M10.8 11.5H14M9 3.5v3M9 11.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="3" cy="6.5" r="1.4" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="15" cy="11.5" r="1.4" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="9" cy="9" r="1.7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function WhyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7c0-1.1.9-2 2-2s2 .9 2 2c0 .9-.6 1.6-1.4 1.9-.4.1-.6.4-.6.8V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="13" r="0.8" fill="currentColor" />
    </svg>
  )
}

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

const USE_CASES = [
  'Customer calls', 'Team meetings', 'Interviews', 'Sales calls', 'Investor calls', 'Coaching sessions', 'Ambient work',
] as const

const ABOUT_FLOW = [
  { label: 'Capture', note: 'Record quietly on your Mac. No bots, no accounts, no notifications to others.' },
  { label: 'Organise', note: 'Folders, tags, search, and full transcripts — all stored locally.' },
  { label: 'Take it anywhere', note: 'Your files. Your AI. Your workflow. No lock-in, no subscription.' },
] as const

const ABOUT_SIGNALS = [
  { value: 'Local', label: 'No cloud required' },
  { value: 'Open', label: 'Any AI welcome' },
  { value: 'Yours', label: 'Files you own forever' },
] as const

const WEBSITE_URL = 'https://www.memosa.dev'

type AboutTab = 'overview' | 'how' | 'integrations' | 'why'

const TABS: { id: AboutTab; label: string; Icon: () => React.ReactElement }[] = [
  { id: 'overview', label: 'Overview', Icon: RecordIcon },
  { id: 'how', label: 'How it works', Icon: FlowIcon },
  { id: 'integrations', label: 'Integrations', Icon: IntegrationsIcon },
  { id: 'why', label: 'Why Memosa', Icon: WhyIcon },
]

function OverviewPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="about-stage">
        <div>
          <div className="about-stage-eyebrow">Local-first recording</div>
          <div className="about-stage-title">Capture quietly.<br />Own what's yours.</div>
          <div className="about-stage-copy-text">
            Record calls and meetings on your Mac with no bots, no cloud upload, and no
            account required. Everything lives on your machine until you decide to move it.
          </div>
        </div>
        <div className="about-stage-visual">
          <div className="about-stage-disc about-stage-disc-a" />
          <div className="about-stage-disc about-stage-disc-b" />
          <div className="about-stage-disc about-stage-disc-c" />
        </div>
      </div>

      <div className="about-card-grid">
        {ABOUT_POINTS.map(({ title, copy, Icon }) => (
          <article key={title} className="about-card about-card-compact">
            <div className="about-card-icon about-card-icon-sm"><Icon /></div>
            <div className="about-card-title">{title}</div>
            <div className="about-card-copy">{copy}</div>
          </article>
        ))}
      </div>

      <div className="settings-note-card">
        <div className="settings-note-title">What people capture</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 10, lineHeight: 1.6 }}>
          Any conversation worth remembering. Memosa stays out of the way while you stay present.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {USE_CASES.map((uc) => (
            <span key={uc} className="chip chip-muted">{uc}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function HowPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="about-lower-grid">
        <section className="about-flow-panel">
          <div className="about-flow-header">
            <div className="about-stage-eyebrow">How it works</div>
            <div className="about-flow-title">Three steps,<br />no lock-in.</div>
          </div>
          <div className="about-flow-strip">
            {ABOUT_FLOW.map(({ label, note }, index) => (
              <div key={label} className="about-flow-step">
                <div className="about-flow-index">{index + 1}</div>
                <div className="about-flow-copy">
                  <div className="about-flow-step-title">{label}</div>
                  <div className="about-flow-step-note">{note}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="about-signal-panel">
          <div className="about-signal-orbit">
            <div className="about-signal-orbit-ring about-signal-orbit-ring-a" />
            <div className="about-signal-orbit-ring about-signal-orbit-ring-b" />
            <div className="about-signal-core" />
          </div>
          <div className="about-signal-grid">
            {ABOUT_SIGNALS.map(({ value, label }) => (
              <div key={value} className="about-signal-card">
                <div className="about-signal-value">{value}</div>
                <div className="about-signal-label">{label}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="settings-note-card">
        <div className="settings-note-title">What happens to your transcript</div>
        <div className="settings-note-copy" style={{ marginTop: 4 }}>
          Whisper runs entirely on your Mac using your GPU. The resulting transcript is a plain text file
          sitting in your Memosa folder — readable by any app, searchable with any tool, and owned by you.
          No third-party transcription service is ever involved.
        </div>
      </div>
    </div>
  )
}

const INTEGRATION_GROUPS = [
  {
    heading: 'Cloud sync — take your files anywhere',
    items: [
      { name: 'Google Drive', detail: 'Sync your Memosa folder to Drive, then point any model at it.' },
      { name: 'Dropbox', detail: 'Files in Dropbox become accessible from any device or AI tool.' },
      { name: 'iCloud Drive', detail: 'Already in iCloud? Point Memosa there and it just works.' },
      { name: 'OneDrive / SharePoint', detail: 'Works for teams already in the Microsoft ecosystem.' },
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
    heading: 'Note-taking and personal knowledge',
    items: [
      { name: 'Obsidian', detail: 'Transcripts are markdown files. Drop them straight into your vault.' },
      { name: 'Notion', detail: 'Paste or automate. The transcript is just text — works anywhere Notion does.' },
      { name: 'Logseq', detail: 'Plain text files work natively in Logseq\'s graph database.' },
      { name: 'Apple Notes / Bear', detail: 'Copy and paste is a valid integration. You own the file.' },
    ],
  },
] as const

function IntegrationsPanel({ onRequest }: { onRequest: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="about-stage">
        <div>
          <div className="about-stage-eyebrow">Open by design</div>
          <div className="about-stage-title">Your data.<br />Your tools.</div>
          <div className="about-stage-copy-text">
            Memosa doesn't push you toward a specific AI or platform. Files are yours —
            plain audio and text you can take anywhere. The goal is openness, not dependency.
          </div>
        </div>
        <div className="about-stage-visual">
          <div className="about-stage-disc about-stage-disc-a" />
          <div className="about-stage-disc about-stage-disc-b" />
          <div className="about-stage-disc about-stage-disc-c" />
        </div>
      </div>

      <div className="settings-note-card">
        <div className="settings-note-title">How it works today</div>
        <div className="settings-note-copy" style={{ marginTop: 4 }}>
          Every recording and transcript is a file in a folder on your Mac. Sync that folder
          to any cloud service and every tool that can read files can use your data.
          No API keys, no special exports, no waiting for us to build a connector.
        </div>
      </div>

      {INTEGRATION_GROUPS.map(({ heading, items }) => (
        <div key={heading}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>{heading}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {items.map(({ name, detail }) => (
              <div key={name} style={{ padding: '11px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{detail}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ padding: '12px 16px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Native integrations — based on demand</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              We may build native push integrations (auto-upload to Drive, webhooks, etc.) if demand is there.
              Tell us what you need and we'll build toward it.
            </div>
          </div>
          <button className="ghost-pill is-selected-pill" style={{ flexShrink: 0 }} onClick={onRequest}>
            Request
          </button>
        </div>
      </div>
    </div>
  )
}

const WHY_REASONS = [
  {
    heading: 'Every other tool sends your voice to the cloud.',
    body: 'Zoom AI, Otter, Fireflies — they all stream your audio to a server you don\'t control. That\'s your strategy, your clients, your negotiations. Memosa never connects to anyone\'s server. The audio stays on your Mac. Period.',
  },
  {
    heading: 'A bot joining your call changes the call.',
    body: 'The moment a participant named "Notetaker" appears, people get careful. Memosa captures from the OS level — no bot, no extra account, no notification to anyone else. You record as naturally as you take notes.',
  },
  {
    heading: 'Transcription is infrastructure, not a product.',
    body: 'Whisper runs locally using your GPU. The transcript is a text file you own. You can take it to ChatGPT, Claude, NotebookLM, Obsidian — or just grep it. Memosa doesn\'t try to be your AI. It feeds the AI you already trust.',
  },
  {
    heading: 'Privacy and productivity shouldn\'t be a trade-off.',
    body: 'The local-first approach isn\'t a limitation — it\'s the feature. Fast, offline, private, and no subscription needed to keep your own recordings. What you capture is yours forever.',
  },
] as const

function WhyPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '4px 0 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.7px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>The honest answer</div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.55, color: 'var(--text-primary)' }}>
          Most tools that record your meetings are built around keeping you dependent on their cloud. Memosa is built around the opposite idea.
        </p>
      </div>

      {WHY_REASONS.map(({ heading, body }) => (
        <div key={heading} style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 6, lineHeight: 1.4 }}>{heading}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{body}</div>
        </div>
      ))}

      <div style={{ padding: '12px 16px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>The commitment</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          No audio ever leaves your machine. No account required. No subscription to access your own recordings. That's not a pricing decision — it's the whole point.
        </div>
      </div>
    </div>
  )
}

export function AboutView() {
  const { setActiveView } = useMemosaStore()
  const [activeTab, setActiveTab] = useState<AboutTab>('overview')

  return (
    <div className="settings-modal-backdrop" onClick={() => setActiveView('today')}>
      <div className="settings-scene" onClick={(event) => event.stopPropagation()}>
        <div className="settings-sheet">

          <aside className="settings-rail about-rail">
            <div className="settings-rail-top">
              <div className="settings-modal-eyebrow">About</div>
              <div className="settings-rail-title">Memosa</div>
              <div className="settings-rail-copy">
                Local capture. Any AI. Your call.
              </div>
            </div>

            <nav className="settings-rail-nav">
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`settings-rail-item${activeTab === id ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(id)}
                >
                  <span className="settings-rail-item-icon"><Icon /></span>
                  {label}
                </button>
              ))}
            </nav>

            <div className="settings-rail-footer">
              <button className="ghost-pill" onClick={() => setActiveView('today')}>
                Close
              </button>
              <button
                className="ghost-pill is-selected-pill"
                onClick={() => void api.openExternalUrl(WEBSITE_URL)}
              >
                memosa.dev ↗
              </button>
            </div>
          </aside>

          <section className="settings-content">
            <div className="settings-content-header">
              <div>
                <h1 className="settings-content-title">Built around one idea.</h1>
                <p className="settings-content-copy">
                  Capture is the hard problem. Memosa solves that part. What you do next is yours.
                </p>
              </div>
            </div>

            <div className="settings-content-scroll">
              <section className="settings-block">
                {activeTab === 'overview' && <OverviewPanel />}
                {activeTab === 'how' && <HowPanel />}
                {activeTab === 'integrations' && <IntegrationsPanel onRequest={() => void api.openExternalUrl(WEBSITE_URL)} />}
                {activeTab === 'why' && <WhyPanel />}
              </section>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
