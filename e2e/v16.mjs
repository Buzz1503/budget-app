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
const body = () => page.textContent('body')
const main = () => page.locator('main').textContent()
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const amSlot = async () => { await page.click('button:has-text("AM")'); await page.waitForTimeout(400) }

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })

// ---------- 1 · the disclaimer ----------
await step('the disclaimer is a one-time sheet, not a row in the home column', async () => {
  await waitText(/not medical advice/)
  if (!(await modal().count())) throw new Error('the disclaimer is not a modal')
  // and it is not text sitting in the page column behind it
  const sheet = await modal().textContent()
  if (!/not medical advice/.test(sheet)) throw new Error('the modal does not carry the framing')
  await page.click('button:has-text("Got it")')
  await page.waitForTimeout(600)
  if (/not medical advice/.test(await main())) throw new Error('the disclaimer is still in the home column')
})

await step('"Got it" persists — it never comes back', async () => {
  const st = await state()
  if (!st.settings.disclaimerDismissed) throw new Error('the dismissal did not persist to the store')
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await page.waitForTimeout(600)
  if (/not medical advice/.test(await body())) throw new Error('the disclaimer came back after a reload')
  if (await modal().count()) throw new Error('the modal reopened on reload')
})

await step('a tiny ⓘ in the header brings it back on demand', async () => {
  const info = page.locator('button[aria-label="About this app"]')
  if (!(await info.count())) throw new Error('no ⓘ in the header')
  const size = await info.locator('svg').evaluate((el) => el.getBoundingClientRect().width)
  if (size > 16) throw new Error(`the ⓘ is ${size}px — not tiny`)
  await info.click()
  await page.waitForTimeout(500)
  if (!/not medical advice/.test(await body())) throw new Error('the ⓘ did not reopen it')
  await page.locator('div.fixed.inset-0.z-50 button[aria-label="Close"]').click()
  await page.waitForTimeout(500)
})

// ---------- 2 · no streak on Home ----------
await step('there is no streak UI anywhere on Home', async () => {
  await amSlot()
  const txt = await main()
  for (const banned of ['Start your streak', 'day streak', 'streak', "Don't break the chain"]) {
    if (new RegExp(banned, 'i').test(txt)) throw new Error(`Home still mentions "${banned}"`)
  }
})

await step('the first-run "start your streak" coach line is gone', async () => {
  const st = await state()
  if (st.doseLogs.length) throw new Error('fixture problem — expected a fresh log history')
  if (/Tap Log to record your first injection/.test(await main())) {
    throw new Error('the streak coach line is still shown')
  }
})

// ---------- 3 · the hero ----------
await step('the hero is just the ring and the count', async () => {
  const hero = await page.locator('[data-testid="hero"]').textContent()
  if (!hero) throw new Error('no hero row found')
  if (!/to inject|Clear morning|Clear evening|done/.test(hero)) throw new Error(`hero has no headline: ${hero}`)
  if (/XP/.test(hero)) throw new Error('XP is still in the hero')
  if (/Lvl|Rookie/.test(hero)) throw new Error('the level is still in the hero')
})

await step('v23 removed levels and XP from Home entirely', async () => {
  const txt = await main()
  if (/\bXP\b/.test(txt)) throw new Error('XP is still on Home')
  if (/Lvl \d+ · .+ · \d+\/\d+/.test(txt)) throw new Error('the level footnote is still on Home')
  // and no XP progress bar competing with the ring
  const bars = await page.evaluate(() => [...document.querySelectorAll('main div')]
    .filter((d) => /linear-gradient\(90deg/.test(d.style.backgroundImage || '')).length)
  if (bars > 0) throw new Error('the XP progress bar is still on Home')
})

// ---------- 4 · one alert row ----------
await step('standing nudges are one small alert row, not cards', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.openVials.bpc157 = { remainingMg: 0.2, reconstitutedAt: new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10) }
    raw.state.backupMeta = { lastBackupAt: null, lastBackupEntryCount: 0, nudgeDismissedAt: null }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await amSlot()
  const bell = page.locator('[data-testid="alert-bell"]')
  if (!(await bell.count())) throw new Error('no alert row')
  const w = await bell.evaluate((el) => el.getBoundingClientRect().width)
  if (w > 60) throw new Error(`the alert control is ${Math.round(w)}px wide — that is a card, not a row`)
  const txt = await main()
  if (/Back up now|restock soon/.test(txt)) throw new Error('a nudge is still expanded in the column')
  await bell.click()
  await page.waitForTimeout(400)
  if (!/Back up now|expires|runs out/i.test(await page.locator('[data-testid="alert-panel"]').textContent())) {
    throw new Error('the row does not expand to the nudges')
  }
  await bell.click()
  await page.waitForTimeout(300)
})

// ---------- 5 · space, not boxes ----------
await step('the dose list dominates the screen', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.coachMarks = { 'log-button': true, 'site-map': true }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await amSlot()
  // "Chrome" is everything that is not about the doses. The combine plan IS
  // dose content — it is the action for this morning's shots — so the ruler
  // runs to whichever comes first, the plan or the first card.
  const geo = await page.evaluate(() => {
    const card = document.querySelector('main button[aria-label^="Log "]')
    const plan = document.querySelector('[data-testid="shot-plan"]')
    const m = document.querySelector('main')
    const tops = [card, plan].filter(Boolean).map((el) => el.getBoundingClientRect().top + scrollY)
    return tops.length ? { top: Math.min(...tops), mainTop: m.getBoundingClientRect().top + scrollY } : null
  })
  if (!geo) throw new Error('no dose content found')
  const above = geo.top - geo.mainTop
  // v28: display title + the focal metric card legitimately sit above the list
  if (above > 320) throw new Error(`${Math.round(above)}px of chrome above the dose content — too much`)
  console.log(`  ${Math.round(above)}px of chrome above the dose content`)
})

// v28 gives the day's progress its own card as the screen's focal point, so
// exactly one card above the dose list is now correct rather than a smell.
await step('fewer boxes: the header block carries no card chrome', async () => {
  const boxes = await page.evaluate(() => {
    const card = document.querySelector('main button[aria-label^="Log "]')
    const plan = document.querySelector('[data-testid="shot-plan"]')
    const cutoff = Math.min(...[card, plan].filter(Boolean).map((el) => el.getBoundingClientRect().top))
    return [...document.querySelectorAll('main .card')]
      .filter((d) => d.getBoundingClientRect().bottom <= cutoff).length
  })
  if (boxes > 1) throw new Error(`${boxes} card(s) still boxed above the dose list`)
})

// ---------- 6 · the full co-draw list ----------
await step('the combine card lists every compound, nothing clipped', async () => {
  const names = page.locator('[data-testid="codraw-names"]').first()
  await names.waitFor({ timeout: 15000 })
  const items = await names.locator('li').allTextContents()
  if (items.length < 3) throw new Error(`only ${items.length} compounds listed in the co-draw`)
  if (/…|\.\.\./.test(items.join(' '))) throw new Error('the list is still truncated with an ellipsis')
  // nothing visually clipped either
  const clipped = await names.evaluate((el) => {
    for (const li of el.querySelectorAll('li')) {
      if (li.scrollWidth > li.clientWidth + 1) return li.textContent
      const st = getComputedStyle(li)
      if (st.textOverflow === 'ellipsis' || st.whiteSpace === 'nowrap') return li.textContent
    }
    return null
  })
  if (clipped) throw new Error(`"${clipped}" is clipped`)
  // and it matches the plan the app actually holds
  const headline = await page.locator('[data-testid="shot-plan"]').textContent()
  const n = Number((headline.match(/Combine into 1 shot · (\d+)/) || [])[1])
  if (n && n !== items.length) throw new Error(`headline says ${n} compounds, list shows ${items.length}`)
  console.log(`  co-draw lists ${items.length}: ${items.map((s) => s.replace(/^·\s*/, '')).join(', ')}`)
})

// ---------- 7 · Testosterone E in a neutral voice ----------
await step('Testosterone E carries no red text or icon', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.peptides = raw.state.peptides.map((p) => (
      p.id === 'testosterone-e' ? { ...p, frequency: 'daily', scheduleWeekdays: [0, 1, 2, 3, 4, 5, 6] } : p
    ))
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await amSlot()
  const card = page.locator('main div.card', { hasText: 'Testosterone En' }).first()
  await card.waitFor({ timeout: 10000 })
  const reds = await card.evaluate((el) => {
    const bad = []
    for (const n of el.querySelectorAll('*')) {
      const c = getComputedStyle(n).color
      // --rose and --coral both land in the red corner of the wheel
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!m) continue
      const [r, g, b] = [+m[1], +m[2], +m[3]]
      if (r > 150 && g < 110 && b < 130 && (n.textContent || '').trim()) bad.push(`${n.tagName}:${c}:${(n.textContent || '').slice(0, 40)}`)
    }
    return bad
  })
  if (reds.length) throw new Error(`red styling remains: ${reds.slice(0, 3).join(' | ')}`)
})

await step('and it still cannot be co-drawn', async () => {
  const card = page.locator('main div.p-4', { hasText: 'Testosterone En' })
    .filter({ has: page.locator('button[aria-label^="Log Testosterone"]') }).first()
  if (await card.locator('button[aria-label^="Select "]').count()) {
    throw new Error('Test E is offered for co-draw selection')
  }
  if (!(await card.locator('[aria-label*="cannot be co-drawn"]').count())) {
    throw new Error('nothing marks Test E as un-co-drawable')
  }
  const txt = await card.textContent()
  if (!/its own shot/i.test(txt)) throw new Error('the card no longer says it goes on its own')
})

// ---------- 8 · layout + persistence ----------
await step('no horizontal overflow at 390px, and data persists', async () => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (over > 1) throw new Error(`Home overflows by ${over}px`)
  const st = await state()
  if (!st.peptides.length) throw new Error('stack lost')
  if (!st.settings.disclaimerDismissed) throw new Error('the disclaimer dismissal was lost')
})

await page.screenshot({ path: `${SHOT}/v16-home.png`, fullPage: true })

await browser.close()
if (errors.length) {
  console.log('\n--- FAILURES ---')
  for (const e of errors) console.log(e)
  process.exit(1)
}
console.log('\nv16 e2e: all green')
