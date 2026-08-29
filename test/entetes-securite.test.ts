import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'
import vercelBrut from '../vercel.json?raw'

// La page tient un coffre d'identifiants chiffrés et treize outils appelables
// par un agent : un script injecté y aurait accès à tout. Les épreuves tiennent
// la politique par ses DIRECTIVES, qu'on affaiblit en la réécrivant, et gardent
// les deux hébergeurs alignés. Vérifié dans Brave sur `dist/` : script en ligne,
// script de CDN, `fetch` sortant, image-balise et cadrage tous refusés, sans une
// erreur de console.
const vercel = JSON.parse(vercelBrut) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

const globales = vercel.headers.find((h) => h.source === '/(.*)')!
const vercelHeader = (nom: string) =>
  globales.headers.find((h) => h.key.toLowerCase() === nom.toLowerCase())?.value ?? ''

const cspHeaders = /Content-Security-Policy:(.*)/.exec(headers)?.[1] ?? ''
const cspVercel = vercelHeader('Content-Security-Policy')

const directive = (csp: string, nom: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === nom || d.startsWith(`${nom} `)) ?? ''

describe('la politique de sécurité du contenu', () => {
  it('part de rien et n’ouvre que cette origine', () => {
    for (const csp of [cspHeaders, cspVercel]) {
      expect(directive(csp, 'default-src')).toBe("default-src 'none'")
      for (const nom of ['style-src', 'img-src', 'connect-src', 'manifest-src', 'worker-src']) {
        expect(directive(csp, nom), nom).toBe(`${nom} 'self'`)
      }
    }
  })

  it('n’autorise jamais ni `unsafe-inline` ni `unsafe-eval`', () => {
    // Le seul script en ligne est autorisé par son empreinte. `unsafe-inline`
    // viderait la politique de tout son intérêt d'un seul mot.
    for (const csp of [cspHeaders, cspVercel]) {
      expect(csp).not.toContain('unsafe-inline')
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).not.toContain('*')
    }
  })

  it('autorise le script d’amorce par une empreinte, et une seule', () => {
    // Dans le dépôt, `_headers` porte un marqueur : c'est `scripts/headers.mjs`
    // qui calcule l'empreinte sur le HTML réellement construit, la substitue,
    // et refuse la construction si `vercel.json` n'en porte pas la même.
    expect(directive(cspHeaders, 'script-src')).toBe("script-src 'self' '__CSP_SCRIPT_HASH__'")

    const dansVercel = cspVercel.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? []
    expect(dansVercel).toHaveLength(1)
    expect(directive(cspVercel, 'script-src')).toBe(`script-src 'self' ${dansVercel[0]}`)
  })

  it('interdit le cadrage, la soumission de formulaire et la réécriture de base', () => {
    for (const csp of [cspHeaders, cspVercel]) {
      expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
      expect(directive(csp, 'form-action')).toBe("form-action 'none'")
      expect(directive(csp, 'base-uri')).toBe("base-uri 'none'")
      expect(directive(csp, 'object-src')).toBe("object-src 'none'")
    }
  })
})

describe('les autres en-têtes', () => {
  const attendus: [string, RegExp][] = [
    ['Strict-Transport-Security', /max-age=31536000/],
    ['X-Content-Type-Options', /^nosniff$/],
    ['X-Frame-Options', /^DENY$/],
    ['Referrer-Policy', /^no-referrer$/],
    ['Cross-Origin-Opener-Policy', /^same-origin$/],
    ['Cross-Origin-Resource-Policy', /^same-origin$/],
  ]

  it.each(attendus)('pose %s des deux côtés', (nom, motif) => {
    const côtéFichier = new RegExp(`${nom}:\\s*(.*)`).exec(headers)?.[1]?.trim() ?? ''
    expect(côtéFichier, `_headers ${nom}`).toMatch(motif)
    expect(vercelHeader(nom).trim(), `vercel.json ${nom}`).toMatch(motif)
  })

  it('refuse toutes les permissions que le produit n’utilise pas', () => {
    // Aucune n'est utilisée : la page ne demande ni caméra, ni micro, ni
    // position, ni paiement. Les refuser coûte zéro et retire autant de
    // surface à un script qui parviendrait quand même à s'exécuter.
    for (const source of [headers, vercelHeader('Permissions-Policy')]) {
      for (const clé of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial']) {
        expect(source, clé).toContain(`${clé}=()`)
      }
    }
  })

  it('ne garde en cache que ce qui porte une empreinte', () => {
    // Mettre `index.html` en cache ferait servir une ancienne page qui réclame
    // des fichiers supprimés : l'écran blanc classique après un déploiement.
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/)
    for (const f of ['/index.html', '/sw.js', '/manifest.webmanifest']) {
      expect(headers, f).toMatch(new RegExp(`${f}\\n\\s+Cache-Control: no-cache`))
    }
  })
})
