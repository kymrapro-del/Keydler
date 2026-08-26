import {
  addConstraint,
  addDecision,
  createTask,
  logStep,
  rejectApproach,
  verifyEvidence,
} from '../domain/task'
import type { TaskState } from '../domain/types'

/**
 * Cahier de démonstration.
 *
 * Reproductible par construction : il est bâti par les mutations du domaine,
 * pas écrit à la main dans une base. C'est ce qui permet à un tiers — un juge,
 * ou nous-mêmes sur une machine vierge en navigation privée — de retrouver
 * exactement l'état qui sert à la démonstration et à la mesure.
 *
 * Il porte trois contraintes et deux approches rejetées. Ce n'est pas
 * décoratif : c'est ce qui rend le test mesurable. Un agent qui a réellement lu
 * ce qu'il a reçu annonce l'approche C, refuse la variante B en citant la
 * rotation des jetons, et n'ajoute aucune dépendance. Sans ces éléments, on ne
 * mesure que le fait qu'un outil a été appelé.
 *
 * Les quatre degrés de preuve y figurent, du plus fort au plus faible : c'est
 * la distinction entre travail prouvé et travail affirmé qui doit se voir à
 * l'écran, et elle ne se voit que si les quatre sont présents.
 */
export function buildDemoTask(): TaskState {
  let task = createTask({
    title: 'Refactor the authentication module',
    next: 'Map the existing entry points',
  })

  // Contraintes humaines : autoritaires, donc sans version revendiquée.
  task = addConstraint(task, { rule: 'Never modify the database schema', basedOnVersion: null }, 'human')
  task = addConstraint(task, { rule: 'Do not add any new dependency', basedOnVersion: null }, 'human')

  // Contrainte que l'agent s'est lui-même donnée, sur la version courante.
  task = addConstraint(task, { rule: 'Keep the public API unchanged', basedOnVersion: task.version }, 'agent')

  task = rejectApproach(
    task,
    {
      approach: 'JWT approach B',
      reason: 'breaks refresh token rotation under concurrent logins',
      basedOnVersion: task.version,
    },
    'agent',
  )
  task = rejectApproach(
    task,
    {
      approach: 'Partial index on sessions',
      reason: 'benchmarked 3x slower than the full index',
      basedOnVersion: task.version,
    },
    'agent',
  )

  task = addDecision(
    task,
    {
      choice: 'Approach C — session-bound refresh tokens',
      rationale: 'keeps rotation intact without touching the schema, unlike approach B',
      basedOnVersion: task.version,
    },
    'agent',
  )

  task = logStep(
    task,
    {
      action: 'Ran the authentication test suite',
      result: '183 passed, 0 failed',
      evidence: { kind: 'test_report', content: 'auth suite — 183 passed, 0 failed, 0 skipped' },
      basedOnVersion: task.version,
    },
    'agent',
  )

  // Une preuve validée d'un clic humain : c'est le seul chemin vers
  // « human_verified », et il faut qu'il soit représenté.
  task = verifyEvidence(task, task.steps[task.steps.length - 1].id)

  task = logStep(
    task,
    {
      action: 'Benchmarked the session-bound refresh prototype',
      result: 'p95 latency unchanged, no schema change required',
      evidence: {
        kind: 'command_output',
        content: 'bench --auth-refresh\np50 12ms  p95 41ms  (baseline p95 43ms)',
      },
      next: 'Implement approach C — session-bound refresh tokens',
      basedOnVersion: task.version,
    },
    'agent',
  )

  // Une preuve qui atteste d'un changement sans le vérifier : degré « evidence ».
  task = logStep(
    task,
    {
      action: 'Extracted the token issuer behind an interface',
      result: 'public API unchanged, 2 files touched',
      evidence: {
        kind: 'diff',
        content:
          '--- a/auth/issuer.ts\n+++ b/auth/issuer.ts\n@@\n-function issue(userId) {\n+function issue(userId, session) {',
      },
      basedOnVersion: task.version,
    },
    'agent',
  )

  // Rien à joindre : l'étape reste « claimed », et doit le rester visiblement.
  task = logStep(
    task,
    {
      action: 'Reduced token TTL to 15 minutes',
      result: 'applied in the prototype, not yet measured',
      basedOnVersion: task.version,
    },
    'agent',
  )

  return task
}
