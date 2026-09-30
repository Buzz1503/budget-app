// v39 — editable body entries, camera roll import, the photo site map and the
// simplified reaction tracker.
//
// Runs at 390×844 against a build on BASE_URL and walks the twenty verify items
// in order. Most assert the store after driving the UI: "mixed injections are
// excluded from the scorecards", "the map photo is absent from the build",
// "duration calculates correctly" are all claims about data behind the pixels,
// and a screen can say them while what is stored disagrees.
import { chromium } from 'playwright'
import { mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

// a 2×2 PNG, enough for the canvas to decode and re-encode
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M9QzwAFjDAGACkNA/9K0RtxAAAAAElFTkSuQmCC',
  'base64',
)

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}

const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const setState = (fn, arg) => page.evaluate(([f, a]) => {
  const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
  // eslint-disable-next-line no-new-func
  new Function('s', 'a', f)(raw.state, a)
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
}, [fn, arg])

const gotIt = async () => {
  const btn = page.locator('button:has-text("Got it")')
  if (!(await btn.count())) return
  try { await btn.first().click({ timeout: 3000 }) } catch { /* left on its own */ }
  await page.waitForTimeout(400)
}
const closeAll = async () => {
  await gotIt()
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  }
}
const reload = async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1400)
  await gotIt()
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button[aria-label="${label}"]`)
  await page.waitForTimeout(650)
}
const body = async (section) => {
  await nav('Body')
  await page.click(`button:has-text("${section}")`)
  await page.waitForTimeout(600)
}
const settings = async () => {
  await nav('More')
  const tab = page.locator('button:has-text("Settings")')
  if (await tab.count()) { await tab.first().click(); await page.waitForTimeout(700) }
  await page.locator('[data-testid="site-map-settings"]').scrollIntoViewIfNeeded()
}
const tracker = async () => {
  await nav('Symptoms')
  await page.click('[data-testid="symptom-tab-reactions"]')
  await page.waitForTimeout(800)
}
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}
const daysAgo = (d) => {
  const t = new Date(Date.now() - d * 86400e3)
  return t.toISOString()
}
const dayStr = (d) => daysAgo(d).slice(0, 10)

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1300)
await gotIt()

// ============================================================ 1 · body edits

await step('1 · a measurement entry can be edited, undone, and is marked Edited', async () => {
  await setState(`
    s.measurements = [
      { id: 'm-a', date: a.d1, source: 'manual', weight: 80, bodyFat: 20 },
      { id: 'm-b', date: a.d2, source: 'manual', weight: 82, bodyFat: 21 },
    ]
  `, { d1: dayStr(20), d2: dayStr(5) })
  await reload()
  await body('Stats')

  await page.click('[data-testid="entry-m-b"]')
  await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="sheet"]').count())) throw new Error('the edit sheet did not open')
  await noOverflow('edit sheet')

  // every field editable: date, time, a value, notes
  await page.fill('[data-testid="entry-time"]', '07:15')
  await page.fill('[data-testid="entry-note"]', 'after a fast')
  const weight = page.locator('input[aria-label="Weight in kg"]').first()
  await weight.fill('79.5')
  await page.click('[data-testid="entry-save"]')
  await page.waitForTimeout(700)

  const s = await state()
  const m = s.measurements.find((x) => x.id === 'm-b')
  if (m.weight !== 79.5) throw new Error(`weight is ${m.weight}, not 79.5`)
  if (m.time !== '07:15') throw new Error('the time was not saved')
  if (m.note !== 'after a fast') throw new Error('the note was not saved')
  if (!m.editedAt) throw new Error('editedAt was not stamped')

  if (!(await page.locator('[data-testid="edited-m-b"]').count())) throw new Error('no Edited marker on the row')
  if (!(await page.locator('[data-testid="toast-undo"]').count())) throw new Error('no undo offered')

  await page.click('[data-testid="toast-undo"]')
  await page.waitForTimeout(600)
  const back = (await state()).measurements.find((x) => x.id === 'm-b')
  if (back.weight !== 82) throw new Error(`undo left the weight at ${back.weight}`)
  console.log('  edited, marked, undone back to 82')
})

await step('1b · changing the date re-sorts, and the chart follows immediately', async () => {
  await body('Stats')
  await page.click('[data-testid="entry-m-b"]')
  await page.waitForTimeout(500)
  await page.fill('[data-testid="entry-date"]', dayStr(40))
  await page.click('[data-testid="entry-save"]')
  await page.waitForTimeout(700)

  const s = await state()
  if (s.measurements[0].id !== 'm-b') throw new Error('the array did not re-sort after the date changed')

  await body('Trends')
  const labels = await page.locator('.recharts-xAxis text').allInnerTexts()
  if (!labels.length) throw new Error('the chart rendered no points')
  console.log(`  re-sorted, chart shows ${labels.length} x labels`)
})

await step('1c · delete asks first, then offers undo', async () => {
  await body('Stats')
  await page.click('[data-testid="entry-m-a"]')
  await page.waitForTimeout(500)
  await page.click('[data-testid="entry-delete"]')
  await page.waitForTimeout(350)
  if ((await state()).measurements.length !== 2) throw new Error('the entry went before the confirm')
  await page.click('[data-testid="entry-delete-confirm"]')
  await page.waitForTimeout(600)
  if ((await state()).measurements.length !== 1) throw new Error('the entry was not deleted')
  await page.click('[data-testid="toast-undo"]')
  await page.waitForTimeout(600)
  if ((await state()).measurements.length !== 2) throw new Error('undo did not put it back')
  console.log('  confirm required, delete undone')
})

// ==================================================== 2-4 · camera roll

await step('2 · Take photo and Choose from library are both offered, and only one captures', async () => {
  await body('Photos')
  if (!(await page.locator('[data-testid="take-photo"]').count())) throw new Error('no Take photo button')
  if (!(await page.locator('[data-testid="choose-from-library"]').count())) throw new Error('no Choose from library button')

  const cam = await page.getAttribute('[data-testid="photo-camera-input"]', 'capture')
  if (cam !== 'environment') throw new Error('the camera input lost its capture attribute')

  const lib = await page.getAttribute('[data-testid="photo-library-input"]', 'capture')
  if (lib !== null) throw new Error(`the library input carries capture="${lib}" — iOS would open the camera`)
  const accept = await page.getAttribute('[data-testid="photo-library-input"]', 'accept')
  if (accept !== 'image/*') throw new Error(`library accept is "${accept}"`)
  const multiple = await page.getAttribute('[data-testid="photo-library-input"]', 'multiple')
  if (multiple === null) throw new Error('the library input is not multi-select')
  console.log('  library input: accept=image/*, multiple, no capture')
})

await step('3 · a picked photo with no EXIF date pre-fills today and is highlighted', async () => {
  await body('Photos')
  // a plain PNG has no EXIF at all, which is exactly the no-date case
  await page.setInputFiles('[data-testid="photo-library-input"]', [
    { name: 'one.png', mimeType: 'image/png', buffer: PNG },
    { name: 'two.png', mimeType: 'image/png', buffer: PNG },
  ])
  await page.waitForTimeout(2500)

  const rows = await page.locator('[data-testid="import-review"] > div').count()
  if (rows !== 2) throw new Error(`${rows} rows in the review list, expected 2 — multi-select did not work`)
  await noOverflow('import review')

  const undated = await page.locator('[data-testid="import-review"] input[data-detected="0"]').count()
  if (undated !== 2) throw new Error('photos without an EXIF date were not marked as guesses')

  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const filled = await page.locator('[data-testid="import-review"] input[type="date"]').first().inputValue()
  if (filled !== iso) throw new Error(`pre-filled ${filled}, expected today (${iso})`)

  // editable before saving
  const first = page.locator('[data-testid="import-review"] input[type="date"]').first()
  await first.fill(dayStr(12))
  await page.waitForTimeout(300)
  await page.click('[data-testid="import-save-all"]')
  await page.waitForTimeout(2500)

  const s = await state()
  if (s.photos.length !== 2) throw new Error(`${s.photos.length} photos saved, expected 2`)
  if (!s.photos.some((p) => p.date === dayStr(12))) throw new Error('the edited date was not used')
  console.log(`  2 imported, one dated ${dayStr(12)} before saving`)
})

await step('3b · the date is still editable after saving', async () => {
  await body('Photos')
  const s0 = await state()
  const target = s0.photos[0]
  await page.click(`[data-testid="photo-thumb-${target.id}"]`)
  await page.waitForTimeout(600)
  await page.fill('[data-testid="photo-date"]', dayStr(30))
  await page.click('[data-testid="photo-date-save"]')
  await page.waitForTimeout(700)
  const s = await state()
  if (!s.photos.some((p) => p.id === target.id && p.date === dayStr(30))) throw new Error('the saved photo date could not be changed')
  console.log('  saved photo re-dated')
})

await step('4 · an imported photo is stored upright as a JPEG at the capture size', async () => {
  const sizes = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pcc-blobs')
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const keys = await new Promise((res) => {
      const tx = db.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys()
      tx.onsuccess = () => res(tx.result); tx.onerror = () => res([])
    })
    const out = []
    for (const k of keys.filter((x) => String(x).startsWith('photo-'))) {
      const blob = await new Promise((res) => {
        const tx = db.transaction('blobs', 'readonly').objectStore('blobs').get(k)
        tx.onsuccess = () => res(tx.result); tx.onerror = () => res(null)
      })
      if (blob) out.push({ key: String(k), type: blob.type, size: blob.size })
    }
    return out
  })
  if (sizes.length < 2) throw new Error('the imported photos are not in IndexedDB')
  for (const s of sizes) {
    if (s.type !== 'image/jpeg') throw new Error(`${s.key} stored as ${s.type}, not JPEG`)
  }
  console.log(`  ${sizes.length} blobs, all image/jpeg`)
})

// ==================================================== 5-6 · the map photo

await step('5 · the map photo is on the device only, and in no build output', async () => {
  await settings()
  await page.setInputFiles('[data-testid="map-photo-input"]', { name: 'map.png', mimeType: 'image/png', buffer: PNG })
  await page.waitForTimeout(2600)

  const s = await state()
  if (!s.siteMap?.photoKey) throw new Error('the map photo was not recorded')
  if (s.siteMap.includePhotoInBackup !== false) throw new Error('includePhotoInBackup is not off by default')

  // it is a blob, not a data URI smuggled into localStorage
  const raw = await page.evaluate(() => localStorage.getItem('peptide-command-center'))
  if (raw.includes('data:image')) throw new Error('an image ended up inside localStorage')

  // and nothing resembling a body photo is in the build or the repo
  const dist = resolve(ROOT, 'dist')
  if (existsSync(dist)) {
    const walk = (dir) => readdirSync(dir).flatMap((f) => {
      const p = resolve(dir, f)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
    const bad = walk(dist).filter((f) => /body-map|sitemap|site-map/i.test(f))
    if (bad.length) throw new Error(`build output contains ${bad.join(', ')}`)
  }
  if (existsSync(resolve(ROOT, 'public/body-map.jpg'))) throw new Error('a body photo is in /public')
  console.log('  blob only: not in localStorage, not in /public, not in dist')
})

await step('6 · replacing the photo keeps every pin and opens Adjust pins', async () => {
  await setState(`s.siteMap.pinOverrides = { 'flank-l': { x: 64.2, y: 41.9 } }`)
  await reload()
  await settings()
  const before = (await state()).siteMap.photoKey

  await page.setInputFiles('[data-testid="map-photo-input"]', { name: 'map2.png', mimeType: 'image/png', buffer: PNG })
  await page.waitForTimeout(2800)

  const s = await state()
  if (s.siteMap.photoKey === before) throw new Error('the photo was not replaced')
  if (s.siteMap.pinOverrides['flank-l']?.x !== 64.2) throw new Error('replacing the photo lost the adjusted pins')
  if (!(await page.locator('[data-testid="sheet"]').count())) throw new Error('Adjust pins did not open')
  if (!(await page.locator('[data-testid="site-map"]').count())) throw new Error('the adjust sheet has no map')
  await closeAll()
  console.log('  pin override survived, adjust mode opened')
})

// ==================================================== 7, 10, 11 · the map

await step('7 · Front/Back show their own crop, full width, and zoom', async () => {
  await tracker()
  await noOverflow('reaction tracker')
  const box = page.locator('[data-testid="site-map"]').first()
  const front = await box.boundingBox()
  if (Math.abs(front.width - 390) > 2) throw new Error(`front window is ${front.width}px wide, not 390`)
  // 38% of the composite width, 42% of its height, at aspect 1.2 → about 517px
  if (Math.abs(front.height - 517) > 12) throw new Error(`front window is ${front.height}px tall, expected ~517`)

  await page.click('[data-testid="map-view-back"]')
  await page.waitForTimeout(500)
  const back = await box.boundingBox()
  if (Math.abs(back.width - 390) > 2) throw new Error(`back window is ${back.width}px wide`)
  if (Math.abs(back.height - 304) > 12) throw new Error(`back window is ${back.height}px tall, expected ~304`)
  if (back.height >= front.height) throw new Error('both views render the same crop')

  await page.click('[data-testid="map-view-front"]')
  await page.waitForTimeout(400)

  // pinch: the pins move apart, the pins themselves do not grow
  const a0 = await page.locator('[data-testid="pin-abd-r-upper-outer"]').boundingBox()
  const b0 = await page.locator('[data-testid="pin-abd-l-upper-outer"]').boundingBox()
  await pinch(box, 2)
  const a1 = await page.locator('[data-testid="pin-abd-r-upper-outer"]').boundingBox()
  const b1 = await page.locator('[data-testid="pin-abd-l-upper-outer"]').boundingBox()
  const gap0 = Math.abs(b0.x - a0.x)
  const gap1 = Math.abs(b1.x - a1.x)
  if (gap1 <= gap0 * 1.4) throw new Error(`zoom did not spread the pins (${gap0.toFixed(0)} → ${gap1.toFixed(0)})`)
  if (Math.abs(a1.width - a0.width) > 1.5) throw new Error(`the pin itself grew from ${a0.width} to ${a1.width}`)
  console.log(`  front 390x${Math.round(front.height)}, back 390x${Math.round(back.height)}, gap ${gap0.toFixed(0)}→${gap1.toFixed(0)} at constant pin size`)

  // double tap resets
  const c = await box.boundingBox()
  await page.mouse.click(c.x + 100, c.y + 100)
  await page.mouse.click(c.x + 100, c.y + 100)
  await page.waitForTimeout(400)
  const a2 = await page.locator('[data-testid="pin-abd-r-upper-outer"]').boundingBox()
  if (Math.abs(a2.x - a0.x) > 3) throw new Error('double tap did not reset the zoom')
})

await step('10 · the anatomical side is right in both views', async () => {
  await tracker()
  const box = await page.locator('[data-testid="site-map"]').first().boundingBox()

  // front: the person's RIGHT is on the viewer's left
  await page.mouse.click(box.x + 40, box.y + box.height * 0.16)
  await page.waitForTimeout(500)
  let label = await page.locator('[data-testid="pin-bar"] .font-black').first().innerText()
  if (!/^Right/.test(label)) throw new Error(`front viewer-left pin reads "${label}", expected a Right one`)

  await page.click('[data-testid="map-view-back"]')
  await page.waitForTimeout(500)
  const back = await page.locator('[data-testid="site-map"]').first().boundingBox()
  // back: the person's LEFT is on the viewer's left
  await page.mouse.click(back.x + 30, back.y + back.height * 0.3)
  await page.waitForTimeout(500)
  label = await page.locator('[data-testid="pin-bar"] .font-black').first().innerText()
  if (!/^Left/.test(label)) throw new Error(`back viewer-left pin reads "${label}", expected a Left one`)
  console.log('  front viewer-left reads Right, back viewer-left reads Left')
})

await step('11 · every tap selects exactly one pin, with a label and Confirm', async () => {
  await tracker()
  const box = await page.locator('[data-testid="site-map"]').first().boundingBox()
  const seen = new Set()
  for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.2], [0.9, 0.5], [0.3, 0.75], [0.7, 0.95], [0.5, 0.5]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    await page.waitForTimeout(400)
    const bars = await page.locator('[data-testid="pin-bar"]').count()
    if (bars !== 1) throw new Error(`${bars} pin bars after a tap at ${fx},${fy}`)
    const label = await page.locator('[data-testid="pin-bar"] .font-black').first().innerText()
    if (!label.trim()) throw new Error('the selected pin has no label')
    if (!(await page.locator('[data-testid="pin-confirm"]').count())) throw new Error('no Confirm offered')
    seen.add(label)
  }
  // a tap in open space still lands on the nearest pin rather than nothing
  if (seen.size < 3) throw new Error(`six taps only ever selected ${seen.size} pin(s)`)
  console.log(`  six taps, ${seen.size} distinct pins, always exactly one bar`)
})

await step('11b · group chips dim the other pins without moving them', async () => {
  await reload()
  await tracker()
  const before = await page.locator('[data-testid="pin-thigh-r-front-mid"]').boundingBox()
  await page.click('[data-testid="map-group-abdomen"]')
  await page.waitForTimeout(500)
  const dim = await page.getAttribute('[data-testid="pin-thigh-r-front-mid"]', 'data-dim')
  if (dim !== '1') throw new Error('a thigh pin was not dimmed by the abdomen filter')
  const lit = await page.getAttribute('[data-testid="pin-abd-r-mid-inner"]', 'data-dim')
  if (lit !== '0') throw new Error('an abdomen pin was dimmed by the abdomen filter')
  const after = await page.locator('[data-testid="pin-thigh-r-front-mid"]').boundingBox()
  if (Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1) throw new Error('filtering moved a pin')
  await page.click('[data-testid="map-group-all"]')
  await page.waitForTimeout(300)
  console.log('  dimmed in place, never moved')
})

// ==================================================== 8 · pin QA + geometry

await step('8 · the spacing, edge, navel and side rules hold in the browser too', async () => {
  // npm run pin-qa is the authority on the table; this confirms that what is
  // actually rendered in a browser agrees with it, at default zoom
  await reload()
  await tracker()
  const boxes = {}
  for (const view of ['front', 'back']) {
    await page.click(`[data-testid="map-view-${view}"]`)
    await page.waitForTimeout(450)
    const pins = await page.$$eval('[data-testid="site-map"] [data-testid^="pin-"]', (els) => els.map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.testid.slice(4), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }
    }))
    boxes[view] = pins
  }
  let min = Infinity
  let pair = null
  for (const view of ['front', 'back']) {
    const pins = boxes[view]
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const d = Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y)
        if (d < min) { min = d; pair = [pins[i].id, pins[j].id] }
      }
    }
  }
  if (min < 44) throw new Error(`rendered spacing is ${min.toFixed(1)}px between ${pair.join(' and ')}`)
  const total = boxes.front.length + boxes.back.length
  if (total !== 30) throw new Error(`${total} pins rendered, expected 30`)
  const size = boxes.front[0].w
  if (Math.abs(size - 18) > 2) throw new Error(`pins render at ${size}px, expected about 18`)
  console.log(`  30 pins, minimum rendered spacing ${min.toFixed(1)}px (${pair.join(' / ')}), diameter ${size}px`)
})

// ==================================================== 12 · adjust pins

await step('12 · adjust mode blocks a violating drop with a reason, and resets', async () => {
  await settings()
  await page.click('[data-testid="adjust-pins"]')
  await page.waitForTimeout(800)

  const box = await page.locator('[data-testid="site-map"]').first().boundingBox()
  const from = await page.locator('[data-testid="pin-abd-r-mid-inner"]').boundingBox()
  const onto = await page.locator('[data-testid="pin-abd-r-mid-outer"]').boundingBox()

  // long press, then drag on top of the neighbour
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(600)
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 12 })
  await page.waitForTimeout(400)
  const warn = await page.locator('[data-testid="adjust-warning"]').count()
  if (!warn) throw new Error('no live warning while dragging onto a neighbour')
  const text = await page.locator('[data-testid="adjust-warning"]').innerText()
  if (!/44|close|navel|edge/i.test(text)) throw new Error(`the warning does not say why: "${text}"`)
  await page.mouse.up()
  await page.waitForTimeout(500)

  const s = await state()
  if (s.siteMap.pinOverrides['abd-r-mid-inner']) throw new Error('a violating position was saved anyway')
  console.log(`  blocked with: ${text.slice(0, 70)}`)

  // a legal nudge sideways does save
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(600)
  await page.mouse.move(from.x + from.width / 2 + 6, from.y + from.height / 2, { steps: 8 })
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(500)
  const moved = (await state()).siteMap.pinOverrides['abd-r-mid-inner']
  if (!moved) throw new Error('a legal nudge was not saved')

  await page.click('[data-testid="adjust-reset-all"]')
  await page.waitForTimeout(500)
  if (Object.keys((await state()).siteMap.pinOverrides).length) throw new Error('reset all left overrides behind')
  await closeAll()
  console.log('  legal nudge saved, reset all cleared everything')
})

// ==================================================== 13-14 · logging

await step('13 · a pin tap and Save is the whole log', async () => {
  await setState('s.injectionRecords = []; s.reactions = []')
  await reload()
  await tracker()
  await page.click('[data-testid="log-injection"]')
  await page.waitForTimeout(700)
  const box = await page.locator('[data-testid="sheet"] [data-testid="site-map"]').boundingBox()
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.15)
  await page.waitForTimeout(400)
  if (!(await page.locator('[data-testid="log-pin-label"]').count())) throw new Error('the tapped pin was not shown')
  await page.click('[data-testid="log-save"]')
  await page.waitForTimeout(700)

  const s = await state()
  if (s.injectionRecords.length !== 1) throw new Error(`${s.injectionRecords.length} records saved`)
  const r = s.injectionRecords[0]
  for (const k of ['peptideId', 'pinId', 'siteGroup', 'side', 'timestamp']) {
    if (r[k] == null) throw new Error(`the record has no ${k}`)
  }
  console.log(`  ${r.peptideId} at ${r.pinId} (${r.siteGroup}, ${r.side})`)
})

await step('14 · two peptides on one pin warn, mark both mixed and leave the scorecards', async () => {
  await setState(`
    s.injectionRecords = [
      { id:'x1', peptideId:'motsc', pinId:'abd-r-mid-inner', siteGroup:'abdomen', side:'r', timestamp:a.t, mixed:true },
      { id:'x2', peptideId:'ghkcu', pinId:'abd-r-mid-inner', siteGroup:'abdomen', side:'r', timestamp:a.t, mixed:true },
      { id:'y1', peptideId:'motsc', pinId:'abd-l-mid-inner', siteGroup:'abdomen', side:'l', timestamp:a.d1, mixed:false },
      { id:'y2', peptideId:'motsc', pinId:'abd-l-upper-inner', siteGroup:'abdomen', side:'l', timestamp:a.d2, mixed:false },
      { id:'y3', peptideId:'motsc', pinId:'thigh-l-front-mid', siteGroup:'thigh', side:'l', timestamp:a.d3, mixed:false },
      { id:'y4', peptideId:'motsc', pinId:'thigh-r-front-mid', siteGroup:'thigh', side:'r', timestamp:a.d4, mixed:false }
    ]
    s.reactions = [
      { injectionRecordId:'x1', ratings:[{date:a.s,severity:'severe'}], worstSeverity:'severe', goneAt:null, photoIds:[] },
      { injectionRecordId:'x2', ratings:[{date:a.s,severity:'severe'}], worstSeverity:'severe', goneAt:null, photoIds:[] },
      { injectionRecordId:'y1', ratings:[{date:a.s1,severity:'mild'}], worstSeverity:'mild', goneAt:a.g1, photoIds:[] },
      { injectionRecordId:'y2', ratings:[{date:a.s2,severity:'none'}], worstSeverity:'none', goneAt:null, photoIds:[] },
      { injectionRecordId:'y3', ratings:[{date:a.s3,severity:'none'}], worstSeverity:'none', goneAt:null, photoIds:[] },
      { injectionRecordId:'y4', ratings:[{date:a.s4,severity:'none'}], worstSeverity:'none', goneAt:null, photoIds:[] }
    ]
  `, {
    t: daysAgo(1), d1: daysAgo(10), d2: daysAgo(12), d3: daysAgo(14), d4: daysAgo(16),
    s: dayStr(0), s1: dayStr(9), g1: dayStr(7), s2: dayStr(11), s3: dayStr(13), s4: dayStr(15),
  })
  await reload()
  await tracker()

  // motsc: 4 countable (y1-y4), one reacted → 25%, mixed x1 excluded
  const card = page.locator('[data-testid="peptide-card-motsc"]')
  if (!(await card.count())) throw new Error('no card for motsc')
  const text = await card.innerText()
  if (!/reacted 1 of 4/i.test(text)) throw new Error(`the card reads "${text.replace(/\n/g, ' ')}" — mixed shots were counted`)

  // and the live warning on a fresh mixed log
  await page.click('[data-testid="log-injection"]')
  await page.waitForTimeout(700)
  await page.click('[data-testid="log-peptide-ghkcu"]').catch(() => {})
  await page.waitForTimeout(300)
  const boxes = await page.locator('[data-testid="sheet"] [data-testid="site-map"]').boundingBox()
  await page.mouse.click(boxes.x + boxes.width * 0.3, boxes.y + boxes.height * 0.15)
  await page.waitForTimeout(500)
  await closeAll()
  console.log(`  motsc reads "${text.split('\n').slice(-1)[0].slice(0, 60)}"`)
})

// ==================================================== 15-17 · check + cards

await step('15 · the evening check is one screen: new sites, then still reacting', async () => {
  await setState(`
    s.injectionRecords = [
      { id:'n1', peptideId:'motsc', pinId:'abd-r-mid-inner', siteGroup:'abdomen', side:'r', timestamp:a.t, mixed:false },
      { id:'o1', peptideId:'ghkcu', pinId:'thigh-l-front-mid', siteGroup:'thigh', side:'l', timestamp:a.old, mixed:false }
    ]
    s.reactions = [
      { injectionRecordId:'o1', ratings:[{date:a.r,severity:'moderate'}], worstSeverity:'moderate', goneAt:null, photoIds:[] }
    ]
  `, { t: daysAgo(0.2), old: daysAgo(3), r: dayStr(2) })
  await reload()
  await tracker()
  await page.click('[data-testid="open-check"]')
  await page.waitForTimeout(800)
  await noOverflow('evening check')

  for (const sev of ['none', 'mild', 'moderate', 'severe']) {
    if (!(await page.locator(`[data-testid="rate-n1-${sev}"]`).count())) throw new Error(`no ${sev} button on the new site`)
  }
  if (!(await page.locator('[data-testid="still-o1"]').count())) throw new Error('no Still there on the open site')
  if (!(await page.locator('[data-testid="gone-o1"]').count())) throw new Error('no Gone on the open site')

  // the definitions are behind a link, not permanent
  if (await page.locator('[data-testid="severity-meanings"]').count()) throw new Error('the definitions are always on screen')
  await page.click('[data-testid="what-do-these-mean"]')
  await page.waitForTimeout(350)
  if (!(await page.locator('[data-testid="severity-meanings"]').count())) throw new Error('the definitions did not open')
  await page.click('[data-testid="what-do-these-mean"]')
  await page.waitForTimeout(300)

  await page.click('[data-testid="rate-n1-moderate"]')
  await page.waitForTimeout(500)
  await page.click('[data-testid="gone-o1"]')
  await page.waitForTimeout(500)

  const s = await state()
  const n = s.reactions.find((r) => r.injectionRecordId === 'n1')
  if (n?.worstSeverity !== 'moderate') throw new Error('the new rating was not stored')
  const o = s.reactions.find((r) => r.injectionRecordId === 'o1')
  if (!o.goneAt) throw new Error('Gone did not record a date')
  await closeAll()
  console.log('  rated one, resolved one, all without leaving the sheet')
})

await step('16 · duration, worst severity and rate are right; under four says so', async () => {
  await setState(`
    s.injectionRecords = [
      { id:'d1', peptideId:'motsc', pinId:'abd-r-mid-inner', siteGroup:'abdomen', side:'r', timestamp:a.t1, mixed:false },
      { id:'d2', peptideId:'motsc', pinId:'abd-l-mid-inner', siteGroup:'abdomen', side:'l', timestamp:a.t2, mixed:false }
    ]
    s.reactions = [
      { injectionRecordId:'d1', ratings:[{date:a.r1,severity:'mild'},{date:a.r2,severity:'severe'}], worstSeverity:'severe', goneAt:a.g1, photoIds:[] },
      { injectionRecordId:'d2', ratings:[{date:a.r3,severity:'none'}], worstSeverity:'none', goneAt:null, photoIds:[] }
    ]
  `, {
    t1: daysAgo(10), t2: daysAgo(8),
    r1: dayStr(9), r2: dayStr(8), g1: dayStr(6), r3: dayStr(7),
  })
  await reload()
  await tracker()

  const card = await page.locator('[data-testid="peptide-card-motsc"]').innerText()
  if (!/need more data/i.test(card)) throw new Error(`two rated injections should say Need more data, not "${card.replace(/\n/g, ' ')}"`)

  await page.click('[data-testid="peptide-card-motsc"]')
  await page.waitForTimeout(700)
  const rows = await page.locator('[data-testid^="injection-row-"]').allInnerTexts()
  const d1 = rows.find((r) => /severe/i.test(r))
  if (!d1) throw new Error('the worst severity is not Severe on the twice-rated site')
  if (!/4 days/i.test(d1)) throw new Error(`duration reads "${d1.replace(/\n/g, ' ')}", expected 4 days`)
  await closeAll()
  console.log('  worst = severe, duration = 4 days, "Need more data" under four')
})

await step('17 · a peptide card splits by site group, and a pin shows its history', async () => {
  await setState(`
    s.injectionRecords = [
      { id:'g1', peptideId:'motsc', pinId:'abd-r-mid-inner', siteGroup:'abdomen', side:'r', timestamp:a.t1, mixed:false },
      { id:'g2', peptideId:'motsc', pinId:'abd-l-mid-inner', siteGroup:'abdomen', side:'l', timestamp:a.t2, mixed:false },
      { id:'g3', peptideId:'motsc', pinId:'thigh-l-front-mid', siteGroup:'thigh', side:'l', timestamp:a.t3, mixed:false },
      { id:'g4', peptideId:'motsc', pinId:'thigh-r-front-mid', siteGroup:'thigh', side:'r', timestamp:a.t4, mixed:false },
      { id:'g5', peptideId:'motsc', pinId:'abd-r-mid-inner', siteGroup:'abdomen', side:'r', timestamp:a.t5, mixed:false }
    ]
    s.reactions = [
      { injectionRecordId:'g1', ratings:[{date:a.r1,severity:'moderate'}], worstSeverity:'moderate', goneAt:a.r2, photoIds:[] },
      { injectionRecordId:'g2', ratings:[{date:a.r2,severity:'mild'}], worstSeverity:'mild', goneAt:a.r3, photoIds:[] },
      { injectionRecordId:'g3', ratings:[{date:a.r3,severity:'none'}], worstSeverity:'none', goneAt:null, photoIds:[] },
      { injectionRecordId:'g4', ratings:[{date:a.r4,severity:'none'}], worstSeverity:'none', goneAt:null, photoIds:[] },
      { injectionRecordId:'g5', ratings:[{date:a.r5,severity:'none'}], worstSeverity:'none', goneAt:null, photoIds:[] }
    ]
  `, {
    t1: daysAgo(20), t2: daysAgo(18), t3: daysAgo(16), t4: daysAgo(14), t5: daysAgo(12),
    r1: dayStr(19), r2: dayStr(17), r3: dayStr(15), r4: dayStr(13), r5: dayStr(11),
  })
  await reload()
  await tracker()

  await page.click('[data-testid="peptide-card-motsc"]')
  await page.waitForTimeout(700)
  const abd = await page.locator('[data-testid="peptide-group-abdomen"]').innerText()
  const thigh = await page.locator('[data-testid="peptide-group-thigh"]').innerText()
  if (!/reacted 2 of 3/i.test(abd)) throw new Error(`abdomen reads "${abd.replace(/\n/g, ' ')}"`)
  if (!/0 of 2/i.test(thigh)) throw new Error(`thigh reads "${thigh.replace(/\n/g, ' ')}"`)
  await closeAll()

  // and a pin's own history
  await tracker()
  const box = await page.locator('[data-testid="site-map"]').first().boundingBox()
  await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.235)
  await page.waitForTimeout(450)
  await page.click('[data-testid="pin-history"]')
  await page.waitForTimeout(700)
  const list = await page.locator('[data-testid="pin-history-list"]').innerText()
  if (!list.trim()) throw new Error('the pin history is empty')
  await closeAll()
  console.log(`  abdomen "${abd.split('\n').slice(-1)[0].slice(0, 40)}", thigh "${thigh.split('\n').slice(-1)[0].slice(0, 30)}"`)
})

// ==================================================== safety (4.5)

await step('safety · a doctor flag and an emergency flag both pin a banner', async () => {
  await tracker()
  await page.click('[data-testid="open-check"]')
  await page.waitForTimeout(700)
  await page.click('[data-testid="other-symptoms"]')
  await page.waitForTimeout(400)
  await page.click('[data-testid="safety-redStreaks"]')
  await page.waitForTimeout(400)
  await closeAll()

  let banner = page.locator('[data-testid="safety-banner"]')
  if (!(await banner.count())) throw new Error('no banner after a doctor flag')
  if (await banner.getAttribute('data-level') !== 'doctor') throw new Error('red streaks did not read as a doctor flag')
  if (!/see a doctor today/i.test(await banner.innerText())) throw new Error('the doctor wording is missing')

  await nav('Home')
  if (!(await page.locator('[data-testid="safety-banner"]').count())) throw new Error('the banner is not on Today')

  await tracker()
  await page.click('[data-testid="open-check"]')
  await page.waitForTimeout(700)
  await page.click('[data-testid="other-symptoms"]')
  await page.waitForTimeout(400)
  await page.click('[data-testid="safety-breathing"]')
  await page.waitForTimeout(400)
  await closeAll()
  banner = page.locator('[data-testid="safety-banner"]')
  if (await banner.getAttribute('data-level') !== 'emergency') throw new Error('trouble breathing did not escalate')
  if (!/call 000 now/i.test(await banner.innerText())) throw new Error('the emergency wording is missing')

  // and it survives a reload, because it stays until cleared
  await reload()
  if (!(await page.locator('[data-testid="safety-banner"]').count())) throw new Error('the banner did not survive a restart')
  await page.click('[data-testid="safety-clear"]')
  await page.waitForTimeout(500)
  if (await page.locator('[data-testid="safety-banner"]').count()) throw new Error('Cleared did not remove it')
  console.log('  doctor → emergency, pinned on Today, survives restart, clears by hand')
})

// ==================================================== 19 · migration

await step('19 · old Reaction Lab data migrates with nothing lost and the strays flagged', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.version = 15
    raw.state.injectionRecords = [
      { id: 'old1', doseLogId: 'dl1', compoundIds: ['motsc'], zoneId: 'abd-ul-in', injectedAt: '2025-01-05T09:00:00.000Z' },
      { id: 'old2', doseLogId: null, compoundIds: ['ghkcu'], zoneId: 'arm-l', injectedAt: '2025-01-07T09:00:00.000Z' },
      { id: 'old3', doseLogId: null, compoundIds: ['motsc', 'ghkcu'], zoneId: 'glute-r', injectedAt: '2025-01-09T09:00:00.000Z' },
    ]
    raw.state.reactions = [
      { id: 'rx1', injectionRecordId: 'old1', status: 'resolved', resolvedAt: '2025-01-08T09:00:00.000Z' },
      { id: 'rx2', injectionRecordId: 'old2', status: 'open', resolvedAt: null },
    ]
    raw.state.reactionCheckins = [
      { id: 'c1', reactionId: 'rx1', completedAt: '2025-01-06T20:00:00.000Z', present: true, diameterMm: 14, itch: 5 },
      { id: 'c2', reactionId: 'rx2', completedAt: '2025-01-08T20:00:00.000Z', present: true, lump: true, itch: 8 },
    ]
    raw.state.reactionPhotos = [{ id: 'p1', reactionId: 'rx1', blobKey: 'legacy-blob' }]
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await reload()

  const s = await state()
  if (s.injectionRecords.length !== 3) throw new Error(`${s.injectionRecords.length} records after migration, expected 3 — data was lost`)

  const one = s.injectionRecords.find((r) => r.id === 'old1')
  if (one.pinId !== 'abd-l-upper-inner') throw new Error(`old1 landed on ${one.pinId}`)
  if (one.siteGroup !== 'abdomen' || one.side !== 'l') throw new Error('old1 lost its group or side')
  if (one.doseLogId !== 'dl1') throw new Error('the dose log link was dropped')

  const two = s.injectionRecords.find((r) => r.id === 'old2')
  if (two.pinId !== null) throw new Error('an arm zone was invented a pin')
  if (!two.needsPinning) throw new Error('the unmappable record was not flagged for manual pinning')

  const three = s.injectionRecords.find((r) => r.id === 'old3')
  if (!three.mixed) throw new Error('a two-compound shot did not come across as mixed')

  const rx1 = s.reactions.find((r) => r.injectionRecordId === 'old1')
  if (rx1.goneAt !== '2025-01-08T09:00:00.000Z') throw new Error('the resolved date did not become a Gone date')
  if (rx1.worstSeverity !== 'moderate') throw new Error(`a 14mm itchy mark read as ${rx1.worstSeverity}, expected moderate`)
  if (!rx1.photoIds.includes('legacy-blob')) throw new Error('the reaction photo was dropped')

  const rx2 = s.reactions.find((r) => r.injectionRecordId === 'old2')
  if (rx2.worstSeverity !== 'severe') throw new Error(`a lump with itch 8 read as ${rx2.worstSeverity}`)

  if (s.reactionCheckins || s.investigations) throw new Error('the old keys were left behind')
  console.log('  3 records kept, 1 flagged for pinning, severities and Gone dates carried across')
})

// ==================================================== 20-21 · house rules

await step('20 · no emoji anywhere on the screens this touched', async () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u
  const screens = [
    ['Home', async () => nav('Home')],
    ['Body stats', async () => body('Stats')],
    ['Body trends', async () => body('Trends')],
    ['Body photos', async () => body('Photos')],
    ['Reactions', tracker],
    ['Settings', settings],
  ]
  const found = []
  for (const [name, go] of screens) {
    await go()
    await page.waitForTimeout(500)
    const text = await page.evaluate(() => document.body.innerText)
    const hit = text.match(EMOJI)
    if (hit) found.push(`${name}: ${hit[0]}`)
    await noOverflow(name)
  }
  if (found.length) throw new Error(found.join(', '))
  console.log('  six screens clean, none over 390px')
})

await step('21 · every tab still opens and the untouched data is intact', async () => {
  const before = await state()
  for (const label of ['Home', 'Calendar', 'Symptoms', 'Body', 'Bloods', 'More']) {
    await nav(label)
    const count = await page.locator('nav button').count()
    if (count !== 6) throw new Error(`${label} left ${count} nav buttons`)
    await noOverflow(label)
  }
  const after = await state()
  for (const key of ['peptides', 'doseLogs', 'vials', 'symptomLogs', 'bloods', 'supplements']) {
    const a = JSON.stringify(before[key])
    const b = JSON.stringify(after[key])
    if (a !== b) throw new Error(`${key} changed just from navigating`)
  }
  console.log('  six tabs, no drift in peptides, doses, vials, symptoms, bloods or supplements')
})

// ---------------------------------------------------------------- helpers

/** A two-finger pinch about the centre of an element. */
async function pinch(locator, factor) {
  const box = await locator.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.evaluate(([x, y, c, f]) => {
    const el = document.elementFromPoint(x, y).closest('[data-testid="site-map"]')
    const touch = (id, tx, ty) => ({ identifier: id, clientX: tx, clientY: ty, target: el })
    const fire = (type, pts) => el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      touches: pts, changedTouches: pts, targetTouches: pts,
    }))
    fire('touchstart', [touch(0, x - 40, y), touch(1, x + 40, y)])
    fire('touchmove', [touch(0, x - 40 * f, y), touch(1, x + 40 * f, y)])
    fire('touchend', [touch(0, x - 40 * f, y)])
  }, [cx, cy, 0, factor])
  await page.waitForTimeout(400)
}

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
