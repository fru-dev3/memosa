import { useState } from 'react'
import * as api from '../lib/tauri'
import type { RecordingProfile, SummaryTemplate } from '../lib/types'
import { useMemosaStore } from '../store'

const SUMMARY_TEMPLATE_LABELS: Record<SummaryTemplate, string> = {
  general: 'General notes',
  meeting_brief: 'Meeting brief',
  one_on_one_briefing: '1-on-1 briefing',
  customer_call: 'Customer call',
  internal_standup: 'Internal standup',
  project_sync: 'Project sync',
  interview_notes: 'Interview notes',
  research_notes: 'Research notes',
  lecture_notes: 'Lecture notes',
  personal_notes: 'Personal notes',
  action_items: 'Action items',
  decision_log: 'Decision log',
}

const SYSTEM_DEFAULT_PROFILE_ID = 'default'

const iconMap: Record<string, string> = {
  briefcase: '▣',
  spark: '✦',
  notebook: '◫',
}

function toggleTag(tags: string[], value: string) {
  return tags.includes(value) ? tags.filter((tag) => tag !== value) : [...tags, value]
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'P'
}

export function ProfilesView() {
  const {
    createProfile,
    deleteProfile,
    meetings,
    profiles,
    selectedProfileId,
    setActiveView,
    setSelectedProfileId,
    updateProfile,
  } = useMemosaStore()
  const [migrating, setMigrating] = useState(false)
  const [migrationDone, setMigrationDone] = useState(false)

  const handleMigrateToDefault = async () => {
    setMigrating(true)
    try {
      const allMeetings = await api.getMeetings({})
      for (const meeting of allMeetings) {
        await api.updateMeetingProfile(meeting.id, SYSTEM_DEFAULT_PROFILE_ID)
      }
      setMigrationDone(true)
    } finally {
      setMigrating(false)
    }
  }

  const activeProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0]
  const isDefaultProfile = activeProfile.id === SYSTEM_DEFAULT_PROFILE_ID

  const update = <K extends keyof RecordingProfile>(key: K, value: RecordingProfile[K]) => {
    updateProfile(activeProfile.id, { [key]: value } as Partial<RecordingProfile>)
  }

  return (
    <div className="settings-modal-backdrop" onClick={() => setActiveView('today')}>
      <div className="settings-scene" onClick={(event) => event.stopPropagation()}>
        <div className="settings-sheet">
          <aside className="settings-rail">
            <div className="settings-rail-top">
              <div className="settings-modal-eyebrow">Profiles</div>
              <div className="settings-rail-title">Recording profiles</div>
              <div className="settings-rail-copy">
                Pick a profile, then edit it in the same place. The default profile is always available.
              </div>
            </div>

            <div className="settings-identity-card">
              <div className="settings-profile-avatar" style={{ background: activeProfile?.accent ?? 'var(--accent)' }}>
                {initialsFor(activeProfile?.name ?? 'Profile')}
              </div>
              <div>
                <div className="settings-identity-name">{activeProfile?.name ?? 'Default profile'}</div>
                <div className="settings-identity-copy">
                  {isDefaultProfile ? 'Default profile' : 'Saved locally'}
                </div>
              </div>
            </div>

            <div className="settings-rail-footer">
              <button className="ghost-pill" onClick={() => setActiveView('today')}>
                Close
              </button>
              <button className="ghost-pill is-selected-pill" onClick={createProfile}>
                Add profile
              </button>
            </div>
          </aside>

          <section className="settings-content">
            <div className="settings-content-header">
              <div>
                <h1 className="settings-content-title">Profiles</h1>
                <p className="settings-content-copy">
                  Choose the active profile on the left. Edit the selected profile on the right.
                </p>
              </div>
              <div className="settings-status-stack">
                <div className="settings-inline-badge is-success">Local</div>
              </div>
            </div>

            <div className="settings-content-scroll">
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: 12 }}>
                <section className="settings-block">
                  <div className="profiles-stage">
                    <div>
                      <div className="profiles-stage-eyebrow">Select</div>
                      <div className="profiles-stage-title">Choose a profile.</div>
                      <div className="profiles-stage-copy">
                        Every recording starts somewhere. The default profile is always present.
                      </div>
                    </div>
                    <div className="profiles-stage-badges">
                      <div className="profiles-stage-badge">{profiles.length} profiles</div>
                    </div>
                  </div>

                  <div className="settings-card-stack">
                    {profiles.map((profile) => {
                      const active = profile.id === selectedProfileId
                      const isDefault = profile.id === SYSTEM_DEFAULT_PROFILE_ID
                      return (
                        <button
                          key={profile.id}
                          className={`profile-card ${active ? 'is-active' : ''}`}
                          onClick={() => setSelectedProfileId(profile.id)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                            <div className="profile-avatar" style={{ background: `${profile.accent}22`, color: profile.accent }}>
                              {iconMap[profile.icon] ?? '•'}
                            </div>
                            <div style={{ textAlign: 'left', minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</span>
                                {isDefault ? <span className="chip chip-success">default</span> : null}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                {profile.default_tags.length > 0 ? profile.default_tags.join(', ') : 'No archive tags'}
                              </div>
                            </div>
                          </div>
                          {!isDefault ? <span className={`chip ${active ? 'chip-success' : 'chip-muted'}`}>{active ? 'selected' : 'saved'}</span> : null}
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="settings-block">
                  <div className="profiles-stage">
                    <div>
                      <div className="profiles-stage-eyebrow">{isDefaultProfile ? 'Default' : 'Editor'}</div>
                      <div className="profiles-stage-title">{activeProfile.name}</div>
                      <div className="profiles-stage-copy">
                        Keep this simple: name, color, and a few archive tags that help organize recordings.
                      </div>
                    </div>
                    <div className="profiles-stage-badges">
                      {isDefaultProfile ? <div className="profiles-stage-badge">Always available</div> : null}
                      <div className="profiles-stage-swatch" style={{ background: activeProfile.accent }} />
                    </div>
                  </div>

                  <div className="settings-card-stack">
                    <label className="settings-field">
                      <div className="settings-field-label-row">
                        <div className="settings-field-label">Profile name</div>
                        {isDefaultProfile ? <div className="settings-field-hint">Marked as the default</div> : null}
                      </div>
                      <input
                        value={activeProfile.name}
                        onChange={(e) => update('name', e.target.value)}
                        className="settings-input"
                      />
                    </label>

                    <label className="settings-field">
                      <div className="settings-field-label">Accent color</div>
                      <input
                        type="color"
                        value={activeProfile.accent}
                        onChange={(e) => update('accent', e.target.value)}
                        style={{ width: 72, height: 42, border: 'none', background: 'transparent', padding: 0 }}
                      />
                    </label>

                    <label className="settings-field">
                      <div className="settings-field-label-row">
                        <div className="settings-field-label">Default summary template</div>
                        <div className="settings-field-hint">Applied when summarizing recordings with this profile</div>
                      </div>
                      <select
                        value={activeProfile.summary_template}
                        onChange={(e) => update('summary_template', e.target.value as SummaryTemplate)}
                        className="settings-input"
                      >
                        {(Object.entries(SUMMARY_TEMPLATE_LABELS) as [SummaryTemplate, string][]).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>

                    <div className="settings-note-card">
                      <div className="settings-note-title">Archive tags</div>
                      <div className="settings-note-copy">
                        Pick a few tags that should follow recordings made with this profile.
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                        {['general', 'work', 'customer', 'research', 'internal', 'follow-up'].map((tag) => (
                          <button
                            key={tag}
                            className={`ghost-pill ${activeProfile.default_tags.includes(tag) ? 'is-selected-pill' : ''}`}
                            onClick={() => update('default_tags', toggleTag(activeProfile.default_tags, tag))}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="settings-note-card">
                      <div className="settings-inline-head">
                        <div>
                          <div className="settings-note-title">{isDefaultProfile ? 'Default profile' : 'Delete this profile'}</div>
                          <div className="settings-note-copy">
                            {isDefaultProfile
                              ? 'This profile stays in the app so there is always a safe starting point.'
                              : 'Delete this profile if you no longer need it. New recordings will fall back to Default.'}
                          </div>
                        </div>
                        {!isDefaultProfile ? (
                          <button className="ghost-pill" onClick={() => deleteProfile(activeProfile.id)}>
                            Delete
                          </button>
                        ) : (
                          <span className="chip chip-success">protected</span>
                        )}
                      </div>
                    </div>

                    {isDefaultProfile && meetings.length > 0 && (
                      <div className="settings-note-card">
                        <div className="settings-inline-head">
                          <div>
                            <div className="settings-note-title">Migrate recordings</div>
                            <div className="settings-note-copy">
                              Move all {meetings.length} recording{meetings.length !== 1 ? 's' : ''} to this default profile.
                              {migrationDone ? ' Done — all recordings now use the default profile.' : ''}
                            </div>
                          </div>
                          <button
                            className="ghost-pill"
                            disabled={migrating || migrationDone}
                            onClick={handleMigrateToDefault}
                          >
                            {migrating ? 'Moving…' : migrationDone ? 'Done' : 'Move all to default'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
