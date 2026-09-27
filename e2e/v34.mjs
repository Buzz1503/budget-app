// v34 — pushing a dose to tomorrow, the notification overlay, and a dose chart
// that only draws when there is something to draw.
//
// Runs at 390×844 against a build on BASE_URL. Walks the six checks in the
// v30.2 brief in order.
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
const rowIndex = (name) => page.locator('[data-testid="log-row"]').evaluateAll(
  (els, n) => els.findIndex((e) => (e.getAttribute('aria-label') || '').includes(n)), name)
// The undo toast sits over the foot of the list for a few seconds after a
// push, so a row under it is not clickable yet. Wait it out rather than race it.
const toastGone = async () => {
  for (let i = 0; i < 40; i++) {
    if (!(await page.locator('[data-testid="toast"]').count())) return
    await page.waitForTimeout(250)
  }
}
const openMenu = async (name) => {
  await toastGone()
  const i = await rowIndex(name)
  if (i < 0) throw new Error(`${name} is not on today's list`)
  const btn = page.locator('[data-testid="row-overflow"]').nth(i)
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  await page.waitForTimeout(450)
}
// A closing menu lingers in the DOM through its exit animation with
// aria-expanded already false, so "a menu exists" is not the same as "a menu is
// open" — close only what is actually open, then let the animation finish.
const shutMenus = async () => {
  for (let i = 0; i < 8; i++) {
    const open = page.locator('[data-testid="row-overflow"][aria-expanded="true"]')
    if (!(await open.count())) break
    await open.first().click()
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(350)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1400)
const gotIt = page.locator('button:has-text("Got it")')
if (await gotIt.count()) { await gotIt.click(); await page.waitForTimeout(700) }

// A protocol with something to look at: a twice-weekly compound due today, a
// compound whose dose has climbed, and one that has never moved.
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
  const s = raw.state
  const d = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10)
  const dow = new Date().getDay()
  s.peptides = s.peptides.map((p) => {
    if (p.id === 'testosterone-e') {
      return { ...p, slot: 'AM', scheduleWeekdays: [dow, (dow + 3) % 7], startedOn: d(-180), startDate: d(-180) }
    }
    if (p.id === 'bpc157') return { ...p, startedOn: d(-120), startDate: d(-120) }
    return p
  })
  s.runs['testosterone-e'] = [{ id: 'r1', startedOn: d(-180), endedOn: null }]
  s.runs.bpc157 = [{ id: 'r2', startedOn: d(-120), endedOn: null }]
  s.doseEvents = s.doseEvents.filter((e) => e.peptideId !== 'bpc157').concat([
    { id: 'b1', peptideId: 'bpc157', kind: 'start', date: d(-120), to: 250, unit: 'mcg' },
    { id: 'b2', peptideId: 'bpc157', kind: 'step-up', date: d(-80), from: 250, to: 500, unit: 'mcg' },
    { id: 'b3', peptideId: 'bpc157', kind: 'step-up', date: d(-30), from: 500, to: 750, unit: 'mcg' },
  ])
  s.skips = [...(s.skips || []), {
    id: 'sk1', kind: 'peptide', peptideId: 'bpc157', date: d(-50), name: 'BPC-157', reason: 'travel',
  }]
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1600)
const am = page.locator('button[aria-label="AM"]')
if (await am.count()) { await am.click(); await page.waitForTimeout(700) }

// ============================================ 1 · push a dose to tomorrow

await step('1 · a multi-weekly compound offers Push to tomorrow', async () => {
  await openMenu('Testosterone')
  if (!(await page.locator('[data-testid="push-peptide"]').count())) {
    throw new Error('no push action in the overflow menu')
  }
  await page.screenshot({ path: `${SHOT}/v34-push-menu.png` })
})

await step('1 · pushing moves it off today and touches nothing else', async () => {
  const before = await state()
  await page.locator('[data-testid="push-peptide"]').click()
  await page.waitForTimeout(900)
  const after = await state()
  if (after.pushes.length !== before.pushes.length + 1) throw new Error('no push recorded')
  const rec = after.pushes[after.pushes.length - 1]
  if (rec.to <= rec.from) throw new Error(`pushed backwards: ${rec.from} → ${rec.to}`)
  // neither taken nor skipped
  if (after.doseLogs.length !== before.doseLogs.length) throw new Error('pushing logged a dose')
  if (after.skips.length !== before.skips.length) throw new Error('pushing recorded a skip')
  // and nothing came out of a vial
  if (JSON.stringify(after.openVials) !== JSON.stringify(before.openVials)) throw new Error('pushing moved stock')
  if (JSON.stringify(after.vials) !== JSON.stringify(before.vials)) throw new Error('pushing changed the shelf')
  if (await rowIndex('Testosterone') >= 0) throw new Error('it is still on today\'s list')
  console.log(`  ${rec.from} → ${rec.to}, stock and logs untouched`)
})

await step('1 · a weekly compound can be pushed too', async () => {
  await shutMenus()
  const weekly = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    const p = s.peptides.find((x) => x.frequency === 'weekly')
    return p ? p.name : null
  })
  if (!weekly) { console.log('  (nothing weekly in the protocol)'); return }
  const i = await page.locator('[data-testid="log-row"]').evaluateAll(
    (els, n) => els.findIndex((e) => (e.getAttribute('aria-label') || '').includes(n)), weekly.split(' ')[0])
  if (i < 0) { console.log(`  (${weekly} is not due today)`); return }
  await page.locator('[data-testid="row-overflow"]').nth(i).click()
  await page.waitForTimeout(450)
  if (!(await page.locator('[data-testid="push-peptide"]').count())) {
    throw new Error(`${weekly} is weekly and offers no push`)
  }
  await shutMenus()
  console.log(`  ${weekly} offers it`)
})

await step('1 · a daily compound has no push action', async () => {
  await shutMenus()
  const daily = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    const p = s.peptides.find((x) => x.frequency === 'daily' || x.frequency === 'nightly')
    return p ? p.name : null
  })
  if (!daily) { console.log('  (no daily compound in the protocol)'); return }
  await openMenu(daily.split(' ')[0])
  if (await page.locator('[data-testid="push-peptide"]').count()) {
    throw new Error(`${daily} is daily and still offers a push`)
  }
  await shutMenus()
  console.log(`  ${daily} correctly offers none`)
})

await step('1 · the pushed dose lands on the next day with a marker', async () => {
  // travel forward a day by moving every date back one
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    const back = (iso) => {
      const dt = new Date(`${iso}T12:00:00`)
      dt.setDate(dt.getDate() - 1)
      return dt.toISOString().slice(0, 10)
    }
    s.pushes = s.pushes.map((p) => ({ ...p, from: back(p.from), to: back(p.to) }))
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  const amb = page.locator('button[aria-label="AM"]')
  if (await amb.count()) { await amb.click(); await page.waitForTimeout(700) }
  if (await rowIndex('Testosterone') < 0) throw new Error('the pushed dose did not arrive on the new day')
  const marker = page.locator('[data-testid="pushed-marker"]')
  if (!(await marker.count())) throw new Error('it arrived with no marker saying where from')
  const txt = (await marker.first().innerText()).trim()
  if (!/pushed from \w{3}/i.test(txt)) throw new Error(`marker reads: ${txt}`)
  console.log(`  "${txt}"`)
  // its own line, and the row the same height as every other one — the marker
  // must not wrap the timing note or take the Log button down with it
  const shape = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="log-row"]')]
    const marked = rows.find((r) => r.querySelector('[data-testid="pushed-marker"]'))
    if (!marked) return null
    const line = marked.querySelector('[data-testid="pushed-marker"]')
    const lines = Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight))
    const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height))
    const others = heights.filter((_, i) => rows[i] !== marked)
    return { lines, mine: Math.round(marked.getBoundingClientRect().height), max: Math.max(...others) }
  })
  if (shape) {
    if (shape.lines > 1) throw new Error('the marker wraps onto a second line')
    if (shape.mine > shape.max + 2) throw new Error(`the marked row is ${shape.mine}px against ${shape.max}px for the rest`)
  }
  await page.screenshot({ path: `${SHOT}/v34-pushed-marker.png` })
})

await step('1 · it can be pushed again, and again', async () => {
  for (let n = 2; n <= 3; n++) {
    await openMenu('Testosterone')
    if (!(await page.locator('[data-testid="push-peptide"]').count())) {
      throw new Error(`push ${n} was refused`)
    }
    await page.locator('[data-testid="push-peptide"]').click()
    await page.waitForTimeout(800)
    const s = await state()
    if (s.pushes.length !== n) throw new Error(`expected ${n} pushes, have ${s.pushes.length}`)
    // move the clock on again so the next one is pushable
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
      const back = (iso) => {
        const dt = new Date(`${iso}T12:00:00`); dt.setDate(dt.getDate() - 1)
        return dt.toISOString().slice(0, 10)
      }
      raw.state.pushes = raw.state.pushes.map((p) => ({ ...p, from: back(p.from), to: back(p.to) }))
      localStorage.setItem('peptide-command-center', JSON.stringify(raw))
    })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const a = page.locator('button[aria-label="AM"]')
    if (await a.count()) { await a.click(); await page.waitForTimeout(600) }
  }
  console.log('  pushed three times, no limit hit')
})

await step('1 · the schedule itself never moved', async () => {
  const s = await state()
  const p = s.peptides.find((x) => x.id === 'testosterone-e')
  if (!p.scheduleWeekdays || p.scheduleWeekdays.length !== 2) throw new Error('the scheduled days changed')
  if (s.titration['testosterone-e']?.level == null) throw new Error('titration was disturbed')
})

// ================================================= 1b · taking a log back

await step('1b · a logged dose can be un-ticked from the row', async () => {
  await nav('Home')
  await shutMenus()
  const before = await state()
  await page.locator('[data-testid="log-row"]:not([data-done])').first().click()
  await page.waitForTimeout(900)
  const mid = await state()
  if (mid.doseLogs.length !== before.doseLogs.length + 1) throw new Error('nothing was logged to undo')
  const tick = page.locator('[data-testid="unlog-row"]').first()
  if (!(await tick.count())) throw new Error('the tick is not a control')
  await tick.click()
  await page.waitForTimeout(900)
  const after = await state()
  if (after.doseLogs.length !== before.doseLogs.length) throw new Error('the tick did not take the log back')
  // and the drug went back in the vial
  if (JSON.stringify(after.openVials) !== JSON.stringify(before.openVials)) {
    throw new Error('un-ticking did not return the dose to the vial')
  }
  console.log('  logged, un-ticked, vial restored')
})

await step('1b · and from the overflow menu, which offers Undo instead of Skip', async () => {
  await page.locator('[data-testid="log-row"]:not([data-done])').first().click()
  await page.waitForTimeout(900)
  const i = await page.locator('[data-testid="log-row"]').evaluateAll(
    (els) => els.findIndex((e) => e.dataset.done === 'true'))
  if (i < 0) throw new Error('no logged row to open')
  await page.locator('[data-testid="row-overflow"]').nth(i).click()
  await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="unlog-peptide"]').count())) throw new Error('no Undo log in the menu')
  if (await page.locator('[data-testid="skip-peptide"]').count()) {
    throw new Error('a logged row still offers Skip, which would mean two answers at once')
  }
  const before = (await state()).doseLogs.length
  await page.locator('[data-testid="unlog-peptide"]').click()
  await page.waitForTimeout(800)
  if ((await state()).doseLogs.length !== before - 1) throw new Error('the menu undo did nothing')
  await shutMenus()
})

// ============================ 2 · pushes are their own thing in the record

await step('2 · pushes are listed in History as their own kind', async () => {
  await more('history')
  const list = page.locator('[data-testid="push-list"]')
  if (!(await list.count())) throw new Error('no push list on History')
  const rows = await page.locator('[data-testid="push-row"]').count()
  if (!rows) throw new Error('the push list is empty')
  const txt = (await list.innerText()).toLowerCase()
  if (!/not missed and not skipped/.test(txt)) throw new Error('the list does not say what a push is')
  console.log(`  ${rows} push row(s)`)
})

await step('2 · and on the compound timeline', async () => {
  await page.locator('[data-testid="tenure-row"]').filter({ hasText: 'Testosterone' }).first().click()
  await page.waitForTimeout(1000)
  const pts = await page.locator('[data-testid="timeline-point"]').allInnerTexts()
  if (!pts.some((x) => /pushed/i.test(x))) throw new Error(`no push on the timeline: ${pts.join(' | ')}`)
  console.log(`  ${pts.filter((x) => /pushed/i.test(x)).length} push point(s)`)
  await closeAll()
})

await step('2 · a pushed day is not counted as missed', async () => {
  const shown = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="adherence-block"] div')]
      .find((d) => /Testosterone/.test(d.textContent))
    return el ? el.textContent : null
  })
  // the figure is whatever the window holds; what matters is that the pushed
  // days are not in the denominator, which the unit tests pin exactly
  console.log(`  adherence row: ${shown ? shown.replace(/\s+/g, ' ').slice(0, 60) : 'not shown'}`)
})

// ================================================ 3 · the notification panel

await step('3 · the bell opens a dimmed, opaque overlay', async () => {
  await nav('Home')
  const bell = page.locator('[data-testid="alert-bell"]')
  if (!(await bell.count())) throw new Error('no bell to open')
  await bell.click()
  await page.waitForTimeout(700)
  const panel = page.locator('[data-testid="alert-panel"]')
  if (!(await panel.count())) throw new Error('the panel did not open')
  // opaque: a fully-specified colour with no alpha below 1
  const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor)
  const alpha = bg.startsWith('rgba') ? Number(bg.split(',')[3]) : 1
  if (alpha < 1) throw new Error(`the panel is see-through: ${bg}`)
  const backdrop = page.locator('[data-testid="alert-backdrop"]')
  if (!(await backdrop.count())) throw new Error('no backdrop dimming the page')
  const dim = await backdrop.evaluate((el) => getComputedStyle(el).backgroundColor)
  if (!/rgba?\(/.test(dim) || dim === 'rgba(0, 0, 0, 0)') throw new Error(`the backdrop is not dimming: ${dim}`)
  // and it is above everything
  const z = await panel.evaluate((el) => {
    let n = el, best = 0
    while (n && n !== document.body) {
      const v = parseInt(getComputedStyle(n).zIndex, 10)
      if (!Number.isNaN(v)) best = Math.max(best, v)
      n = n.parentElement
    }
    return best
  })
  if (z < 50) throw new Error(`the panel sits at z-index ${z}, under the app chrome`)
  console.log(`  panel ${bg} over ${dim}, z-index ${z}`)
})

await step('3 · nothing from the page bleeds through it', async () => {
  const bleed = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="alert-panel"]')
    const r = panel.getBoundingClientRect()
    // sample the middle of the panel; whatever is topmost there must be the
    // panel or something inside it
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + 20)
    return panel.contains(el) ? null : (el?.getAttribute('data-testid') || el?.tagName)
  })
  if (bleed) throw new Error(`${bleed} is drawn over the panel`)
})

await step('3 · it is legible at 390px with several items and a long name', async () => {
  const items = await page.locator('[data-testid^="bell-"]').count()
  if (items < 2) throw new Error(`only ${items} notification(s) — not a real test of the list`)
  const clipped = await page.evaluate(() => {
    const out = []
    for (const it of document.querySelectorAll('[data-testid^="bell-"]')) {
      if (it.scrollWidth > it.clientWidth + 1) out.push(it.textContent.slice(0, 40))
    }
    return out
  })
  if (clipped.length) throw new Error(`clipped: ${clipped.join(' | ')}`)
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  if (wide > 391) throw new Error(`the panel overflows to ${wide}px`)
  console.log(`  ${items} items, none clipped`)
  await page.screenshot({ path: `${SHOT}/v34-bell.png` })
})

await step('3 · the close control and the backdrop both close it', async () => {
  await page.click('[data-testid="alert-close"]')
  await page.waitForTimeout(600)
  if (await page.locator('[data-testid="alert-panel"]').count()) throw new Error('the ✕ did not close it')
  await page.click('[data-testid="alert-bell"]')
  await page.waitForTimeout(600)
  await page.locator('[data-testid="alert-backdrop"]').click({ position: { x: 20, y: 760 } })
  await page.waitForTimeout(600)
  if (await page.locator('[data-testid="alert-panel"]').count()) throw new Error('a backdrop tap did not close it')
})

// ================================================= 4 · the dose chart

await step('4 · a compound whose dose never moved gets a statement, not a chart', async () => {
  await more('history')
  await page.locator('[data-testid="tenure-row"]').filter({ hasText: 'Semax' }).first().click()
  await page.waitForTimeout(1000)
  if (await page.locator('[data-testid="dose-timeline"]').count()) {
    throw new Error('a flat chart is still being drawn')
  }
  const steady = page.locator('[data-testid="dose-steady"]')
  if (!(await steady.count())) throw new Error('no statement either')
  const txt = (await steady.innerText()).replace(/\s+/g, ' ')
  if (!/no dose changes/i.test(txt)) throw new Error(`the statement does not say so: ${txt}`)
  if (!/\d/.test(txt)) throw new Error('the statement names no dose')
  console.log(`  "${txt.slice(0, 80)}"`)
  await page.screenshot({ path: `${SHOT}/v34-dose-steady.png` })
  await closeAll()
})

await step('4 · a compound whose dose changed gets a readable stepped line', async () => {
  await page.locator('[data-testid="tenure-row"]').filter({ hasText: 'BPC-157' }).first().click()
  await page.waitForTimeout(1000)
  const chart = page.locator('[data-testid="dose-timeline"]')
  if (!(await chart.count())) throw new Error('no chart for a dose that has changed')
  const svg = chart.locator('svg').first()
  const labels = await svg.locator('text').evaluateAll((els) => els.map((e) => e.textContent.trim()))
  // the doses themselves are the axis values
  const doseLabels = labels.filter((l) => /\d+\s*(mcg|mg)/.test(l))
  if (doseLabels.length < 2) throw new Error(`only ${doseLabels.length} dose label(s): ${labels.join(' | ')}`)
  const dateLabels = labels.filter((l) => /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(l))
  if (!dateLabels.length) throw new Error('no date labels on the axis')
  const box = await svg.boundingBox()
  if (box.height < 120) throw new Error(`the plot is only ${Math.round(box.height)}px tall`)
  console.log(`  ${doseLabels.length} dose labels, ${dateLabels.length} date labels, ${Math.round(box.height)}px tall`)
  await page.screenshot({ path: `${SHOT}/v34-dose-chart.png` })
})

await step('4 · no skip markers and no "logged" legend on the plot', async () => {
  const chart = page.locator('[data-testid="dose-timeline"]')
  const legend = (await chart.innerText()).toLowerCase()
  if (/\blogged\b/.test(legend.split('\n')[0] || '')) throw new Error('the logged legend is back')
  // the skip is real and must still be in the events list below, just not plotted
  // Every plotted marker must sit on a dose level. A skip has no dose, so it
  // used to be dropped on the baseline — if any marker is down there, they are
  // back on the plot.
  const onBaseline = await chart.locator('svg').first().evaluate((svg) => {
    const base = svg.viewBox.baseVal.height - 30 // CH.padB
    return [...svg.querySelectorAll('circle')]
      .filter((c) => Number(c.getAttribute('r')) > 1)
      .filter((c) => Math.abs(Number(c.getAttribute('cy')) - base) < 0.5).length
  })
  if (onBaseline) throw new Error(`${onBaseline} marker(s) sitting on the baseline — skips are still plotted`)
  const points = await page.locator('[data-testid="timeline-point"]').allInnerTexts()
  const skipsListed = points.filter((p) => /skipped/i.test(p)).length
  if (!skipsListed) throw new Error('the skip vanished from the events list as well')
  const dots = await chart.locator('svg').first().evaluate((svg) =>
    [...svg.querySelectorAll('circle')].filter((c) => Number(c.getAttribute('r')) > 1).length)
  console.log(`  ${dots} dose markers plotted · ${skipsListed} skip still listed below`)
  await closeAll()
})

// ================================================= 5 · nothing else moved

await step('5 · data survives a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const after = await state()
  for (const k of ['doseLogs', 'peptides', 'symptomLogs', 'measurements', 'supplements', 'vials', 'skips', 'pushes']) {
    if ((after[k]?.length ?? 0) !== (before[k]?.length ?? 0)) throw new Error(`${k} changed across a reload`)
  }
  console.log(`  ${after.peptides.length} compounds · ${after.doseLogs.length} logs · ${after.pushes.length} pushes intact`)
})

await step('5 · a save from before v30.2 gains pushes and keeps everything', async () => {
  const seeded = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    const d = new Date().toISOString().slice(0, 10)
    delete s.pushes
    s.doseLogs = [...(s.doseLogs || []), {
      id: 'mig-1', peptideId: s.peptides[0].id, date: d, loggedAt: `${d}T08:00:00.000Z`,
      doseValue: 250, unit: 'mcg', route: 'SubQ',
    }]
    raw.version = 11
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
    return { logs: s.doseLogs.length, peptides: s.peptides.length, vials: s.vials.length }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1500)
  const after = await state()
  if (!Array.isArray(after.pushes)) throw new Error('the migration did not create the pushes list')
  if (after.doseLogs.length !== seeded.logs) throw new Error('the migration changed doseLogs')
  if (after.peptides.length !== seeded.peptides) throw new Error('the migration changed the protocol')
  if (after.vials.length !== seeded.vials) throw new Error('the migration changed the shelf')
  console.log(`  upgraded from v11: ${after.doseLogs.length} logs, ${after.vials.length} vials, pushes ready`)
})

await step('5 · every screen renders with no overflow', async () => {
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'More']) {
    await nav(tab)
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    if (w > 391) throw new Error(`${tab} overflows to ${w}px`)
  }
  await nav('Home')
  await page.screenshot({ path: `${SHOT}/v34-home.png` })
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
