import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decideApproval, pendingApprovals } from '../src/domain/task'
import {
  APPROVAL_TIMEOUT,
  requestApprovalTool,
  __setApprovalTimeout,
  WRITE_TOOLS,
} from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { call, clearDatabase, currentTask, textOf, waitUntil, writeArgs } from './helpers'

async function decide(what: 'allowed' | 'denied') {
  await waitUntil(() => pendingApprovals(currentTask()).length > 0, 'la demande à être écrite')
  const id = pendingApprovals(currentTask())[0].id
  await store.mutate((s) => decideApproval(s, id, what))
}

beforeEach(async () => {
  __setApprovalTimeout(APPROVAL_TIMEOUT)
  store.__resetStore()
  await clearDatabase()
  await store.init()
  await store.createAndOpenTask('Ship the issuer', 'Read the spec')
})

afterEach(() => {
  __setApprovalTimeout(APPROVAL_TIMEOUT)
  store.__resetStore()
})

describe('request_approval', () => {
  it('est une écriture, et déclarée comme telle', () => {
    expect(WRITE_TOOLS).toContain(requestApprovalTool)
    expect(requestApprovalTool.annotations?.readOnlyHint).toBe(false)
  })

  it('attend la décision, puis rend l’autorisation', async () => {
    const pending = call(
      requestApprovalTool,
      writeArgs(currentTask(), {
        action: 'Run the migration against the staging replica',
        why: 'It rewrites 40k rows and I cannot undo it from here.',
      }),
    )

    await decide('allowed')
    const result = await pending

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('ALLOWED')
    expect(textOf(result)).toContain('Run the migration')
  })

  it('rend un refus comme une erreur, pour que l’agent ne passe pas outre', async () => {
    const pending = call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Drop the index', why: 'It is not reversible.' }),
    )

    await decide('denied')
    const result = await pending

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('DENIED')
    expect(textOf(result)).toContain('Do not do it')
  })

  it('abandonne au bout du délai, sans jamais appeler cela une autorisation', async () => {
    __setApprovalTimeout(40)
    const result = await call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Deploy to production', why: 'Nobody is watching.' }),
    )

    expect(result.isError).toBe(true)
    const texte = textOf(result)
    expect(texte).toContain('NO ANSWER')
    expect(texte).not.toContain('ALLOWED')
    // Le silence n'est pas un accord : c'est la phrase qui compte le plus ici.
    expect(texte.toLowerCase()).toContain('is not approval')
    // La demande reste ouverte : l'humain la trouvera en revenant.
    expect(pendingApprovals(currentTask())).toHaveLength(1)
  })

  it('écrit la demande même si personne ne répond, pour qu’elle survive', async () => {
    __setApprovalTimeout(40)
    const before = currentTask().version
    await call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Deploy', why: 'It is risky.' }),
    )
    expect(currentTask().version).toBe(before + 1)
  })

  it('renonce dès que l’exécution est annulée, sans attendre le délai', async () => {
    __setApprovalTimeout(60_000)
    const controller = new AbortController()
    const pending = call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Deploy', why: 'It is risky.' }),
      controller.signal,
    )

    await waitUntil(() => pendingApprovals(currentTask()).length > 0, 'la demande')
    controller.abort()

    const result = await pending
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/cancel/i)
  })

  it('rejoue une reprise sans redemander, et rend la décision déjà prise', async () => {
    const args = writeArgs(currentTask(), {
      action: 'Run the migration',
      why: 'It rewrites 40k rows.',
    })

    const first = call(requestApprovalTool, args)
    await decide('allowed')
    await first

    const replay = await call(requestApprovalTool, args)
    expect(textOf(replay)).toContain('ALLOWED')
    expect(currentTask().approvals).toHaveLength(1)
  })

  it('ne rend JAMAIS la décision d’une demande antérieure au même libellé', async () => {
    const même = {
      action: 'Run the migration against the staging replica',
      why: 'It rewrites 40k rows.',
    }

    // Première demande : autorisée.
    const first = call(requestApprovalTool, writeArgs(currentTask(), même))
    await decide('allowed')
    expect(textOf(await first)).toContain('ALLOWED')

    // Seconde demande, identique mot pour mot, mais NOUVELLE. Rendre le « allowed »
    // d'hier autoriserait une action que personne n'a validée. C'est la pire
    // défaillance possible pour cet outil.
    __setApprovalTimeout(60)
    const second = await call(requestApprovalTool, writeArgs(currentTask(), même))

    expect(textOf(second)).toContain('NO ANSWER')
    expect(textOf(second)).not.toContain('ALLOWED by the human')
    expect(currentTask().approvals).toHaveLength(2)
    expect(pendingApprovals(currentTask())).toHaveLength(1)
  })

  it('refuse une demande sans motif', async () => {
    const result = await call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Do the thing' }),
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('why')
  })
})
