import { EVIDENCE_KINDS } from '../domain/types'
import { MAX_EVIDENCE_LENGTH, MAX_FIELD_LENGTH } from '../domain/validate'
import { DEFAULT_LIMIT, MAX_LIMIT, SECTIONS } from '../domain/detail'
import { BASED_ON_VERSION_DESCRIPTION, MUTATION_ID_DESCRIPTION } from './descriptions'

function boundedText(description: string, maxLength: number = MAX_FIELD_LENGTH) {
  return { type: 'string', description, minLength: 1, maxLength } as const
}

export const versionProperty = {
  type: 'integer',
  minimum: 1,
  description: BASED_ON_VERSION_DESCRIPTION,
} as const

export const mutationIdProperty = {
  type: 'string',
  minLength: 8,
  maxLength: 64,
  pattern: '^[A-Za-z0-9_.:-]{8,64}$',
  description: MUTATION_ID_DESCRIPTION,
} as const

const evidenceSchema = {
  type: 'object',
  description:
    'Proof of the result. Omit it only when you genuinely have none — the step is then recorded as claimed, and a human will have to re-check it. ' +
    'Attaching evidence does NOT mark the step verified: a human still has to read it.',
  properties: {
    kind: {
      type: 'string',
      enum: [...EVIDENCE_KINDS],
      description: 'What sort of proof this is.',
    },
    content: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_EVIDENCE_LENGTH,
      description: 'The evidence itself, verbatim. Do not summarise it — a summary proves nothing.',
    },
  },
  required: ['kind', 'content'],
  additionalProperties: false,
} as const

export function writeSchema(
  properties: Record<string, object>,
  required: readonly string[],
): object {
  return {
    type: 'object',
    properties: {
      ...properties,
      based_on_version: versionProperty,
      mutation_id: mutationIdProperty,
    },
    required: [...required, 'based_on_version', 'mutation_id'],
    additionalProperties: false,
  }
}

export const LOG_STEP_SCHEMA = writeSchema(
  {
    action: boundedText('What was done, in one line.'),
    result: boundedText('What came of it, in one line.'),
    evidence: evidenceSchema,
    next: boundedText('The next action, in one sentence. Set it whenever it changes.', 400),
  },
  ['action', 'result'],
)

export const ADD_CONSTRAINT_SCHEMA = writeSchema(
  {
    rule: boundedText('The rule, stated so it can be checked against later work.'),
  },
  ['rule'],
)

export const REJECT_APPROACH_SCHEMA = writeSchema(
  {
    approach: boundedText('The approach you believe must not be retried.'),
    reason: boundedText('Why it failed. Mandatory, and the most useful part of the record.'),
  },
  ['approach', 'reason'],
)

export const ADD_DECISION_SCHEMA = writeSchema(
  {
    choice: boundedText('What was chosen.'),
    rationale: boundedText('Why, including what it was chosen over.'),
  },
  ['choice', 'rationale'],
)

export const COMPLETE_TASK_SCHEMA = writeSchema(
  {
    summary: boundedText('Final hand-over summary, written for someone who was not present.', 4000),
  },
  ['summary'],
)

export const RESUME_TASK_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

export const READ_DETAIL_SCHEMA = {
  type: 'object',
  properties: {
    section: {
      type: 'string',
      enum: [...SECTIONS],
      description:
        'Which part of the record to read. "proposals" holds agent-written rules and rejections that no human has approved.',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      description: 'How many entries to skip. Take it from the MORE line of the previous page.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Entries per page, at most ${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}.`,
    },
    id: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description:
        'One entry, returned in full and unpaginated — including whole evidence, which pages truncate. Take the id from a page.',
    },
  },
  required: ['section'],
  additionalProperties: false,
} as const
