import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
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
const body = () => page.textContent('body')
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
// The screen cross-fade takes ~180 ms, so a tab tap followed immediately by a
// body read sees the *outgoing* screen. Wait for something only the incoming
// screen renders before asserting anything.
const TAB_MARK = {
  Home: /Pepito \+/, Calendar: /This week|Adherence this month/, Symptoms: /Symptom|How are you/i,
  Body: /How to measure/, More: /Build \/ rebuild my protocol/,
}
const nav = async (label) => {
  await page.click(`nav button[aria-label="${label}"]`)
  await waitText(TAB_MARK[label])
  await page.waitForTimeout(250)
}
// v21 split this screen into a stock room and the restock list, opening on the
// stock room. These checks are about the restock plan, so switch to it first.
const toRestockList = async () => {
  await page.waitForTimeout(500)
  const tab = page.locator('[data-testid="stock-view"] button[aria-label="Restock list"]')
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(450) }
}
const closeModal = async () => {
  const close = modal().locator('button[aria-label="Close"]')
  if (await close.count()) await close.first().click()
  await page.waitForTimeout(400)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await waitText(/Pepito/)
// v16 shows the framing once, on first launch, as a sheet with no dismiss
// other than "Got it" — acknowledge it before anything else.
const gotIt = page.locator('button:has-text("Got it")')
if (await gotIt.count()) { await gotIt.first().click(); await page.waitForTimeout(500) }
// the wizard auto-offers on an empty stack; the seed stack is not empty, but be safe
if (await modal().count()) {
  const close = modal().locator('button[aria-label="Close"], button:has-text("Not now")')
  if (await close.count()) await close.first().click()
}

// ---------- 1. five-tab nav ----------
await step('bottom nav shows exactly Home · Calendar · Symptoms · Body · More', async () => {
  const labels = await page.locator('nav button span:not(:has(svg))').allTextContents()
  const got = labels.map((s) => s.trim())
  if (got.join('|') !== 'Home|Calendar|Symptoms|Body|More') {
    throw new Error(`nav is [${got.join(', ')}]`)
  }
})

await step('nav icons are large (>=28px)', async () => {
  const size = await page.locator('nav button svg').first().evaluate((el) => el.getBoundingClientRect().width)
  if (size < 28) throw new Error(`icon is ${size}px wide`)
})

await step('Mix and Calculator are reachable from More, not the nav', async () => {
  await nav('More')
  const txt = await body()
  for (const w of ['Calculator', 'Mix']) {
    if (!txt.includes(w)) throw new Error(`${w} is missing from More`)
  }
  await page.click('text=Calculator')
  await waitText(/Reconstitution|mg\/mL|units/i)
  await nav('More')
  await page.click('text=Can these two share a syringe')
  await waitText(/Mix/)
})

// ---------- 4. no double-ups in More ----------
await step('More has no entry that just re-opens a nav tab', async () => {
  await nav('More')
  const txt = await body()
  for (const banned of ['Outcomes & body', 'Body outcomes', 'Restock list']) {
    if (txt.includes(banned)) throw new Error(`More still lists "${banned}"`)
  }
})

await step('the Plan/Schedule timeline is gone; the ladder lives in the compound sheet', async () => {
  await nav('More')
  if ((await body()).includes('Titration ladders & cycles')) throw new Error('the Plan screen is still linked')
  await page.click('text=Everything I’m on, at a glance')
  await waitText(/Everything I'm currently taking|compound/i)
  await page.locator('[data-testid="protocol-row"]').first().click()
  await page.waitForTimeout(600)
  await page.click('[data-testid="sheet-tab-mine"]')
  await waitText(/Rung/, 8000)
  // the sheet is a modal — leaving it open would swallow every later click
  await page.click('button[aria-label="Close"]')
  await page.waitForTimeout(500)
})

// ---------- 2. calendar ----------
await step('Calendar opens on the week view with a this-week summary', async () => {
  await nav('Calendar')
  await waitText(/This week/)
  await waitText(/shot/)
})

await step('a day row splits AM and PM and shows syringe units', async () => {
  // NB: the slot heading renders as "AM" immediately followed by the first
  // compound name, so a /\bAM\b/ text match can't see it — locate the heading.
  // the heading text is " AM" — icon then a space — so anchor loosely
  const am = await page.locator('p.uppercase', { hasText: /^\s*AM\s*$/ }).count()
  const pm = await page.locator('p.uppercase', { hasText: /^\s*PM\s*$/ }).count()
  if (am === 0) throw new Error('no AM section')
  if (pm === 0) throw new Error('no PM section')
  if (!/\d+(\.\d+)? units/.test(await body())) throw new Error('no unit figure on any dose line')
})

await step('a co-draw group reads as one syringe on the calendar', async () => {
  if (!/one syringe/.test(await body())) throw new Error('no combined line shown')
})

await step('today is highlighted in the week view', async () => {
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const row = page.locator(`[data-testid="cal-day-${iso}"]`)
  if (!(await row.count())) throw new Error('today is not in the visible week')
  const shadow = await row.evaluate((el) => getComputedStyle(el).boxShadow)
  if (shadow === 'none') throw new Error('today has no highlight ring')
})

await step('future days show a projected dose, marked as projected', async () => {
  // step forward a week so every visible day is in the future
  await page.click('button[aria-label="Next period"]')
  await page.waitForTimeout(400)
  const cells = page.locator('[data-testid^="cal-day-"]')
  const n = await cells.count()
  if (n !== 7) throw new Error(`expected 7 day rows, got ${n}`)
  await cells.nth(2).click()
  await waitText(/projected/i, 8000)
  await closeModal()
  await page.click('button:has-text("Today")')
  await page.waitForTimeout(400)
})

await step('tapping a day opens its detail', async () => {
  await page.locator('[data-testid^="cal-day-"]').first().click()
  await waitText(/Nothing scheduled|shot|On this day/, 8000)
  await closeModal()
})

await step('month view renders a whole-week grid with per-day indicators', async () => {
  await page.click('button:has-text("Month")')
  await waitText(/Adherence this month/)
  const cells = await page.locator('[data-testid^="cal-cell-"]').count()
  if (cells % 7 !== 0 || cells < 28) throw new Error(`month grid has ${cells} cells`)
})

await step('the adherence heatmap legend names every colour in words', async () => {
  const txt = await body()
  for (const w of ['all taken', 'some taken', 'missed', 'still to do', 'scheduled']) {
    if (!txt.includes(w)) throw new Error(`legend is missing "${w}"`)
  }
})

await step('event markers appear on the calendar', async () => {
  // reconstitute a vial so an expiry marker exists, then look for it
  await nav('More')
  await page.click('text=Vials I own, run-out dates')
  await toRestockList()
  // NB: "Stock & restock" is also the More-hub link's own label, so waiting on
  // it would match the outgoing screen. Wait for text only this screen renders.
  await waitText(/soonest to run out first|Nothing with a set protocol/)
  const recon = page.locator('button:has-text("Mark reconstituted today")').first()
  if (await recon.count()) await recon.click()
  await page.waitForTimeout(300)
  await nav('Calendar')
  await page.click('button:has-text("Month")')
  await page.waitForTimeout(400)
  const dots = await page.locator('[data-testid^="cal-cell-"] span.rounded-full').count()
  if (dots === 0) {
    // the expiry may land in a later month — step forward one and re-check
    await page.click('button[aria-label="Next period"]')
    await page.waitForTimeout(400)
    const later = await page.locator('[data-testid^="cal-cell-"] span.rounded-full').count()
    if (later === 0) throw new Error('no event dot on any day in two months')
  }
})

await step('.ics export downloads from the Calendar', async () => {
  await nav('Calendar')
  await page.waitForTimeout(300)
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 12000 }),
    page.click('button:has-text("Add to phone calendar")'),
  ])
  if (!dl.suggestedFilename().endsWith('.ics')) throw new Error(dl.suggestedFilename())
})

await step('Home carries a next-7-days strip that opens the Calendar', async () => {
  await nav('Home')
  const strip = page.locator('[data-testid="next-7-days"]')
  await strip.waitFor({ timeout: 8000 })
  await strip.click()
  await waitText(/This week/, 8000)
})

// ---------- 3. merged stock + restock ----------
await step('Stock and restock are one screen', async () => {
  await nav('More')
  const links = await page.locator('button[data-testid^="more-"] span.t-label').allTextContents()
  const stockish = links.filter((l) => /stock/i.test(l))
  if (stockish.length !== 1) throw new Error(`More lists ${stockish.length} stock screens: ${stockish.join(', ')}`)
  await page.click('text=Vials I own, run-out dates')
  await toRestockList()
  // NB: "Stock & restock" is also the More-hub link's own label, so waiting on
  // it would match the outgoing screen. Wait for text only this screen renders.
  await waitText(/soonest to run out first|Nothing with a set protocol/)
  const txt = await body()
  for (const w of ['on hand', 'runs out', 'cost/dose', 'Consumables', 'To end of cycles']) {
    if (!txt.includes(w)) throw new Error(`merged screen is missing "${w}"`)
  }
})

await step('each compound shows its numbers exactly once', async () => {
  const txt = await body()
  const count = (needle) => txt.split(needle).length - 1
  // "runs out" appears once per compound card; "cost/dose" likewise
  if (count('on hand') !== count('cost/dose')) {
    throw new Error(`on-hand appears ${count('on hand')}× but cost/dose ${count('cost/dose')}×`)
  }
})

await step('order quantity and delivery date still work on the merged screen', async () => {
  const plus = page.locator('button[aria-label="One more"]').first()
  await plus.click()
  await page.waitForTimeout(250)
  const st = await state()
  if (Object.keys(st.restock.qty || {}).length === 0) throw new Error('quantity override did not persist')
  const delivery = page.locator('button:has-text("Add expected delivery")').first()
  await delivery.click()
  await page.locator('input[aria-label="Expected delivery date"]').first().fill('2026-12-01')
  await page.waitForTimeout(250)
  const st2 = await state()
  if (!Object.values(st2.restock.delivery || {}).includes('2026-12-01')) throw new Error('delivery date did not persist')
})

await step('per-vial purchase editing survived the merge', async () => {
  await page.locator('button:has-text("Purchases")').first().click()
  await page.waitForTimeout(300)
  const qty = page.locator('input[aria-label*="vials on hand"]').first()
  await qty.waitFor({ timeout: 6000 })
  await qty.fill('3')
  await page.waitForTimeout(250)
  const st = await state()
  if (!st.vials.some((v) => v.qtyOnHand === 3)) throw new Error('vial qty did not persist')
})

// ---------- 5. body measurements ----------
await step('Body tab states the global measuring rules once', async () => {
  await nav('Body')
  await waitText(/How to measure — every time/)
  const txt = await body()
  for (const w of ['same time of day', 'not compressing', 'normal exhale']) {
    if (!txt.toLowerCase().includes(w.toLowerCase())) throw new Error(`missing rule "${w}"`)
  }
})

await step('reference distances are shown and editable', async () => {
  await waitText(/My saved reference distances/)
  const txt = await body()
  if (!/up from the elbow crease/.test(txt)) throw new Error('no elbow-crease reference')
  if (!/above the top of the kneecap/.test(txt)) throw new Error('no kneecap reference')
  const armInput = page.locator('input[aria-label="Upper arm reference in cm"]').first()
  await armInput.fill('21')
  await page.waitForTimeout(300)
  const st = await state()
  if (st.bodyRefs.arm !== 21) throw new Error(`bodyRefs.arm is ${st.bodyRefs.arm}`)
  await waitText(/21 cm up from the elbow crease/)
})

await step('the entry form gives each measurement its exact instruction', async () => {
  await page.click('button:has-text("Log measurement")')
  await waitText(/Log measurement/)
  await modal().locator('button:has-text("More")').click()
  await page.waitForTimeout(400)
  const txt = (await modal().textContent()).toLowerCase()
  for (const w of [
    "just below the adam's apple",
    'fullest part at nipple level',
    'widest part of the buttocks',
    'widest part below the elbow',
    'weight even on both feet',
    'widest part, standing',
  ]) {
    if (!txt.includes(w)) throw new Error(`instruction missing: "${w}"`)
  }
  if (!txt.includes('21 cm up from the elbow crease')) throw new Error('saved arm reference not shown in the form')
})

await step('left and right are separate inputs and store separately', async () => {
  const m = modal()
  await m.locator('input[aria-label="Upper arm — left in cm"]').fill('38')
  await m.locator('input[aria-label="Upper arm — right in cm"]').fill('39.5')
  await m.locator('input[aria-label="Thigh — left in cm"]').fill('58')
  await m.locator('input[aria-label="Thigh — right in cm"]').fill('57')
  await m.locator('input[aria-label="Calf — right in cm"]').fill('40')
  await m.locator('button:has-text("Save measurement")').click()
  await page.waitForTimeout(700)
  const st = await state()
  const last = st.measurements[st.measurements.length - 1]
  if (last.armL !== 38 || last.armR !== 39.5) throw new Error(`arms stored as ${last.armL}/${last.armR}`)
  if (last.thighL !== 58 || last.thighR !== 57) throw new Error(`thighs stored as ${last.thighL}/${last.thighR}`)
  if (last.calfR !== 40) throw new Error('calf did not store')
  if ('arms' in last || 'thighs' in last) throw new Error('a merged single-value field was written')
})

await step('trends can chart each side on its own', async () => {
  await page.click('button:has-text("Trends")')
  await page.waitForTimeout(400)
  const txt = await body()
  for (const w of ['Upper arm — left', 'Upper arm — right', 'Thigh — left', 'Calf — right']) {
    if (!txt.includes(w)) throw new Error(`no trend chip for "${w}"`)
  }
  await page.click('button:has-text("Upper arm — left")')
  await page.waitForTimeout(400)
  await waitText(/up from the elbow crease/)
})

await step('the Outcome Engine still lives inside Body', async () => {
  await page.click('button:has-text("Outcomes")')
  await page.waitForTimeout(500)
  await waitText(/outcome|overlay|dose|metric/i, 8000)
})

// ---------- 6. persistence + layout ----------
await step('data persists across a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  const st = await state()
  if (st.bodyRefs.arm !== 21) throw new Error('reference distance lost on reload')
  const last = st.measurements[st.measurements.length - 1]
  if (last.armR !== 39.5) throw new Error('measurement lost on reload')
})

await step('no horizontal overflow at 390px on any tab', async () => {
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'More']) {
    await nav(tab)
    await page.waitForTimeout(500)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) throw new Error(`${tab} overflows by ${over}px`)
  }
})

await step('the bottom nav never covers the last card', async () => {
  await nav('Calendar')
  await page.waitForTimeout(400)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(400)
  // main's padding box deliberately runs under the nav (that's the scroll
  // padding). What must clear it is the last piece of visible content.
  const clear = await page.evaluate(() => {
    const navTop = document.querySelector('nav').getBoundingClientRect().top
    let lowest = -Infinity
    for (const el of document.querySelector('main').querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.height > 0 && r.width > 0 && el.textContent.trim()) lowest = Math.max(lowest, r.bottom)
    }
    return navTop - lowest
  })
  if (clear < 0) throw new Error(`content ends ${Math.round(-clear)}px under the nav`)
})

for (const tab of ['Home', 'Calendar', 'Body', 'More']) {
  await nav(tab)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOT}/v13-${tab.toLowerCase()}.png`, fullPage: true })
}

await browser.close()
if (errors.length) {
  console.log('\n--- FAILURES ---')
  for (const e of errors) console.log(e)
  process.exit(1)
}
console.log('\nv13 e2e: all green')
