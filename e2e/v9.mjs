import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const waitText = async (re, timeout = 12000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (re.test(await page.textContent('body'))) return true
    await page.waitForTimeout(150)
  }
  throw new Error('timeout waiting for ' + re)
}
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const openPicker = async () => {
  await page.locator('button[aria-label^="Log "]').first().click()
  await waitText(/INJECT HERE/)
}
// v15 hides the full written list behind a toggle to quieten the map; these
// checks are about the words, so open it.
const openList = async () => {
  const more = modal().locator('button:has-text("spots in words")')
  if (await more.count()) { await more.first().click(); await page.waitForTimeout(400) }
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
await page.click('text=Got it')
// pin the AM slot: the suite assumes the seeded morning list, and the app
// otherwise opens on whichever slot the wall clock says
const amSlot = async () => { await page.click('button:has-text("AM")'); await page.waitForTimeout(500) }
await amSlot()

// ---------------- FIX 1 · the co-draw bar ----------------
await step('the whole "Log together" bar clears the bottom nav at 390px', async () => {
  // each click renames that card's button to "Deselect", so always take the first
  const circles = page.locator('button[aria-label^="Select "]')
  await circles.first().click()
  await page.waitForTimeout(300)
  await circles.first().click()
  await page.waitForTimeout(700)

  const geo = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="codraw-bar"]')
    const nav = document.querySelector('nav')
    if (!bar || !nav) return null
    const btn = [...bar.querySelectorAll('button')].find((b) => /Log together/.test(b.textContent))
    const br = bar.getBoundingClientRect()
    const nr = nav.getBoundingClientRect()
    const bt = btn.getBoundingClientRect()
    // what actually receives a tap in the middle of the button?
    const hit = document.elementFromPoint(bt.left + bt.width / 2, bt.top + bt.height / 2)
    return {
      barBottom: br.bottom, barTop: br.top, navTop: nr.top, navH: nr.height,
      btnLeft: bt.left, btnRight: bt.right, btnTop: bt.top, btnBottom: bt.bottom,
      barZ: +getComputedStyle(bar).zIndex, navZ: +getComputedStyle(nav).zIndex,
      vw: innerWidth, vh: innerHeight,
      hitText: (hit?.closest('button')?.textContent || hit?.textContent || '').trim(),
      label: btn.textContent.trim(),
    }
  })
  if (!geo) throw new Error('co-draw bar did not render')
  if (geo.barBottom > geo.navTop) throw new Error(`bar overlaps the nav (bar ends ${geo.barBottom}, nav starts ${geo.navTop})`)
  if (geo.barZ <= geo.navZ) throw new Error(`bar z-index ${geo.barZ} is not above the nav's ${geo.navZ}`)
  if (geo.btnLeft < 0 || geo.btnRight > geo.vw) throw new Error(`button runs off-screen (${geo.btnLeft}–${geo.btnRight} of ${geo.vw})`)
  if (geo.btnTop < 0 || geo.btnBottom > geo.vh) throw new Error('button is off the bottom of the screen')
  if (!/Log together/.test(geo.hitText)) throw new Error(`something covers the button — a tap hits "${geo.hitText}"`)
  if (!/Log together/.test(geo.label)) throw new Error(`label is "${geo.label}"`)
  console.log(`  bar ends ${Math.round(geo.barBottom)}, nav starts ${Math.round(geo.navTop)} (nav is ${Math.round(geo.navH)} tall)`)
})
await page.screenshot({ path: `${SHOT}/v9-01-codraw-bar.png` })

await step('nothing is hidden behind the bar or the nav', async () => {
  const clear = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="codraw-bar"]')
    const barTop = bar.getBoundingClientRect().top
    // scrolled to the bottom, the last due card must sit above the floating bar
    const main = document.querySelector('main')
    main.scrollIntoView(false)
    window.scrollTo(0, document.body.scrollHeight)
    const cards = [...document.querySelectorAll('main div.card')]
    const last = cards[cards.length - 1]
    return { lastBottom: last.getBoundingClientRect().bottom, barTop, padBottom: getComputedStyle(main).paddingBottom }
  })
  await page.waitForTimeout(300)
  if (clear.lastBottom > clear.barTop) {
    throw new Error(`last card (ends ${Math.round(clear.lastBottom)}) is under the bar (starts ${Math.round(clear.barTop)})`)
  }
  console.log(`  main padding-bottom ${clear.padBottom}`)
})

await page.click('button[aria-label="Clear selection"]')
await page.waitForTimeout(400)

// ---------------- FIX 2 · the injection map ----------------
await step('the map draws a landmarked body with a keep-clear zone', async () => {
  await openPicker()
  const svg = modal().locator('svg[aria-label^="Injection site map"]')
  const text = await svg.textContent()
  for (const want of ['belly button', 'waist', 'hip bone', 'knee']) {
    if (!text.includes(want)) throw new Error(`landmark "${want}" not labelled on the diagram`)
  }
  await modal().locator('button[aria-label="What do the colours mean?"]').first().click()
  await page.waitForTimeout(400)
  const body = await modal().textContent()
  if (!/Shaded ring = keep clear/.test(body)) throw new Error('keep-clear zone not explained')
  if (!/2 in \/ 5 cm/.test(body)) throw new Error('keep-clear distance not given')
  await modal().locator('button[aria-label="What do the colours mean?"]').first().click()
  await page.waitForTimeout(300)
})

await step('every spot is numbered with a plain-language location', async () => {
  await openList()
  const body = await modal().textContent()
  // all 16 SubQ spots listed, each with its description
  for (const want of [
    'Belly · upper-left', 'Belly · lower-right', 'Love handle · left',
    'Left thigh · upper-outer', 'Right thigh · lower-inner',
  ]) {
    if (!body.includes(want)) throw new Error(`missing spot label "${want}"`)
  }
  if (!/two finger-widths up and to the left of your belly button/i.test(body)) {
    throw new Error('belly spot has no finger-width description')
  }
  if (!/between hip and knee/i.test(body)) throw new Error('thigh spot has no hip-to-knee description')
  if (!/above your hip bone/i.test(body)) throw new Error('love handle has no hip-bone description')
  // numbers are printed on the targets themselves
  const nums = await modal().locator('svg[aria-label^="Injection site map"] text').allTextContents()
  for (const n of ['1', '8', '16']) {
    if (!nums.includes(n)) throw new Error(`spot number ${n} is not printed on the map`)
  }
})

await step('the recommendation is unmistakable and gives a reason', async () => {
  const body = await modal().textContent()
  if (!/inject here — spot \d+/i.test(body)) throw new Error('no "INJECT HERE" recommendation card')
  if (!/never used this one — fully rested|furthest from your recent shots/.test(body)) {
    throw new Error('recommendation gives no reason')
  }
  // and the same call-out is on the diagram
  const svgText = await modal().locator('svg[aria-label^="Injection site map"]').textContent()
  if (!/INJECT HERE/.test(svgText)) throw new Error('no INJECT HERE marker on the map itself')
})

await step('"when did I last inject" is answered in words', async () => {
  const body = await modal().textContent()
  if (!/No injections logged yet/.test(body)) throw new Error('no plain-words last-shot banner')
  if (!/never used/.test(body)) throw new Error('spots do not state when they were last used')
})

await step('region zoom enlarges one area at a time', async () => {
  await modal().locator('button:has-text("Left thigh")').first().click()
  await page.waitForTimeout(500)
  const spots = await modal().locator('svg[aria-label^="Injection site map"] g[role="button"]').count()
  if (spots !== 4) throw new Error(`left-thigh zoom shows ${spots} spots, expected 4`)
  await openList()
  const list = modal().locator('[data-testid="spot-list"]')
  if (await list.locator('> div').count() !== 4) throw new Error('the spot list did not narrow to the region')
  const listText = await list.textContent()
  if (!/Left thigh · upper-outer/.test(listText)) throw new Error('zoomed list lost its descriptions')
  if (/Belly · upper-left/.test(listText)) throw new Error('zoom still lists belly spots')
  const view = await modal().locator('svg[aria-label^="Injection site map"]').getAttribute('viewBox')
  if (view === '0 0 100 130') throw new Error('viewBox did not zoom')
  await page.screenshot({ path: `${SHOT}/v9-02-region-zoom.png` })
  await modal().locator('button:has-text("Whole body")').click()
  await page.waitForTimeout(400)
  const back = await modal().locator('svg[aria-label^="Injection site map"] g[role="button"]').count()
  if (back !== 16) throw new Error(`back on the whole body we should see 16 spots, saw ${back}`)
  await openList()
  if (await modal().locator('[data-testid="spot-list"] > div').count() !== 16) {
    throw new Error('the spot list did not return to all 16')
  }
})

await step('the "how do I inject here?" helper opens with plain steps', async () => {
  await modal().locator('button:has-text("How do I inject here?")').click()
  await page.waitForTimeout(500)
  const body = await modal().textContent()
  for (const want of [/Pinch a fold of skin/i, /45–90°/, /alcohol swab/i, /sharps bin/i]) {
    if (!want.test(body)) throw new Error(`how-to is missing ${want}`)
  }
})
await page.screenshot({ path: `${SHOT}/v9-03-site-picker.png` })

await step('picking a different spot updates the readout', async () => {
  await openList()
  await modal().locator('[data-testid="spot-list"] button:has-text("Right thigh · lower-inner")').first().click()
  await page.waitForTimeout(400)
  const body = await modal().textContent()
  if (!/Your pick/.test(body) || !/Right thigh · lower-inner/.test(body)) throw new Error('selection readout did not update')
  if (!/Log here — Right thigh · lower-inner/.test(body)) throw new Error('confirm button did not follow the selection')
})

await step('logging confirms in words and names the next spot', async () => {
  await modal().locator('button:has-text("Log here —")').click()
  await waitText(/Logged — /)
  const body = await modal().textContent()
  if (!/Logged — Right thigh · lower-inner/.test(body)) throw new Error('confirmation does not name the spot')
  if (!/Next time we'll steer you to/.test(body)) throw new Error('no rotation hint after logging')
  const logged = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.doseLogs.slice(-1)[0])
  if (logged.siteId !== 'thr-li') throw new Error(`logged to ${logged.siteId}, expected thr-li`)
  await page.screenshot({ path: `${SHOT}/v9-04-confirmation.png` })
  await modal().locator('button:has-text("Done")').click()
  await page.waitForTimeout(500)
})

await step('the next visit reports the last shot in plain words', async () => {
  await openPicker()
  const body = await modal().textContent()
  if (!/Last shot: today — Right thigh · lower-inner/.test(body)) {
    throw new Error('last-shot banner does not report the previous injection')
  }
  if (!/used today/.test(body)) throw new Error('the used spot does not read "used today"')
  // and the suggestion has moved off it
  if (/INJECT HERE — SPOT 16/.test(body)) throw new Error('still recommending the spot just used')
})

// ---------------- usability pass ----------------
await step('term explanations open on tap', async () => {
  const term = modal().locator('button[aria-label="What does SubQ mean?"]')
  if (!await term.count()) throw new Error('SubQ is not tappable for an explanation')
  await term.first().click()
  await page.waitForTimeout(350)
  if (!/into the fat just under the skin/i.test(await modal().textContent())) {
    throw new Error('no plain-language explanation shown')
  }
  // tapping elsewhere must dismiss it rather than leaving it covering the page
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  if (/into the fat just under the skin/i.test(await modal().textContent())) {
    throw new Error('the explanation stayed open after Escape')
  }
})

await step('coach tips show once, then stay gone', async () => {
  let body = await modal().textContent()
  if (!/New to this\? Start with the green/.test(body)) throw new Error('map coach tip missing')
  await modal().locator('[data-coach="site-map"] button[aria-label="Dismiss tip"]').click()
  await page.waitForTimeout(500)
  if (/New to this\? Start with the green/.test(await modal().textContent())) {
    throw new Error('coach tip did not dismiss')
  }
  // close, reload, and it must not come back
  await modal().locator('button[aria-label="Close"]').click()
  await page.waitForTimeout(300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await openPicker()
  body = await modal().textContent()
  if (/New to this\? Start with the green/.test(body)) throw new Error('coach tip came back after reload')
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.coachMarks)
  if (!seen['site-map']) throw new Error('coach mark not persisted')
  await modal().locator('button[aria-label="Close"]').click()
})

await step('the Home coach tip points at the Log button and dismisses', async () => {
  await page.waitForTimeout(400)
  const tip = page.locator('[data-coach="log-button"]')
  if (!await tip.count()) throw new Error('no Log-button coach tip on Home')
  if (!/Tap the green/.test(await tip.textContent())) throw new Error('tip does not point at Log')
  await tip.locator('button[aria-label="Dismiss tip"]').click()
  await page.waitForTimeout(400)
  if (await page.locator('[data-coach="log-button"]').count()) throw new Error('Home tip did not dismiss')
})

// ---------------- IM map still works ----------------
await step('an IM peptide still gets the IM map, with its own how-to', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const te = raw.state.peptides.find((p) => p.id === 'testosterone-e')
    te.scheduleWeekdays = [0, 1, 2, 3, 4, 5, 6]
    te.frequency = 'daily'
    // v20 ships it SubQ; this step is about the IM map, so put it on that route
    te.route = 'IM'
    delete te.allowedZone
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await amSlot()
  await page.click('button[aria-label="Log Testosterone Enanthate"]')
  await waitText(/INJECT HERE/)
  const body = await modal().textContent()
  if (!/Into the muscle/.test(body)) throw new Error('IM route not stated in plain words')
  if (!/glute|shoulder|quad/i.test(body)) throw new Error('IM spots not offered')
  if (/Belly · upper-left/.test(body)) throw new Error('SubQ spots offered for an IM shot')
  await modal().locator('button:has-text("How do I inject here?")').click()
  await page.waitForTimeout(400)
  if (!/Relax the muscle/i.test(await modal().textContent())) throw new Error('IM how-to not shown')
  await modal().locator('button[aria-label="Close"]').click()
})

// ---------------- persistence ----------------
await step('everything still loads and persists', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!s.peptides?.length) throw new Error('peptides lost')
  if (!s.doseLogs?.some((l) => l.siteId === 'thr-li')) throw new Error('site log lost')
  if (!s.coachMarks?.['site-map']) throw new Error('coach marks lost')
  console.log(`  peptides ${s.peptides.length} · logs ${s.doseLogs.length}`)
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 220)))
await browser.close()
process.exit(errors.length ? 1 : 0)
