// v33 — the cycle line on Home, History rebuilt around tenure, dark only.
//
// Runs at 390×844 against a build on BASE_URL. Walks the six checks in the
// v30.1 brief in order.
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

let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const closeAll = async () => {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(350)
  }
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button:has-text("${label}")`)
  await page.waitForTimeout(700)
}
const more = async (id) => {
  await nav('More')
  await page.click(`[data-testid="more-${id}"]`)
  await page.waitForTimeout(900)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1400)
const gotIt = page.locator('button:has-text("Got it")')
if (await gotIt.count()) { await gotIt.click(); await page.waitForTimeout(700) }

// ================================================== 1 · the cycle line

await step('1 · cycled compounds carry a cycle line, uncycled ones do not', async () => {
  const rows = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    const cycled = new Set(s.peptides.filter((p) => p.cycleOnDays && p.cycleOffDays).map((p) => p.name))
    return [...document.querySelectorAll('[data-testid="log-row"]')].map((r) => ({
      name: r.getAttribute('aria-label').replace(/^Log |^| logged$/g, '').trim(),
      hasLine: !!r.querySelector('[data-testid="cycle-line"]'),
      line: r.querySelector('[data-testid="cycle-line"]')?.textContent?.trim() || null,
      cycledNames: [...cycled],
    }))
  })
  if (!rows.length) throw new Error('no dose rows on Home')
  const withLine = rows.filter((r) => r.hasLine)
  if (!withLine.length) throw new Error('not one card shows a cycle line')
  for (const r of withLine) {
    if (!/^(Day \d+ of \d+|Off · |Starts )/.test(r.line)) throw new Error(`unexpected cycle line: "${r.line}"`)
  }
  // an uncycled compound must show nothing extra
  const uncycled = rows.filter((r) => !r.cycledNames.includes(r.name))
  for (const r of uncycled) {
    if (r.hasLine) throw new Error(`${r.name} has no cycle but shows a cycle line`)
  }
  console.log(`  ${withLine.length}/${rows.length} cards cycled · e.g. "${withLine[0].line}"`)
})

await step('1 · the cycle line never wraps and never pushes Log down', async () => {
  const bad = await page.evaluate(() => {
    const out = []
    for (const line of document.querySelectorAll('[data-testid="cycle-line"]')) {
      const span = line.querySelector('span')
      if (!span) continue
      // one line of text, and nothing clipped off the end of it
      const lines = Math.round(span.getBoundingClientRect().height / parseFloat(getComputedStyle(span).lineHeight))
      if (lines > 1) out.push(`wraps: ${span.textContent}`)
      if (span.scrollWidth > span.clientWidth + 1) out.push(`clipped: ${span.textContent}`)
    }
    return out
  })
  if (bad.length) throw new Error(bad.join(' | '))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth)
  if (overflow > 391) throw new Error(`horizontal overflow: ${overflow}px`)
})

await step('1 · tapping the cycle line opens the compound, not a dose', async () => {
  const line = page.locator('[data-testid="cycle-line"]').first()
  const before = (await state()).doseLogs.length
  await line.click()
  await page.waitForTimeout(900)
  if (!(await page.locator('[data-testid="compound-sheet"]').count())) {
    throw new Error('the compound page did not open')
  }
  if ((await state()).doseLogs.length !== before) throw new Error('tapping the cycle line logged a dose')
  await closeAll()
})

await step('1 · tapping anywhere else still logs', async () => {
  const before = (await state()).doseLogs.length
  await page.locator('[data-testid="log-row"]:not([data-done])').first().click()
  await page.waitForTimeout(800)
  if ((await state()).doseLogs.length !== before + 1) throw new Error('the row stopped logging')
})

// ============================================ 2 · History is a tenure table

await step('2 · the tenure table leads the page', async () => {
  await more('history')
  const table = page.locator('[data-testid="tenure-table"]')
  if (!(await table.count())) throw new Error('no tenure table')
  const rows = page.locator('[data-testid="tenure-row"]')
  const n = await rows.count()
  if (!n) throw new Error('the tenure table has no rows')
  // and it is above the log and the adherence block
  const order = await page.evaluate(() => {
    const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? Infinity
    return { table: y('[data-testid="tenure-table"]'), adherence: y('[data-testid="adherence-block"]') }
  })
  if (!(order.table < order.adherence)) throw new Error('adherence is above the tenure table')
  console.log(`  ${n} rows, table above adherence`)
})

await step('2 · each row carries time on, dose, time at dose and a progression', async () => {
  const row = page.locator('[data-testid="tenure-row"]').first()
  for (const id of ['row-time-on', 'row-at-dose', 'row-progression']) {
    const el = row.locator(`[data-testid="${id}"]`)
    if (!(await el.count())) throw new Error(`a row is missing ${id}`)
    const t = (await el.innerText()).trim()
    if (!t) throw new Error(`${id} is empty`)
  }
  console.log(`  ${(await row.innerText()).replace(/\s+/g, ' ').slice(0, 120)}`)
})

await step('2 · rows are one consistent height', async () => {
  const hs = await page.evaluate(() => [...document.querySelectorAll('[data-testid="tenure-row"]')]
    .map((r) => Math.round(r.getBoundingClientRect().height)))
  const spread = Math.max(...hs) - Math.min(...hs)
  if (spread > 24) throw new Error(`row heights vary by ${spread}px: ${hs.join(', ')}`)
  console.log(`  ${hs.length} rows, heights ${Math.min(...hs)}–${Math.max(...hs)}px`)
})

await step('2 · sortable by longest on, recently started and longest at dose', async () => {
  // a protocol built today has nothing to sort — every compound ties at zero,
  // so the orders are seeded apart first
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    const d = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10)
    const offsets = [-400, -200, -90, -30, -7]
    s.peptides = s.peptides.map((p, i) => {
      const off = offsets[i % offsets.length]
      return { ...p, startedOn: d(off) }
    })
    for (const p of s.peptides) s.runs[p.id] = [{ id: `r-${p.id}`, startedOn: p.startedOn, endedOn: null }]
    s.doseEvents = s.peptides.map((p, i) => ({
      id: `de-${p.id}`, peptideId: p.id, kind: 'start',
      date: i % 2 ? p.startedOn : d(-3), to: p.ladder?.floor ?? 1, unit: p.ladder?.unit,
    }))
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  await page.click('nav button:has-text("More")'); await page.waitForTimeout(500)
  await page.click('[data-testid="more-history"]'); await page.waitForTimeout(900)

  const first = async () => (await page.locator('[data-testid="tenure-row"]').first().innerText()).split('\n')[0]
  const longest = await first()
  await page.click('[data-testid="tsort-newest"]'); await page.waitForTimeout(500)
  const newest = await first()
  await page.click('[data-testid="tsort-atdose"]'); await page.waitForTimeout(500)
  const atDose = await first()
  if (longest === newest) throw new Error('longest on and recently started gave the same order')
  await page.click('[data-testid="tsort-longest"]'); await page.waitForTimeout(500)
  if ((await first()) !== longest) throw new Error('sorting back did not restore the default order')
  console.log(`  longest: ${longest} · newest: ${newest} · at dose: ${atDose}`)
})

await step('2 · the supplements block and the skipped list are gone', async () => {
  if (await page.locator('[data-testid="supplement-adherence"]').count()) {
    throw new Error('the supplements adherence block is still here')
  }
  if (await page.locator('[data-testid="skip-list"]').count()) {
    throw new Error('the skipped list is still here')
  }
})

await step('2 · missed doses are a quiet line, not a red alert', async () => {
  const loud = page.locator('[data-testid="catch-up-card"]')
  if (await loud.count()) throw new Error('the red missed-doses card is still on History')
  const quiet = page.locator('[data-testid="catch-up-quiet"]')
  if (await quiet.count()) {
    const tone = await quiet.evaluate((el) => getComputedStyle(el.querySelector('span')).color)
    console.log(`  quiet line present, ${tone}`)
  } else {
    console.log('  (nothing missed — no line to show)')
  }
})

// ======================================= 3 · a row opens its dose timeline

await step('3 · tapping a row opens the timeline, exposure and step-up list', async () => {
  await page.locator('[data-testid="tenure-row"]').first().click()
  await page.waitForTimeout(900)
  const detail = page.locator('[data-testid="compound-detail"]')
  if (!(await detail.count())) throw new Error('no detail opened')
  for (const id of ['tenure-block', 'exposure-block']) {
    if (!(await page.locator(`[data-testid="${id}"]`).count())) throw new Error(`detail is missing ${id}`)
  }
  // v30.2: a steady dose is stated rather than plotted, and either counts
  const timeline = await page.locator('[data-testid="dose-timeline"], [data-testid="dose-steady"], [data-testid="dose-timeline-empty"]').count()
  if (!timeline) throw new Error('detail has no dose history at all')
  const steps = await page.locator('[data-testid="stepup-line"]').count()
  console.log(`  detail opens · ${steps} dose change line(s)`)
  await closeAll()
})

// ============================ 4 · the summary opens in-app and closes again

await step('4 · the shareable summary opens in-app with a working Close', async () => {
  await page.click('[data-testid="open-summary"]')
  await page.waitForTimeout(1200)
  const sheet = page.locator('[data-testid="summary-sheet"]')
  if (!(await sheet.count())) throw new Error('the summary did not open in-app')
  if (!(await page.locator('[data-testid="summary-frame"]').count())) throw new Error('no document rendered')
  if (!(await page.locator('[data-testid="summary-print"]').count())) throw new Error('no print action')
  if (ctx.pages().length > 1) throw new Error('it opened a second tab as well')
  // the document leads with tenure
  const doc = (await page.frameLocator('[data-testid="summary-frame"]').locator('body').innerText()).toLowerCase()
  if (doc.indexOf('time on compound') < 0) throw new Error('the document has no tenure section')
  if (doc.indexOf('time on compound') > doc.indexOf('current protocol')) {
    throw new Error('the current protocol is above time on compound')
  }
  if (doc.indexOf('every dose change') < 0) throw new Error('the document has no dose-change list')
  if (/undefined/.test(doc)) throw new Error('the document renders "undefined"')
  await page.locator('[data-testid="sheet"] button[aria-label="Close"], [data-testid="sheet"] button:has(svg)').first().click()
  await page.waitForTimeout(700)
  if (await page.locator('[data-testid="summary-sheet"]').count()) throw new Error('Close did not close it')
  console.log('  opens framed, closes, leads with tenure')
})

// ================================================= 5 · dark only, data safe

await step('5 · no light mode remains in the stylesheet or the store', async () => {
  const rule = await page.evaluate(() => {
    for (const sh of [...document.styleSheets]) {
      let rules
      try { rules = [...sh.cssRules] } catch { continue }
      for (const r of rules) {
        if (r.selectorText && /data-theme=.?light/.test(r.selectorText)) return r.selectorText
        if (r.conditionText && /prefers-color-scheme:\s*light/.test(r.conditionText)) return r.conditionText
      }
    }
    return null
  })
  if (rule) throw new Error(`a light-mode rule survives: ${rule}`)
  if (await page.evaluate(() => document.documentElement.dataset.theme)) {
    throw new Error('the root still carries a theme attribute')
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.settings.theme ?? null)
  if (stored) throw new Error(`settings.theme survives as "${stored}"`)
})

await step('5 · the theme toggle is gone from Settings', async () => {
  await more('settings')
  const body = await page.locator('body').innerText()
  if (/\bTheme\b/.test(body)) throw new Error('Settings still offers a Theme row')
})

await step('5 · the app is dark and legible', async () => {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const m = bg.match(/\d+/g).slice(0, 3).map(Number)
  const lum = (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000
  if (lum > 60) throw new Error(`body is not dark: ${bg}`)
})

await step('5 · data survives a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const after = await state()
  for (const k of ['doseLogs', 'peptides', 'symptomLogs', 'measurements', 'supplements', 'vials', 'skips']) {
    if ((after[k]?.length ?? 0) !== (before[k]?.length ?? 0)) throw new Error(`${k} changed across a reload`)
  }
  console.log(`  ${after.peptides.length} compounds · ${after.doseLogs.length} logs · ${after.vials.length} vials intact`)
})

await step('5 · a save from before v30.1 keeps its data and loses only the theme', async () => {
  // A real upgrade: a v10 save, carrying a dose log, a symptom check-in, a
  // measurement and a light-mode preference.
  const seeded = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    const d = new Date().toISOString().slice(0, 10)
    s.settings.theme = 'light'
    s.doseLogs = [
      ...(s.doseLogs || []),
      { id: 'mig-1', peptideId: s.peptides[0].id, date: d, loggedAt: `${d}T08:00:00.000Z`, doseValue: 250, unit: 'mcg', route: 'SubQ' },
    ]
    s.symptomLogs = [...(s.symptomLogs || []), { id: 'mig-s', date: d, tags: [], note: 'kept', activePeptides: [] }]
    s.measurements = [...(s.measurements || []), { id: 'mig-m', date: d, weight: 84 }]
    s.supplements = [...(s.supplements || []), { id: 'mig-sup', name: 'Magnesium', slot: 'PM', dose: '400 mg' }]
    raw.version = 10
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
    return { logs: s.doseLogs.length, symptoms: s.symptomLogs.length, measurements: s.measurements.length, supplements: s.supplements.length }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1400)
  const after = await state()
  if (after.doseLogs.length !== seeded.logs) throw new Error(`the migration changed doseLogs: ${seeded.logs} → ${after.doseLogs.length}`)
  if (!after.doseLogs.some((l) => l.id === 'mig-1')) throw new Error('the seeded dose log is gone')
  if (after.symptomLogs.length !== seeded.symptoms) throw new Error('symptom check-ins changed')
  if (after.measurements.length !== seeded.measurements) throw new Error('measurements changed')
  if (after.supplements.length !== seeded.supplements) throw new Error('supplements changed')
  if (after.settings.theme) throw new Error('settings.theme survived the migration')
  if (await page.evaluate(() => document.documentElement.dataset.theme)) throw new Error('the root gained a theme again')
  console.log(`  upgraded from v10: ${after.doseLogs.length} logs, ${after.supplements.length} supplements, theme dropped`)
})

await step('5 · every screen renders with no overflow', async () => {
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'More']) {
    await nav(tab)
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    if (w > 391) throw new Error(`${tab} overflows to ${w}px`)
  }
  await nav('Home')
  await page.screenshot({ path: `${SHOT}/v33-home.png` })
  await more('history')
  await page.screenshot({ path: `${SHOT}/v33-history.png`, fullPage: true })
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
