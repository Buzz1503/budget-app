#!/usr/bin/env node
/**
 * Pin QA — the build fails if any pin is in an impossible place.
 *
 * Five numeric checks run always, against the same functions the app uses, so
 * this cannot pass on arithmetic the app does not share. A sixth, visual, check
 * runs only when the developer has put the real composite at
 * /dev-assets/body-map.jpg — which is gitignored, never bundled and never
 * referenced by application code. Without it there is no way to know whether a
 * pin is on skin or on a knee, so the script says so instead of pretending.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  PINS, WINDOWS, VIEWS, checkPins, toScreen, windowHeightPx,
  COMPOSITE_ASPECT, SCREEN_WIDTH, MIN_SPACING_PX, EDGE_MARGIN_PX, PIN_DIAMETER_PX,
  NAVEL, NAVEL_CLEARANCE_PCT,
} from '../src/lib/sitePins.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAP = resolve(root, 'dev-assets/body-map.jpg')
const QA_DIR = resolve(root, 'dev-assets/qa')

/**
 * The real image's aspect ratio when it is available.
 *
 * Vertical spacing depends on it, so measuring the actual file beats assuming.
 * Read straight out of the JPEG's SOF marker rather than pulling in a decoder.
 */
function jpegSize(path) {
  try {
    const buf = readFileSync(path)
    let i = 2
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  } catch { /* fall through */ }
  return null
}

const hasMap = existsSync(MAP)
const size = hasMap ? jpegSize(MAP) : null
const aspect = size ? size.height / size.width : COMPOSITE_ASPECT

console.log('Pin QA')
console.log('------')
console.log(`pins            ${PINS.length}`)
console.log(`viewport width  ${SCREEN_WIDTH} px`)
console.log(size
  ? `composite       ${size.width} x ${size.height} (measured) · aspect ${aspect.toFixed(4)}`
  : `composite       not present · assumed aspect ${aspect.toFixed(4)}`)
for (const v of VIEWS) {
  const w = WINDOWS[v]
  console.log(`  ${v.padEnd(6)} window x ${w.x0}–${w.x1}, y ${w.y0}–${w.y1} → ${SCREEN_WIDTH} x ${Math.round(windowHeightPx(v, SCREEN_WIDTH, aspect))} px`)
}
console.log()

const result = checkPins(PINS, { screenWidth: SCREEN_WIDTH, aspect })

const byCheck = {}
for (const f of result.failures) (byCheck[f.check] ||= []).push(f)

const CHECKS = [
  ['unique', 'Pin ids are unique'],
  ['group', 'Every pin has a known group'],
  ['label', 'Every pin has a label'],
  ['view', 'Every pin belongs to a view'],
  ['side', `Anatomical side matches position (front midline x ${26.8}, back x ${75})`],
  ['label-side', 'Label agrees with the stored side'],
  ['spacing', `Minimum centre-to-centre spacing ${MIN_SPACING_PX} px`],
  ['edge', `Every pin at least ${EDGE_MARGIN_PX} px inside its window`],
  ['navel', `Abdomen pins at least ${NAVEL_CLEARANCE_PCT}% of width from the navel (5 cm)`],
]

for (const [id, label] of CHECKS) {
  const bad = byCheck[id] || []
  console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${label}`)
  for (const f of bad) console.log(`        ${f.pin}: ${f.detail}`)
}

console.log()
console.log(`minimum spacing measured: ${result.minSpacingPx} px`
  + (result.closestPair ? `  (${result.closestPair.join(' / ')})` : ''))

// the tightest margins, so a near-miss is visible before it becomes a failure
const margins = PINS.map((p) => ({
  id: p.id,
  navel: p.group === 'abdomen'
    ? Math.hypot(p.x - NAVEL.x, (p.y - NAVEL.y) * aspect)
    : null,
})).filter((m) => m.navel != null).sort((a, b) => a.navel - b.navel)
if (margins.length) {
  console.log(`closest to the navel:     ${margins[0].navel.toFixed(2)}% of width (${margins[0].id})`)
}

// ---------------------------------------------------------------- visual

if (!hasMap) {
  console.log()
  console.log('Visual QA skipped: dev-assets/body-map.jpg is not present.')
  console.log('  Put the composite there (gitignored, never bundled) and run again to')
  console.log('  render both views with the pins drawn.')
} else {
  mkdirSync(QA_DIR, { recursive: true })
  const b64 = readFileSync(MAP).toString('base64')
  for (const view of VIEWS) {
    const w = WINDOWS[view]
    const h = Math.round(windowHeightPx(view, SCREEN_WIDTH, aspect))
    const scale = SCREEN_WIDTH / ((w.x1 - w.x0) / 100)
    const pins = PINS.filter((p) => p.view === view)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SCREEN_WIDTH}" height="${h}" viewBox="0 0 ${SCREEN_WIDTH} ${h}">
  <defs><clipPath id="c"><rect width="${SCREEN_WIDTH}" height="${h}"/></clipPath></defs>
  <g clip-path="url(#c)">
    <image href="data:image/jpeg;base64,${b64}"
      x="${-w.x0 / 100 * scale}" y="${-w.y0 / 100 * scale * aspect}"
      width="${scale}" height="${scale * aspect}" preserveAspectRatio="none"/>
${pins.map((p) => {
      const s = toScreen(p, { screenWidth: SCREEN_WIDTH, aspect })
      return `    <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${PIN_DIAMETER_PX / 2}" fill="rgba(220,40,50,0.75)" stroke="#fff" stroke-width="2"/>
    <text x="${s.x.toFixed(1)}" y="${(s.y - 13).toFixed(1)}" font-size="9" font-family="system-ui" fill="#fff" text-anchor="middle" stroke="#000" stroke-width="2.5" paint-order="stroke">${p.id}</text>`
    }).join('\n')}
${view === 'front' ? `    <circle cx="${((NAVEL.x - w.x0) / 100 * scale).toFixed(1)}" cy="${((NAVEL.y - w.y0) / 100 * scale * aspect).toFixed(1)}" r="4" fill="none" stroke="#0ff" stroke-width="2"/>` : ''}
  </g>
</svg>`
    const out = resolve(QA_DIR, `pins-${view}.svg`)
    writeFileSync(out, svg)
    console.log(`  rendered ${out}`)
  }
  console.log()
  console.log('Visual QA rendered. Open the files above and confirm no pin sits on the')
  console.log('navel, a bone, a knee, the underwear edge, the background or a tattoo edge.')
}

console.log()
if (!result.ok) {
  console.log(`FAILED — ${result.failures.length} problem(s).`)
  process.exit(1)
}
console.log('All checks passed.')
