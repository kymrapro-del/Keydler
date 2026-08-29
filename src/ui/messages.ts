import { ConcurrentWriteError, StaleStateError, ValidationError } from '../domain/errors'

const FIELDS: Record<string, string> = {
  rule: 'the rule',
  approach: 'the approach',
  reason: 'the reason',
  title: 'the task title',
  summary: 'the summary',
  stepId: 'that step',
  constraintId: 'that rule',
  rejectionId: 'that rejected approach',
  reviewedContent: 'the evidence shown',
  mutation_id: 'the write id',
  status: 'this task',
  question: 'the question',
  why: 'the reason it blocks you',
  answer: 'your answer',
  questionId: 'that question',
  step_id: 'that step',
  next: 'the next action',
  name: 'the credential name',
  purpose: 'what the credential is for',
  kind: 'the kind',
  value: 'the value',
  passphrase: 'the passphrase',
  query: 'the search term',
  limit: 'the number of results',
}

export function humanReason(error: ValidationError): string {
  const field = FIELDS[error.field] ?? `the “${error.field}” field`

  switch (error.code) {
    case 'empty':
      return `${field} cannot be empty.`
    case 'too-long':
      return `${field} is longer than ${error.max ?? 0} characters.`
    case 'too-short':
      return `${field} is too short.`
    case 'not-a-string':
      return `${field} has to be text.`
    case 'bad-version':
      return `${field} has to be a version number.`
    case 'out-of-range':
      return `${field} is outside the accepted range.`
    case 'bad-enum':
      return `${field} is not one of the accepted values.`
    case 'not-found':
      return `${field} could not be found · the page may have changed since.`
    case 'no-evidence':
      return 'that step has no evidence to review.'
    case 'already-active':
      return 'this task is already open.'
    case 'already-completed':
      return 'this task is closed. Reopen it if there is work left.'
    case 'bad-mutation-id':
      return `${field} is not a valid write id.`
    case 'mutation-id-reused':
      return `${field} has already been used for another write.`
    case 'mutation-id-collision':
      return `${field} has already been used, with different details.`
    case 'content-not-reviewed':
      return 'the evidence on screen no longer matches the one on file · read it again before approving.'
    case 'not-proposed':
      return 'that proposal has already been decided.'
    case 'already-has-evidence':
      return 'that step already carries evidence. Record a new step rather than replacing it.'
    case 'already-recorded':
      return 'that is already on the task, word for word.'
    case 'already-answered':
      return 'that question already has an answer. Reword the question instead of replacing it.'
  }
}

export function humanMessage(error: unknown, action: string): string {
  if (error instanceof ConcurrentWriteError) {
    return (
      `${action}: another tab changed this task in the meantime. ` +
      `It has just been reloaded at version ${error.foundVersion} · try again.`
    )
  }
  if (error instanceof StaleStateError) {
    return `${action}: the task changed since it was shown. Try again.`
  }
  if (error instanceof ValidationError) {
    return `${action} failed: ${humanReason(error)}`
  }
  if (error instanceof Error && error.message.startsWith('NO ACTIVE TASK')) {
    return `${action} failed: no task is open on this device.`
  }
  if (error instanceof Error && error.message.startsWith('STORAGE UNAVAILABLE')) {
    return (
      `${action} failed: the browser is refusing access to storage. ` +
      'Private browsing and blocked site data are the usual causes.'
    )
  }
  return `${action} failed: ${error instanceof Error ? error.message : String(error)}`
}
