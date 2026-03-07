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

const ABOUT_POINTS = [
  {
    title: 'Quiet capture',
    copy: 'Record calls and meetings on your Mac. No bots, no extra participants.',
    Icon: RecordIcon,
  },
  {
    title: 'Local first',
    copy: 'Audio and transcripts stay on your machine. Nothing leaves unless you choose.',
    Icon: PrivacyIcon,
  },
  {
    title: 'AI agnostic',
    copy: 'Bring your own model. ChatGPT, Claude, Gemini, NotebookLM — your pick.',
    Icon: OpenIcon,
  },
] as const

const USE_CASES = [
  'Customer calls', 'Team meetings', 'Interviews', 'Sales calls', 'Ambient work',
] as const

const ABOUT_FLOW = [
  { label: 'Capture', note: 'Record quietly on your Mac.' },
  { label: 'Organise', note: 'Folders, tags, full transcripts.' },
  { label: 'Take it anywhere', note: 'Your AI. Your workflow.' },
] as const

const ABOUT_SIGNALS = [
  { value: 'Local', label: 'No cloud required' },
  { value: 'Open', label: 'Any AI welcome' },
  { value: 'Yours', label: 'Files you own forever' },
] as const

const WEBSITE_URL = 'https://www.memosa.dev'

type AboutTab = 'overview' | 'how' | 'more'

const TABS: { id: AboutTab; label: string; Icon: () => React.ReactElement }[] = [
  { id: 'overview', label: 'Overview', Icon: RecordIcon },
  { id: 'how', label: 'How it works', Icon: FlowIcon },
  { id: 'more', label: 'Take it anywhere', Icon: ShareIcon },
]

function OverviewPanel() {
  return (
    <>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
          {USE_CASES.map((uc) => (
            <span key={uc} className="chip chip-muted">{uc}</span>
          ))}
        </div>
      </div>
    </>
  )
}

function HowPanel() {
  return (
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
  )
}

function MorePanel({ onRequest }: { onRequest: () => void }) {
  return (
    <>
      <div className="settings-note-card">
        <div className="settings-note-title">Take it anywhere</div>
        <div className="settings-note-copy" style={{ marginTop: 4 }}>
          Sync your Memosa folder to Google Drive or Dropbox, then point any model at it.
          Build a NotebookLM on your calls. Ask Claude to summarise a week of meetings.
          The more you capture, the more useful your AI becomes.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {['NotebookLM', 'ChatGPT', 'Claude', 'Gemini', 'Google Drive', 'Obsidian'].map((tool) => (
            <span key={tool} className="chip chip-muted">{tool}</span>
          ))}
        </div>
      </div>

      <div className="settings-note-card">
        <div className="settings-inline-head">
          <div>
            <div className="settings-note-title">Shape what comes next</div>
            <div className="settings-note-copy">
              Want native AI or a new integration? The roadmap follows real demand.
            </div>
          </div>
          <button
            className="ghost-pill is-selected-pill"
            style={{ flexShrink: 0 }}
            onClick={onRequest}
          >
            Request a feature
          </button>
        </div>
      </div>
    </>
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
                {activeTab === 'more' && <MorePanel onRequest={() => void api.openExternalUrl(WEBSITE_URL)} />}
              </section>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
