export class StaleStateError extends Error {
  readonly claimedVersion: number
  readonly currentVersion: number

  constructor(claimedVersion: number, currentVersion: number) {
    super(
      [
        'STALE STATE',
        `You are attempting to log work based on task state v${claimedVersion}.`,
        `Current state is v${currentVersion}. Call resume_task before continuing.`,
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
        `Another page has since written v${foundVersion}. Call resume_task before continuing.`,
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
