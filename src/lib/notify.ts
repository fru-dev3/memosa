// Lightweight toast helpers. The <Toast/> component in App.tsx listens for the
// `memosa:toast` window event, so any module can surface a message without
// importing React state.

export function showToast(message: string): void {
  window.dispatchEvent(new CustomEvent('memosa:toast', { detail: { message } }))
}

/** Surface an error to the user as a toast. Accepts an Error, string, or unknown. */
export function showError(err: unknown, fallback = 'Something went wrong'): void {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : fallback
  showToast(message)
}
