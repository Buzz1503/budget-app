// v30 — keyboard-safe sheets, and adding doses after the fact.
//
// Runs at 390×844 against a build on BASE_URL, with a simulated on-screen
// keyboard: window.visualViewport is replaced with one whose height actually
// shrinks, which is the only signal the app has that the bottom of the window
// is no longer on screen.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

// an iPhone 14 keyboard plus its accessory strip, in CSS pixels
const KEYBOARD = 336
const VISIBLE = 844 - KEYBOARD

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })

// The fake viewport has to be installed before any app code reads it.
await ctx.addInitScript(() => {
  let kb = 0
  const listeners = { resize: [], scroll: [] }
  const vv = {
    get height() { return window.innerHeight - kb },
    get width() { return window.innerWidth },
    get offsetTop() { return 0 },
    get offsetLeft() { return 0 },
    get pageTop() { return 0 },
    get scale() { return 1 },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn) },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn) },
  }
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true })
  window.__keyboard = (px) => {
    kb = px
    for (const fn of listeners.resize || []) fn()
  }
})

const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const sheet = () => page.locator('[data-testid="sheet"]').last()
const openKeyboard = async (px = KEYBOARD) => {
  await page.evaluate((n) => window.__keyboard(n), px)
  await page.waitForTimeout(500)
}
const closeKeyboard = async () => {
  await page.evaluate(() => window.__keyboard(0))
  await page.waitForTimeout(400)
}
// Sheets stack (a picker over a form over a day), and Escape dismisses one
// layer at a time by design — so getting back to a screen means peeling.
const closeAll = async () => {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(200)
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button:has-text("${label}")`)
  await page.waitForTimeout(500)
}
const more = async (id) => {
  await nav('More')
  await page.click(`[data-testid="more-${id}"]`)
  await page.waitForTimeout(700)
}
const stockRoom = async () => {
  await more('supplies')
  const t = page.locator('[data-testid="stock-view"] button[aria-label="Stock room"]')
  if (await t.count()) { await t.click(); await page.waitForTimeout(600) }
}
const iso = (d) => {
  const x = new Date()
  x.setDate(x.getDate() + d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('nav button')

// A protocol that started a month ago, so the days behind us were real days
// with real doses owed on them.
await step('seed: a protocol that has been running a month, nothing logged', async () => {
  await page.evaluate((start) => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.peptides = raw.state.peptides.map((p) => ({ ...p, startDate: start }))
    for (const k of Object.keys(raw.state.titration || {})) {
      raw.state.titration[k] = { ...raw.state.titration[k], levelStartDate: start }
    }
    raw.state.doseLogs = []
    raw.state.skips = []
    raw.state.supplementLogs = []
    raw.state.coachMarks = { 'wizard-offered': true, 'wizard-done': true }
    raw.state.settings = { ...raw.state.settings, disclaimerDismissed: true }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  }, iso(-30))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(600)
  const gotIt = page.locator('button:has-text("Got it")')
  if (await gotIt.count()) { await gotIt.first().click(); await page.waitForTimeout(500) }
  const s = await state()
  if (s.doseLogs.length !== 0) throw new Error('seed did not clear the logs')
})

// ---------------------------------------------------------------- FIX 1

await step('the stock search sheet stays above the keyboard', async () => {
  await stockRoom()
  await page.click('[data-testid="add-stock"]')
  await page.waitForTimeout(700)
  await page.click('input[aria-label="Search compounds"]')
  await openKeyboard()
  const box = await sheet().boundingBox()
  if (!box) throw new Error('no sheet')
  const bottom = box.y + box.height
  if (bottom > VISIBLE + 1) {
    throw new Error(`sheet runs to ${Math.round(bottom)}px, past the ${VISIBLE}px the keyboard leaves`)
  }
  console.log(`  sheet bottom ${Math.round(bottom)}px ≤ ${VISIBLE}px visible`)
})

await step('the search field is pinned, and stays on screen while results scroll', async () => {
  const field = page.locator('input[aria-label="Search compounds"]')
  const before = await field.boundingBox()
  await page.locator('[data-testid="sheet-body"]').last().evaluate((el) => { el.scrollTop = 400 })
  await page.waitForTimeout(300)
  const after = await field.boundingBox()
  if (!after) throw new Error('the search field scrolled out of the sheet')
  if (Math.abs(after.y - before.y) > 2) throw new Error('the search field moved when the list scrolled')
  if (after.y + after.height > VISIBLE) throw new Error('the search field is under the keyboard')
  console.log(`  field held at y=${Math.round(after.y)} through a 400px scroll`)
})

await step('at least four results are readable above the keyboard', async () => {
  await page.locator('[data-testid="sheet-body"]').last().evaluate((el) => { el.scrollTop = 0 })
  await page.fill('input[aria-label="Search compounds"]', 'a')
  await page.waitForTimeout(500)
  const rows = page.locator('[data-testid="stock-results"] > button')
  const n = await rows.count()
  let visible = 0
  for (let i = 0; i < Math.min(n, 12); i++) {
    const b = await rows.nth(i).boundingBox()
    if (b && b.y >= 0 && b.y + b.height <= VISIBLE) visible += 1
  }
  if (visible < 4) throw new Error(`only ${visible} of ${n} results fit above the keyboard`)
  console.log(`  ${visible} results fully visible above the keyboard`)
})

await step('the magnifying glass never sits on the typed text', async () => {
  const bad = await page.evaluate(() => {
    const out = []
    for (const input of document.querySelectorAll('input')) {
      const icon = input.parentElement?.querySelector('svg')
      if (!icon) continue
      const ib = icon.getBoundingClientRect()
      const nb = input.getBoundingClientRect()
      if (ib.width === 0) continue
      // the icon has to be inside the field's own left padding
      const pad = parseFloat(getComputedStyle(input).paddingLeft)
      if (ib.right > nb.left + pad + 0.5) out.push(`${input.getAttribute('aria-label') || input.placeholder}: icon ends ${Math.round(ib.right - nb.left)}px in, padding is ${Math.round(pad)}px`)
    }
    return out
  })
  if (bad.length) throw new Error(bad.join('; '))
})

await step('typing into the batch form keeps the field it is typing in on screen', async () => {
  await closeKeyboard()
  await page.locator('[data-testid="stock-results"] > button').first().click()
  await page.waitForTimeout(600)
  const field = page.locator('input[aria-label="Sealed expiry"]')
  await field.click()
  await openKeyboard()
  await page.waitForTimeout(700)
  const b = await field.boundingBox()
  if (!b) throw new Error('the field is not rendered')
  if (b.y + b.height > VISIBLE) throw new Error(`the focused field sits at ${Math.round(b.y + b.height)}px, under the keyboard`)
  console.log(`  focused field bottom ${Math.round(b.y + b.height)}px`)
  await closeKeyboard()
  await closeAll()
})

await step('every sheet with a field in it is sized against the keyboard, not the window', async () => {

  // the wizard's compound search — reached from either the intro or the
  // manage list, depending on whether a protocol already exists
  await more('wizard')
  await page.waitForTimeout(400)
  const add = page.locator('[data-testid="manage-add"]')
  if (await add.count()) await add.first().click()
  else await page.click('button:has-text("Start")').catch(() => {})
  await page.waitForTimeout(900)
  await openKeyboard()
  let box = await sheet().boundingBox()
  if (box && box.y + box.height > VISIBLE + 1) throw new Error(`wizard runs to ${Math.round(box.y + box.height)}px`)
  const wqField = page.locator('input[aria-label="Search compounds"]')
  if (!(await wqField.count())) throw new Error('never reached the wizard compound search')
  const wq = await wqField.boundingBox()
  if (wq && wq.y + wq.height > VISIBLE) throw new Error('the wizard search sits under the keyboard')
  console.log(`  wizard sheet ${Math.round(box.y + box.height)}px, search at ${Math.round(wq.y)}px`)
  await closeKeyboard()
  await closeAll()

  // the supplement picker
  await more('supplements')
  const addSupp = page.locator('[data-testid="add-supplement"]')
  if (await addSupp.count()) {
    await addSupp.first().click()
    await page.waitForTimeout(800)
    await openKeyboard()
    box = await sheet().boundingBox()
    if (box && box.y + box.height > VISIBLE + 1) throw new Error(`supplement sheet runs to ${Math.round(box.y + box.height)}px`)
    const sq = await page.locator('input[aria-label="Search supplements"]').boundingBox()
    if (sq && sq.y + sq.height > VISIBLE) throw new Error('the supplement search sits under the keyboard')
    await closeKeyboard()
    await closeAll()
  }
})

await step('the bottom nav gets out of the way while typing', async () => {
  await nav('Home')
  await openKeyboard()
  const opacity = await page.locator('nav').evaluate((el) => getComputedStyle(el).opacity)
  if (Number(opacity) > 0.05) throw new Error(`the nav is still at opacity ${opacity} over the keyboard`)
  await closeKeyboard()
  const back = await page.locator('nav').evaluate((el) => getComputedStyle(el).opacity)
  if (Number(back) < 0.95) throw new Error('the nav did not come back')
})

// ---------------------------------------------------------------- FIX 2

await step('a past day with nothing logged reads as missed, not as blank', async () => {
  await nav('Calendar')
  await page.waitForTimeout(600)
  const body = await page.textContent('body')
  if (!/missed/i.test(body)) throw new Error('the calendar never says "missed"')
})

await step('Home offers the way in when days have gone unrecorded', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const card = page.locator('[data-testid="catch-up-card"]')
  if (!(await card.count())) throw new Error('no catch-up card on Home')
  const txt = await card.textContent()
  if (!/missed dose/i.test(txt)) throw new Error(`catch-up card does not say what is missing: ${txt}`)
  console.log(`  ${txt.trim().split('\n')[0]}`)
})

await step('More → My protocol has "Add a past dose"', async () => {
  await nav('More')
  const link = page.locator('[data-testid="more-backfill"]')
  if (!(await link.count())) throw new Error('no backfill link under More')
  await link.click()
  await page.waitForTimeout(700)
  if (!(await page.locator('[data-testid="backfill-sheet"]').count())) throw new Error('the sheet did not open')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
})

await step('a missed day opens from the calendar and lists what was owed', async () => {
  await nav('Calendar')
  await page.waitForTimeout(500)
  await page.click(`[data-testid="cal-day-${iso(-1)}"]`)
  await page.waitForTimeout(600)
  const missed = page.locator('[data-testid="day-missed"]')
  if (!(await missed.count())) throw new Error('yesterday does not report its missed doses')
  await page.click('[data-testid="day-catch-up"]')
  await page.waitForTimeout(700)
  if (!(await page.locator('[data-testid="backfill-missed"]').count())) throw new Error('the backfill sheet has no missed section')
  const date = await page.inputValue('[data-testid="backfill-date"]')
  if (date !== iso(-1)) throw new Error(`the sheet opened on ${date}, not on the day that was tapped`)
})

await step('the three states are told apart, each with its own word', async () => {
  const txt = await page.textContent('[data-testid="backfill-sheet"]')
  if (!/Missed/.test(txt)) throw new Error('nothing is labelled Missed')
  const summary = await page.textContent('[data-testid="backfill-summary"]')
  if (!/due/.test(summary) || !/logged/.test(summary)) throw new Error(`summary is not a breakdown: ${summary}`)
  console.log(`  ${summary.trim()}`)
})

let firstGroupNames = []
await step('logging a missed group asks where it went, once, for the whole group', async () => {
  const group = page.locator('[data-testid="backfill-group"]').first()
  firstGroupNames = (await group.textContent()).trim()
  await group.locator('[data-testid="backfill-log-group"]').click()
  await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="backfill-confirm-site"]').count())) {
    throw new Error('an injection was logged without ever asking for a site')
  }
})

await step('a co-draw group backfills as one shot into one site', async () => {
  const before = (await state()).doseLogs.length
  await page.click('[data-testid="backfill-confirm-site"]')
  await page.waitForTimeout(900)
  const s = await state()
  const added = s.doseLogs.slice(before)
  if (added.length === 0) throw new Error('nothing was written')
  const dates = new Set(added.map((l) => l.date))
  if (dates.size !== 1 || !dates.has(iso(-1))) throw new Error(`landed on ${[...dates]}, not on ${iso(-1)}`)
  if (!added.every((l) => l.backfilled)) throw new Error('a backfilled dose does not say it was added later')
  const sites = new Set(added.map((l) => l.siteId))
  if (sites.size !== 1) throw new Error(`one syringe went into ${sites.size} different sites`)
  if (added.length > 1) {
    const ids = new Set(added.map((l) => l.coDrawId))
    if (ids.size !== 1 || ids.has(null)) throw new Error('the group was written as separate injections')
  }
  console.log(`  ${added.length} dose(s), one site (${[...sites][0]}), coDraw ${added[0].coDrawId || 'n/a'}`)
})

await step('the backfill comes out of the vial, so the run-out date catches up', async () => {
  const s = await state()
  const log = [...s.doseLogs].reverse().find((l) => l.backfilled)
  const open = s.openVials[log.peptideId]
  if (log.movedStock === false) {
    console.log('  that day ran on a vial since finished — the open vial was left alone, as it should be')
    return
  }
  const p = s.peptides.find((x) => x.id === log.peptideId)
  const full = p.recon.vialMg
  if (!(open.remainingMg < full)) throw new Error(`the vial still reads full (${open.remainingMg}/${full} mg)`)
  console.log(`  ${log.peptideId}: ${open.remainingMg} of ${full} mg left`)
})

await step('that day now reads as logged rather than missed', async () => {
  await nav('Calendar')
  await page.waitForTimeout(600)
  await page.click(`[data-testid="cal-day-${iso(-1)}"]`)
  await page.waitForTimeout(600)
  const txt = await page.textContent('body')
  if (!/logged/i.test(txt)) throw new Error('the day detail does not report the new log')
})

await step('a past dose can be deleted, and the day goes back to missed', async () => {
  const open = page.locator('[data-testid="day-catch-up"], [data-testid="day-open-backfill"]').first()
  await open.click()
  await page.waitForTimeout(700)
  const before = (await state()).doseLogs.length
  await page.locator('[data-testid="backfill-edit"]').first().click()
  await page.waitForTimeout(500)
  await page.click('[data-testid="backfill-delete"]')
  await page.waitForTimeout(400)
  const confirm = await page.textContent('[data-testid="backfill-confirm-delete"]')
  if (!/goes back to reading as missed/i.test(confirm)) throw new Error(`the confirm does not say what happens: ${confirm}`)
  await page.click('[data-testid="backfill-delete-yes"]')
  await page.waitForTimeout(800)
  const after = (await state()).doseLogs.length
  if (after !== before - 1) throw new Error(`delete left ${after} logs, expected ${before - 1}`)
})

await step('"I skipped it" records a decision on that day, not on today', async () => {
  await page.waitForTimeout(400)
  const group = page.locator('[data-testid="backfill-group"]').first()
  if (!(await group.count())) throw new Error('nothing left to skip')
  await group.locator('[data-testid="backfill-skip-group"]').click()
  await page.waitForTimeout(700)
  const s = await state()
  const sk = s.skips.filter((k) => k.date === iso(-1))
  if (sk.length === 0) throw new Error(`the skip landed on ${s.skips.map((k) => k.date)}, not ${iso(-1)}`)
  console.log(`  ${sk.length} skip(s) recorded on ${iso(-1)}`)
})

await step('a skip never touches the vial — nothing was taken', async () => {
  const s = await state()
  const skipped = s.skips.find((k) => k.date === iso(-1))
  if (!s.doseLogs.some((l) => l.date === iso(-1) && l.peptideId === skipped.peptideId)) return
  throw new Error('a skip also wrote a dose log')
})

await step('the catch-up flow can clear a whole run of days at once', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const card = page.locator('[data-testid="catch-up-card"]')
  if (!(await card.count())) { console.log('  nothing left missed — skipped'); return }
  await page.click('[data-testid="catch-up-open"]')
  await page.waitForTimeout(700)
  const days = await page.locator('[data-testid="catch-up-day"]').count()
  if (days === 0) throw new Error('the catch-up sheet lists no days')
  const before = (await state()).skips.length
  await page.click('[data-testid="catch-up-skip-all"]')
  await page.waitForTimeout(400)
  await page.click('[data-testid="catch-up-skip-yes"]')
  await page.waitForTimeout(1200)
  const s = await state()
  if (s.skips.length <= before) throw new Error('the bulk skip wrote nothing')
  const dates = new Set(s.skips.map((k) => k.date))
  if (dates.size < 2) throw new Error('the bulk skip landed on a single day')
  console.log(`  ${s.skips.length - before} doses skipped across ${dates.size} days`)
})

await step('Home stops offering a catch-up once the days are accounted for', async () => {
  await nav('Home')
  await page.waitForTimeout(900)
  const card = page.locator('[data-testid="catch-up-card"]')
  if (await card.count()) {
    const txt = await card.textContent()
    throw new Error(`still asking to catch up: ${txt.trim().split('\n')[0]}`)
  }
  if (!(await page.locator('[data-testid="home-add-past-dose"]').count())) {
    throw new Error('the plain "Add a past dose" entry is gone too')
  }
})

await step('the backfill sheet itself is keyboard-safe', async () => {
  await page.click('[data-testid="home-add-past-dose"]')
  await page.waitForTimeout(700)
  await page.click('[data-testid="backfill-date"]')
  await openKeyboard()
  const box = await sheet().boundingBox()
  if (box && box.y + box.height > VISIBLE + 1) {
    throw new Error(`the backfill sheet runs to ${Math.round(box.y + box.height)}px, past ${VISIBLE}px`)
  }
  const field = await page.locator('[data-testid="backfill-date"]').boundingBox()
  if (field && field.y + field.height > VISIBLE) throw new Error('the date field is under the keyboard')
  await page.screenshot({ path: `${SHOT}/v30-backfill-keyboard.png` })
  await closeKeyboard()
})

await step('a future day is refused', async () => {
  await page.fill('[data-testid="backfill-date"]', iso(3))
  await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="backfill-future"]').count())) {
    throw new Error('the sheet accepted a day that has not happened')
  }
  if (await page.locator('[data-testid="backfill-log-group"]').count()) {
    throw new Error('a future day still offers to log a dose')
  }
})

await closeAll()
await page.screenshot({ path: `${SHOT}/v30-home.png` })

console.log(`\n--- console/page errors: ${errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror')).length}`)
for (const e of errors) console.log('  ' + e.split('\n')[0])
await browser.close()
process.exit(errors.length ? 1 : 0)
