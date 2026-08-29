export function canonicalIntent(operation: string, args: Record<string, unknown>): string {
  return `${operation} ${encode(args)}`
}

function encode(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.trim())
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${encode(v)}`)
    return `{${entries.join(',')}}`
  }

  return JSON.stringify(String(value))
}

export function fingerprintIntent(operation: string, args: Record<string, unknown>): string {
  const canonical = canonicalIntent(operation, args)
  const a = cyrb53(canonical, 0)
  const b = cyrb53(canonical, 0x9e3779b9)
  return `${canonical.length.toString(36)}.${a.toString(36)}.${b.toString(36)}`
}

function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
