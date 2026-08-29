export const DYNAMIC_UNREGISTER_MIN_CHROMIUM = 153

export type LifecycleMode = 'dynamic' | 'static'

export type ToolLifecycle = {
  mode: LifecycleMode
  chromiumMajor: number | null
  reason: string
}

type Brand = { brand?: unknown; version?: unknown }
type UADataLike = { brands?: Brand[] }

export function chromiumMajorVersion(): number | null {
  const data = (globalThis.navigator as unknown as { userAgentData?: UADataLike } | undefined)
    ?.userAgentData
  if (!data || !Array.isArray(data.brands)) return null

  for (const entry of data.brands) {
    if (typeof entry?.brand !== 'string' || entry.brand.toLowerCase() !== 'chromium') continue
    const version = Number.parseInt(String(entry.version), 10)
    return Number.isInteger(version) ? version : null
  }
  return null
}

export function detectLifecycle(): ToolLifecycle {
  const chromiumMajor = chromiumMajorVersion()

  if (chromiumMajor === null) {
    return {
      mode: 'static',
      chromiumMajor: null,
      reason:
        'Chromium version unknown, so tools stay registered for the life of the document (safe default).',
    }
  }

  if (chromiumMajor >= DYNAMIC_UNREGISTER_MIN_CHROMIUM) {
    return {
      mode: 'dynamic',
      chromiumMajor,
      reason: `Chromium ${chromiumMajor}: unregistering a tool is safe while an execution is in flight (since ${DYNAMIC_UNREGISTER_MIN_CHROMIUM}).`,
    }
  }

  return {
    mode: 'static',
    chromiumMajor,
    reason: `Chromium ${chromiumMajor}, below ${DYNAMIC_UNREGISTER_MIN_CHROMIUM}, where unregistering may drop an in-flight reply; tools stay registered.`,
  }
}
