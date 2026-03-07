export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

function normalizeToken(token: string) {
  const lower = token.trim().toLowerCase()
  if (lower === 'cmd' || lower === 'command' || lower === 'meta') return 'meta'
  if (lower === 'ctrl' || lower === 'control') return 'ctrl'
  if (lower === 'alt' || lower === 'option') return 'alt'
  if (lower === 'shift') return 'shift'
  if (lower === 'return') return 'enter'
  return lower
}

export function matchesHotkey(event: KeyboardEvent, shortcut: string) {
  const tokens = shortcut.split('+').map(normalizeToken).filter(Boolean)
  if (tokens.length === 0) return false

  const keyToken = tokens[tokens.length - 1]
  const modifiers = new Set(tokens.slice(0, -1))
  const eventKey = normalizeToken(event.key)

  return (
    modifiers.has('meta') === event.metaKey &&
    modifiers.has('ctrl') === event.ctrlKey &&
    modifiers.has('alt') === event.altKey &&
    modifiers.has('shift') === event.shiftKey &&
    eventKey === keyToken
  )
}
