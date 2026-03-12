const CONTACT_EMAIL = 'hello@memosa.app'
const FEATURE_REQUEST_URL = 'https://memosa.app/requests'

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.8" stroke="currentColor" strokeWidth="1.35" />
      <path d="M1.5 5.5L8 9.5L14.5 5.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 2.5H13.5V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 2.5L7 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7.5 4H3C2.45 4 2 4.45 2 5v8c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function DriveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7 4H13L16.5 10L13 16H7L3.5 10L7 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function NotesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.5" y="3" width="13" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7.5H13M7 10.5H13M7 13.5H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function DatabaseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <ellipse cx="10" cy="6" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 6V14C4.5 15.38 7.02 16.5 10 16.5C12.98 16.5 15.5 15.38 15.5 14V6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 10C4.5 11.38 7.02 12.5 10 12.5C12.98 12.5 15.5 11.38 15.5 10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function WebhookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 10a3 3 0 116 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 10a3 3 0 11-6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4.5" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.5" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 10l-1.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 10l1.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const INTEGRATION_GROUPS = [
  {
    title: 'Cloud drives',
    detail: 'Google Drive · Box · Dropbox',
    copy: 'The most-requested storage destinations. Export recordings, transcripts, and summaries to shared drives for your team.',
    icon: <DriveIcon />,
    priority: 1,
  },
  {
    title: 'Notes & research',
    detail: 'Notion · Obsidian · NotebookLM',
    copy: 'Turn transcripts into searchable, linked working knowledge that lives where your thinking already happens.',
    icon: <NotesIcon />,
    priority: 2,
  },
  {
    title: 'Databases',
    detail: 'Snowflake · Supabase · PostgreSQL',
    copy: 'Sync structured meeting data to the platforms your team already uses for analytics and reporting.',
    icon: <DatabaseIcon />,
    priority: 3,
  },
  {
    title: 'Automation',
    detail: 'Webhooks · Custom endpoints',
    copy: 'The simplest path for custom pipelines — push events and transcripts to any internal system on your terms.',
    icon: <WebhookIcon />,
    priority: 4,
  },
]

export function IntegrationsView() {
  return (
    <div className="page-shell">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="surface-panel integrations-hero">
        <div className="integrations-hero-copy">
          <div className="eyebrow">Integrations</div>
          <h1 className="page-title" style={{ marginTop: 8 }}>
            Local first.<br />Connected soon.
          </h1>
          <p className="page-subtitle">
            Everything Memosa captures stays on this Mac — no bots, no middlemen.
            The categories below represent the most-requested ways to bring that archive
            into the rest of your workflow. None are live yet, but they're what's being planned.
          </p>
        </div>
        <div className="integrations-hero-art" aria-hidden="true">
          <span className="integrations-node integrations-node-a" />
          <span className="integrations-node integrations-node-b" />
          <span className="integrations-node integrations-node-c" />
          <span className="integrations-node integrations-node-d" />
          <span className="integrations-link integrations-link-a" />
          <span className="integrations-link integrations-link-b" />
          <span className="integrations-link integrations-link-c" />
          <span className="integrations-core" />
        </div>
      </section>

      {/* ── Cards grid ───────────────────────────────────────── */}
      <div className="integrations-grid">
        {INTEGRATION_GROUPS.map((group) => (
          <section key={group.title} className="integration-card">
            <div className="integration-card-head">
              <div className="integration-card-icon">{group.icon}</div>
              <div className="integration-priority-badge">
                #{group.priority} most requested
              </div>
            </div>
            <div>
              <h2 className="integration-card-title">{group.title}</h2>
              <div className="integration-card-detail">{group.detail}</div>
            </div>
            <p className="integration-card-copy">{group.copy}</p>
            <div className="integration-card-foot">
              <span className="integration-card-badge">Coming Soon</span>
            </div>
          </section>
        ))}
      </div>

      {/* ── Request section ──────────────────────────────────── */}
      <section className="surface-panel integrations-request-panel">
        <div className="integrations-request-copy">
          <div className="section-label">Shape what gets built next</div>
          <div className="integrations-request-title">Request an integration</div>
          <p className="integrations-request-text">
            Every integration on this list was requested by users like you.
            Tell the developer what would make Memosa fit perfectly into your workflow —
            the most-requested ones move up the priority list.
          </p>
        </div>
        <div className="integrations-request-actions">
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Integration%20Request&body=Hi%2C%20I%27d%20love%20to%20see%20Memosa%20integrate%20with...`}
            className="integrations-request-btn integrations-request-btn-primary"
          >
            <MailIcon />
            <span>Send a request</span>
          </a>
          <a
            href={FEATURE_REQUEST_URL}
            target="_blank"
            rel="noreferrer"
            className="integrations-request-btn"
          >
            <ExternalIcon />
            <span>Feature requests page</span>
          </a>
          <div className="integrations-request-email">
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>or email directly:</span>
            <a href={`mailto:${CONTACT_EMAIL}`} className="integrations-request-email-link">{CONTACT_EMAIL}</a>
          </div>
        </div>
      </section>

    </div>
  )
}
