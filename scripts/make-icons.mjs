// Generates the PWA icon set from one on-brand SVG.
// Mark: a syringe barrel on the app's lime→violet gradient over the dark base,
// with a completion-ring arc echoing the Home screen's daily ring.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'fs'

const OUT = 'public'
mkdirSync(OUT, { recursive: true })

const BG = '#080a12'   // app --bg
const LIME = '#b4f13a' // app --lime
const VIOLET = '#a066ff'
const INDIGO = '#6d6bff'

// `pad` insets the artwork so a maskable icon survives circular cropping
// (safe zone = middle 80%).
function svg({ size, bg, pad }) {
  const s = size
  const c = s / 2
  const k = (1 - pad * 2)           // usable fraction after safe-zone padding
  const r = s * 0.355 * k           // ring radius — kept well clear of the mark
  const stroke = s * 0.075 * k      // heavy stroke so it survives 60px home-screen size
  const gap = 0.26                  // fraction of the circle left open
  const dash = 2 * Math.PI * r

  // Bold solid syringe, angled slightly so it reads as an object not a bar.
  const bw = s * 0.155 * k          // barrel width
  const bh = s * 0.300 * k          // barrel height

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="ring" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="${LIME}"/>
      <stop offset="50%" stop-color="${VIOLET}"/>
      <stop offset="100%" stop-color="${INDIGO}"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="${LIME}"/>
      <stop offset="100%" stop-color="${VIOLET}"/>
    </linearGradient>
  </defs>
  ${bg ? `<rect width="${s}" height="${s}" fill="${BG}"/>` : ''}

  <!-- daily-completion ring: a progress arc with a clean gap at the top -->
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#ring)" stroke-width="${stroke}"
          stroke-linecap="round"
          stroke-dasharray="${dash * (1 - gap)} ${dash}"
          transform="rotate(${-90 + (gap * 360) / 2} ${c} ${c})"/>

  <!-- syringe: one bold solid silhouette, centred in the ring -->
  <g transform="translate(${c} ${c})">
    <!-- plunger rod + thumb pad -->
    <rect x="${-bw * 0.42}" y="${-bh * 0.92}" width="${bw * 0.84}" height="${bh * 0.15}"
          rx="${bh * 0.075}" fill="url(#body)"/>
    <rect x="${-bw * 0.11}" y="${-bh * 0.80}" width="${bw * 0.22}" height="${bh * 0.24}"
          fill="url(#body)"/>
    <!-- barrel -->
    <rect x="${-bw / 2}" y="${-bh * 0.56}" width="${bw}" height="${bh}"
          rx="${bw * 0.34}" fill="url(#body)"/>
    <!-- graduation marks cut into the barrel -->
    <g fill="${BG}" opacity="0.85">
      <rect x="${-bw * 0.30}" y="${-bh * 0.34}" width="${bw * 0.34}" height="${bh * 0.045}" rx="${bh * 0.022}"/>
      <rect x="${-bw * 0.30}" y="${-bh * 0.16}" width="${bw * 0.34}" height="${bh * 0.045}" rx="${bh * 0.022}"/>
      <rect x="${-bw * 0.30}" y="${bh * 0.02}" width="${bw * 0.34}" height="${bh * 0.045}" rx="${bh * 0.022}"/>
    </g>
    <!-- needle -->
    <rect x="${-bw * 0.075}" y="${bh * 0.44}" width="${bw * 0.15}" height="${bh * 0.30}"
          rx="${bw * 0.06}" fill="url(#body)"/>
  </g>
</svg>`
}

const targets = [
  { file: 'pwa-192x192.png', size: 192, bg: true, pad: 0.06 },
  { file: 'pwa-512x512.png', size: 512, bg: true, pad: 0.06 },
  // maskable: extra padding so nothing is clipped by the platform mask
  { file: 'pwa-maskable-512x512.png', size: 512, bg: true, pad: 0.14 },
  { file: 'apple-touch-icon.png', size: 180, bg: true, pad: 0.08 },
]

for (const t of targets) {
  await sharp(Buffer.from(svg(t))).png().toFile(`${OUT}/${t.file}`)
  console.log(`wrote ${OUT}/${t.file} (${t.size}x${t.size})`)
}

// favicon.svg — scales crisply in browser tabs
writeFileSync(`${OUT}/favicon.svg`, svg({ size: 64, bg: true, pad: 0.05 }))
console.log(`wrote ${OUT}/favicon.svg`)
