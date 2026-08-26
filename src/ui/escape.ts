/**
 * Échappement sûr en contenu ET en position d'attribut.
 *
 * Les guillemets comptent : un identifiant interpolé dans `data-verify="…"` qui
 * en contiendrait un sortirait de l'attribut. Les identifiants viennent
 * normalement de `crypto.randomUUID`, mais ils sont relus depuis IndexedDB, et
 * une couche d'affichage ne doit jamais faire confiance à ce qu'elle relit.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
