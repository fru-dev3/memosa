import { useMemo } from 'react'
import type { Meeting } from '../../lib/types'

interface TagRailProps {
  meetings: Meeting[]
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
}

const TAG_COLORS: Record<string, string> = {
  general: '#6b7280',
  work: '#3b82f6',
  customer: '#8b5cf6',
  research: '#f59e0b',
  internal: '#10b981',
  'follow-up': '#ef4444',
}

function tagColor(tag: string): string {
  return TAG_COLORS[tag] ?? '#0FBE80'
}

export function TagRail({ meetings, selectedTag, onSelectTag }: TagRailProps) {
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const meeting of meetings) {
      for (const tag of meeting.tags ?? []) {
        map.set(tag, (map.get(tag) ?? 0) + 1)
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [meetings])

  const untaggedCount = meetings.filter((m) => !m.tags || m.tags.length === 0).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '8px 0' }}>

      {/* All */}
      <button
        className={`library-tag-item ${selectedTag === null ? 'is-selected' : ''}`}
        onClick={() => onSelectTag(null)}
      >
        <span className="library-tag-dot" style={{ background: 'var(--border-strong)' }} />
        <span className="library-tag-label">All recordings</span>
        <span className="library-tag-count">{meetings.length}</span>
      </button>

      {tagCounts.map(([tag, count]) => (
        <button
          key={tag}
          className={`library-tag-item ${selectedTag === tag ? 'is-selected' : ''}`}
          onClick={() => onSelectTag(selectedTag === tag ? null : tag)}
        >
          <span className="library-tag-dot" style={{ background: tagColor(tag) }} />
          <span className="library-tag-label">{tag}</span>
          <span className="library-tag-count">{count}</span>
        </button>
      ))}

      {untaggedCount > 0 && (
        <button
          className={`library-tag-item ${selectedTag === '__untagged__' ? 'is-selected' : ''}`}
          onClick={() => onSelectTag(selectedTag === '__untagged__' ? null : '__untagged__')}
        >
          <span className="library-tag-dot" style={{ background: 'var(--border-subtle)', border: '1px solid var(--border)' }} />
          <span className="library-tag-label" style={{ color: 'var(--text-muted)' }}>Untagged</span>
          <span className="library-tag-count">{untaggedCount}</span>
        </button>
      )}
    </div>
  )
}
