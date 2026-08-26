import {
  addConstraint,
  addDecision,
  createTask,
  logStep,
  rejectApproach,
  setConstraintStanding,
  setRejectionStanding,
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
 * Il porte trois contraintes en vigueur et deux approches condamnées. Ce n'est
 * pas décoratif : c'est ce qui rend le test mesurable. Un agent qui a réellement
 * lu ce qu'il a reçu annonce l'approche C, refuse la variante B en citant la
 * rotation des jetons, et n'ajoute aucune dépendance. Sans ces éléments, on ne
 * mesure que le fait qu'un outil a été appelé.
 *
 * Il porte AUSSI une proposition d'agent laissée en attente, et c'est le
 * deuxième enseignement de la démonstration : ce qu'un agent écrit n'oppose
 * rien tant qu'un humain ne l'a pas endossé. Sans elle, la page ne montrerait
 * que le cas où l'agent a raison — et c'est le cas où il a tort qui décide de
 * la valeur du cahier.
 *
 * Les trois degrés de preuve y figurent, du plus fort au plus faible : c'est
 * la distinction entre travail prouvé et travail affirmé qui doit se voir à
 * l'écran, et elle ne se voit que si les trois sont présents.
 */
export function buildDemoTask(): TaskState {
  let task = createTask({
    title: 'Refactor the authentication module',
    next: 'Map the existing entry points',
  })

  // Contraintes humaines : autoritaires, donc sans version revendiquée.
  task = addConstraint(
    task,
    { rule: 'Never modify the database schema', basedOnVersion: null },
    'human',
  )
  task = addConstraint(
    task,
    { rule: 'Do not add any new dependency', basedOnVersion: null },
    'human',
  )

  // Contrainte que l'agent a proposée, puis que l'humain a endossée d'un clic.
  // Elle devient opposable, et garde la marque de qui l'a écrite.
  task = addConstraint(
    task,
    { rule: 'Keep the public API unchanged', basedOnVersion: task.version },
    'agent',
  )
  task = setConstraintStanding(task, task.constraints[task.constraints.length - 1].id, 'accepted')

  // Veto humain : autoritaire d'emblée. C'est celui que la mesure interroge.
  task = rejectApproach(
    task,
    {
      approach: 'JWT approach B',
      reason: 'breaks refresh token rotation under concurrent logins',
      basedOnVersion: null,
    },
    'human',
  )

  // Condamnation proposée par un agent, puis endossée : la voie complète.
  task = rejectApproach(
    task,
    {
      approach: 'Partial index on sessions',
      reason: 'benchmarked 3x slower than the full index',
      basedOnVersion: task.version,
    },
    'agent',
  )
  task = setRejectionStanding(task, task.rejected[task.rejected.length - 1].id, 'accepted')

  // Et celle qui reste en attente. Elle condamne la bonne réponse pour un motif
  // que l'agent a cru vrai : c'est exactement le cas où une écriture d'agent
  // tenue pour autoritaire empoisonnerait toutes les conversations suivantes.
  // Personne n'a tranché, donc elle n'interdit rien — elle se lit, à part.
  task = rejectApproach(
    task,
    {
      approach: 'Rotating refresh tokens on every request',
      reason: 'assumed to conflict with the mobile client, not measured',
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
  // « human_verified », et il faut qu'il soit représenté. Le contenu relu est
  // repris de l'étape elle-même : c'est ce qu'un écran affiche avant le clic.
  const relue = task.steps[task.steps.length - 1]
  task = verifyEvidence(task, relue.id, relue.evidence!.content)

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
  //
  // Ce diff doit rester cohérent avec ce que l'étape affirme ET avec les
  // contraintes actives. La première version ne l'était pas : elle annonçait
  // « public API unchanged » en montrant un changement de signature, sous une
  // contrainte qui interdit précisément cela. Un agent l'a relevé en ouvrant la
  // preuve. Un décor qui contredit sa propre règle discrédite la démonstration
  // entière, et c'est exactement ce qu'un juge attentif cherche.
  task = logStep(
    task,
    {
      action: 'Extracted the token issuer behind an interface',
      result: 'public API unchanged, 2 files touched',
      evidence: {
        kind: 'diff',
        content: [
          '--- a/auth/issuer.ts',
          '+++ b/auth/issuer.ts',
          '@@',
          ' export function issue(userId) {',
          '-  return sign({ sub: userId })',
          '+  return getIssuer().issue(userId)',
          ' }',
          '--- a/auth/issuerFactory.ts',
          '+++ b/auth/issuerFactory.ts',
          '@@',
          '+export function getIssuer() {',
          '+  return { issue: (userId) => sign({ sub: userId }) }',
          '+}',
        ].join('\n'),
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
