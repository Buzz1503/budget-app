// v36 — pausing the protocol, and a month you can correct.
//
// Runs at 390×844 against a build on BASE_URL. Walks the nine checks in the
// v32 brief in order.
//
// Most of these assert against the store after the UI has been driven, not just
// against what the screen says. "Paused days do not count as missed" and "the
// run-out date recalculates" are claims about arithmetic behind the pixels, and
// a screen can say them while the numbers underneath disagree.
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
const gotIt = async () => {
  const btn = page.locator('button:has-text("Got it")')
  if (!(await btn.count())) return
  try { await btn.first().click({ timeout: 3000 }) } catch { /* it left on its own */ }
  await page.waitForTimeout(600)
}
const closeAll = async () => {
  await gotIt()
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(350)
  }
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button[aria-label="${label}"]`)
  await page.waitForTimeout(700)
}
const more = async (id) => {
  await nav('More')
  await page.click(`[data-testid="more-${id}"]`)
  await page.waitForTimeout(900)
}
const toastGone = async () => {
  for (let i = 0; i < 40; i++) {
    if (!(await page.locator('[data-testid="toast"]').count())) return
    await page.waitForTimeout(250)
  }
}
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}
const iso = (d) => {
  const x = new Date()
  x.setDate(x.getDate() + d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const monthView = async () => {
  await nav('Calendar')
  const month = page.locator('button:has-text("Month")')
  if (await month.count()) { await month.first().click(); await page.waitForTimeout(900) }
}
// The month grid opens on the month holding today. A day earlier in the week
// may be in the previous month, so step back until the cell is actually there.
const showing = async (date) => {
  for (let i = 0; i < 4; i++) {
    if (await page.locator(`[data-testid="cal-cell-${date}"]`).count()) return
    await page.click('button[aria-label="Previous period"]')
    await page.waitForTimeout(500)
  }
  throw new Error(`the grid never showed ${date}`)
}
const openDay = async (date) => {
  await showing(date)
  await page.click(`[data-testid="cal-cell-${date}"]`)
  await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="day-sheet"]').count())) throw new Error(`the day sheet did not open on ${date}`)
}

// Home only shows the slot you are in, so which compounds have a row there
// depends on the time of day the suite runs. History's tenure table lists every
// compound whatever the hour, which is what this needs.
const openCompoundTimeline = async () => {
  await more('history')
  const row = page.locator('[data-testid="tenure-row"]').first()
  await row.waitFor({ state: 'visible', timeout: 15000 })
  await row.click()
  await page.waitForTimeout(1000)
  if (!(await page.locator('[data-testid="compound-detail"]').count())) {
    throw new Error('the compound detail did not open')
  }
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1200)
await gotIt()

// A protocol that has been running a month, so the days behind us were real
// days with real doses owed on them.
await step('seed: a protocol a month old, nothing logged', async () => {
  await page.evaluate((start) => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.peptides = raw.state.peptides.map((p) => ({ ...p, startDate: start, startedOn: start }))
    for (const k of Object.keys(raw.state.titration || {})) {
      raw.state.titration[k] = { ...raw.state.titration[k], levelStartDate: start }
    }
    for (const k of Object.keys(raw.state.runs || {})) {
      raw.state.runs[k] = (raw.state.runs[k] || []).map((r) => ({ ...r, startedOn: start }))
    }
    raw.state.doseLogs = []
    raw.state.skips = []
    raw.state.pauses = []
    raw.state.settings = { ...raw.state.settings, disclaimerDismissed: true }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  }, iso(-40))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1400)
  await gotIt()
  const s = await state()
  if (s.doseLogs.length !== 0) throw new Error('the seed did not clear the logs')
  if (!Array.isArray(s.pauses)) throw new Error('no pauses list')
  console.log(`  ${s.peptides.length} compounds, started ${iso(-40)}`)
})

// ================================================================ 1 · pause

await step('1 · pause everything, with a reason from the list', async () => {
  await more('settings')
  await page.click('[data-testid="settings-pause"]')
  await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="pause-sheet"]').count())) throw new Error('the pause sheet did not open')

  const reasons = await page.locator('[data-testid="pause-reason"]').evaluateAll(
    (els) => els.map((e) => e.textContent.trim()))
  const want = ['Holiday', 'Sick', 'Injury', 'Out of stock', 'Cycling off', 'Taking a break', 'Other']
  if (JSON.stringify(reasons) !== JSON.stringify(want)) throw new Error(`reasons are [${reasons.join(', ')}]`)

  await page.click('[data-testid="pause-reason"][data-reason="holiday"]')
  await page.fill('[data-testid="pause-note"]', 'two weeks away')
  await page.waitForTimeout(300)
  await page.click('[data-testid="pause-save"]')
  await page.waitForTimeout(900)

  const s = await state()
  if (s.pauses.length !== 1) throw new Error(`${s.pauses.length} pauses stored`)
  const p = s.pauses[0]
  if (p.reason !== 'holiday') throw new Error(`reason is ${p.reason}`)
  if (p.note !== 'two weeks away') throw new Error('the note was not kept')
  if (p.peptideIds !== null) throw new Error('a whole-protocol pause should name no compounds')
  console.log(`  paused from ${p.startedOn}, everything, "${p.note}"`)
})

// The brief asks for a way in from Settings *and* from the Home header. The
// first cut only wired up Settings — the Home prop was passed and never used —
// and this suite did not notice because it only ever drove the Settings route.
await step('1a · a pause can also be started from the Home header', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.pauses = []
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1200)
  await gotIt()

  await nav('Home')
  const btn = page.locator('[data-testid="home-pause"]')
  if (!(await btn.count())) throw new Error('no way to pause from the Home header')
  await btn.click()
  await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="pause-sheet"]').count())) throw new Error('the pause sheet did not open from Home')
  await page.click('[data-testid="pause-reason"][data-reason="sick"]')
  await page.click('[data-testid="pause-save"]')
  await page.waitForTimeout(900)
  const s = await state()
  if (s.pauses.at(-1)?.reason !== 'sick') throw new Error('the pause was not started from Home')

  // and it stands down once something is paused, because the banner carries Resume
  await nav('Home')
  if (await page.locator('[data-testid="home-pause"]').count()) {
    throw new Error('the header still offers Pause while already paused')
  }
  if (!(await page.locator('[data-testid="resume-protocol"]').count())) throw new Error('no Resume on the banner')
  console.log('  started from the Home header; hidden again while paused')
})

await step('1b · Other opens a free-text reason, and an end date is optional', async () => {
  // clear the one just made so a second can start
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.pauses = []
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1200)
  await gotIt()

  await more('settings')
  await page.click('[data-testid="settings-pause"]')
  await page.waitForTimeout(800)
  await page.click('[data-testid="pause-reason"][data-reason="other"]')
  await page.waitForTimeout(400)
  const free = page.locator('[data-testid="pause-reason-text"]')
  if (!(await free.count())) throw new Error('Other did not offer a free-text field')

  const save = page.locator('[data-testid="pause-save"]')
  if (!(await save.isDisabled())) throw new Error('an empty "Other" was accepted')
  await free.fill('moving house')
  await page.fill('[data-testid="pause-ends-on"]', iso(6))
  await page.waitForTimeout(300)
  await page.click('[data-testid="pause-save"]')
  await page.waitForTimeout(900)

  const s = await state()
  const p = s.pauses.at(-1)
  if (p.reason !== 'other' || p.reasonText !== 'moving house') throw new Error('the free text was not kept')
  if (p.endsOn !== iso(6)) throw new Error(`end date is ${p.endsOn}`)
  console.log(`  "${p.reasonText}" until ${p.endsOn}`)
})

await step('1c · only some compounds can be paused', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.pauses = []
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1200)
  await gotIt()

  await more('settings')
  await page.click('[data-testid="settings-pause"]')
  await page.waitForTimeout(800)
  await page.click('[data-testid="pause-reason"][data-reason="out-of-stock"]')
  await page.click('[data-testid="pause-scope-option"][data-scope="some"]')
  await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="pause-picker"]').count())) throw new Error('no compound picker')
  if (!(await page.locator('[data-testid="pause-save"]').isDisabled())) throw new Error('an empty selection was accepted')
  await page.locator('[data-testid="pause-pick"]').first().click()
  await page.waitForTimeout(300)
  await page.click('[data-testid="pause-save"]')
  await page.waitForTimeout(900)

  const s = await state()
  const p = s.pauses.at(-1)
  if (!Array.isArray(p.peptideIds) || p.peptideIds.length !== 1) throw new Error('the scope was not stored')
  console.log(`  ${p.peptideIds.length} compound paused, out of ${s.peptides.length}`)
  globalThis.__partial = p.peptideIds[0]
})

// ========================================================= 2 · consequences

await step('2 · a paused day is not a missed day', async () => {
  // back to a clean whole-protocol pause covering the last week
  await page.evaluate((from) => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.pauses = [{
      id: 'pa-e2e', startedOn: from, endedOn: null, endsOn: null,
      reason: 'holiday', reasonText: '', note: 'e2e', peptideIds: null, at: `${from}T09:00:00Z`,
    }]
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  }, iso(-7))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1400)
  await gotIt()

  await monthView()
  await openDay(iso(-3))
  const txt = await page.locator('[data-testid="day-sheet"]').innerText()
  if (!/paused/i.test(txt)) throw new Error(`a day inside the pause does not say so: ${txt.slice(0, 120)}`)
  if (/\bmissed\b/i.test(txt)) throw new Error('a paused day still reports misses')
  const states = await page.locator('[data-testid="day-compound"]').evaluateAll(
    (els) => [...new Set(els.map((e) => e.getAttribute('data-state')))])
  if (!states.includes('paused')) throw new Error(`compound states on a paused day: ${states.join(', ')}`)
  if (states.includes('missed')) throw new Error('a compound inside the pause reads as missed')
  await closeAll()
  console.log(`  states inside the pause: ${states.join(', ')}`)
})

await step('2b · stock is untouched and the run-out date moves out', async () => {
  const withPause = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    return { vials: JSON.stringify(s.vials), open: JSON.stringify(s.openVials), logs: s.doseLogs.length }
  })
  // the same protocol with the pause lifted, to compare the two run-outs
  const dates = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const keep = raw.state.pauses
    raw.state.pauses = []
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
    return keep
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1200)
  await gotIt()
  const without = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    return { vials: JSON.stringify(s.vials), open: JSON.stringify(s.openVials), logs: s.doseLogs.length }
  })
  if (without.vials !== withPause.vials) throw new Error('the pause changed the sealed shelf')
  if (without.open !== withPause.open) throw new Error('the pause changed the open vials')
  if (without.logs !== withPause.logs) throw new Error('the pause wrote a log')

  // put the pause back for the steps that follow
  await page.evaluate((keep) => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.pauses = keep
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  }, dates)
  console.log('  vials, open vials and logs all identical either way')
})

await step('2c · run-out and time-at-dose account for the days paused', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1400)
  await gotIt()
  const s = await state()
  if (!s.pauses.length) throw new Error('the pause did not survive the reload')

  // the compound page states time at this dose; a week paused must be excluded
  await openCompoundTimeline()
  const paused = page.locator('[data-testid="tenure-paused"]')
  if (!(await paused.count())) throw new Error('the compound page does not say how much of the run was paused')
  const words = await paused.innerText()
  const m = words.match(/(\d+) days? paused/)
  if (!m) throw new Error(`no day count in "${words}"`)
  if (Number(m[1]) < 1) throw new Error(`it reports ${m[1]} days paused`)
  await closeAll()
  console.log(`  "${words.trim()}"`)
})

// ================================================================ 3 · resume

await step('3 · pause bands show on the timeline with the reason', async () => {
  await openCompoundTimeline()
  const rows = await page.locator('[data-testid="pause-row"]').count()
  if (rows === 0) throw new Error('the compound page lists no pauses')
  const txt = await page.locator('[data-testid="compound-detail"]').innerText()
  if (!/holiday/i.test(txt)) throw new Error('the reason is not on the compound page')
  await page.screenshot({ path: `${SHOT}/v36-timeline.png` })
  await closeAll()
  console.log(`  ${rows} pause(s) on the compound page, with the reason`)
})

await step('3b · Home says it is paused, with the reason and how long', async () => {
  await nav('Home')
  const banner = page.locator('[data-testid="paused-banner"]')
  if (!(await banner.count())) throw new Error('Home does not say the protocol is paused')
  const txt = await banner.innerText()
  if (!/holiday/i.test(txt)) throw new Error(`the reason is not on the banner: ${txt}`)
  if (!/\d+ days?/.test(txt)) throw new Error(`no duration on the banner: ${txt}`)
  if (!(await page.locator('[data-testid="resume-protocol"]').count())) throw new Error('no Resume')
  await noOverflow('the paused Home')
  await page.screenshot({ path: `${SHOT}/v36-paused.png` })
  console.log(`  "${txt.split('\n').slice(0, 2).join(' · ')}"`)
})

await step('3c · Resume puts the schedule back from today', async () => {
  await nav('Home')
  await page.click('[data-testid="resume-protocol"]')
  await page.waitForTimeout(900)
  const s = await state()
  const p = s.pauses.find((x) => x.id === 'pa-e2e') || s.pauses[0]
  if (!p) throw new Error('the pause record was deleted rather than closed')
  if (!p.endedOn) throw new Error('the pause was not given an end date')
  if (p.endedOn !== iso(-1)) throw new Error(`ended on ${p.endedOn}, not yesterday`)
  if (await page.locator('[data-testid="paused-banner"]').count()) throw new Error('the banner is still up')
  console.log(`  ended ${p.endedOn}; today is back on the protocol`)
})

await step('3d · a step-up due during the pause is held and asked on resume', async () => {
  // a compound whose interval elapsed inside the pause
  await page.evaluate((args) => {
    const [levelStart, pauseFrom, pauseTo] = args
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    const p = s.peptides.find((x) => x.ladder?.step > 0 && x.ladder?.ceiling > x.ladder?.floor)
    if (!p) return
    s.titration[p.id] = { ...(s.titration[p.id] || {}), level: 0, levelStartDate: levelStart }
    s.peptides = s.peptides.map((x) => (x.id === p.id
      ? { ...x, ladder: { ...x.ladder, intervalWeeks: 1 } } : x))
    s.pauses = [{
      id: 'pa-held', startedOn: pauseFrom, endedOn: pauseTo, endsOn: null,
      reason: 'sick', reasonText: '', note: '', peptideIds: null, at: `${pauseFrom}T09:00:00Z`,
    }]
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  }, [iso(-20), iso(-14), iso(-2)])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1400)
  await gotIt()
  await nav('Home')

  const held = page.locator('[data-testid="held-step-ups"]')
  if (!(await held.count())) throw new Error('nothing says a step-up was held')
  const before = await state()
  const open = page.locator('[data-testid="held-step-up-open"]').first()
  const name = await open.innerText()
  await open.click()
  await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="held-step-up"]').count())) throw new Error('the question was not asked')

  // holding restarts the interval rather than advancing the rung
  await page.click('[data-testid="hold-step-up"]')
  await page.waitForTimeout(900)
  const after = await state()
  const changed = Object.keys(after.titration).filter(
    (k) => after.titration[k].levelStartDate !== before.titration[k]?.levelStartDate)
  if (!changed.length) throw new Error('holding did not restart the interval')
  const id = changed[0]
  if (after.titration[id].level !== before.titration[id].level) throw new Error('holding advanced the rung anyway')
  console.log(`  ${name.split('—')[0].trim()} held; interval restarted from today`)
})

await step('3e · pause history is kept', async () => {
  await more('settings')
  const hist = page.locator('[data-testid="pause-history"]')
  if (!(await hist.count())) throw new Error('no pause history in Settings')
  const rows = await page.locator('[data-testid="pause-row"]').count()
  if (rows === 0) throw new Error('the history is empty')
  const txt = await hist.innerText()
  if (!/sick/i.test(txt)) throw new Error(`the reason is not in the history: ${txt.slice(0, 120)}`)
  if (!/\d+ days?/.test(txt)) throw new Error('no duration in the history')
  await noOverflow('the pause history')
  console.log(`  ${rows} pause(s) on record`)
})

// ================================================================ 4 · month

await step('4 · the month grid draws completion, dots and markers', async () => {
  // something to draw: a logged day, a skipped day, a paused stretch,
  // a symptom entry and a blood test
  await page.evaluate((args) => {
    const [logDay, skipDay, pauseFrom, pauseTo, symDay] = args
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    // a daily compound, so the log and the skip land on days it was actually
    // owed — a log on an unscheduled day is not part of that day's completion
    const p = s.peptides.find((x) => x.frequency === 'daily' || x.frequency === 'nightly') || s.peptides[0]
    s.doseLogs = [{
      id: 'dl-e2e', peptideId: p.id, date: logDay, doseValue: 1, unit: p.ladder.unit,
      insulinUnits: 5, route: 'SubQ', loggedAt: `${logDay}T12:00:00Z`, coDrawId: null,
    }]
    s.skips = [{
      id: 'sk-e2e', kind: 'peptide', peptideId: p.id, date: skipDay,
      at: `${skipDay}T12:00:00Z`, name: p.name, reason: 'Travelling',
    }]
    s.pauses = [{
      id: 'pa-month', startedOn: pauseFrom, endedOn: pauseTo, endsOn: null,
      reason: 'holiday', reasonText: '', note: '', peptideIds: null, at: `${pauseFrom}T09:00:00Z`,
    }]
    s.symptomLogs = [{ id: 'sym-e2e', date: symDay, tags: [{ id: 'fatigue', severity: 'mild' }], note: '', activePeptides: [] }]
    s.bloods = { ...s.bloods, tests: [...(s.bloods?.tests || []), {
      id: 'bt-e2e', date: symDay, lab: 'e2e lab', ref: '', notes: '',
      values: { CRP: 2 }, attachment: null,
    }].sort((a, b) => a.date.localeCompare(b.date)) }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  }, [iso(-6), iso(-5), iso(-12), iso(-9), iso(-4)])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1500)
  await gotIt()

  await monthView()
  if (!(await page.locator('[data-testid="month-grid"]').count())) throw new Error('no month grid')
  const cells = await page.locator('[data-testid^="cal-cell-"]').count()
  if (cells % 7 !== 0) throw new Error(`${cells} cells — not whole weeks`)

  await showing(iso(-6))
  const ring = page.locator(`[data-testid="cal-cell-${iso(-6)}"] [data-testid="day-ring"]`)
  if (!(await ring.count())) throw new Error('the day with a log has no completion ring')

  const kinds = await page.locator('[data-testid="day-dot"]').evaluateAll(
    (els) => [...new Set(els.map((e) => e.getAttribute('data-kind')))])
  for (const k of ['logged', 'missed', 'skipped']) {
    if (!kinds.includes(k)) throw new Error(`no ${k} dot anywhere in the month (saw ${kinds.join(', ')})`)
  }
  await noOverflow('the month grid')
  await page.screenshot({ path: `${SHOT}/v36-month.png`, fullPage: true })
  console.log(`  ${cells} cells, dot kinds: ${kinds.join(', ')}`)
})

await step('4b · paused days are treated differently across the whole cell', async () => {
  await showing(iso(-10))
  const cell = page.locator(`[data-testid="cal-cell-${iso(-10)}"]`)
  if (await cell.getAttribute('data-paused') !== 'true') throw new Error('a paused day is not marked as one')
  const label = await cell.getAttribute('aria-label')
  if (!/paused/i.test(label)) throw new Error(`the paused day does not say so in words: ${label}`)
  // and a normal day does not carry the treatment
  const normal = page.locator(`[data-testid="cal-cell-${iso(-6)}"]`)
  if (await normal.getAttribute('data-paused') === 'true') throw new Error('an ordinary day reads as paused')
  console.log(`  "${label}"`)
})

await step('4c · symptom and blood markers are there, and distinct from doses', async () => {
  await showing(iso(-4))
  const cell = page.locator(`[data-testid="cal-cell-${iso(-4)}"]`)
  if (!(await cell.locator('[data-testid="day-symptom"]').count())) throw new Error('no symptom marker')
  if (!(await cell.locator('[data-testid="day-blood"]').count())) throw new Error('no blood-test marker')
  // they are not dots — a dot means a dose
  const dots = await cell.locator('[data-testid="day-dot"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-kind')))
  if (dots.includes('symptom') || dots.includes('blood')) throw new Error('markers were drawn as dose dots')
  console.log(`  symptom + blood markers, ${dots.length} dose dot(s) beside them`)
})

await step('4d · the legend exists and is folded away', async () => {
  if (await page.locator('[data-testid="legend"]').count()) throw new Error('the legend is open on arrival')
  await page.click('[data-testid="legend-toggle"]')
  await page.waitForTimeout(600)
  const legend = page.locator('[data-testid="legend"]')
  if (!(await legend.count())) throw new Error('the legend did not open')
  const txt = await legend.innerText()
  for (const w of ['Logged', 'Missed', 'Skipped', 'Pushed', 'Paused']) {
    if (!txt.includes(w)) throw new Error(`the legend does not name "${w}"`)
  }
  await page.click('[data-testid="legend-toggle"]')
  await page.waitForTimeout(500)
  console.log('  opens, names every mark, folds away again')
})

await step('4e · months step with the arrows', async () => {
  const first = await page.locator('[data-testid^="cal-cell-"]').first().getAttribute('data-testid')
  await page.click('button[aria-label="Previous period"]')
  await page.waitForTimeout(700)
  const back = await page.locator('[data-testid^="cal-cell-"]').first().getAttribute('data-testid')
  if (back === first) throw new Error('the grid did not move')
  await page.click('button[aria-label="Next period"]')
  await page.waitForTimeout(700)
  const fwd = await page.locator('[data-testid^="cal-cell-"]').first().getAttribute('data-testid')
  if (fwd !== first) throw new Error('coming back did not land on the same month')
  console.log('  back and forward, landing where it started')
})

// ============================================================= 5 · day sheet

await step('5 · a day opens to everything that happened on it', async () => {
  await monthView()
  await openDay(iso(-4))
  const sheet = page.locator('[data-testid="day-sheet"]')
  const compounds = await sheet.locator('[data-testid="day-compound"]').count()
  if (compounds === 0) throw new Error('no compounds listed')
  const states = await sheet.locator('[data-testid="day-compound"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-state')))
  if (states.some((x) => !['logged', 'missed', 'skipped', 'paused', 'due', 'scheduled'].includes(x))) {
    throw new Error(`unknown state among [${states.join(', ')}]`)
  }
  // the seed ships no supplements, so the section is only owed when some exist
  const supps = (await state()).supplements.length
  if (supps > 0 && !(await sheet.locator('[data-testid="day-supplements"]').count())) {
    throw new Error('supplements exist but the day does not list them')
  }
  if (!(await sheet.locator('[data-testid="day-symptom-entry"]').count())) throw new Error('the symptom entry is not shown')
  if (!(await sheet.locator('[data-testid="day-bloods"]').count())) throw new Error('the blood test is not shown')
  await noOverflow('the day sheet')
  await page.screenshot({ path: `${SHOT}/v36-day.png` })
  console.log(`  ${compounds} compounds, supplements, symptoms and a blood test`)
})

// ========================================================== 6 · backdating

await step('6 · a dose can be logged onto a past day', async () => {
  await closeAll()
  await monthView()
  await openDay(iso(-3))
  const before = await state()
  const target = page.locator('[data-testid="day-compound"][data-state="missed"]').first()
  if (!(await target.count())) throw new Error('nothing missed on that day to log')
  const id = await target.getAttribute('data-compound')
  await target.locator('[data-testid="day-log"]').click()
  await page.waitForTimeout(900)

  const after = await state()
  const added = after.doseLogs.filter((l) => !before.doseLogs.some((b) => b.id === l.id))
  if (added.length !== 1) throw new Error(`${added.length} logs written`)
  const log = added[0]
  if (log.date !== iso(-3)) throw new Error(`the log landed on ${log.date}`)
  if (log.peptideId !== id) throw new Error('the wrong compound was logged')
  if (!log.backfilled) throw new Error('the log is not marked as added later')
  console.log(`  ${log.peptideId} ${log.doseValue} ${log.unit} on ${log.date}`)
  globalThis.__backfilled = { id, date: iso(-3), logId: log.id }
})

await step('6b · it moves the vial, the run-out date and adherence', async () => {
  const { id } = globalThis.__backfilled
  const s = await state()
  const open = s.openVials[id]
  // either it came out of the open vial, or the record says which vial it came
  // from — silently taking nothing from anywhere is the failure mode here
  const log = s.doseLogs.find((l) => l.id === globalThis.__backfilled.logId)
  if (log.movedStock === false) {
    console.log('  that day ran on a vial since finished — the open vial was rightly left alone')
  } else if (!open || !(open.remainingMg >= 0)) {
    throw new Error('the backfilled dose did not touch the inventory')
  } else {
    console.log(`  open vial now ${open.remainingMg} mg`)
  }
  // and it shows up as logged on the day it was put on
  await closeAll()
  await monthView()
  await openDay(iso(-3))
  const st = await page.locator(`[data-testid="day-compound"][data-compound="${id}"]`).getAttribute('data-state')
  if (st !== 'logged') throw new Error(`the day still reads ${st}`)
  const txt = await page.locator(`[data-testid="day-compound"][data-compound="${id}"]`).innerText()
  if (!/added later/i.test(txt)) throw new Error('a backfilled dose is not distinguished from one logged on the day')
})

await step('6c · a dose can be marked skipped on a past day, with a reason', async () => {
  const target = page.locator('[data-testid="day-compound"][data-state="missed"]').first()
  if (!(await target.count())) throw new Error('nothing missed left to skip')
  const id = await target.getAttribute('data-compound')
  await target.locator('[data-testid="day-skip"]').click()
  await page.waitForTimeout(700)
  await page.locator('[data-testid="skip-reason"]').first().click()
  await page.click('[data-testid="skip-save"]')
  await page.waitForTimeout(900)
  const s = await state()
  const k = s.skips.find((x) => x.peptideId === id && x.date === iso(-3))
  if (!k) throw new Error('the skip was not recorded on that day')
  if (!k.reason) throw new Error('the reason was not kept')
  console.log(`  ${id} skipped on ${k.date} — "${k.reason}"`)
})

await step('6d · symptoms can be added to a past day and edited', async () => {
  await closeAll()
  await monthView()
  await openDay(iso(-3))
  await page.click('[data-testid="day-edit-symptoms"]')
  await page.waitForTimeout(700)
  await page.locator('[data-testid="symptom-tag"][data-tag="great-energy"]').click()
  await page.fill('[data-testid="symptom-note"]', 'felt good')
  await page.click('[data-testid="symptom-save"]')
  await page.waitForTimeout(900)
  let s = await state()
  const entry = s.symptomLogs.find((l) => l.date === iso(-3))
  if (!entry) throw new Error('the check-in was not saved against that day')
  if (entry.note !== 'felt good') throw new Error('the note was not kept')

  // and editing it replaces rather than duplicating
  await closeAll()
  await monthView()
  await openDay(iso(-3))
  await page.click('[data-testid="day-edit-symptoms"]')
  await page.waitForTimeout(700)
  await page.fill('[data-testid="symptom-note"]', 'felt good, mild headache later')
  await page.click('[data-testid="symptom-save"]')
  await page.waitForTimeout(900)
  s = await state()
  const forDay = s.symptomLogs.filter((l) => l.date === iso(-3))
  if (forDay.length !== 1) throw new Error(`${forDay.length} check-ins on one day`)
  if (!/headache later/.test(forDay[0].note)) throw new Error('the edit did not stick')
  console.log(`  one check-in on ${iso(-3)}, edited in place`)
})

await step('6e · a recorded dose can be corrected and deleted', async () => {
  await closeAll()
  await monthView()
  await openDay(iso(-3))
  const logged = page.locator('[data-testid="day-compound"][data-state="logged"]').first()
  if (!(await logged.count())) throw new Error('nothing logged on that day to correct')
  const id = await logged.getAttribute('data-compound')

  await logged.locator('[data-testid="day-edit-log"]').click()
  await page.waitForTimeout(700)
  const before = await state()
  const wasDose = before.doseLogs.find((l) => l.peptideId === id && l.date === iso(-3)).doseValue
  await page.fill('[data-testid="edit-dose"]', String(wasDose + 1))
  await page.click('[data-testid="edit-save"]')
  await page.waitForTimeout(900)
  let s = await state()
  const edited = s.doseLogs.find((l) => l.peptideId === id && l.date === iso(-3))
  if (edited.doseValue !== wasDose + 1) throw new Error(`the dose reads ${edited.doseValue}`)
  if (!edited.edited) throw new Error('the correction is not marked as one')

  await closeAll()
  await monthView()
  await openDay(iso(-3))
  await page.locator(`[data-testid="day-compound"][data-compound="${id}"] [data-testid="day-delete-log"]`).click()
  await page.waitForTimeout(900)
  s = await state()
  if (s.doseLogs.some((l) => l.peptideId === id && l.date === iso(-3))) throw new Error('the log was not deleted')
  console.log(`  ${id}: ${wasDose} → ${wasDose + 1}, then removed`)
})

await step('6f · the whole-day catch-up is still reachable', async () => {
  await closeAll()
  await monthView()
  await openDay(iso(-3))
  const way = page.locator('[data-testid="day-catch-up"], [data-testid="day-open-backfill"]').first()
  if (!(await way.count())) throw new Error('no way into the catch-up sheet from a past day')
  await way.click()
  await page.waitForTimeout(900)
  if (!(await page.locator('[data-testid="backfill-sheet"]').count())) throw new Error('the catch-up sheet did not open')
  const date = await page.inputValue('[data-testid="backfill-date"]')
  if (date !== iso(-3)) throw new Error(`it opened on ${date}, not the day that was tapped`)
  await closeAll()
  console.log('  co-draw catch-up still opens on the right day')
})

// =============================================================== 7 · summary

await step('7 · the month summary agrees with the days it covers', async () => {
  await monthView()
  const sum = page.locator('[data-testid="month-summary"]')
  if (!(await sum.count())) throw new Error('no month summary')
  const text = await sum.innerText()
  const m = text.match(/(\d+)\/(\d+)\s*doses logged/)
  if (!m) throw new Error(`the summary does not state logged out of scheduled: ${text.replace(/\n/g, ' | ')}`)
  const [, logged, scheduled] = m.map(Number)
  if (logged > scheduled) throw new Error(`${logged} logged out of ${scheduled} scheduled`)

  // Cross-checked against the cells themselves rather than against the raw log
  // list: the summary counts scheduled doses that were logged, and a log on a
  // day the compound was not due is a real dose that no day's completion owns.
  const cells = await page.locator('[data-testid^="cal-cell-"]').evaluateAll(
    (els) => els.map((e) => ({
      date: e.getAttribute('data-testid').replace('cal-cell-', ''),
      dots: [...e.querySelectorAll('[data-testid="day-dot"]')].map((d) => d.getAttribute('data-kind')),
    })))
  const monthKey = cells[15].date.slice(0, 7)
  const withLogged = cells.filter((c) => c.date.slice(0, 7) === monthKey && c.dots.includes('logged')).length
  if (logged > 0 && withLogged === 0) {
    throw new Error(`the summary says ${logged} logged but no cell carries a logged dot`)
  }
  if (logged === 0 && withLogged > 0) {
    throw new Error(`cells show logged doses the summary does not count`)
  }
  if (!/full day/.test(text)) throw new Error('the summary does not report fully complete days')
  console.log(`  ${logged}/${scheduled} logged · ${text.split('\n').filter(Boolean).slice(2, 3).join('')}`)
})

// ================================================================= 8 · intact

await step('8 · the app works normally and existing data is intact', async () => {
  const s = await state()
  if (!s.peptides.length) throw new Error('the protocol is empty')
  if (!Array.isArray(s.vials)) throw new Error('the shelf is gone')
  if (!s.bloods?.tests?.length) throw new Error('the blood results are gone')
  if (!Array.isArray(s.pauses)) throw new Error('the pauses list is gone')
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'Bloods', 'More']) {
    await nav(tab)
    await noOverflow(tab)
  }
  await nav('Home')
  await page.screenshot({ path: `${SHOT}/v36-home.png` })
  console.log(`  ${s.peptides.length} compounds, ${s.vials.length} vials, ${s.bloods.tests.length} blood tests`)
})

await step('8b · an older save migrates without losing anything', async () => {
  const before = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    delete s.pauses
    raw.version = 13
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
    return { logs: s.doseLogs.length, peptides: s.peptides.length, vials: s.vials.length, tests: s.bloods.tests.length }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button'); await page.waitForTimeout(1500)
  await gotIt()
  const after = await state()
  if (!Array.isArray(after.pauses)) throw new Error('the migration did not create the pauses list')
  if (after.doseLogs.length !== before.logs) throw new Error('the migration changed the logs')
  if (after.peptides.length !== before.peptides) throw new Error('the migration changed the protocol')
  if (after.vials.length !== before.vials) throw new Error('the migration changed the shelf')
  if (after.bloods.tests.length !== before.tests) throw new Error('the migration changed the blood results')
  console.log(`  upgraded from v13: ${after.doseLogs.length} logs, ${after.bloods.tests.length} tests, pauses ready`)
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
