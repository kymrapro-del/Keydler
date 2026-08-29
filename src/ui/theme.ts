export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'watch-log.theme'

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function nextTheme(current: ThemeChoice): ThemeChoice {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'
}

export function themeLabel(choice: ThemeChoice): string {
  return choice === 'system' ? 'Theme: system' : choice === 'light' ? 'Theme: light' : 'Theme: dark'
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice

  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    /* storage refused: the choice holds for this page only */
  }

  const resolved =
    choice === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : choice

  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.remove()
  }
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = resolved === 'dark' ? '#131316' : '#ffffff'
  document.head.append(meta)
}
