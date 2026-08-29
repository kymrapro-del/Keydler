import { describe, expect, it } from 'vitest'
import { buildSvg, svgFingerprint } from '../scripts/social-card.mjs'
// `?raw` reads as UTF-8 and would corrupt a binary; `?inline` returns a data
// URL, so the base64 arrives intact.
import inlineCard from '../public/og.png?inline'

// A committed generated file goes stale in silence. This one did: the social
// card kept an em dash for three hours after the text lost it, nothing
// comparing image to source. The generator now writes its SVG fingerprint into
// the PNG, and this reads it back.
//
// It catches staleness, not rendering: a card regenerated from the right source
// by a different tool would still pass.
function pngComment(dataUri: string): string | null {
  const bytes = Uint8Array.from(atob(dataUri.split(',')[1]), (c) => c.charCodeAt(0))
  let i = 8 // signature PNG
  const view = new DataView(bytes.buffer)
  while (i + 8 <= bytes.length) {
    const size = view.getUint32(i, false)
    const type = String.fromCharCode(...bytes.slice(i + 4, i + 8))
    if (type === 'tEXt') {
      const block = String.fromCharCode(...bytes.slice(i + 8, i + 8 + size))
      const [key, ...rest] = block.split('\0')
      if (key === 'comment') return rest.join('\0')
    }
    if (type === 'IEND') break
    i += 12 + size
  }
  return null
}

describe('the social card', () => {
  it('was generated from the source that is in the repository', () => {
    const expected = `svg-sha256=${svgFingerprint(buildSvg())}`
    expect(pngComment(inlineCard)).toBe(expected)
  })

  it('carries no em dash, which is what made this check necessary', () => {
    expect(buildSvg()).not.toContain(String.fromCodePoint(0x2014))
  })

  it('declares the size the platforms ask for', () => {
    // 1200x630 is the 1.91:1 that X, LinkedIn, Slack and Discord crop the
    // least. index.html announces those numbers; the SVG has to agree.
    const svg = buildSvg()
    expect(svg).toContain('width="1200"')
    expect(svg).toContain('height="630"')
  })
})
