/**
 * Loader Node minimal, chargé uniquement par scripts/generate-tokens.mjs.
 *
 * `@material/material-color-utilities@0.4.0` publie un import relatif sans
 * extension (`dynamiccolor/color_spec_2025.js` importe `./dynamic_color` au
 * lieu de `./dynamic_color.js`). Le résolveur ESM strict de Node rejette ce
 * spécificateur ; ce hook retente avec `.js` avant d'abandonner. Vite/esbuild
 * n'ont pas ce problème (résolution plus permissive), donc ce hook ne sert
 * qu'à exécuter le script de génération en Node pur.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
      return nextResolve(`${specifier}.js`, context)
    }
    throw err
  }
}
