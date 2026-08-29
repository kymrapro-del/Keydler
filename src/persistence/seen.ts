const PREFIX = 'watch-log:seen:'

function key(taskId: string): string {
  return `${PREFIX}${taskId}`
}

export function seenVersion(taskId: string): number | null {
  try {
    const stored = localStorage.getItem(key(taskId))
    if (stored === null) return null
    const parsed = Number(stored)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

export function markSeen(taskId: string, version: number): void {
  if (!Number.isInteger(version) || version < 1) return
  const known = seenVersion(taskId)
  if (known !== null && known >= version) return
  try {
    localStorage.setItem(key(taskId), String(version))
  } catch {
    // Storage can be refused (private browsing, blocked site). The digest will
    // then show nothing, which is the right default.
  }
}

export function forgetSeen(taskId: string): void {
  try {
    localStorage.removeItem(key(taskId))
  } catch {
    // Nothing to do: there was already nothing to forget.
  }
}
