import { useMemo, useState } from 'react'
import * as api from '../lib/tauri'
import { useMemosaStore } from '../store'

const SECTION_ORDER = ['overview', 'runtime', 'trust'] as const
type PrivacySectionId = (typeof SECTION_ORDER)[number]

const pillars = [
  'No meeting bots',
  'Audio processing happens on-device after model download',
  'Local transcription on your device',
  'Local storage in your chosen folder',
  'Transparent microphone permissions',
]

const WHISPER_REPO_URL = 'https://github.com/openai/whisper'
const WHISPER_MODEL_CARD_URL = 'https://github.com/openai/whisper/blob/main/model-card.md'

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4 2.25H9.75V8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 2.5L2.25 9.75" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

const trustSections = [
  {
    title: 'No data sent to third parties',
    body: 'Memosa does not transmit recordings, transcripts, or any personal data to external services. All processing happens on this Mac.',
  },
  {
    title: 'What gets recorded',
    body: 'Only the microphone or system audio sources you explicitly enable.',
  },
  {
    title: 'What stays local',
    body: 'Audio files, transcripts, and search content remain on-device. Nothing is uploaded.',
  },
  {
    title: 'Local models',
    body: 'Whisper runs on this Mac, so sensitive meeting audio does not need a remote transcription service.',
  },
]

function PrivacyMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="privacy-metric-card">
      <div className="privacy-metric-label">{label}</div>
      <div className="privacy-metric-value">{value}</div>
      {detail ? <div className="privacy-metric-copy">{detail}</div> : null}
    </div>
  )
}

export function PrivacyView() {
  const { availableModels, meetings, settings, setActiveView } = useMemosaStore()
  const [activeSection, setActiveSection] = useState<PrivacySectionId>('overview')

  const transcriptsComplete = meetings.filter((meeting) => meeting.transcription_status === 'complete').length
  const failedTranscripts = meetings.filter((meeting) => meeting.transcription_status === 'failed').length
  const downloadedModels = availableModels.filter((model) => model.downloaded)
  const localOnlyMode = true

  const modelRuntime = useMemo(() => {
    if (downloadedModels.length === 0) return 'No local model yet'
    return `${downloadedModels.map((model) => model.name).join(', ')} local`
  }, [downloadedModels])

  const encryptionStatus = settings?.storage_path?.startsWith('/Users/')
    ? 'Managed by macOS disk encryption'
    : 'Storage path configured'

  const sectionMeta: Record<PrivacySectionId, { label: string; detail: string }> = {
    overview: {
      label: 'Overview',
      detail: 'The privacy promise, condensed into a smaller trust overview.',
    },
    runtime: {
      label: 'Runtime',
      detail: 'What the app is currently doing on this Mac.',
    },
    trust: {
      label: 'Trust',
      detail: 'Why the product behaves differently from visible meeting bots.',
    },
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':
        return (
          <section className="settings-block">
            <div className="settings-block-header">
              <div className="settings-block-label">Overview</div>
              <h2 className="settings-block-title">Built to stay local.</h2>
              <p className="settings-block-copy">
                Memosa keeps your data on your Mac: no bot joins the call, no remote transcription service in the default flow, and a local archive you control.
              </p>
            </div>

            <div className="privacy-pillars">
              {pillars.map((pillar) => (
                <div key={pillar} className="privacy-pillar-chip">
                  <span className="privacy-pillar-dot" aria-hidden="true" />
                  <span>{pillar}</span>
                </div>
              ))}
            </div>

            <div className="settings-note-card">
              <div className="settings-note-title">Local Whisper models in Memosa</div>
              <div className="settings-note-copy">
                This app exposes four local Whisper sizes: tiny, base, small, and medium. Models are downloaded from the internet on first use, then run entirely on this Mac. Once downloaded, audio processing happens on-device without sending data to any cloud service.
              </div>
              <div className="settings-link-row">
                <button className="settings-link-pill" type="button" onClick={() => void api.openExternalUrl(WHISPER_REPO_URL)}>
                  <ExternalLinkIcon />
                  OpenAI Whisper repo
                </button>
                <button className="settings-link-pill" type="button" onClick={() => void api.openExternalUrl(WHISPER_MODEL_CARD_URL)}>
                  <ExternalLinkIcon />
                  Model card
                </button>
              </div>
            </div>

            <div className="privacy-band">
              <div className="privacy-band-card">
                <div className="privacy-band-label">Traditional meeting bots</div>
                <div className="privacy-band-copy">
                  Join the meeting visibly and route audio through a remote service.
                </div>
              </div>
              <div className="privacy-band-card is-active">
                <div className="privacy-band-label">Memosa</div>
                <div className="privacy-band-copy">
                  Records locally and keeps the archive under your control on this Mac.
                </div>
              </div>
            </div>
          </section>
        )
      case 'runtime':
        return (
          <section className="settings-block">
            <div className="settings-block-header">
              <div className="settings-block-label">Runtime</div>
              <h2 className="settings-block-title">Current local posture</h2>
              <p className="settings-block-copy">
                The app is local-first right now, and these cards summarize the current runtime behavior.
              </p>
            </div>

            <div className="privacy-metrics-grid">
              <PrivacyMetric label="Flow" value={localOnlyMode ? 'Local' : 'Mixed'} detail="Current runtime mode" />
              <PrivacyMetric label="Storage" value={settings?.storage_path ?? 'Not configured'} detail="Archive folder" />
              <PrivacyMetric label="Model runtime" value={modelRuntime} detail="Whisper on this Mac" />
              <PrivacyMetric label="Encryption" value={encryptionStatus} />
              <PrivacyMetric label="Completed" value={String(transcriptsComplete)} detail="Transcripts" />
              <PrivacyMetric label="Failed" value={String(failedTranscripts)} detail="Transcripts" />
            </div>
          </section>
        )
      case 'trust':
        return (
          <section className="settings-block">
            <div className="settings-block-header">
              <div className="settings-block-label">Trust</div>
              <h2 className="settings-block-title">What the app is doing</h2>
              <p className="settings-block-copy">
                The main privacy decisions are simple and visible, rather than hidden behind marketing copy.
              </p>
            </div>

            <div className="privacy-trust-list">
              {trustSections.map((section) => (
                <article key={section.title} className="privacy-trust-item">
                  <div className="privacy-trust-title">{section.title}</div>
                  <div className="privacy-trust-copy">{section.body}</div>
                </article>
              ))}
            </div>
          </section>
        )
    }
  }

  return (
    <div className="settings-modal-backdrop" onClick={() => setActiveView('today')}>
      <div className="settings-scene" onClick={(event) => event.stopPropagation()}>
        <div className="settings-sheet">
          <aside className="settings-rail">
            <div className="settings-rail-top">
              <div className="settings-modal-eyebrow">Privacy</div>
              <div className="settings-rail-title">Trust Center</div>
              <div className="settings-rail-copy">
                A compact view of what stays local and how the current app behaves.
              </div>
            </div>

            <div className="settings-identity-card">
              <div className="settings-inline-badge is-success">Local-first</div>
              <div>
                <div className="settings-identity-name">Privacy posture</div>
                <div className="settings-identity-copy">Current app runtime</div>
              </div>
            </div>

            <nav className="settings-rail-nav">
              {SECTION_ORDER.map((sectionId) => (
                <button
                  key={sectionId}
                  className={`settings-rail-item ${activeSection === sectionId ? 'is-active' : ''}`}
                  onClick={() => setActiveSection(sectionId)}
                >
                  <span>{sectionMeta[sectionId].label}</span>
                </button>
              ))}
            </nav>

            <div className="settings-rail-footer">
              <button className="ghost-pill" onClick={() => setActiveView('today')}>
                Close
              </button>
            </div>
          </aside>

          <section className="settings-content">
            <div className="settings-content-header">
              <div>
                <h1 className="settings-content-title">{sectionMeta[activeSection].label}</h1>
                <p className="settings-content-copy">{sectionMeta[activeSection].detail}</p>
              </div>
              <div className="settings-status-stack">
                <div className="settings-inline-badge is-success">Local-first</div>
              </div>
            </div>

            <div className="settings-content-scroll">
              {renderSection()}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
