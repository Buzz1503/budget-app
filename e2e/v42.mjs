// v42 — tapping a pin on the site map.
//
// Every step uses real touch input (a touch-enabled context, touchscreen taps
// and CDP touch events), because the bug lived in the gap between touch and
// mouse: a tap arrives as touchstart, touchend and then a made-up mousedown,
// mouseup and click, and a mouse-only harness never sees the second half.
//
// Run at both phone sizes. The full-screen maps fit the crop to the space left
// over, so a narrower phone is a narrower map, and that is where taps missed.
import { chromium } from 'playwright'
import { deflateSync } from 'zlib'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

// a portrait PNG at the 1.2 aspect the pin table is authored against
function crc32(buf) {
  const t = crc32.t || (crc32.t = (() => {
    const a = new Int32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; a[n] = c }
    return a
  })())
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF]
  return (crc ^ -1) >>> 0
}
function makePng(w, h) {
  const stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * stride + 1 + x * 3
    raw[o] = (x / w * 255) | 0; raw[o + 1] = (y / h * 255) | 0; raw[o + 2] = 140
  }
  const chunk = (ty, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length)
    const td = Buffer.concat([Buffer.from(ty, 'ascii'), d])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td))
    return Buffer.concat([l, td, c])
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PNG = makePng(250, 300)

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}

async function open(W, H) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1400)
  const got = page.locator('button:has-text("Got it")')
  if (await got.count()) { await got.first().click().catch(() => {}); await page.waitForTimeout(400) }
  return { ctx, page }
}

const SCREENS = {
  tracker: {
    go: async (page) => {
      await page.tap('nav button[aria-label="Symptoms"]'); await page.waitForTimeout(600)
      await page.tap('[data-testid="symptom-tab-reactions"]'); await page.waitForTimeout(1000)
    },
    view: (v) => `[data-testid="map-view-${v}"]`,
    scrolls: true,
  },
  logonbody: {
    go: async (page) => { await page.tap('[data-testid="log-on-body"]'); await page.waitForTimeout(1000) },
    view: (v) => `[data-testid="lob-view-${v}"]`,
  },
  adjust: {
    go: async (page) => {
      await page.tap('nav button[aria-label="More"]'); await page.waitForTimeout(600)
      const tab = page.locator('button:has-text("Settings")')
      if (await tab.count()) { await tab.first().tap(); await page.waitForTimeout(700) }
      await page.locator('[data-testid="site-map-settings"]').scrollIntoViewIfNeeded()
      await page.setInputFiles('[data-testid="map-photo-input"]', { name: 'm.png', mimeType: 'image/png', buffer: PNG })
      await page.waitForTimeout(3000)
    },
    view: (v) => `[data-testid="adjust-view-${v}"]`,
  },
}

/** The id of the one selected pin, or the list if there is not exactly one. */
const selectedIds = (page) => page.$$eval(
  '[data-testid="site-map"] [data-testid^="pin-"][data-selected="1"]',
  (els) => els.map((e) => e.dataset.testid.slice(4)),
)
const pinIds = (page) => page.$$eval(
  '[data-testid="site-map"] [data-testid^="pin-"]',
  (els) => els.map((e) => e.dataset.testid.slice(4)),
)
const centre = async (page, id) => {
  const b = await page.locator(`[data-testid="pin-${id}"]`).boundingBox({ timeout: 2500 })
  return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const spreadOf = async (page) => {
  const a = await centre(page, 'abd-r-upper-outer'); const b = await centre(page, 'abd-l-upper-outer')
  return Math.round(Math.abs(b.x - a.x))
}
const pinch = async (page, factor) => {
  const box = await page.locator('[data-testid="site-map"]').boundingBox()
  await page.evaluate(([x, y, f]) => {
    const el = document.querySelector('[data-testid="site-map"]')
    const t = (id, tx, ty) => ({ identifier: id, clientX: tx, clientY: ty, target: el })
    const fire = (type, pts) => el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches: pts, changedTouches: pts, targetTouches: pts }))
    fire('touchstart', [t(0, x - 40, y), t(1, x + 40, y)])
    fire('touchmove', [t(0, x - 40 * f, y), t(1, x + 40 * f, y)])
    fire('touchend', [t(0, x - 40 * f, y)])
  }, [box.x + box.width / 2, box.y + box.height / 2, factor])
  await page.waitForTimeout(450)
}

// ============================================== 1 · every pin, at 1x, by touch

for (const [W, H] of [[390, 844], [375, 667]]) {
  for (const name of ['tracker', 'logonbody', 'adjust']) {
    await step(`1 · ${W}x${H} ${name}: every one of the 30 pins selects on a single tap`, async () => {
      const { ctx, page } = await open(W, H)
      try {
        await SCREENS[name].go(page)
        let tapped = 0
        for (const view of ['front', 'back']) {
          await page.tap(SCREENS[name].view(view)); await page.waitForTimeout(450)
          for (const id of await pinIds(page)) {
            // only the in-page map scrolls; the full-screen ones are fixed, and
            // scrolling a pin inside an overflow-hidden box would move the box
            if (SCREENS[name].scrolls) {
              await page.locator(`[data-testid="pin-${id}"]`).evaluate((el) => el.scrollIntoView({ block: 'center' }))
              await page.waitForTimeout(60)
            }
            const c = await centre(page, id)
            await page.touchscreen.tap(c.x, c.y)
            await page.waitForTimeout(220)
            const sel = await selectedIds(page)
            // 2 · exactly one selected, and it is this one: the previous
            // selection cleared and the new one took
            if (sel.length !== 1 || sel[0] !== id) throw new Error(`${view}: tapped ${id}, selected [${sel.join(',') || 'nothing'}]`)
            tapped++
          }
        }
        if (tapped !== 30) throw new Error(`only ${tapped} of 30 pins were tapped`)
      } finally { await ctx.close() }
    })
  }
}

// ======================================== 3 · zoomed in: select, and keep the zoom

await step('3 · zoomed in, a tap selects the pin and does not reset the zoom', async () => {
  const { ctx, page } = await open(390, 844)
  try {
    await SCREENS.logonbody.go(page)
    const flat = await spreadOf(page)
    await pinch(page, 2.2)
    const zoomed = await spreadOf(page)
    if (zoomed < flat * 1.5) throw new Error(`pinch did not zoom (${flat} -> ${zoomed})`)

    const box = await page.locator('[data-testid="site-map"]').boundingBox()
    const onScreen = []
    for (const id of await pinIds(page)) {
      const c = await centre(page, id)
      if (c && c.x > box.x + 8 && c.x < box.x + box.width - 8 && c.y > box.y + 8 && c.y < box.y + box.height - 8) onScreen.push(id)
    }
    if (onScreen.length < 3) throw new Error(`only ${onScreen.length} pins on screen when zoomed`)

    for (const id of onScreen) {
      const c = await centre(page, id)
      await page.touchscreen.tap(c.x, c.y)
      await page.waitForTimeout(220)
      const sel = await selectedIds(page)
      if (sel.length !== 1 || sel[0] !== id) throw new Error(`zoomed: tapped ${id}, selected [${sel.join(',') || 'nothing'}]`)
      const now = await spreadOf(page)
      if (Math.abs(now - zoomed) > 2) throw new Error(`a tap on ${id} changed the zoom (${zoomed} -> ${now})`)
    }
    console.log(`  ${onScreen.length} pins tapped at ${(zoomed / flat).toFixed(1)}x, zoom held throughout`)
  } finally { await ctx.close() }
})

await step('3b · two quick taps on different pins while zoomed select both, in turn', async () => {
  const { ctx, page } = await open(390, 844)
  try {
    await SCREENS.logonbody.go(page)
    await pinch(page, 2.2)
    const box = await page.locator('[data-testid="site-map"]').boundingBox()
    const vis = []
    for (const id of await pinIds(page)) {
      const c = await centre(page, id)
      if (c && c.x > box.x + 8 && c.x < box.x + box.width - 8 && c.y > box.y + 8 && c.y < box.y + box.height - 8) vis.push({ id, c })
    }
    if (vis.length < 2) throw new Error('fewer than two pins on screen')
    // two pins that are well apart, tapped with no pause between them
    const [a, b] = [vis[0], vis[vis.length - 1]]
    await page.touchscreen.tap(a.c.x, a.c.y)
    await page.touchscreen.tap(b.c.x, b.c.y)
    await page.waitForTimeout(250)
    const sel = await selectedIds(page)
    if (sel.length !== 1 || sel[0] !== b.id) throw new Error(`the second quick tap on ${b.id} selected [${sel.join(',') || 'nothing'}]`)
  } finally { await ctx.close() }
})

await step('3c · a double tap on a zoomed map resets it', async () => {
  const { ctx, page } = await open(390, 844)
  try {
    await SCREENS.logonbody.go(page)
    const flat = await spreadOf(page)
    await pinch(page, 2.2)
    const box = await page.locator('[data-testid="site-map"]').boundingBox()
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await page.touchscreen.tap(x, y)
    await page.touchscreen.tap(x, y)
    await page.waitForTimeout(450)
    const back = await spreadOf(page)
    if (Math.abs(back - flat) > 3) throw new Error(`the map is at ${back}px spread, not the original ${flat}`)
  } finally { await ctx.close() }
})

// ============================================ 4 · the made-up mouse events

await step('4 · one tap produces no mouse events, so nothing can read it as a second tap', async () => {
  const { ctx, page } = await open(390, 844)
  try {
    await SCREENS.logonbody.go(page)
    await page.evaluate(() => {
      window.__ev = []
      const box = document.querySelector('[data-testid="site-map"]')
      for (const t of ['touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) {
        box.addEventListener(t, () => window.__ev.push(t), true)
      }
    })
    const c = await centre(page, 'abd-l-mid-inner')
    await page.touchscreen.tap(c.x, c.y)
    await page.waitForTimeout(300)
    const ev = await page.evaluate(() => window.__ev)
    if (ev.some((e) => e.startsWith('mouse') || e === 'click')) throw new Error(`the browser still sent ${ev.join(', ')}`)
    if (!ev.includes('touchend')) throw new Error('the tap produced no touchend at all')
  } finally { await ctx.close() }
})

await step('4b · a real mouse still works on a device that has one', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1400)
  const got = page.locator('button:has-text("Got it")')
  if (await got.count()) { await got.first().click().catch(() => {}); await page.waitForTimeout(400) }
  try {
    await page.click('[data-testid="log-on-body"]'); await page.waitForTimeout(1000)
    for (const id of ['abd-r-upper-inner', 'abd-l-mid-outer', 'thigh-r-front-lower']) {
      if (!(await page.locator(`[data-testid="pin-${id}"]`).count())) { await page.click('[data-testid="lob-view-front"]'); await page.waitForTimeout(300) }
      const c = await centre(page, id)
      await page.mouse.click(c.x, c.y)
      await page.waitForTimeout(220)
      const sel = await selectedIds(page)
      if (sel.length !== 1 || sel[0] !== id) throw new Error(`mouse: ${id} selected [${sel.join(',') || 'nothing'}]`)
    }
  } finally { await ctx.close() }
})

// ================================================ 5 · finger drift and drags

await step('5 · a tap with a little drift still selects; a real drag does not', async () => {
  const { ctx, page } = await open(390, 844)
  try {
    await SCREENS.logonbody.go(page)
    const cdp = await ctx.newCDPSession(page)
    const gesture = async (x, y, dx) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await page.waitForTimeout(40)
      for (let i = 1; i <= 3; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 3, y }] })
        await page.waitForTimeout(30)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(300)
    }
    const prime = await centre(page, 'abd-r-upper-inner')
    await page.touchscreen.tap(prime.x, prime.y); await page.waitForTimeout(250)

    const target = await centre(page, 'abd-l-mid-inner')
    await gesture(target.x, target.y, 10)
    let sel = await selectedIds(page)
    if (sel[0] !== 'abd-l-mid-inner') throw new Error(`a 10 px drift was not a tap (selected ${sel.join(',') || 'nothing'})`)

    await page.touchscreen.tap(prime.x, prime.y); await page.waitForTimeout(250)
    await gesture(target.x, target.y, 40)
    sel = await selectedIds(page)
    if (sel[0] !== 'abd-r-upper-inner') throw new Error(`a 40 px drag changed the selection to ${sel.join(',')}`)
  } finally { await ctx.close() }
})

await step('5b · long-press drag still moves one pin on Adjust pins, and taps still work around it', async () => {
  const { ctx, page } = await open(390, 844)
  try {
    await SCREENS.adjust.go(page)
    const cdp = await ctx.newCDPSession(page)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.siteMap.pinOverrides)

    // 1. a quick tap selects, and does not pick the pin up
    const a = await centre(page, 'abd-r-mid-inner')
    await page.touchscreen.tap(a.x, a.y); await page.waitForTimeout(250)
    if ((await selectedIds(page))[0] !== 'abd-r-mid-inner') throw new Error('a quick tap did not select in adjust mode')
    if (Object.keys(await store()).length) throw new Error('a quick tap moved a pin')

    // 2. a long press then a small legal drag moves exactly that pin
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] })
    await page.waitForTimeout(450)
    // Far enough to be delivered at all: Chromium withholds touchmove until a
    // finger leaves its own slop region, so an 8 px test drag never reaches the
    // page. 24 px sideways is still a legal spot — 50 px from every neighbour
    // and well clear of the navel.
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + i * 4, y: a.y }] })
      await page.waitForTimeout(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(400)
    const moved = await store()
    const keys = Object.keys(moved)
    if (keys.length !== 1 || keys[0] !== 'abd-r-mid-inner') throw new Error(`the drag saved [${keys.join(',') || 'nothing'}]`)

    // 3. a tap on a different pin straight afterwards still selects it
    const b = await centre(page, 'thigh-l-front-mid')
    await page.touchscreen.tap(b.x, b.y); await page.waitForTimeout(250)
    const sel = await selectedIds(page)
    if (sel.length !== 1 || sel[0] !== 'thigh-l-front-mid') throw new Error(`after a drag, a tap selected [${sel.join(',') || 'nothing'}]`)
  } finally { await ctx.close() }
})

// ================================================ 6 · feedback on touch

await step('6 · the pin lights up while the finger is down, and stays obviously selected after', async () => {
  const { ctx, page } = await open(390, 844)
  try {
    await SCREENS.logonbody.go(page)
    const cdp = await ctx.newCDPSession(page)
    const c = await centre(page, 'abd-l-upper-inner')
    const width = () => page.locator('[data-testid="pin-abd-l-upper-inner"]').evaluate((e) => Math.round(e.getBoundingClientRect().width))
    const base = await width()

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] })
    await page.waitForTimeout(200)
    const pressed = await page.locator('[data-testid="pin-abd-l-upper-inner"]').getAttribute('data-pressed')
    const heldWidth = await width()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(300)

    if (pressed !== '1') throw new Error('nothing marked the pin as pressed while the finger was down')
    if (heldWidth <= base) throw new Error(`the pin did not swell under the finger (${base} -> ${heldWidth})`)

    const sel = page.locator('[data-testid="pin-abd-l-upper-inner"]')
    if ((await sel.getAttribute('data-selected')) !== '1') throw new Error('the pin is not marked selected')
    if ((await sel.getAttribute('data-pressed')) !== '0') throw new Error('the pressed state stuck after release')
    const finalWidth = await width()
    if (finalWidth < heldWidth) throw new Error(`selected is smaller than pressed (${finalWidth} < ${heldWidth})`)
    const ring = await sel.locator('> div').first().evaluate((e) => getComputedStyle(e).borderTopWidth + ' ' + getComputedStyle(e).borderTopColor)
    if (!/^3px/.test(ring)) throw new Error(`the selected ring is "${ring}"`)
    console.log(`  ${base}px at rest, ${heldWidth}px pressed, ${finalWidth}px selected, ring ${ring}`)
  } finally { await ctx.close() }
})

await step('6b · letting go away from where the finger went down leaves nothing lit', async () => {
  const { ctx, page } = await open(390, 844)
  try {
    await SCREENS.logonbody.go(page)
    const cdp = await ctx.newCDPSession(page)
    const c = await centre(page, 'abd-r-upper-outer')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] })
    await page.waitForTimeout(80)
    for (let i = 1; i <= 4; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + i * 15, y: c.y }] })
      await page.waitForTimeout(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(300)
    const lit = await page.$$eval('[data-testid="site-map"] [data-pressed="1"]', (els) => els.length)
    if (lit) throw new Error(`${lit} pin(s) left in the pressed state`)
    if ((await selectedIds(page)).length) throw new Error('a drag selected a pin')
  } finally { await ctx.close() }
})

// ======================= 7 · nothing on top of what the map shares a screen with

await step('7 · selecting a pin never lets the map cover the pin bar or its buttons', async () => {
  for (const [W, H] of [[390, 844], [375, 667], [360, 640]]) {
    const { ctx, page } = await open(W, H)
    try {
      // some history, so the pin bar carries a warning and its Try button
      await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
        const now = Date.now()
        const [mine, other] = [raw.state.peptides[1].id, raw.state.peptides[2].id]
        const at = (h) => new Date(now - h * 3600e3).toISOString()
        raw.state.injectionRecords = [
          { id: 'a', peptideId: other, pinId: 'abd-l-mid-inner', siteGroup: 'abdomen', side: 'l', timestamp: at(20), mixed: false },
          { id: 'b', peptideId: mine, pinId: 'abd-r-upper-inner', siteGroup: 'abdomen', side: 'r', timestamp: at(40), mixed: false },
          { id: 'c', peptideId: other, pinId: 'thigh-l-front-mid', siteGroup: 'thigh', side: 'l', timestamp: at(60), mixed: false },
        ]
        raw.state.reactions = []
        localStorage.setItem('peptide-command-center', JSON.stringify(raw))
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('nav button'); await page.waitForTimeout(1400)
      const got = page.locator('button:has-text("Got it")')
      if (await got.count()) { await got.first().click().catch(() => {}); await page.waitForTimeout(400) }

      await page.locator('[data-testid="log-on-body"]').first().tap()
      await page.waitForTimeout(1000)
      const c = await centre(page, 'abd-l-mid-inner')
      await page.touchscreen.tap(c.x, c.y)
      await page.waitForTimeout(500)

      const r = await page.evaluate(() => {
        const map = document.querySelector('[data-testid="site-map"]').getBoundingClientRect()
        const bar = document.querySelector('[data-testid="lob-pin-bar"]').getBoundingClientRect()
        const log = document.querySelector('[data-testid="lob-log-here"]').getBoundingClientRect()
        const hit = (el) => {
          const b = el.getBoundingClientRect()
          const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
          return !!top && el.contains(top)
        }
        const buttons = [...document.querySelectorAll('[data-testid="lob-pin-bar"] button')]
        return {
          overlap: Math.round(map.bottom - bar.top),
          logReachable: hit(document.querySelector('[data-testid="lob-log-here"]')),
          buttons: buttons.length,
          unreachable: buttons.filter((b) => !hit(b)).length,
          bottomGap: Math.round(window.innerHeight - log.bottom),
        }
      })
      if (r.overlap > 0) throw new Error(`${W}x${H}: the map overlaps the pin bar by ${r.overlap}px`)
      if (!r.logReachable) throw new Error(`${W}x${H}: Log here is covered`)
      if (!r.buttons) throw new Error(`${W}x${H}: the warning has no Try button to test`)
      if (r.unreachable) throw new Error(`${W}x${H}: ${r.unreachable} button(s) in the pin bar are covered by the map`)
    } finally { await ctx.close() }
  }
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
