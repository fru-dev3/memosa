import type { Meeting } from './types'

export interface AggregateInsight {
  title: string
  summary: string
  expandedSummary: string
  meetingCount: number
  totalDurationSeconds: number
  people: string[]
  themes: string[]
  tags: string[]
  actionItems: string[]
  meetings: Meeting[]
}

function unique(values: string[], limit: number) {
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized) continue
    if (!out.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      out.push(normalized)
    }
    if (out.length >= limit) break
  }
  return out
}

function sumDuration(meetings: Meeting[]) {
  return meetings.reduce((sum, meeting) => sum + (meeting.duration_seconds ?? 0), 0)
}

function sentenceCase(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized[0].toUpperCase() + normalized.slice(1)
}

function cleanSummary(summary: string) {
  return sentenceCase(summary.replace(/\s+/g, ' ').trim().replace(/\.+$/g, ''))
}

function buildSynthesizedSummary(meetings: Meeting[], people: string[], themes: string[], tags: string[]) {
  const summaries = meetings
    .map((meeting) => meeting.summary?.trim())
    .filter((summary): summary is string => Boolean(summary))
    .map(cleanSummary)
    .filter(Boolean)

  const opening = `Across ${meetings.length} conversation${meetings.length === 1 ? '' : 's'}, the strongest recurring focus was ${themes.slice(0, 3).join(', ') || tags.slice(0, 3).join(', ') || 'recent work'}.`
  const peopleSentence = people.length > 0
    ? `The thread most often involved ${people.slice(0, 4).join(', ')}.`
    : ''
  const directionSentence = tags.length > 0
    ? `The material consistently points toward ${tags.slice(0, 4).join(', ')}.`
    : themes.length > 0
      ? `The notes cluster around ${themes.slice(0, 4).join(', ')} rather than isolated one-off topics.`
      : ''
  const evidenceSentence = summaries.length > 0
    ? `Taken together, the notes suggest: ${summaries.slice(0, 2).join(' ')}.`
    : ''

  const summary = [opening, peopleSentence, directionSentence]
    .filter(Boolean)
    .join(' ')
    .trim()

  const expandedSummary = [opening, peopleSentence, directionSentence, evidenceSentence]
    .filter(Boolean)
    .join(' ')
    .trim()

  return {
    summary,
    expandedSummary: expandedSummary || summary,
  }
}

export function buildAggregateInsight(title: string, meetings: Meeting[]): AggregateInsight | null {
  if (meetings.length === 0) return null

  const people = unique(meetings.flatMap((meeting) => meeting.people ?? meeting.attendees ?? []), 6)
  const themes = unique(meetings.flatMap((meeting) => meeting.themes ?? []), 6)
  const tags = unique(meetings.flatMap((meeting) => meeting.tags ?? meeting.keywords ?? []), 8)
  const synthesized = buildSynthesizedSummary(meetings, people, themes, tags)

  return {
    title,
    summary: synthesized.summary,
    expandedSummary: synthesized.expandedSummary,
    meetingCount: meetings.length,
    totalDurationSeconds: sumDuration(meetings),
    people,
    themes,
    tags,
    actionItems: unique(
      meetings.flatMap((meeting) => {
        const base = meeting.summary ? [meeting.summary] : []
        return base
      }),
      3
    ),
    meetings,
  }
}

export function formatDurationCompact(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.round((totalSeconds % 3600) / 60)
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function startOfWeek(date: Date) {
  const next = new Date(date)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  next.setHours(0, 0, 0, 0)
  return next
}

export function filterMeetingsByRange(meetings: Meeting[], from: Date, to: Date) {
  const fromKey = from.toISOString().slice(0, 10)
  const toKey = to.toISOString().slice(0, 10)
  return meetings.filter((meeting) => meeting.date >= fromKey && meeting.date <= toKey)
}
