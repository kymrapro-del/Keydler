export class StaleStateError extends Error {
  readonly claimedVersion: number
  readonly currentVersion: number

  constructor(claimedVersion: number, currentVersion: number) {
    super(
      [
        'STALE STATE',
        `You are attempting to log work based on task state v${claimedVersion}.`,
        `Current state is v${currentVersion}. No write took place.`,
        `Call what_changed with since_version: ${claimedVersion} to see only what moved,`,
        'or resume_task for the whole state. Then retry with the version it gives you.',
      ].join('\n'),
    )
    this.name = 'StaleStateError'
    this.claimedVersion = claimedVersion
    this.currentVersion = currentVersion
  }
}

export type ValidationCode =
  | 'empty'
  | 'too-long'
  | 'too-short'
  | 'not-a-string'
  | 'bad-enum'
  | 'bad-version'
  | 'out-of-range'
  | 'not-found'
  | 'no-evidence'
  | 'already-active'
  | 'already-completed'
  | 'bad-mutation-id'
  | 'mutation-id-reused'
  | 'mutation-id-collision'
  | 'content-not-reviewed'
  | 'not-proposed'
  | 'already-answered'
  | 'already-has-evidence'

export type ValidationOptions = {
  code: ValidationCode
  retryable?: boolean
  max?: number
}

export class ValidationError extends Error {
  readonly field: string
  readonly code: ValidationCode
  readonly retryable: boolean
  readonly max: number | null

  constructor(field: string, message: string, options: ValidationOptions) {
    super(`INVALID INPUT\nField "${field}": ${message}`)
    this.name = 'ValidationError'
    this.field = field
    this.code = options.code
    this.retryable = options.retryable ?? true
    this.max = options.max ?? null
  }
}

export class ConcurrentWriteError extends Error {
  readonly expectedVersion: number
  readonly foundVersion: number

  constructor(expectedVersion: number, foundVersion: number) {
    super(
      [
        'STALE STATE',
        `You are attempting to write against task state v${expectedVersion}.`,
        `Another page has since written v${foundVersion}. No write took place.`,
        `Call what_changed with since_version: ${expectedVersion} to see what that page did,`,
        'or resume_task for the whole state.',
      ].join('\n'),
    )
    this.name = 'ConcurrentWriteError'
    this.expectedVersion = expectedVersion
    this.foundVersion = foundVersion
  }
}

export class CancelledError extends Error {
  constructor(operation: string) {
    super(
      [
        'CANCELLED',
        `The ${operation} call was cancelled before anything was written.`,
        'Nothing changed. Retry with the same mutation_id if you still want it recorded.',
      ].join('\n'),
    )
    this.name = 'CancelledError'
  }
}
