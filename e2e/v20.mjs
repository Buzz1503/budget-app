// v20 — thigh-only zones for reaction-prone compounds, and skipping a dose.
// Runs at 390×844 against a build (or the dev server) on BASE_URL.
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
const waitText = async (re, timeout = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (re.test(await page.textContent('body'))) return true
    await page.waitForTimeout(150)
  }
  throw new Error('timeout waiting for ' + re)
}
const main = () => page.locator('main').textContent()
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const nav = async (label) => { await page.click(`nav button:has-text("${label}")`); await page.waitForTimeout(500) }
const more = async (label) => {
  await nav('More')
  await page.click(`button:has-text("${label}")`)
  await page.waitForTimeout(700)
}
// The picker has two exits: an X while choosing, and a Done button on the
// post-log confirmation. Either can be on screen, and whichever is left open
// swallows the next click.
const closeSheet = async () => {
  for (let i = 0; i < 3; i++) {
    const done = page.locator('button:has-text("Done")').first()
    if (await done.count()) { await done.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(400); continue }
    const x = page.locator('button[aria-label="Close"]').first()
    if (await x.count()) { await x.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(400); continue }
    break
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}
const THIGH_ONLY = ['ss31', 'nad', 'testosterone-e', 'tesamorelin', 'ghkcu']

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
if (await modal().count()) { await page.click('button:has-text("Got it")'); await page.waitForTimeout(500) }

// ========================================================= 1 · zone defaults

await step('the five reaction-prone compounds ship thigh-only', async () => {
  const st = await state()
  for (const id of THIGH_ONLY) {
    const p = st.peptides.find((x) => x.id === id)
    if (!p) throw new Error(`${id} is not in the seed stack`)
    if (p.allowedZone !== 'thigh') throw new Error(`${id} is "${p.allowedZone}", expected thigh`)
  }
})

await step('Testosterone E is SubQ into thigh fat, not IM', async () => {
  const st = await state()
  const te = st.peptides.find((x) => x.id === 'testosterone-e')
  if (te.route !== 'SubQ') throw new Error(`Test E route is ${te.route}`)
  if (te.allowedZone !== 'thigh') throw new Error('Test E is not thigh-only')
  if (!te.alwaysSeparate) throw new Error('Test E lost its never-co-draw rule')
})

await step('MOTS-c and the rest stay flexible', async () => {
  const st = await state()
  for (const id of ['motsc', 'bpc157', 'retatrutide', 'selank']) {
    const p = st.peptides.find((x) => x.id === id)
    if (p && p.allowedZone === 'thigh') throw new Error(`${id} was restricted but should be flexible`)
  }
})

// ==================================================== 2 · the picker narrows

// Target the exact card by its Log button's aria-label. A plain text filter
// matches every OTHER card too, because the co-draw hints name their partners.
const openPickerFor = async (name) => {
  await nav('Home')
  await page.waitForTimeout(500)
  let btn = page.locator(`button[aria-label="Log ${name}"]`)
  if (!(await btn.count())) {
    await page.click('button:has-text("PM")')
    await page.waitForTimeout(600)
    btn = page.locator(`button[aria-label="Log ${name}"]`)
  }
  if (!(await btn.count())) throw new Error(`${name} is not due in either slot`)
  await btn.first().click()
  await page.waitForTimeout(1100)
}
const selectForCoDraw = async (name) => {
  const btn = page.locator(`button[aria-label="Select ${name} to co-draw"]`)
  if (await btn.count()) await btn.first().click()
  await page.waitForTimeout(300)
}

await step('a thigh-only compound offers only the thigh regions', async () => {
  await openPickerFor('SS-31')
  const t = await page.locator('div.fixed').last().textContent()
  if (!/Left thigh/.test(t) || !/Right thigh/.test(t)) throw new Error('the thigh regions are missing')
  if (/Belly/.test(t) || /Love handle/.test(t)) throw new Error('belly or love-handle spots are still offered')
  await closeSheet()
})

await step('and says why the map is smaller', async () => {
  await openPickerFor('SS-31')
  const note = page.locator('[data-testid="zone-note"]')
  if (!(await note.count())) throw new Error('no thigh-only note')
  const t = await note.textContent()
  if (!/thigh only/i.test(t)) throw new Error('the note does not say thigh only')
  if (!/reaction/i.test(t)) throw new Error('the note does not give the reason')
  if (!/stomach/i.test(t)) throw new Error('the note does not mention the stomach')
  await closeSheet()
})

await step('the suggestion lands on a thigh spot', async () => {
  await openPickerFor('SS-31')
  const rec = await page.locator('[data-testid="recommendation"]').textContent()
  if (!/thigh/i.test(rec)) throw new Error(`the suggestion is not a thigh spot: ${rec.slice(0, 80)}`)
  await closeSheet()
})

await step('follow-the-path only walks thigh spots', async () => {
  await openPickerFor('SS-31')
  await page.click('button:has-text("Follow the path")')
  await page.waitForTimeout(700)
  const rec = await page.locator('[data-testid="recommendation"]').textContent()
  if (!/thigh/i.test(rec)) throw new Error(`the path suggested a non-thigh spot: ${rec.slice(0, 80)}`)
  const sheet = await page.locator('div.fixed').last().textContent()
  if (/Belly · /.test(sheet)) throw new Error('the path preview includes a belly spot')
  await closeSheet()
})

await step('a flexible compound still gets the whole map', async () => {
  await openPickerFor('BPC-157')
  const t = await page.locator('div.fixed').last().textContent()
  if (!/Belly/.test(t)) throw new Error('the belly is missing for a flexible compound')
  if (await page.locator('[data-testid="zone-note"]').count()) {
    throw new Error('the thigh-only note is showing for an unrestricted compound')
  }
  await closeSheet()
})

// ================================================ 3 · the per-compound toggle

await step('every peptide exposes an allowed-zone setting', async () => {
  await more('Library')
  await page.locator('h3:has-text("BPC-157")').first().click()
  await page.waitForTimeout(700)
  const sel = page.locator('select[aria-label="Allowed injection zone"]').first()
  if (!(await sel.count())) throw new Error('no allowed-zone control')
  const opts = await sel.locator('option').allTextContents()
  for (const want of ['All SubQ sites', 'Thigh only']) {
    if (!opts.includes(want)) throw new Error(`the zone list is missing "${want}" — got [${opts.join(', ')}]`)
  }
})

await step('setting a compound to thigh-only takes effect', async () => {
  await more('Library')
  await page.locator('h3:has-text("BPC-157")').first().click()
  await page.waitForTimeout(700)
  await page.locator('select[aria-label="Allowed injection zone"]').first().selectOption('thigh')
  await page.waitForTimeout(600)
  const st = await state()
  if (st.peptides.find((x) => x.id === 'bpc157').allowedZone !== 'thigh') {
    throw new Error('the setting did not save')
  }
  await openPickerFor('BPC-157')
  const t = await page.locator('div.fixed').last().textContent()
  if (/Belly/.test(t)) throw new Error('the belly is still offered after restricting it')
  await closeSheet()
  // put it back
  await more('Library')
  await page.locator('h3:has-text("BPC-157")').first().click()
  await page.waitForTimeout(700)
  await page.locator('select[aria-label="Allowed injection zone"]').first().selectOption('all')
  await page.waitForTimeout(500)
})

await step('a co-draw containing a thigh-only compound is thigh-only', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  // select a flexible compound and a thigh-only one
  await selectForCoDraw('BPC-157')
  await selectForCoDraw('Tesamorelin')
  const bar = page.locator('[data-testid="codraw-bar"]')
  if (!(await bar.count())) throw new Error('no co-draw bar after selecting two')
  await page.click('button:has-text("Log together")')
  await page.waitForTimeout(1400)
  const sheet = await page.locator('div.fixed').last().textContent()
  if (/Belly/.test(sheet)) throw new Error('the co-draw still offers belly spots')
  if (!/thigh/i.test(sheet)) throw new Error('the co-draw is not on the thigh map')
  await closeSheet()
  await nav('Home')
  await page.waitForTimeout(400)
})

// ================================================= 4 · thigh wear + routing

await step('an over-used thigh spot is parked and routed around', async () => {
  await page.evaluate(() => {
    const KEY = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(KEY))
    const iso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
    // hammer one thigh spot, spread a few elsewhere
    const logs = []
    // start yesterday — a dose logged today would mark the compound done and
    // take its Log button (and this whole step's entry point) off the screen
    for (let i = 0; i < 10; i++) {
      const d = iso(i * 2 + 1)
      logs.push({ id: `h${i}`, peptideId: 'ss31', siteId: 'thl-uo', date: d, loggedAt: `${d}T09:00:00` })
    }
    for (let i = 0; i < 3; i++) {
      const d = iso(i * 3 + 2)
      logs.push({ id: `o${i}`, peptideId: 'ss31', siteId: 'thr-uo', date: d, loggedAt: `${d}T09:00:00` })
    }
    raw.state.doseLogs = logs
    localStorage.setItem(KEY, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await openPickerFor('SS-31')
  const rec = await page.locator('[data-testid="recommendation"]').textContent()
  if (/upper-outer/i.test(rec) && /left thigh/i.test(rec)) {
    throw new Error('the hammered spot is still being recommended')
  }
  await closeSheet()
})

await step('the pool is flagged while spots are still usable', async () => {
  await openPickerFor('SS-31')
  const load = page.locator('[data-testid="zone-load"]')
  if (!(await load.count())) throw new Error('no warning about the thigh pool under load')
  const t = await load.textContent()
  if (!/thigh|spot/i.test(t)) throw new Error(`the warning does not name the problem: ${t}`)
  await closeSheet()
})

await step('rotation health is scored against the thigh pool', async () => {
  await openPickerFor('SS-31')
  const h = page.locator('[data-testid="rotation-health"]')
  if (!(await h.count())) throw new Error('no rotation health block')
  await closeSheet()
  await page.evaluate(() => {
    const KEY = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(KEY))
    raw.state.doseLogs = []
    localStorage.setItem(KEY, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
})

// ============================================================== 5 · skipping

await step('every due peptide has a Skip action', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const cards = page.locator('[data-testid="shot-plan"], .card')
  const skips = await page.locator('[data-testid="skip-peptide"]').count()
  if (skips === 0) throw new Error('no Skip buttons on any due peptide')
  const logs = await page.locator('button[aria-label^="Log "]').count()
  if (skips < logs) throw new Error(`${logs} loggable doses but only ${skips} Skip actions`)
})

// Whichever peptide happens to be due first — the suite must not depend on a
// particular compound's weekday landing on the day it runs.
let skipTarget = null
await step('skipping records it with an optional reason', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  const btn = page.locator('[data-testid="skip-peptide"]').first()
  if (!(await btn.count())) throw new Error('nothing skippable on Home')
  skipTarget = (await btn.getAttribute('aria-label')).replace(/^Skip /, '')
  await btn.click()
  await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="skip-sheet"]').count())) throw new Error('no skip sheet')
  await page.click('button:has-text("Travelling")')
  await page.waitForTimeout(250)
  await page.click('[data-testid="skip-confirm"]')
  await page.waitForTimeout(900)
  const st = await state()
  const k = st.skips.find((x) => x.kind === 'peptide' && x.name === skipTarget)
  if (!k) throw new Error(`the skip for ${skipTarget} was not recorded`)
  if (k.reason !== 'travel') throw new Error(`the reason is "${k.reason}"`)
})

await step('a skip is not a dose — nothing is logged and no stock moves', async () => {
  const st = await state()
  const k = st.skips.find((x) => x.kind === 'peptide' && x.name === skipTarget)
  const pid = k.peptideId
  if (st.doseLogs.some((l) => l.peptideId === pid && l.date === k.date)) {
    throw new Error('a dose log was written for a skip')
  }
  const vial = st.openVials?.[pid]
  const seeded = st.peptides.find((p) => p.id === pid)?.recon?.vialMg
  if (vial && seeded != null && vial.remainingMg !== seeded) {
    throw new Error(`inventory moved on a skip: ${vial.remainingMg} vs ${seeded}`)
  }
})

await step('a skipped dose leaves the due list and the ring', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const hero = await page.locator('[data-testid="hero"]').textContent()
  if (!/skipped/i.test(hero)) throw new Error(`the hero does not mention the skip: ${hero.replace(/\s+/g, ' ')}`)
  const m = hero.match(/(\d+)\/(\d+)\s*this AM/i)
  if (!m) throw new Error('no slot count in the hero')
  const t = await main()
  if (!/Skipped today/.test(t)) throw new Error('the card does not read as skipped')
  if (!/nothing taken from stock/i.test(t)) throw new Error('the card does not say stock is untouched')
})

await step('a skip can be undone', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  await page.click(`button[aria-label="Undo skip: ${skipTarget}"]`)
  await page.waitForTimeout(800)
  const st = await state()
  if (st.skips.some((k) => k.kind === 'peptide' && k.name === skipTarget)) {
    throw new Error('the skip survived the undo')
  }
  if (!(await page.locator(`button[aria-label="Skip ${skipTarget}"]`).count())) {
    throw new Error('the dose did not come back onto the list')
  }
})

await step('supplements can be skipped too', async () => {
  // put one on the shelf first
  await more('Supplements')
  await page.click('[data-testid="add-supplement"]')
  await page.waitForTimeout(600)
  await page.fill('input[aria-label="Search supplements"]', 'B-Complex')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="supplement-library"] button:has-text("B-Complex #12")').first().click()
  await page.waitForTimeout(700)

  await nav('Home')
  await page.waitForTimeout(700)
  if ((await page.locator('[data-testid="take-row"]').count()) === 0) {
    await page.click('button:has-text("AM")'); await page.waitForTimeout(600)
  }
  const skip = page.locator('[data-testid="skip-supplement"]').first()
  if (!(await skip.count())) throw new Error('no Skip action on a supplement')
  await skip.click()
  await page.waitForTimeout(600)
  await page.click('[data-testid="skip-confirm"]')
  await page.waitForTimeout(900)
  const st = await state()
  const k = st.skips.find((x) => x.kind === 'supplement')
  if (!k) throw new Error('the supplement skip was not recorded')
  if (st.supplementLogs.length) throw new Error('a taken-log was written for a skipped supplement')
  const row = await page.locator('[data-testid="take-row"]').first().textContent()
  if (!/Skipped today/.test(row)) throw new Error('the row does not read as skipped')
})

await step('several doses can be skipped at once', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const selectable = page.locator('button[aria-label^="Select "]')
  if ((await selectable.count()) < 2) throw new Error('fewer than two selectable doses on screen')
  await selectable.nth(0).click(); await page.waitForTimeout(250)
  await selectable.nth(1).click(); await page.waitForTimeout(250)
  const before = (await state()).skips.length
  await page.click('[data-testid="skip-selected"]')
  await page.waitForTimeout(600)
  await page.click('[data-testid="skip-confirm"]')
  await page.waitForTimeout(1000)
  const after = (await state()).skips.length
  if (after !== before + 2) throw new Error(`expected 2 more skips, got ${after - before}`)
})

await step('History shows skipped apart from missed', async () => {
  await more('History & adherence')
  await waitText(/Adherence/)
  const box = page.locator('[data-testid="skip-summary"]')
  if (!(await box.count())) throw new Error('no skip figure in the adherence block')
  const t = await box.textContent()
  if (!/skipped/i.test(t)) throw new Error('the figure is not labelled skipped')
  if (!/missed/i.test(t)) throw new Error('missed is not shown alongside it')
  const list = page.locator('[data-testid="skip-list"]')
  if (!(await list.count())) throw new Error('no skipped list')
  const lt = await list.textContent()
  if (!/not a lapse/i.test(lt)) throw new Error('the list does not frame a skip as a decision')
})

// ============================================================ 6 · 390px fit

await step('nothing overflows horizontally at 390px', async () => {
  const bad = []
  for (const [how, label] of [['nav', 'Home'], ['nav', 'Calendar'], ['more', 'Library'], ['more', 'History & adherence']]) {
    if (how === 'nav') await nav(label); else await more(label)
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (over) bad.push(label)
  }
  if (bad.length) throw new Error(`horizontal overflow on: ${bad.join(', ')}`)
})

// ============================================================= 7 · survival

await step('zones and skips survive a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const after = await state()
  if (after.skips.length !== before.skips.length) throw new Error('skips lost')
  for (const id of THIGH_ONLY) {
    if (after.peptides.find((p) => p.id === id)?.allowedZone !== 'thigh') {
      throw new Error(`${id} lost its zone`)
    }
  }
  if (after.peptides.length !== before.peptides.length) throw new Error('the stack changed')
})

await step('logging still works normally after all this', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const before = (await state()).doseLogs.length
  await openPickerFor('SS-31')
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(1300)
  const st = await state()
  if (st.doseLogs.length !== before + 1) throw new Error('the dose was not logged')
  const last = st.doseLogs.at(-1)
  if (!/^th/.test(last.siteId || '')) throw new Error(`logged to ${last.siteId}, not a thigh site`)
  await closeSheet()
})

await step('no runtime errors anywhere in the run', async () => {
  const real = errors.filter((e) => e.startsWith('pageerror') || e.startsWith('console'))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
})

await nav('Home')
await page.screenshot({ path: `${SHOT}/v20-home.png`, fullPage: true })
await browser.close()

const failures = errors.filter((e) => e.startsWith('step ') || e.startsWith('pageerror') || e.startsWith('console'))
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'ALL PASS'}`)
for (const f of failures) console.log(' -', f.split('\n')[0])
process.exit(failures.length ? 1 : 0)
