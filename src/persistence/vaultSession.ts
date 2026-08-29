import { getDb } from './db'
import { requirePassphrase } from '../domain/secret'
import { decryptWithKey, deriveKeyFor } from './vault'

/**
 * Session de déverrouillage du coffre.
 *
 * `vault.ts` scelle chaque secret avec son propre sel : il n'existe donc pas
 * de clé unique pour « tout le coffre », seulement une clé par secret. Ce
 * module tient le compromis retenu — un cache en mémoire, vivant le temps de
 * la page, qui associe un identifiant de secret à la `CryptoKey` (non
 * extractable) dérivée pour lui. Une révélation qui trouve sa clé en cache
 * n'a plus besoin de repasser par la passphrase ; verrouiller, explicitement
 * ou par inactivité, ne fait que vider ce cache.
 *
 * Ce qui rend ça sûr : une `CryptoKey` marquée `extractable: false` (voir
 * `deriveKey` dans `vault.ts`) est un handle opaque que le moteur JS refuse
 * d'exporter en octets. Même une injection de script qui lirait cette Map ne
 * pourrait en tirer ni la passphrase (jamais conservée, nulle part) ni la clé
 * elle-même — seul `subtle.decrypt` sait s'en servir, et seulement pour ce
 * secret précis. Une chaîne de caractères n'offrirait aucune de ces garanties.
 */

const cache = new Map<string, CryptoKey>()

/** Durée d'inactivité humaine avant verrouillage automatique. */
export const AUTOLOCK_MS = 5 * 60_000

export type LockReason = 'manual' | 'auto'
export type LockEvent = { reason: LockReason; unlockedBefore: number }
type LockListener = (event: LockEvent) => void

const listeners = new Set<LockListener>()
let timer: ReturnType<typeof setTimeout> | null = null
let activityListenersAttached = false

function notify(reason: LockReason, unlockedBefore: number): void {
  for (const listener of listeners) listener({ reason, unlockedBefore })
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function armTimer(): void {
  clearTimer()
  // Rien à protéger, rien à minuter : un cache vide n'a pas besoin d'expirer.
  if (cache.size === 0) return
  timer = setTimeout(() => {
    timer = null
    const before = cache.size
    cache.clear()
    notify('auto', before)
  }, AUTOLOCK_MS)
}

/** Réarme le minuteur sur une interaction humaine — jamais sur une écriture d'agent. */
function noteActivity(): void {
  if (cache.size === 0) return
  armTimer()
}

/**
 * Les écouteurs ne sont posés qu'à la première clé mise en cache, pas au
 * chargement du module : une page qui n'ouvre jamais de coffre ne doit pas
 * écouter `pointerdown`/`keydown`/`focus` pour rien.
 */
function ensureActivityListeners(): void {
  if (activityListenersAttached || typeof document === 'undefined') return
  activityListenersAttached = true
  document.addEventListener('pointerdown', noteActivity)
  document.addEventListener('keydown', noteActivity)
  // `focus` ne bouillonne pas : seule la phase de capture le voit passer,
  // quel que soit le champ qui le reçoit.
  document.addEventListener('focus', noteActivity, true)
}

/** Ce secret a-t-il une clé en cache, prête à déchiffrer sans repasser par la passphrase ? */
export function isUnlocked(id: string): boolean {
  return cache.has(id)
}

/** Combien de secrets sont déverrouillés en ce moment — pour afficher un état honnête. */
export function unlockedCount(): number {
  return cache.size
}

/** Verrouillage explicite : vide tout le cache d'un coup. */
export function lockAll(): void {
  const before = cache.size
  clearTimer()
  cache.clear()
  if (before > 0) notify('manual', before)
}

/** S'abonner aux verrouillages (manuels ou automatiques) pour refléter l'état à l'écran. */
export function onLockChange(listener: LockListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Révèle un secret via la session : utilise la clé en cache si elle existe,
 * sinon dérive une nouvelle clé à partir de la passphrase fournie et la met
 * en cache pour la suite. `passphrase` peut être `null` quand l'appelant a
 * déjà vérifié `isUnlocked(id)` — dans ce cas, une passphrase manquante alors
 * que le cache est vide (par ex. un verrouillage automatique survenu entre
 * l'affichage du bouton et le clic) redevient une erreur de validation
 * ordinaire, gérée comme n'importe quelle passphrase absente.
 */
export async function revealWithSession(id: string, passphrase: string | null): Promise<string> {
  const db = await getDb()
  const ref = await db.get('secrets', id)
  if (!ref) throw new Error('No such credential on this device.')

  const cached = cache.get(id)
  if (cached) {
    try {
      const value = await decryptWithKey(ref.sealed, cached)
      noteActivity()
      return value
    } catch {
      // La clé en cache n'ouvre plus ce secret — il a été corrigé et rescellé
      // entre-temps, par exemple. On l'oublie plutôt que de laisser croire
      // que le cache est encore de confiance, et on retombe sur la passphrase.
      cache.delete(id)
    }
  }

  const phrase = requirePassphrase(passphrase)
  const key = await deriveKeyFor(ref.sealed, phrase)
  const value = await decryptWithKey(ref.sealed, key) // jette WrongPassphraseError si la passphrase est fausse
  cache.set(id, key)
  ensureActivityListeners()
  armTimer()
  return value
}

/** Remise à zéro pour les tests : un module singleton survivrait sinon d'un test à l'autre. */
export function __resetVaultSession(): void {
  clearTimer()
  cache.clear()
  listeners.clear()
  if (activityListenersAttached && typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', noteActivity)
    document.removeEventListener('keydown', noteActivity)
    document.removeEventListener('focus', noteActivity, true)
  }
  activityListenersAttached = false
}
