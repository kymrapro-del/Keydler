const COUNT = /^\(\d+\)\s+/

export function attentionTitle(current: string, waiting: number, visible: boolean): string {
  const base = current.replace(COUNT, '')
  if (waiting <= 0 || visible) return base
  return `(${waiting}) ${base}`
}
