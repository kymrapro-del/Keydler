// L'enregistrement WebMCP est un effet de bord d'import, volontairement placé
// avant tout rendu. Il ne dépend d'aucun composant et ne doit jamais en
// dépendre : le mode strict de React, quand il arrivera, monte deux fois.
import './webmcp'

import './tokens.css'
import './style.css'
import { buildMeasureTask } from './demo/measures'
import { buildFullExport, buildTaskExport, exportFilename } from './export/notebook'
import { ConcurrentWriteError, StaleStateError, ValidationError } from './domain/errors'
import { buildDemoTask } from './demo/seed'
import { renderTaskState } from './domain/render'
import {
  addConstraint,
  rejectApproach,
  reopenTask,
  setConstraintActive,
  verifyEvidence,
} from './domain/task'
import * as store from './store/taskStore'
import { getCalls, getRegistrationState, onCall, onRegistrationChange, resetCalls } from './webmcp'

/**
 * Banc d'essai.
 *
 * Ce n'est pas le produit — le tableau de bord viendra au J4, et son apparence
 * relève d'une autre voie. Cette page sert à voir en direct ce qu'un agent fait
 * au cahier : la version qui avance, les écritures refusées, et le texte exact
 * que `resume_task` restitue.
 */

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

/**
 * Échappement sûr en contenu ET en position d'attribut.
 *
 * Les guillemets comptent : un identifiant interpolé dans `data-verify="…"`
 * qui en contiendrait un sortirait de l'attribut. Les identifiants viennent
 * normalement de `crypto.randomUUID`, mais ils sont relus depuis IndexedDB, et
 * une couche d'affichage ne doit jamais faire confiance à ce qu'elle relit.
 */
const escapeHtml = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

function renderStatus(): string {
  const { phase, availability, toolNames, error } = getRegistrationState()

  if (phase === 'registered') {
    const surface = availability.supported ? availability.surface : 'inconnue'
    return `<div class="status status--ok">
      <p class="status__title">WebMCP actif — ${toolNames.length} outils exposés</p>
      <p class="mono">${toolNames.join(' · ')}</p>
      <p class="muted">API lue sur <code>${surface}.modelContext</code>.</p>
    </div>`
  }

  if (phase === 'failed') {
    return `<div class="status status--error">
      <p class="status__title">L'enregistrement a échoué</p>
      <p>${escapeHtml(error ?? 'raison inconnue')}</p>
    </div>`
  }

  if (phase === 'pending') return `<div class="status"><p>Enregistrement en cours…</p></div>`

  const insecure = !availability.supported && availability.reason === 'insecure-context'
  if (insecure) {
    return `<div class="status status--warn">
      <p class="status__title">WebMCP exige un contexte sécurisé</p>
      <p>Cette page doit être servie en HTTPS ou depuis <code>localhost</code>.</p>
    </div>`
  }

  return `<div class="status status--warn">
    <p class="status__title">WebMCP n'est pas disponible dans ce navigateur</p>
    <p>
      1. ouvrir <code>chrome://flags/#enable-webmcp-testing</code><br />
      2. passer le drapeau à <strong>Enabled</strong><br />
      3. relancer le navigateur, puis recharger cette page
    </p>
    <p class="muted">
      Lu sur <code>document.modelContext</code>, repli <code>navigator.modelContext</code>
      — déprécié depuis Chrome 150.
    </p>
  </div>`
}

function renderWitness(): string {
  const calls = getCalls()
  const refused = calls.filter((c) => c.refused).length
  const rows = [...calls]
    .reverse()
    .slice(0, 10)
    .map(
      (c) =>
        `<li class="${c.refused ? 'call call--refused' : 'call'}">
           <code>${c.tool}</code>
           <span>${c.refused ? 'REFUSÉ' : 'appliqué'}</span>
           <span class="muted">${new Date(c.at).toLocaleTimeString('fr-FR')}</span>
         </li>`,
    )
    .join('')

  return `<div class="witness" role="status" aria-live="polite">
      <span class="witness__count">${calls.length}</span>
      <span class="witness__label">
        appel${calls.length > 1 ? 's' : ''} d'outil<br />
        <span class="muted">dont ${refused} refusé${refused > 1 ? 's' : ''}</span>
      </span>
      <button type="button" id="reset-witness" class="btn">Vider ce journal d'appels</button>
    </div>
    ${rows ? `<ul class="calls">${rows}</ul>` : ''}`
}

function renderTask(): string {
  const { status, task, error } = store.getSnapshot()

  if (status === 'loading') return `<p class="muted">Chargement du cahier…</p>`
  if (status === 'error') {
    return `<div class="status status--error"><p>${escapeHtml(error ?? '')}</p></div>`
  }
  if (!task) {
    // État vide, et première impression pour qui arrive sans rien savoir.
    // On dit ce que la chose sert à faire et ce qu'il y a à faire — jamais
    // comment le versionnage fonctionne : un essai a montré qu'un agent lisant
    // une page qui décrit son mécanisme se met à éprouver le mécanisme.
    return `<div class="status status--info">
      <p class="status__title">Aucun cahier ouvert sur cet appareil</p>
      <p>
        Un cahier de quart retient ce qu'une conversation perd : les contraintes
        en vigueur, le travail déjà prouvé, et les approches écartées avec leur
        motif. Un agent le relit au début de chaque conversation ; vous le
        corrigez pendant qu'il travaille.
      </p>
      <p>
        Rien ne quitte cet appareil : ni compte, ni serveur.
      </p>
      <p><button type="button" id="seed" class="btn">Ouvrir un cahier de démonstration</button></p>
    </div>`
  }

  const clôturée =
    task.status === 'completed'
      ? `<div class="status status--warn">
           <p class="status__title">Tâche close</p>
           <p>Les écritures d'agent sont refusées. L'humain reste maître : il peut rouvrir.</p>
           <p><button type="button" id="reopen" class="btn">Rouvrir la tâche</button></p>
         </div>`
      : ''

  return `${clôturée}
    <section>
      <h2>Version en direct</h2>
      <p class="exports">
        <button type="button" id="export-un" class="btn">Exporter ce cahier</button>
        <button type="button" id="export-tous" class="btn">Exporter tous les cahiers</button>
      </p>
      <p class="version" aria-live="polite" aria-atomic="true">v${task.version} <span class="muted">— ${task.steps.length} étapes,
        ${task.constraints.filter((c) => c.active).length} contraintes actives,
        ${task.rejected.length} rejets</span></p>
    </section>
    <section>
      <h2>Ce que <code>resume_task</code> restitue</h2>
      <pre>${escapeHtml(renderTaskState(task))}</pre>
    </section>`
}

/**
 * La page présente LA TÂCHE, pas le mécanisme qui la porte.
 *
 * Un essai du J3 l'a montré crûment : quand l'en-tête expliquait le versionnage
 * et le refus d'état périmé, l'agent a conclu que sa mission était d'éprouver
 * ce mécanisme, et il a passé son tour à tester le garde-fou au lieu de
 * reprendre le travail. Le texte visible de la page entre en concurrence avec
 * la description des outils pour l'attention de l'agent — et il gagne.
 *
 * L'explication du mécanisme est donc reléguée en pied de page, où elle
 * renseigne un humain de passage sans détourner un agent.
 */
function titre(): string {
  const task = store.getSnapshot().task
  return task ? task.title : 'Cahier de quart'
}

function sousTitre(): string {
  const task = store.getSnapshot().task
  if (!task) return 'Aucune tâche ouverte sur cet appareil.'
  if (task.status === 'completed') return `Tâche close en v${task.version}.`
  return task.next ? `Prochaine action : ${task.next}` : 'Prochaine action non définie.'
}

/**
 * Saisies en cours, conservées hors du rendu.
 *
 * La page se redessine à chaque écriture d'agent, et c'est précisément ce qui
 * doit arriver pendant qu'un humain tape : sans ce report, l'agent effacerait
 * la contrainte qu'on est en train de rédiger contre lui.
 */
const brouillons: Record<string, string> = {
  'new-constraint': '',
  'new-rejection': '',
  'new-rejection-reason': '',
}

/**
 * Dernier échec d'une action humaine.
 *
 * Une action humaine peut échouer — un motif de rejet vide, par exemple, est
 * refusé par le domaine. Sans cet affichage, le clic ne produirait rien de
 * visible et l'humain croirait l'interface cassée.
 */
let erreurHumaine: string | null = null

/**
 * Traduit une erreur du domaine pour la personne qui a cliqué.
 *
 * Les messages du domaine sont écrits pour un agent : ils sont en anglais et se
 * terminent par « Call resume_task before continuing ». Quelqu'un qui vient
 * d'appuyer sur un bouton n'appellera jamais resume_task. Lui montrer ce texte
 * brut, c'est la même faute que laisser NO ACTIVE TASK traîner à l'écran.
 */
function messageHumain(error: unknown, action: string): string {
  if (error instanceof ConcurrentWriteError) {
    return (
      `${action} : un autre onglet a modifié ce cahier entre-temps. ` +
      `Il vient d'être rechargé à la version ${error.foundVersion} — refaites votre geste.`
    )
  }
  if (error instanceof StaleStateError) {
    return `${action} : le cahier a changé depuis l'affichage. Refaites votre geste.`
  }
  if (error instanceof ValidationError) {
    return `${action} impossible : ${motifFrancais(error)}`
  }
  if (error instanceof Error && error.message.startsWith('NO ACTIVE TASK')) {
    return `${action} impossible : aucun cahier n'est ouvert sur cet appareil.`
  }
  if (error instanceof Error && error.message.startsWith('STORAGE UNAVAILABLE')) {
    return (
      `${action} impossible : le navigateur refuse l'accès au stockage. ` +
      "La navigation privée et le blocage des données de site en sont les causes habituelles."
    )
  }
  return `${action} impossible : ${error instanceof Error ? error.message : String(error)}`
}

/** Noms français des champs que l'interface expose réellement. */
const CHAMPS: Record<string, string> = {
  rule: 'la règle',
  approach: "l'approche",
  reason: 'le motif',
  next: 'la prochaine action',
  title: 'le titre',
  summary: 'le résumé',
  stepId: "l'étape",
  constraintId: 'la contrainte',
  status: 'la tâche',
}

/**
 * Traduit le motif d'un refus de validation.
 *
 * Les cas qu'une personne peut déclencher depuis l'interface sont en nombre
 * fini : on les traduit, et on retombe sur le texte d'origine pour le reste
 * plutôt que d'inventer une phrase approximative.
 */
function motifFrancais(error: ValidationError): string {
  const brut = error.message.split('\n').slice(1).join(' ').replace(/^Field "[^"]*": /, '')
  const champ = CHAMPS[error.field] ?? `le champ « ${error.field} »`

  if (brut.startsWith('must not be empty')) return `${champ} ne peut pas être vide.`

  const tropLong = brut.match(/^must be at most (\d+) characters/)
  if (tropLong) return `${champ} dépasse ${tropLong[1]} caractères.`

  if (brut.startsWith('expected a string')) return `${champ} doit être du texte.`
  if (brut.includes('carries no evidence')) return "cette étape ne porte aucune preuve à valider."
  if (brut.includes('is already active')) return "cette tâche n'est pas close."
  if (brut.includes('already completed')) {
    return 'cette tâche est close. Rouvrez-la si du travail reste à faire.'
  }
  return brut
}

/** Exécute une action humaine en rendant son échec lisible par un humain. */
function actionHumaine(action: string, muter: Parameters<typeof store.mutate>[0]): void {
  erreurHumaine = null
  void store.mutate(muter).catch((error: unknown) => {
    erreurHumaine = messageHumain(error, action)
    scheduleRender()
  })
}

function renderSupervision(): string {
  const task = store.getSnapshot().task
  if (!task) return ''

  const contraintes = task.constraints
    .map(
      (c) => `<li class="regle${c.active ? '' : ' regle--levee'}">
        <span class="chip chip--${c.source}">${c.source}</span>
        <span class="regle__texte">${escapeHtml(c.rule)}</span>
        <span class="muted">v${c.addedAtVersion}</span>
        <button type="button" class="btn" data-toggle="${escapeHtml(c.id)}" data-active="${c.active}"
                aria-label="${c.active ? 'Lever' : 'Rétablir'} la contrainte : ${escapeHtml(c.rule)}">
          ${c.active ? 'Lever' : 'Rétablir'}
        </button>
      </li>`,
    )
    .join('')

  // Une preuve ne devient « vérifiée humain » que par un clic. C'est le seul
  // chemin vers ce degré, et il n'existait jusqu'ici que dans le domaine.
  const àValider = task.steps
    .filter((s) => s.evidence !== null && s.confidence !== 'human_verified')
    .map(
      (s) => `<li class="regle">
        <span class="chip chip--${s.confidence}">${s.confidence}</span>
        <span class="regle__texte">${escapeHtml(s.action)}</span>
        <button type="button" class="btn" data-verify="${escapeHtml(s.id)}"
                aria-label="Valider la preuve de : ${escapeHtml(s.action)}">Valider la preuve</button>
      </li>`,
    )
    .join('')

  const rejets = task.rejected
    .map(
      (r) => `<li class="regle">
        <span class="chip chip--${r.source}">${r.source}</span>
        <span class="regle__texte">
          ${escapeHtml(r.approach)}
          <span class="muted"> — ${escapeHtml(r.reason)}</span>
        </span>
      </li>`,
    )
    .join('')

  const saisieContrainte =
    task.status === 'active'
      ? `<form id="form-contrainte" class="saisie">
           <label for="new-constraint">Ajouter une contrainte</label>
           <input id="new-constraint" type="text" autocomplete="off"
                  placeholder="Ne jamais modifier le schéma de base" />
           <button type="submit" class="btn">Ajouter</button>
         </form>
         <p class="muted">
           Une contrainte posée ici est humaine : elle n'est jamais refusée, et
           elle périme la version sur laquelle l'agent travaille.
         </p>`
      : ''

  const saisieRejet =
    task.status === 'active'
      ? `<form id="form-rejet" class="saisie">
           <label for="new-rejection">Approche à condamner</label>
           <input id="new-rejection" type="text" autocomplete="off"
                  placeholder="Approche à écarter" />
           <label for="new-rejection-reason">Motif du rejet, obligatoire</label>
           <input id="new-rejection-reason" type="text" autocomplete="off"
                  required aria-required="true"
                  placeholder="Pourquoi elle a échoué" />
           <button type="submit" class="btn">Rejeter</button>
         </form>
         <p class="muted">
           Le motif est exigé : un rejet sans motif n'apprend rien à qui le lira
           ensuite, et serait retenté faute de savoir pourquoi il a échoué.
         </p>`
      : ''

  const erreur = erreurHumaine
    ? `<div class="status status--error" role="alert"><p>${escapeHtml(erreurHumaine)}</p></div>`
    : ''

  // Une étape sans aucune preuve est celle qui mérite le plus l'attention
  // humaine, et c'était précisément celle qui n'apparaissait nulle part : la
  // file ne montrait que les étapes déjà étayées. On ne peut pas « valider »
  // ce qui n'a rien à valider — on peut, et on doit, le signaler.
  const sansPreuve = task.steps
    .filter((s) => s.evidence === null)
    .map(
      (s) => `<li class="regle">
        <span class="chip chip--claimed">affirmé</span>
        <span class="regle__texte">${escapeHtml(s.action)}</span>
        <span class="muted">aucune preuve jointe</span>
      </li>`,
    )
    .join('')

  return `<section class="supervision" aria-labelledby="titre-supervision">
      ${erreur}
      <h2 id="titre-supervision" tabindex="-1"><span id="supervision-ancre"></span>Contraintes</h2>
      <ul class="regles">${contraintes || '<li class="muted">Aucune.</li>'}</ul>
      ${saisieContrainte}
      <h2>Approches condamnées</h2>
      <ul class="regles">${rejets || '<li class="muted">Aucune.</li>'}</ul>
      ${saisieRejet}
      ${àValider ? `<h2>Preuves à valider</h2><ul class="regles">${àValider}</ul>` : ''}
      ${sansPreuve ? `<h2>Affirmé sans preuve</h2><ul class="regles">${sansPreuve}</ul>` : ''}
    </section>`
}

/** Rebranche les commandes de supervision après chaque rendu. */
function brancherSupervision(): void {
  for (const id of Object.keys(brouillons)) {
    const champ = document.querySelector<HTMLInputElement>(`#${id}`)
    if (!champ) continue
    champ.value = brouillons[id]
    champ.addEventListener('input', () => {
      brouillons[id] = champ.value
      // Corriger sa saisie efface le reproche : sinon l'erreur resterait
      // affichée pendant qu'on répare ce qu'elle signale.
      if (erreurHumaine !== null) {
        erreurHumaine = null
        scheduleRender()
      }
    })
  }

  document.querySelector<HTMLFormElement>('#form-contrainte')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const règle = brouillons['new-constraint'].trim()
    if (!règle) return
    brouillons['new-constraint'] = ''
    actionHumaine('Ajout de la contrainte', (state) =>
      addConstraint(state, { rule: règle, basedOnVersion: null }, 'human'),
    )
  })

  document.querySelector<HTMLFormElement>('#form-rejet')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const approche = brouillons['new-rejection'].trim()
    const motif = brouillons['new-rejection-reason'].trim()
    // On laisse le domaine refuser un motif vide plutôt que de l'intercepter
    // ici : une seule règle, un seul endroit où elle est écrite.
    actionHumaine('Condamnation de l’approche', (state) =>
      rejectApproach(state, { approach: approche, reason: motif, basedOnVersion: null }, 'human'),
    )
    if (approche && motif) {
      brouillons['new-rejection'] = ''
      brouillons['new-rejection-reason'] = ''
    }
  })

  for (const bouton of document.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
    bouton.addEventListener('click', () => {
      const id = bouton.dataset.toggle!
      const actif = bouton.dataset.active === 'true'
      actionHumaine(
        actif ? 'Levée de la contrainte' : 'Rétablissement de la contrainte',
        (state) => setConstraintActive(state, id, !actif),
      )
    })
  }

  for (const bouton of document.querySelectorAll<HTMLButtonElement>('[data-verify]')) {
    bouton.addEventListener('click', () => {
      actionHumaine('Validation de la preuve', (state) =>
        verifyEvidence(state, bouton.dataset.verify!),
      )
    })
  }
}

/** Remet un fichier à la personne. Rien ne quitte l'appareil. */
function telecharger(nom: string, contenu: string): void {
  const blob = new Blob([contenu], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  document.body.append(lien)
  lien.click()
  lien.remove()
  URL.revokeObjectURL(url)
}

function render(): void {
  // Le champ de saisie est remplacé par le rendu : on note s'il avait le focus
  // et où était le curseur, pour que l'agent ne coupe pas la parole à l'humain.
  const actif = document.activeElement
  const champFocalisé =
    actif instanceof HTMLInputElement && actif.id in brouillons ? actif.id : null
  const curseur = champFocalisé ? (actif as HTMLInputElement).selectionStart : null

  root!.innerHTML = `<a class="skip-link" href="#supervision-ancre">Aller aux commandes de supervision</a>
    <main id="contenu">
      <header>
        <h1>${escapeHtml(titre())}</h1>
        <p class="muted">${escapeHtml(sousTitre())}</p>
      </header>
      ${renderTask()}
      ${renderSupervision()}
      ${renderStatus()}
      ${renderWitness()}
      <footer class="muted">
        <p>
          Cahier de quart — mémoire de tâche persistante et supervisée, exposée
          aux agents par WebMCP.
        </p>
      </footer>
    </main>`

  document.querySelector('#reset-witness')?.addEventListener('click', () => resetCalls())
  brancherSupervision()

  if (champFocalisé) {
    const champ = document.querySelector<HTMLInputElement>(`#${champFocalisé}`)
    champ?.focus()
    if (curseur !== null) champ?.setSelectionRange(curseur, curseur)
  }

  document.querySelector('#export-un')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) telecharger(exportFilename(task), buildTaskExport(task))
  })

  document.querySelector('#export-tous')?.addEventListener('click', () => {
    void store.allTasks().then((tasks) => telecharger('cahiers.md', buildFullExport(tasks)))
  })

  document.querySelector('#reopen')?.addEventListener('click', () => {
    const motif = window.prompt('Pourquoi rouvrir cette tâche ?')
    if (!motif?.trim()) return
    actionHumaine('Réouverture de la tâche', (state) => reopenTask(state, motif))
  })
  document.querySelector('#seed')?.addEventListener('click', () => {
    // `?mesure=N` charge la tâche de mesure N au lieu du cahier de
    // démonstration, pour que le protocole du J6 soit rejouable tel quel.
    const n = Number(new URLSearchParams(location.search).get('mesure'))
    void store.openPreparedTask(n ? buildMeasureTask(n) : buildDemoTask())
  })
}

/**
 * Rendu groupé.
 *
 * Une écriture d'agent notifiait deux fois — une par le magasin, une par le
 * témoin d'appels — et la page se redessinait deux fois de suite. Sans
 * conséquence sur l'état, mais visible à l'œil pendant une rafale d'écritures,
 * et deux fois plus d'occasions de perdre le curseur de la personne qui tape.
 */
let renduPrevu = false

function scheduleRender(): void {
  if (renduPrevu) return
  renduPrevu = true
  queueMicrotask(() => {
    renduPrevu = false
    render()
  })
}

render()
onRegistrationChange(scheduleRender)
onCall(scheduleRender)
store.subscribe(scheduleRender)

/**
 * `?mesure=N` charge la tâche de mesure N au chargement de la page.
 *
 * Le protocole du J6 doit être rejouable par une simple URL : un juge ouvre
 * l'adresse et retrouve exactement l'état sur lequel la mesure a été faite,
 * sans manipulation. La tâche n'est reconstruite que si le cahier ouvert n'est
 * pas déjà celle-là, pour qu'un rechargement en cours d'essai ne remette pas
 * le compteur à zéro.
 */
void (async () => {
  await store.init()

  const n = Number(new URLSearchParams(location.search).get('mesure'))
  if (!n) return

  const voulue = buildMeasureTask(n)
  if (store.currentTask()?.title === voulue.title) return
  await store.openPreparedTask(voulue)
})()
