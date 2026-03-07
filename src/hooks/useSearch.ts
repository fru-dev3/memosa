import { useState, useEffect, useCallback } from 'react'
import * as api from '../lib/tauri'
import type { SearchResult } from '../lib/types'
import { useMemosaStore } from '../store'

function stripSnippetMarkup(snippet: string) {
  return snippet.replace(/<\/?b>/g, '')
}

export function useSearch() {
  const { meetings } = useMemosaStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const timer = setTimeout(async () => {
      try {
        const data = await api.searchMeetings(query.trim())
        const cleaned = data.map((item) => ({
          ...item,
          snippet: stripSnippetMarkup(item.snippet),
        }))
        const normalized = query.trim().toLowerCase()
        const enriched: SearchResult[] = meetings
          .filter((meeting) => {
            const haystack = [
              meeting.title,
              meeting.summary ?? '',
              ...(meeting.tags ?? []),
              ...(meeting.people ?? []),
              ...(meeting.themes ?? []),
              ...(meeting.keywords ?? []),
              meeting.source_app ?? '',
            ].join(' ').toLowerCase()
            return haystack.includes(normalized)
          })
          .map((meeting) => ({
            meeting,
            snippet: meeting.summary ?? `Matched metadata in ${meeting.title}`,
          }))
        const merged = [...cleaned]
        for (const item of enriched) {
          if (!merged.some((existing) => existing.meeting.id === item.meeting.id)) {
            merged.push(item)
          }
        }
        if (!cancelled) {
          setResults(merged)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed')
          setResults([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [meetings, query])

  const clearSearch = useCallback(() => {
    setQuery('')
    setResults([])
    setError(null)
  }, [])

  return { query, setQuery, results, loading, error, clearSearch }
}
