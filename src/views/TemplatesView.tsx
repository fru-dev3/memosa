import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/tauri'
import type { AppSettings } from '../lib/types'
import { useMemosaStore } from '../store'

const TEMPLATE_OPTIONS = [
  { id: 'meeting_brief', label: 'Meeting', detail: 'General meeting summary for most work conversations.', icon: 'brief' },
  { id: 'one_on_one_briefing', label: '1:1', detail: 'Manager, teammate, or coaching-style conversations.', icon: 'person' },
  { id: 'customer_call', label: 'Customer call', detail: 'Customer needs, commitments, objections, and next steps.', icon: 'call' },
  { id: 'project_sync', label: 'Project sync', detail: 'Status, blockers, owners, and milestones.', icon: 'grid' },
  { id: 'interview_notes', label: 'Interview', detail: 'Candidate evaluation, evidence, and recommendation.', icon: 'spark' },
  { id: 'personal_notes', label: 'Personal note', detail: 'Personal reflections, voice notes, and idea capture.', icon: 'note' },
] as const

type TemplateId = (typeof TEMPLATE_OPTIONS)[number]['id']
type EditableTemplate = {
  id: string
  label: string
  detail: string
  prompt: string
  builtIn: boolean
  icon: string
}

function TemplateIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'brief':
      return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2.25" width="12" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.35" /><path d="M5 5.5H11M5 8H11M5 10.5H8.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
    case 'person':
      return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="5" r="2.25" stroke="currentColor" strokeWidth="1.35" /><path d="M3.5 13.25C4.05 11.3 5.83 10 8 10C10.17 10 11.95 11.3 12.5 13.25" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
    case 'call':
      return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 2.75H11V13.25H5V2.75Z" stroke="currentColor" strokeWidth="1.35" /><path d="M7 11.1H9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
    case 'grid':
      return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.35" /><rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.35" /><rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.35" /><rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.35" /></svg>
    case 'spark':
      return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.25L9.55 6.45L13.75 8L9.55 9.55L8 13.75L6.45 9.55L2.25 8L6.45 6.45L8 2.25Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /></svg>
    default:
      return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2.5H13V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.35" /><path d="M5.25 5.5H10.75M5.25 8H10.75M5.25 10.5H8.75" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
  }
}

function normalizeCustomTemplates(settings: AppSettings | null): AppSettings['custom_summary_templates'] {
  const raw = settings?.custom_summary_templates
  if (!Array.isArray(raw)) return []
  return raw
    .filter((template): template is AppSettings['custom_summary_templates'][number] => Boolean(template && typeof template === 'object'))
    .map((template) => ({
      id: typeof template.id === 'string' && template.id.trim() ? template.id : `custom_${Date.now()}`,
      label: typeof template.label === 'string' && template.label.trim() ? template.label : 'New template',
      detail: typeof template.detail === 'string' && template.detail.trim() ? template.detail : 'Custom summary shape',
      prompt: typeof template.prompt === 'string' ? template.prompt : '',
    }))
}

const DEFAULT_PROMPTS: Record<TemplateId, string> = {
  meeting_brief: 'Summarize the meeting clearly. Highlight the main discussion, the most important decisions, and the next steps.',
  one_on_one_briefing: 'Summarize this 1:1 with emphasis on alignment, feedback, blockers, and follow-through.',
  customer_call: 'Summarize this customer call with emphasis on customer needs, pain points, commitments, and follow-up.',
  project_sync: 'Summarize this project sync with emphasis on status, risks, owners, and next milestones.',
  interview_notes: 'Summarize this interview with emphasis on candidate strengths, concerns, evidence, and recommendation.',
  personal_notes: 'Summarize this personal note with emphasis on reflections, ideas, and next actions.',
}

const MAX_CUSTOM_TEMPLATES = 6

function normalizePrompts(settings: AppSettings | null): Record<TemplateId, string> {
  const current = settings?.summary_template_prompts ?? {}
  return {
    meeting_brief: current.meeting_brief ?? DEFAULT_PROMPTS.meeting_brief,
    one_on_one_briefing: current.one_on_one_briefing ?? DEFAULT_PROMPTS.one_on_one_briefing,
    customer_call: current.customer_call ?? DEFAULT_PROMPTS.customer_call,
    project_sync: current.project_sync ?? DEFAULT_PROMPTS.project_sync,
    interview_notes: current.interview_notes ?? DEFAULT_PROMPTS.interview_notes,
    personal_notes: current.personal_notes ?? DEFAULT_PROMPTS.personal_notes,
  }
}

export function TemplatesView() {
  const { setActiveView, setSettings, settings } = useMemosaStore()
  const [activeTemplateId, setActiveTemplateId] = useState<string>('meeting_brief')
  const [draftPrompts, setDraftPrompts] = useState<Record<TemplateId, string>>(() => normalizePrompts(settings))
  const [customTemplates, setCustomTemplates] = useState<AppSettings['custom_summary_templates']>(() => normalizeCustomTemplates(settings))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraftPrompts(normalizePrompts(settings))
    setCustomTemplates(normalizeCustomTemplates(settings))
  }, [settings])

  const allTemplates = useMemo<EditableTemplate[]>(
    () => [
      ...TEMPLATE_OPTIONS.map((template) => ({
        ...template,
        prompt: draftPrompts[template.id],
        builtIn: true,
      })),
      ...customTemplates.map((template) => ({
        ...template,
        builtIn: false,
        icon: 'custom',
      })),
    ],
    [customTemplates, draftPrompts]
  )
  const customTemplateLimitReached = customTemplates.length >= MAX_CUSTOM_TEMPLATES

  const activeTemplate = allTemplates.find((template) => template.id === activeTemplateId) ?? allTemplates[0]
  const isDirty = useMemo(() => {
    return (
      JSON.stringify(draftPrompts) !== JSON.stringify(normalizePrompts(settings)) ||
      JSON.stringify(customTemplates) !== JSON.stringify(settings?.custom_summary_templates ?? [])
    )
  }, [customTemplates, draftPrompts, settings])

  const updatePrompt = (templateId: TemplateId, prompt: string) => {
    setDraftPrompts((prev) => ({ ...prev, [templateId]: prompt }))
    setSaved(false)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const nextSettings: AppSettings = {
        ...settings,
        summary_template_prompts: draftPrompts,
        custom_summary_templates: customTemplates,
      }
      await api.saveSettings(nextSettings)
      const refreshed = await api.getSettings()
      setSettings(refreshed)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save templates')
    } finally {
      setSaving(false)
    }
  }

  const resetTemplate = () => {
    if (!activeTemplate) return
    if (activeTemplate.builtIn) {
      updatePrompt(activeTemplate.id as TemplateId, DEFAULT_PROMPTS[activeTemplate.id as TemplateId])
      return
    }

    setCustomTemplates((prev) => prev.map((template) => (
      template.id === activeTemplate.id
        ? { ...template, prompt: '' }
        : template
    )))
    setSaved(false)
  }

  const updateCustomTemplate = (templateId: string, patch: Partial<AppSettings['custom_summary_templates'][number]>) => {
    setCustomTemplates((prev) => prev.map((template) => (
      template.id === templateId ? { ...template, ...patch } : template
    )))
    setSaved(false)
  }

  const addTemplate = () => {
    if (customTemplateLimitReached) {
      setError(`You can keep up to ${MAX_CUSTOM_TEMPLATES} custom templates. Delete one or edit an existing template to continue.`)
      return
    }
    const id = `custom_${Date.now()}`
    const next = {
      id,
      label: 'New template',
      detail: 'Custom summary shape',
      prompt: '',
    }
    setCustomTemplates((prev) => [...prev, next])
    setActiveTemplateId(id)
    setError(null)
    setSaved(false)
  }

  const deleteTemplate = () => {
    if (!activeTemplate || activeTemplate.builtIn) return
    setCustomTemplates((prev) => prev.filter((template) => template.id !== activeTemplate.id))
    setActiveTemplateId('meeting_brief')
    setError(null)
    setSaved(false)
  }

  if (!activeTemplate) {
    return (
      <div className="settings-modal-backdrop" onClick={() => setActiveView('today')}>
        <div className="settings-scene" onClick={(event) => event.stopPropagation()}>
          <div className="settings-sheet templates-sheet">
            <aside className="settings-rail templates-rail">
              <div className="settings-rail-top">
                <div className="settings-modal-eyebrow">Templates</div>
                <div className="settings-rail-title">Summary prompts</div>
                <div className="settings-rail-copy">
                  No templates are available right now.
                </div>
              </div>
              <div className="settings-rail-footer">
                <button className="ghost-pill" onClick={() => setActiveView('today')}>
                  Close
                </button>
                <button className="ghost-pill is-selected-pill" onClick={addTemplate}>
                  New template
                </button>
              </div>
            </aside>
            <section className="settings-content templates-content">
              <div className="settings-content-scroll">
                <div className="templates-stage">
                  <section className="settings-block">
                    <div className="settings-block-header">
                      <h2 className="settings-block-title">Templates unavailable</h2>
                      <p className="settings-block-copy">
                        Memosa could not load the current template state. Create a new template or close this view and reopen it.
                      </p>
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

  return (
    <div className="settings-modal-backdrop" onClick={() => setActiveView('today')}>
      <div className="settings-scene" onClick={(event) => event.stopPropagation()}>
        <div className="settings-sheet templates-sheet">
          <aside className="settings-rail templates-rail">
            <div className="settings-rail-top">
              <div className="settings-modal-eyebrow">Templates</div>
              <div className="settings-rail-title">Templates</div>
              <div className="settings-rail-copy">
                Pick one. Edit the prompt on the right.
              </div>
            </div>

            <div className="templates-rail-count">
              <span>{customTemplates.length}/{MAX_CUSTOM_TEMPLATES} custom</span>
              {saved ? <span className="chip chip-success">saved</span> : null}
            </div>

            {customTemplateLimitReached ? (
              <div className="templates-limit-note">
                Max reached. Delete one to add another.
              </div>
            ) : null}

            <div className="templates-list">
              {allTemplates.map((template) => {
                const active = template.id === activeTemplateId
                return (
                  <button
                    key={template.id}
                    className={`templates-list-item ${active ? 'is-active' : ''}`}
                    onClick={() => setActiveTemplateId(template.id)}
                  >
                    <div className="templates-list-item-title-row">
                      <span className="templates-list-item-title-wrap">
                        <span className="templates-list-item-icon"><TemplateIcon kind={template.icon} /></span>
                        <span className="templates-list-item-title">{template.label}</span>
                      </span>
                      <span className={`templates-list-item-kind ${template.builtIn ? '' : 'is-custom'}`}>
                        {template.builtIn ? 'Built-in' : 'Custom'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="settings-rail-footer">
              <button className="ghost-pill" onClick={() => setActiveView('today')}>
                Close
              </button>
              <button className="ghost-pill" onClick={addTemplate} disabled={customTemplateLimitReached}>
                Add template
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="ghost-pill is-selected-pill"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </aside>

          <section className="settings-content templates-content">
            <div className="settings-content-header">
              <div>
                <h1 className="settings-content-title">{activeTemplate.label}</h1>
                <p className="settings-content-copy">{activeTemplate.detail}</p>
              </div>
              <div className="settings-status-stack">
                {isDirty ? <div className="settings-inline-badge is-pending">Unsaved</div> : null}
                <button className="ghost-pill is-selected-pill" onClick={addTemplate} disabled={customTemplateLimitReached}>
                  New template
                </button>
                {!activeTemplate.builtIn ? (
                  <button className="ghost-pill" onClick={deleteTemplate}>
                    Delete
                  </button>
                ) : null}
                <button className="ghost-pill" onClick={resetTemplate}>Reset</button>
              </div>
            </div>

            {error ? <div className="settings-message is-error">{error}</div> : null}

            <div className="settings-content-scroll">
              <div className="templates-stage">
                <section className="settings-block">
                  <div className="settings-block-header">
                    <h2 className="settings-block-title">System prompt</h2>
                    <p className="settings-block-copy">
                      This prompt guides how Memosa summarizes a conversation when you choose the <strong>{activeTemplate.label}</strong> template in Library.
                    </p>
                  </div>

                  <div className="templates-guidance-grid" style={{ marginBottom: 14 }}>
                    <div className="settings-note-card">
                      <div className="settings-note-title">Good prompt patterns</div>
                      <div className="settings-note-copy">
                        Ask for decisions, next steps, blockers, risks, customer needs, strengths, concerns, or reflective takeaways.
                      </div>
                    </div>
                    <div className="settings-note-card">
                      <div className="settings-note-title">Keep it focused</div>
                      <div className="settings-note-copy">
                        One clear instruction works better than a long paragraph. Tell Memosa what to prioritize in this kind of call.
                      </div>
                    </div>
                  </div>

                  {!activeTemplate.builtIn ? (
                    <div className="settings-note-card" style={{ marginBottom: 12 }}>
                      <div className="settings-note-title">Custom template</div>
                      <div className="settings-note-copy">
                        Rename it, describe what it is for, then write the system prompt below. Save once and it becomes available as a selectable summary view in Library.
                      </div>
                    </div>
                  ) : null}
                  {!activeTemplate.builtIn ? (
                    <div className="templates-meta-grid">
                      <input
                        value={activeTemplate.label}
                        onChange={(event) => updateCustomTemplate(activeTemplate.id, { label: event.target.value })}
                        className="settings-input"
                        placeholder="Template name"
                      />
                      <input
                        value={activeTemplate.detail}
                        onChange={(event) => updateCustomTemplate(activeTemplate.id, { detail: event.target.value })}
                        className="settings-input"
                        placeholder="Short description"
                      />
                    </div>
                  ) : null}
                  <textarea
                    value={activeTemplate.builtIn ? draftPrompts[activeTemplate.id as TemplateId] : activeTemplate.prompt}
                    onChange={(event) => activeTemplate.builtIn
                      ? updatePrompt(activeTemplate.id as TemplateId, event.target.value)
                      : updateCustomTemplate(activeTemplate.id, { prompt: event.target.value })}
                    className="settings-input templates-prompt-editor"
                  />
                </section>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
