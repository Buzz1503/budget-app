// Source artwork for the native iOS app, drawn from the same SVG as the PWA
// icons (scripts/make-icons.mjs) so the two cannot drift apart.
//
//   assets/icon-only.png   1024x1024, fully opaque (iOS rejects an alpha channel)
//   assets/splash.png      2732x2732, the app background with the mark centred
//   assets/splash-dark.png the same: the app is dark only
//
// `npm run ios:assets` then feeds these to @capacitor/assets, which writes the
// Xcode asset catalog (icon and launch image) under ios/.
import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { svg } from './make-icons.mjs'

const BG = '#080a12'
mkdirSync('assets', { recursive: true })

// the icon: the PWA artwork at 1024, on the app background, flattened so there is no alpha
await sharp(Buffer.from(svg({ size: 1024, bg: true, pad: 0.06 })))
  .flatten({ background: BG }).removeAlpha().png().toFile('assets/icon-only.png')
console.log('wrote assets/icon-only.png (1024x1024, opaque)')

// the splash: iOS crops a launch image to fill the screen, so the mark stays
// inside the central square that survives every device's crop
const SIZE = 2732
const MARK = 720
const mark = await sharp(Buffer.from(svg({ size: MARK, bg: false, pad: 0.06 }))).png().toBuffer()
for (const file of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: BG } })
    .composite([{ input: mark, left: (SIZE - MARK) / 2, top: (SIZE - MARK) / 2 }])
    .png().toFile(`assets/${file}`)
  console.log(`wrote assets/${file} (${SIZE}x${SIZE})`)
}
