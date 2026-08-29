import { describe, expect, it } from 'vitest'
import { construireSvg, empreinteSvg } from '../scripts/carte-sociale.mjs'
// `?raw` lit en UTF-8 et abîmerait un binaire ; `?inline` rend une URL de
// données, donc du base64 intact.
import carteInline from '../public/og.png?inline'

// A generated file that is committed goes stale in silence. This one did: the
// social card kept an em dash for three hours after the text had lost it,
// because nothing compared the image to the source it came from. The generator
// now writes the fingerprint of its SVG into the PNG, and this reads it back.
//
// It catches staleness, not rendering: a card regenerated from the right source
// by a different tool would still pass. That is the part it does not check.
function commentaireDuPng(dataUri: string): string | null {
  const octets = Uint8Array.from(atob(dataUri.split(',')[1]), (c) => c.charCodeAt(0))
  let i = 8 // signature PNG
  const vue = new DataView(octets.buffer)
  while (i + 8 <= octets.length) {
    const taille = vue.getUint32(i, false)
    const type = String.fromCharCode(...octets.slice(i + 4, i + 8))
    if (type === 'tEXt') {
      const bloc = String.fromCharCode(...octets.slice(i + 8, i + 8 + taille))
      const [clef, ...reste] = bloc.split('\0')
      if (clef === 'comment') return reste.join('\0')
    }
    if (type === 'IEND') break
    i += 12 + taille
  }
  return null
}

describe('the social card', () => {
  it('was generated from the source that is in the repository', () => {
    const attendu = `svg-sha256=${empreinteSvg(construireSvg())}`
    expect(commentaireDuPng(carteInline)).toBe(attendu)
  })

  it('carries no em dash, which is what made this check necessary', () => {
    expect(construireSvg()).not.toContain('—')
  })

  it('declares the size the platforms ask for', () => {
    // 1200x630 is the 1.91:1 that X, LinkedIn, Slack and Discord crop the
    // least. index.html announces those numbers; the SVG has to agree.
    const svg = construireSvg()
    expect(svg).toContain('width="1200"')
    expect(svg).toContain('height="630"')
  })
})
