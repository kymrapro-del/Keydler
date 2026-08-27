export type StorageState = {
  persisted: boolean | null
  usage: number | null
  quota: number | null
}

export const UNKNOWN: StorageState = { persisted: null, usage: null, quota: null }

export async function readStorage(): Promise<StorageState> {
  const api = navigator.storage
  if (!api || typeof api.persisted !== 'function') return UNKNOWN

  let persisted: boolean
  try {
    persisted = await api.persisted()
  } catch {
    return UNKNOWN
  }

  try {
    const estimate = await api.estimate?.()
    return { persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null }
  } catch {
    // La durabilité est connue, la place ne l'est pas : on rend ce que l'on sait.
    return { persisted, usage: null, quota: null }
  }
}

/**
 * `null` veut dire que le navigateur ne répond pas à cette question. Ni oui,
 * ni non : on ne peut rien en conclure, et l'écran doit le dire ainsi.
 */
export async function askForPersistence(): Promise<boolean | null> {
  const api = navigator.storage
  if (!api || typeof api.persist !== 'function') return null
  try {
    return await api.persist()
  } catch {
    return null
  }
}

export function humanSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

export function describeStorage(state: StorageState): string {
  const place = state.usage === null ? '' : ` This log takes ${humanSize(state.usage)}.`

  if (state.persisted === null) {
    return `This browser cannot say whether it will keep the data here.${place}`
  }

  if (state.persisted) {
    return (
      'Storage is durable: the browser will not clear this on its own when space ' +
      `runs short. You can still delete it yourself, and so can a full site-data wipe.${place}`
    )
  }

  return (
    'Storage is not durable: the browser may clear this when space runs short, ' +
    `and nothing here would survive it. Export what matters.${place}`
  )
}
