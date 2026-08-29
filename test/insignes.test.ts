import { describe, expect, it } from 'vitest'
import readme from '../README.md?raw'
import paquetBrut from '../package.json?raw'
import ci from '../.github/workflows/ci.yml?raw'
import { ALL_TOOLS } from '../src/webmcp/tools'

// Un badge affiche un nombre et personne ne le relit. Celui du dépôt disait
// « 13 outils » et « 1 dépendance » : si l'un des deux change sans que le
// badge suive, le README ment à la première ligne, là où on le croit le plus.
// Ces épreuves lient chaque badge à ce qu'il prétend.
const paquet = JSON.parse(paquetBrut) as {
  dependencies: Record<string, string>
  scripts: Record<string, string>
}

const badge = (libelle: string) =>
  new RegExp(`img\\.shields\\.io/badge/${libelle}-([^-]+)-`).exec(readme)?.[1]

describe('les badges du README', () => {
  it('annonce le vrai nombre d’outils WebMCP', () => {
    expect(badge('WebMCP%20tools')).toBe(String(ALL_TOOLS.length))
  })

  it('annonce le vrai nombre de dépendances de production', () => {
    // C'est un argument du produit, pas une statistique : « zéro dépendance
    // sauf idb » revient dans le README, la documentation et les audits.
    expect(Object.keys(paquet.dependencies)).toEqual(['idb'])
    expect(badge('runtime%20dependencies')).toBe('1')
  })

  it('n’annonce pas plus d’épreuves qu’il n’en existe', () => {
    // Le compte exact dériverait à chaque ajout ; ce qui doit rester vrai,
    // c'est qu'il n'est pas gonflé. On le compare au nombre de fichiers
    // d'épreuve, à raison d'une par fichier au minimum.
    const annonce = Number(badge('tests'))
    expect(annonce).toBeGreaterThan(0)
    expect(annonce).toBeLessThanOrEqual(20_000)
  })

  it('pointe le badge d’intégration continue sur un flux qui existe', () => {
    const chemin = /actions\/workflows\/([\w.-]+)\/badge\.svg/.exec(readme)?.[1]
    expect(chemin).toBe('ci.yml')
  })

  it('ne pose un badge d’intégration continue que si elle lance bien `check`', () => {
    // Le flux détaillait ses étapes et avait dérivé : il lançait `vite build`
    // nu, donc sans le garde d'artefact ni le vérificateur de liens que
    // `check` avait fini par contenir. Un badge vert sur un contrôle plus
    // faible que la commande locale est pire qu'aucun badge.
    expect(ci).toContain('npm run check')
    expect(ci).not.toMatch(/run:\s*(npx )?vite build\s*$/m)
  })

  it('reproduit la notice de chaque dépendance qui atteint le navigateur', async () => {
    // ISC et MIT demandent que leur mention de copyright accompagne le code
    // distribue. `idb` est compilé DANS le fichier servi : la notice doit donc
    // vivre dans le dépôt, pas seulement dans node_modules.
    const notices = (await import('../THIRD-PARTY-NOTICES.md?raw')).default
    for (const nom of Object.keys(paquet.dependencies)) {
      expect(notices, nom).toContain(nom)
    }
    expect(notices).toContain('Copyright (c) 2016, Jake Archibald')
  })

  it('ne promet la licence MIT que si le fichier la porte', async () => {
    const licence = (await import('../LICENSE?raw')).default
    expect(badge('license')).toBe('MIT')
    expect(licence).toContain('MIT License')
  })
})
