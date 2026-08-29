import { ALL_TOOLS } from '../webmcp/tools'

const KEY = 'nightorder.tool-permissions.v1'
const listeners = new Set<() => void>()

function knownNames(): string[] {
  return ALL_TOOLS.map((tool) => tool.name)
}

function normalize(input: unknown): string[] {
  if (!Array.isArray(input)) return knownNames()
  const known = new Set(knownNames())
  const clean = input.filter((name): name is string => typeof name === 'string' && known.has(name))
  return [...new Set(clean)]
}

export function enabledToolNames(): string[] {
  if (typeof localStorage === 'undefined') return knownNames()
  try {
    const stored = localStorage.getItem(KEY)
    return stored === null ? knownNames() : normalize(JSON.parse(stored))
  } catch {
    return knownNames()
  }
}

export function setEnabledToolNames(names: readonly string[]): void {
  const clean = normalize([...names])
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(clean))
  for (const listener of listeners) listener()
}

export function setToolEnabled(name: string, enabled: boolean): void {
  const names = new Set(enabledToolNames())
  if (enabled) names.add(name)
  else names.delete(name)
  setEnabledToolNames([...names])
}

export function onToolPermissionsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetToolPermissions(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY)
  for (const listener of listeners) listener()
}
