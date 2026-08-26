import { buildMeasureTask } from '../demo/measures'
import { buildFullExport, buildTaskExport, exportFilename } from '../export/notebook'
import { escapeHtml } from './escape'
import { messageHumain } from './messages'
import { buildDemoTask } from '../demo/seed'
import { renderTaskState } from '../domain/render'
import {
  addConstraint,
  rejectApproach,
  reopenTask,
  setConstraintActive,
  verifyEvidence,
} from '../domain/task'
import * as store from '../store/taskStore'
import {
  getRegistrationState,
  getWitness,
  onCall,
  onRegistrationChange,
  resetCalls,
} from '../webmcp'

/**
 * La vue du banc d'essai.
 *
 * Extraite de `main.ts` parce que huit des quinze constats de la revue vivaient
 * dans ce fichier — le seul du projet qu'aucun test n'atteignait, ce qui est
 * précisément pourquoi ils avaient tous passé la CI.
 *
 * `mount` prend sa racine en paramètre et rend de quoi se démonter : c'est ce
 * qui permet de l'instancier dans un DOM de test, plusieurs fois, sans état
 * résiduel entre deux cas.
 */

let root: HTMLElement | null = null

/**
 * Banc d'essai.
 *
 * Ce n'est pas le produit — le tableau de bord viendra au J4, et son apparence
 * relève d'une autre voie. Cette page sert à voir en direct ce qu'un agent fait
 * au cahier : la version qui avance, les écritures refusées, et le texte exact
 * que `resume_task` restitue.
 */

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
  const { total, refused, recents } = getWitness()
  const rows = [...recents]
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

  return `<div class="witness">
      <span class="witness__count">${total}</span>
      <span class="witness__label">
        appel${total > 1 ? 's' : ''} d'outil<br />
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
    // Traduite comme toute autre erreur montrée à une personne : c'est le seul
    // chemin par lequel une panne de stockage atteint réellement l'écran.
    const texte = messageHumain(new Error(error ?? ''), 'Ouverture du cahier')
    return `<div class="status status--error" role="alert"><p>${escapeHtml(texte)}</p></div>`
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
        <button type="button" id="supprimer" class="btn btn--danger">Supprimer ce cahier</button>
      </p>
      <p class="version">v${task.version} <span class="muted">— ${task.steps.length} étapes,
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

/** Exécute une action humaine en rendant son échec lisible par un humain. */
function actionHumaine(
  action: string,
  muter: Parameters<typeof store.mutate>[0],
  siRéussi?: () => void,
): void {
  erreurHumaine = null
  void store.mutate(muter).then(
    () => siRéussi?.(),
    (error: unknown) => {
      erreurHumaine = messageHumain(error, action)
      scheduleRender()
    },
  )
}

/** Nombre de lignes affichées par liste de supervision. */
const MAX_LIGNES = 8

/** Annonce ce qui n'est pas montré, plutôt que de le taire. */
function reste(total: number): string {
  const caché = total - MAX_LIGNES
  return caché > 0
    ? `<p class="muted">${caché} entrée${caché > 1 ? 's' : ''} plus ancienne${caché > 1 ? 's' : ''} non affichée${caché > 1 ? 's' : ''} — l'export les contient toutes.</p>`
    : ''
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
  // Les listes d'étapes croissent sans limite avec la tâche, et sont
  // reconstruites à chaque écriture d'agent. Au-delà d'une poignée, on annonce
  // le reste plutôt que de rebâtir des centaines de nœuds à chaque rafale.
  const attente = task.steps.filter((s) => s.evidence !== null && s.confidence !== 'human_verified')
  // Les PLUS ANCIENNES d'abord : le clic humain est le seul chemin vers
  // « human_verified », et montrer les plus récentes rendait les anciennes
  // inatteignables tant que les nouvelles n'étaient pas traitées. Prises par le
  // début, la file se vide.
  const àValider = attente
    .slice(0, MAX_LIGNES)
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
      ? `<form id="form-contrainte" class="saisie" novalidate>
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
      ? `<form id="form-rejet" class="saisie" novalidate>
           <label for="new-rejection">Approche à condamner</label>
           <input id="new-rejection" type="text" autocomplete="off"
                  placeholder="Approche à écarter" />
           <label for="new-rejection-reason">Motif du rejet, obligatoire</label>
           <input id="new-rejection-reason" type="text" autocomplete="off"
                  aria-required="true"
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
  const claims = task.steps.filter((s) => s.evidence === null)
  const sansPreuve = claims
    .slice(-MAX_LIGNES)
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
      ${àValider ? `<h2>Preuves à valider</h2><ul class="regles">${àValider}</ul>${reste(attente.length)}` : ''}
      ${sansPreuve ? `<h2>Affirmé sans preuve</h2><ul class="regles">${sansPreuve}</ul>${reste(claims.length)}` : ''}
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
      // Corriger sa saisie efface le reproche. On retire l'alerte du DOM sans
      // redessiner : un rendu complet détruirait le champ en cours de frappe,
      // ce qui interrompt une composition (saisies asiatiques, touches mortes)
      // et vide la pile d'annulation du navigateur.
      if (erreurHumaine !== null) {
        erreurHumaine = null
        document.querySelector('.supervision [role="alert"]')?.remove()
      }
    })
  }

  document
    .querySelector<HTMLFormElement>('#form-contrainte')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      const règle = brouillons['new-constraint'].trim()
      if (!règle) return
      // Vidé seulement si la mutation passe : sinon une règle refusée pour
      // longueur disparaissait de l'écran, et on ne pouvait plus la raccourcir.
      actionHumaine(
        'Ajout de la contrainte',
        (state) => addConstraint(state, { rule: règle, basedOnVersion: null }, 'human'),
        () => {
          brouillons['new-constraint'] = ''
        },
      )
    })

  document.querySelector<HTMLFormElement>('#form-rejet')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const approche = brouillons['new-rejection'].trim()
    const motif = brouillons['new-rejection-reason'].trim()
    // On laisse le domaine refuser un motif vide plutôt que de l'intercepter
    // ici : une seule règle, un seul endroit où elle est écrite.
    actionHumaine(
      'Condamnation de l’approche',
      (state) =>
        rejectApproach(state, { approach: approche, reason: motif, basedOnVersion: null }, 'human'),
      () => {
        brouillons['new-rejection'] = ''
        brouillons['new-rejection-reason'] = ''
      },
    )
  })

  for (const bouton of document.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
    bouton.addEventListener('click', () => {
      const id = bouton.dataset.toggle!
      const actif = bouton.dataset.active === 'true'
      actionHumaine(actif ? 'Levée de la contrainte' : 'Rétablissement de la contrainte', (state) =>
        setConstraintActive(state, id, !actif),
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
  // Révoquée au tour suivant : révoquer dans le même tour que le clic peut
  // laisser un téléchargement vide sur les navigateurs qui résolvent la
  // navigation plus tard.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Dernier état annoncé, pour ne pas répéter la même phrase. */
let dernièreAnnonce = ''

/**
 * Annonce un changement dans la région persistante.
 *
 * Les attributs `aria-live` posés sur les nœuds du rendu ne produisaient aucune
 * annonce : `render()` remplace tout le sous-arbre, et une région réinsérée est
 * du DOM neuf, pas une mutation. Seule une région qui survit au rendu est
 * suivie par une aide technique.
 */
function annoncer(): void {
  const région = document.querySelector('#annonces')
  if (!région) return

  const task = store.getSnapshot().task
  const { total, refused } = getWitness()
  const phrase = task
    ? `Version ${task.version}. ${total} appel${total > 1 ? 's' : ''} d'outil, ${refused} refusé${refused > 1 ? 's' : ''}.`
    : ''

  if (phrase === dernièreAnnonce) return
  dernièreAnnonce = phrase
  région.textContent = phrase
}

function render(): void {
  // Une frame planifiée avant le démontage s'exécute quand même : sans ce
  // garde-fou, elle écrivait dans une racine devenue nulle. En production rien
  // ne démonte, si bien que seul un test pouvait le montrer.
  if (!root) return

  // Le champ de saisie est remplacé par le rendu : on note s'il avait le focus
  // et où était le curseur, pour que l'agent ne coupe pas la parole à l'humain.
  const actif = document.activeElement
  const champFocalisé =
    actif instanceof HTMLInputElement && actif.id in brouillons ? actif.id : null
  const curseur = champFocalisé ? (actif as HTMLInputElement).selectionStart : null

  // Le lien d'évitement ne s'émet que si son ancre existe : elle vit dans la
  // supervision, qui n'est pas rendue tant qu'aucun cahier n'est ouvert.
  const supervision = renderSupervision()
  const lienEvitement = supervision
    ? '<a class="skip-link" href="#supervision-ancre">Aller aux commandes de supervision</a>'
    : ''

  root.innerHTML = `${lienEvitement}
    <main id="contenu">
      <header>
        <h1>${escapeHtml(titre())}</h1>
        <p class="muted">${escapeHtml(sousTitre())}</p>
      </header>
      ${renderTask()}
      ${supervision}
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

  annoncer()

  document.querySelector('#export-un')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) telecharger(exportFilename(task), buildTaskExport(task))
  })

  document.querySelector('#export-tous')?.addEventListener('click', () => {
    void store.allTasks().then(
      (tasks) => telecharger('cahiers.md', buildFullExport(tasks)),
      (error: unknown) => {
        // Sans cette branche, un stockage indisponible ne produisait ni fichier,
        // ni message, et laissait un rejet non géré dans la console.
        erreurHumaine = messageHumain(error, 'Export des cahiers')
        scheduleRender()
      },
    )
  })

  root?.querySelector('#supprimer')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    // Destructif et irréversible : on demande, en nommant ce qui disparaît.
    const sûr = window.confirm(
      `Supprimer définitivement « ${task.title} » (v${task.version}) ?\n\n` +
        "Exportez-le d'abord si vous voulez en garder trace.",
    )
    if (!sûr) return
    erreurHumaine = null
    void store.deleteCurrentTask().catch((error: unknown) => {
      erreurHumaine = messageHumain(error, 'Suppression du cahier')
      scheduleRender()
    })
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
let frameEnAttente: number | null = null

function scheduleRender(): void {
  if (renduPrevu) return
  renduPrevu = true
  // À la frame, pas à la micro-tâche. Les deux notifications d'une écriture
  // d'agent — le magasin puis le témoin d'appels — sont séparées par un
  // `await` : la micro-tâche du magasin est purgée AVANT que le témoin ne
  // notifie, si bien qu'elle ne groupait rien. Une frame couvre la chaîne
  // de promesses entière.
  const planifier =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: () => void) => setTimeout(fn, 0)
  frameEnAttente = planifier(() => {
    frameEnAttente = null
    renduPrevu = false
    render()
  }) as unknown as number
}

/**
 * Monte la vue sur une racine et s'abonne aux trois sources de changement.
 * Rend une fonction de démontage, pour qu'un test puisse repartir à neuf.
 */
export function mount(cible: HTMLElement): () => void {
  root = cible
  for (const clé of Object.keys(brouillons)) brouillons[clé] = ''
  erreurHumaine = null
  dernièreAnnonce = ''
  renduPrevu = false

  render()
  const abonnements = [
    onRegistrationChange(scheduleRender),
    onCall(scheduleRender),
    store.subscribe(scheduleRender),
  ]

  return () => {
    for (const retirer of abonnements) retirer()
    if (frameEnAttente !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameEnAttente)
      else clearTimeout(frameEnAttente)
      frameEnAttente = null
    }
    renduPrevu = false
    root = null
  }
}

/** Force un rendu immédiat. Réservé aux tests, qui n'attendent pas la frame. */
export function __renderNow(): void {
  renduPrevu = false
  render()
}
