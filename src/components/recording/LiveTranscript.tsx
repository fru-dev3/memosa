import { useEffect, useRef } from 'react'
import { useMemosaStore } from '../../store'

export function LiveTranscript() {
  const lines = useMemosaStore((s) => s.liveTranscriptLines)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  if (lines.length === 0) {
    return (
      <div style={{
        padding: '10px 14px',
        color: 'var(--text-muted)',
        fontSize: 12,
        fontStyle: 'italic',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        Live transcript will appear here as you speak…
      </div>
    )
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border-subtle)',
      maxHeight: 160,
      overflowY: 'auto',
      padding: '8px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      {lines.map((line, i) => (
        <p key={i} style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.5,
          color: i === lines.length - 1 ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}>
          {line}
        </p>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
