import { describe, expect, it } from 'vitest'
import {
  ConcurrentWriteError,
  StaleStateError,
  ValidationError,
  type ValidationCode,
} from '../src/domain/errors'
import { escapeHtml } from '../src/ui/escape'
import { humanMessage, humanReason } from '../src/ui/messages'

describe('messages meant for the human', () => {
  it('never orders a person to call resume_task', () => {
    const messages = [
      humanMessage(new StaleStateError(5, 6), 'Adding the rule'),
      humanMessage(new ConcurrentWriteError(5, 6), 'Adding the rule'),
      humanMessage(
        new ValidationError('reason', 'must not be empty.', { code: 'empty' }),
        'Ruling out the approach',
      ),
    ]
    for (const m of messages) {
      expect(m).not.toContain('resume_task')
      expect(m).not.toContain('STALE STATE')
      expect(m).not.toContain('INVALID INPUT')
    }
  })

  it('explains a conflict between tabs by saying what to do', () => {
    const m = humanMessage(new ConcurrentWriteError(5, 6), 'Adding the rule')
    expect(m).toContain('another tab')
    expect(m).toContain('version 6')
    expect(m).toContain('try again')
  })

  it('names the action that failed', () => {
    const m = humanMessage(
      new ValidationError('rule', 'must not be empty.', { code: 'empty' }),
      'Lifting the rule',
    )
    expect(m.startsWith('Lifting the rule')).toBe(true)
  })

  it('rewords the refusals a person can actually trigger', () => {
    const cas: Array<[ValidationError, string]> = [
      [
        new ValidationError('reason', 'must not be empty.', { code: 'empty' }),
        'the reason cannot be empty.',
      ],
      [
        new ValidationError('rule', 'must be at most 2000 characters.', {
          code: 'too-long',
          max: 2000,
        }),
        'the rule is longer than 2000 characters.',
      ],
      [
        new ValidationError('approach', 'expected a string.', { code: 'not-a-string' }),
        'the approach has to be text.',
      ],
      [
        new ValidationError('stepId', 'this step carries no evidence to verify.', {
          code: 'no-evidence',
        }),
        'that step has no evidence to review.',
      ],
      [
        new ValidationError('status', 'task "X" is already completed.', {
          code: 'already-completed',
          retryable: false,
        }),
        'this task is closed. Reopen it if there is work left.',
      ],
    ]
    for (const [error, expected] of cas) expect(humanReason(error)).toBe(expected)
  })

  it('covers every code without letting the agent text through', () => {
    const codes: ValidationCode[] = [
      'empty',
      'too-long',
      'not-a-string',
      'bad-enum',
      'bad-version',
      'not-found',
      'no-evidence',
      'already-active',
      'already-completed',
      'out-of-range',
      'bad-mutation-id',
      'mutation-id-reused',
      'mutation-id-collision',
      'content-not-reviewed',
      'not-proposed',
    ]
    for (const code of codes) {
      const m = humanReason(new ValidationError('rule', 'raw agent text', { code, max: 10 }))
      expect(m).not.toContain('raw agent text')
      expect(m.length).toBeGreaterThan(5)
    }
  })

  it('names an unknown field without crashing', () => {
    const m = humanReason(
      new ValidationError('champInedit', 'must not be empty.', { code: 'empty' }),
    )
    expect(m).toContain('“champInedit”')
  })

  it('makes a storage failure actionable', () => {
    const m = humanMessage(new Error('STORAGE UNAVAILABLE\nquota'), 'Adding')
    expect(m).toContain('Private browsing')
    expect(m).not.toContain('STORAGE UNAVAILABLE')
  })
})

describe('escaping', () => {
  it('neutralises the quotes that would break out of an attribute', () => {
    expect(escapeHtml('x" onload="alert(1)')).toBe('x&quot; onload=&quot;alert(1)')
    expect(escapeHtml("x' onload='alert(1)")).toBe('x&#39; onload=&#39;alert(1)')
  })

  it('neutralises a tag in content position', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes the ampersand first, with no double escaping', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Never change the schema')).toBe('Never change the schema')
  })
})
