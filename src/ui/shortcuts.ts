export type Shortcut = {
  key: string
  what: string
}

export const SHORTCUTS: readonly Shortcut[] = [
  { key: '/', what: 'Search this task and the others' },
  { key: 's', what: 'Record a step you did yourself' },
  { key: 'n', what: 'Start a new task' },
  { key: 'e', what: 'Change the next action' },
  { key: '?', what: 'Show this list' },
  { key: 'Esc', what: 'Close whatever is open' },
] as const
