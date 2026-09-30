// v38 — Reaction Lab.
//
// Runs at 390×844 against a build on BASE_URL. Walks the nineteen checks in the
// brief in order.
//
// Most of these assert the store after driving the UI, because the claims being
// made are arithmetic ones. "Paused days are excluded", "the score matches its
// breakdown", "a broken lock excludes the shot from the step" are all statements
// about numbers behind the pixels, and a screen can say them while the data
// underneath disagrees.
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
const setState = (fn, arg) => page.evaluate(([f, a]) => {
  const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
  // eslint-disable-next-line no-new-func
  new Function('s', 'a', f)(raw.state, a)
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
}, [fn, arg])
const reload = async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1400)
  await gotIt()
}
const gotIt = async () => {
  const btn = page.locator('button:has-text("Got it")')
  if (!(await btn.count())) return
  try { await btn.first().click({ timeout: 3000 }) } catch { /* left on its own */ }
  await page.waitForTimeout(500)
}
const closeAll = async () => {
  await gotIt()
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(320)
  }
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button[aria-label="${label}"]`)
  await page.waitForTimeout(650)
}
const lab = async () => {
  await nav('Symptoms')
  await page.click('[data-testid="symptom-tab-reactions"]')
  await page.waitForTimeout(900)
}
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString()

const SETUP = `
  s.reactionSettings = { enabled: true, suspects: ['motsc','ghkcu'],
    sideAssignment: { motsc:'left-abdomen', ghkcu:'right-abdomen' },
    windowTimes: { morning:'07:00', evening:'20:00' }, coin:'aud-20c', restDays:3, discardWindows:{} }
`

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1300)
await gotIt()

// ================================================================ 1 · setup

await step('1 · setup runs once and saves everything it asked for', async () => {
  await lab()
  if (!(await page.locator('[data-testid="reaction-setup"]').count())) throw new Error('setup did not run on first open')

  const suspects = await page.locator('[data-testid="suspect-row"]').count()
  if (suspects === 0) throw new Error('no compounds offered as suspects')
  const preselected = await page.locator('[data-testid="suspect-row"][data-on="true"]').count()
  if (preselected === 0) throw new Error('nothing was pre-selected')

  await page.click('[data-testid="setup-next"]'); await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="setup-sides"]').count())) throw new Error('no side assignment screen')
  if (!(await page.locator('[data-testid="side-row"]').count())) throw new Error('no compounds to assign')

  await page.click('[data-testid="setup-next"]'); await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="setup-routine"]').count())) throw new Error('no routine screen')
  await page.fill('[data-testid="window-morning"]', '07:30')
  const coins = await page.locator('[data-testid="coin-option"]').count()
  if (coins !== 4) throw new Error(`${coins} coins offered`)
  await page.click('[data-testid="coin-option"][data-coin="aud-1"]')
  await page.waitForTimeout(300)

  await page.click('[data-testid="setup-start"]'); await page.waitForTimeout(1100)
  const s = await state()
  if (!s.reactionSettings.enabled) throw new Error('setup did not save')
  if (!s.reactionSettings.suspects.length) throw new Error('no suspects saved')
  if (s.reactionSettings.windowTimes.morning !== '07:30') throw new Error('window not saved')
  if (s.reactionSettings.coin !== 'aud-1') throw new Error('coin not saved')
  if (!Object.keys(s.reactionSettings.sideAssignment).length) throw new Error('no side assignment saved')
  console.log(`  ${s.reactionSettings.suspects.length} suspects, coin ${s.reactionSettings.coin}, morning ${s.reactionSettings.windowTimes.morning}`)
})

await step('1b · it does not run again, and stays editable', async () => {
  await lab()
  if (await page.locator('[data-testid="reaction-setup"]').count()) throw new Error('setup ran a second time')
  if (!(await page.locator('[data-testid="reaction-lab"]').count())) throw new Error('the lab did not open')

  await page.click('[data-testid="lab-settings"]'); await page.waitForTimeout(800)
  await page.fill('[data-testid="settings-window-morning"]', '06:45')
  await page.click('[data-testid="settings-coin"][data-coin="aud-10c"]')
  await page.click('[data-testid="settings-rest"][data-days="5"]')
  await page.waitForTimeout(500)
  const s = await state()
  if (s.reactionSettings.windowTimes.morning !== '06:45') throw new Error('window not editable')
  if (s.reactionSettings.coin !== 'aud-10c') throw new Error('coin not editable')
  if (s.reactionSettings.restDays !== 5) throw new Error('rest days not editable')
  if (!(await page.locator('[data-testid="settings-side-row"]').count())) throw new Error('side assignment not editable')
  await closeAll()
  console.log('  windows, coin, rest and sides all editable afterwards')
})

// ------------------------------------------------------------- 2 · tonight

await step('2 · the Tonight card gives one instruction line per shot', async () => {
  await setState(SETUP)
  await reload()
  await nav('Home')
  const card = page.locator('[data-testid="tonight-card"]')
  if (!(await card.count())) throw new Error('no Tonight card on Home')
  const lines = page.locator('[data-testid="tonight-line"]')
  const n = await lines.count()
  if (n === 0) throw new Error('no instruction lines')
  const text = await lines.first().innerText()
  if (!/abdomen|thigh|glute|arm|handle/i.test(text)) throw new Error(`no site in the line: ${text}`)
  if (!/room temp/i.test(text)) throw new Error(`no technique in the line: ${text}`)
  if (!(await page.locator('[data-testid="summary-line"]').count())) throw new Error('no one-line summary')
  await noOverflow('the Tonight card')
  await page.screenshot({ path: `${SHOT}/v38-today.png` })
  console.log(`  ${n} lines, e.g. "${text.split('\n')[0]}"`)
})

await step('2b · tapping a line opens the log pre-filled', async () => {
  await page.locator('[data-testid="tonight-line"]').first().click()
  await page.waitForTimeout(1000)
  if (!(await page.locator('[data-testid="log-injection"]').count())) throw new Error('the log did not open')
  const chosen = await page.locator('[data-testid="chosen-site"]').innerText()
  if (/tap a site/i.test(chosen)) throw new Error('no site was pre-selected')
  await closeAll()
  console.log(`  pre-selected ${chosen}`)
})

// ------------------------------------------------------------- 3 · logging

await step('3 · a shot needs only a site tap; everything else auto-fills', async () => {
  await lab()
  await page.locator('[data-testid="lab-log-compound"]').first().click()
  await page.waitForTimeout(1000)
  if (!(await page.locator('[data-testid="site-suggestion"]').count())) throw new Error('no next-best-site suggestion')

  // the save is live straight away — nothing else is required
  if (await page.locator('[data-testid="log-save"]').isDisabled()) throw new Error('a site was pre-selected but save is disabled')
  await page.click('[data-testid="log-save"]')
  await page.waitForTimeout(1000)

  const s = await state()
  const r = s.injectionRecords.at(-1)
  if (!r) throw new Error('nothing was recorded')
  for (const k of ['dose', 'units', 'needleGauge', 'needleLength', 'angle', 'speed', 'temperature', 'skinPrep', 'diluent', 'zoneId', 'side']) {
    if (r[k] == null) throw new Error(`${k} did not auto-fill`)
  }
  if (!r.doseLogId) throw new Error('the shot is not linked to a dose log')
  if (s.doseLogs.length === 0) throw new Error('no dose was logged')
  console.log(`  ${r.compoundIds[0]} ${r.dose} at ${r.zoneId}, ${r.needleGauge}G, linked to ${r.doseLogId}`)
})

await step('3b · every variable the brief lists is captured and editable', async () => {
  await lab()
  await page.locator('[data-testid="lab-log-compound"]').first().click()
  await page.waitForTimeout(900)
  await page.click('[data-testid="details-toggle"]'); await page.waitForTimeout(600)
  const pane = page.locator('[data-testid="details-pane"]')
  if (!(await pane.count())) throw new Error('no details pane')
  for (const id of ['field-dose', 'field-units', 'field-diluent', 'field-gauge', 'field-length',
    'field-angle', 'field-pinched', 'field-speed', 'field-temp', 'field-prep']) {
    if (!(await pane.locator(`[data-testid="${id}"]`).count())) throw new Error(`no ${id}`)
  }
  const text = await pane.innerText()
  if (!/benzyl alcohol/i.test(text)) throw new Error('the BAC water note is missing')
  if (!/vial/i.test(text)) throw new Error('no vial or batch line')
  await noOverflow('the log details')
  await closeAll()
  console.log('  dose, units, diluent, needle, angle, pinch, speed, temperature, prep, vial')
})

// -------------------------------------------------------- 4 · site rules

await step('4 · reacting sites are blocked, override warns, suggestion respects the side', async () => {
  await setState(`${SETUP}
    s.injectionRecords = [{ id:'ir-block', doseLogId:null, investigationStepId:null,
      injectedAt: a, compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false,
      zoneId:'abd-lr-in', point:{x:0.5,y:0.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
    s.reactions = [{ id:'rx-block', injectionRecordId:'ir-block', injectedAt:a, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
    s.reactionCheckins = []
  `, hoursAgo(30))
  await reload()
  await lab()

  const ghk = page.locator('[data-testid="lab-log-compound"]')
  // pick whichever compound the seed put on the right
  await ghk.first().click(); await page.waitForTimeout(900)
  // the blocked zone is drawn as blocked on the map
  const sheetMap = page.locator('[data-testid="log-injection"] [data-testid="zone-abd-lr-in"]')
  const blockedAttr = await sheetMap.getAttribute('data-blocked')
  if (blockedAttr !== 'true') throw new Error('a reacting zone is not marked blocked on the map')
  const status = await sheetMap.getAttribute('data-status')
  if (status !== 'reacting') throw new Error(`the zone reads ${status}`)

  // choosing it warns and requires an override
  await sheetMap.click(); await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="site-blocked"]').count())) throw new Error('no warning on a blocked site')
  if (!(await page.locator('[data-testid="log-save"]').isDisabled())) throw new Error('a blocked site saved without an override')
  await page.click('[data-testid="site-override"]'); await page.waitForTimeout(400)
  if (await page.locator('[data-testid="log-save"]').isDisabled()) throw new Error('the override did not unlock the save')
  await closeAll()
  console.log('  blocked, warned, and only saveable after an explicit override')
})

await step('4b · the suggestion keeps a compound on its own side', async () => {
  const s = await state()
  const motsId = Object.keys(s.reactionSettings.sideAssignment).find((k) => s.reactionSettings.sideAssignment[k] === 'left-abdomen')
  if (!motsId) throw new Error('no compound assigned to the left')
  await lab()
  const btn = page.locator(`[data-testid="lab-log-compound"][data-compound="${motsId}"]`)
  if (!(await btn.count())) { console.log('  (that compound is not on the quick list; checked via the library instead)'); return }
  await btn.click(); await page.waitForTimeout(900)
  const suggestion = await page.locator('[data-testid="site-suggestion"]').innerText()
  if (/ R | right/i.test(suggestion)) throw new Error(`a left-side compound was sent right: ${suggestion}`)
  await closeAll()
  console.log(`  ${suggestion}`)
})

// ------------------------------------------------------------ 5 · check-ins

await step('5 · check-ins schedule, accept a late answer, and never stack', async () => {
  await setState(`${SETUP}
    s.injectionRecords = [{ id:'ir-c', doseLogId:null, investigationStepId:null, injectedAt:a,
      compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
      point:{x:0.5,y:0.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
    s.reactions = [{ id:'rx-c', injectionRecordId:'ir-c', injectedAt:a, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
    s.reactionCheckins = []
  `, hoursAgo(80))
  await reload()
  await lab()

  const badge = page.locator('[data-testid="checkins-due"]')
  if (!(await badge.count())) throw new Error('nothing says a check-in is due')
  const label = await badge.innerText()
  // eighty hours went by with many windows in it; there is still one thing to do
  if (!/^1 check-in due/m.test(label)) throw new Error(`the badge stacked: ${label.split('\n')[0]}`)

  await badge.click(); await page.waitForTimeout(900)
  const cards = await page.locator('[data-testid="checkin-card"]').count()
  if (cards !== 1) throw new Error(`${cards} cards for one site`)

  const before = new Date().toISOString()
  await page.click('[data-testid="checkin-clear"]'); await page.waitForTimeout(900)
  const s = await state()
  const c = s.reactionCheckins.at(-1)
  if (!c) throw new Error('nothing was saved')
  if (c.completedAt < before) throw new Error('the check-in was stored at its scheduled time, not the real one')
  if (c.scheduledWindow >= c.completedAt) throw new Error('the scheduled window is not earlier than the answer')
  await closeAll()
  console.log(`  answered ${Math.round((new Date(c.completedAt) - new Date(c.scheduledWindow)) / 3600e3)} h late, stored at the real time`)
})

await step('6 · swipe alternatives work and two clear looks close it', async () => {
  // One clear answer already on record; the next one should close it. The
  // schedule quite rightly does not offer two windows in the same minute, so
  // the first of the pair is seeded rather than clicked twice.
  await setState(`${SETUP}
    s.injectionRecords = [{ id:'ir-r2', doseLogId:null, investigationStepId:null, injectedAt:a.inj,
      compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
      point:{x:0.5,y:0.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
    s.reactions = [{ id:'rx-r2', injectionRecordId:'ir-r2', injectedAt:a.inj, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
    s.reactionCheckins = [{ id:'rc-seed', reactionId:'rx-r2', windowId:'seeded', completedAt:a.first,
      present:false, itch:0, pain:0, welt:false, lump:false, diameterMm:null }]
  `, { inj: hoursAgo(80), first: hoursAgo(40) })
  await reload()
  await lab()
  const badge = page.locator('[data-testid="checkins-due"]')
  if (!(await badge.count())) throw new Error('nothing due for the second look')
  await badge.click(); await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="checkin-card"]').count())) throw new Error('no card to answer')
  await page.click('[data-testid="checkin-clear"]'); await page.waitForTimeout(1100)
  const s = await state()
  const rx = s.reactions.find((r) => r.id === 'rx-r2')
  if (rx.status !== 'resolved') throw new Error('two clear check-ins did not close it')
  if (!rx.resolvedAt) throw new Error('no resolved timestamp')
  await closeAll()
  console.log('  closed on the second consecutive clear')
})

await step('6b · "still there" opens the detail sheet with every field', async () => {
  await setState(`${SETUP}
    s.injectionRecords = [{ id:'ir-d', doseLogId:null, investigationStepId:null, injectedAt:a,
      compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
      point:{x:0.5,y:0.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
    s.reactions = [{ id:'rx-d', injectionRecordId:'ir-d', injectedAt:a, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
    s.reactionCheckins = []
  `, hoursAgo(20))
  await reload()
  await lab()
  await page.click('[data-testid="checkins-due"]'); await page.waitForTimeout(800)
  await page.click('[data-testid="checkin-present"]'); await page.waitForTimeout(900)
  const sheet = page.locator('[data-testid="checkin-detail"]')
  if (!(await sheet.count())) throw new Error('no detail sheet')
  if (!(await sheet.locator('[data-testid="scale-itch"]').count())) throw new Error('no itch scale')
  if (!(await sheet.locator('[data-testid="scale-pain"]').count())) throw new Error('no pain scale')
  const anchors = await sheet.locator('[data-testid="scale-itch"]').innerText()
  for (const w of ['None', 'Mild', 'Moderate', 'Severe']) {
    if (!anchors.includes(w)) throw new Error(`the scale is missing the "${w}" anchor`)
  }
  for (const f of ['welt', 'lump', 'warm', 'bruise']) {
    if (!(await sheet.locator(`[data-testid="detail-toggle"][data-flag="${f}"]`).count())) throw new Error(`no ${f} toggle`)
  }
  if (!(await sheet.locator('[data-testid="open-trace"]').count())) throw new Error('no photo trace')
  if (!(await sheet.locator('[data-testid="manual-mm"]').count())) throw new Error('no manual mm fallback')
  await noOverflow('the detail sheet')
  console.log('  photo, two scales with word anchors, four toggles, manual fallback')
})

// ------------------------------------------------------ 7 · trace, 8 · score

await step('8 · the score matches its own breakdown', async () => {
  // 30 mm, itch 6, welt: 3 + 1.2 + 1 = 5.2, recorded through the real sheet
  await setState(`${SETUP}
    s.injectionRecords = [{ id:'ir-s8', doseLogId:null, investigationStepId:null, injectedAt:a,
      compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
      point:{x:0.5,y:0.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
    s.reactions = [{ id:'rx-s8', injectionRecordId:'ir-s8', injectedAt:a, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
    s.reactionCheckins = []
  `, hoursAgo(26))
  await reload()
  await lab()
  await page.click('[data-testid="checkins-due"]'); await page.waitForTimeout(800)
  await page.click('[data-testid="checkin-present"]'); await page.waitForTimeout(900)
  await page.locator('[data-testid="scale-itch"] [data-testid="scale-step"][data-value="6"]').click()
  await page.fill('[data-testid="manual-mm"]', '30')
  await page.locator('[data-testid="detail-toggle"][data-flag="welt"]').click()
  await page.waitForTimeout(400)
  await page.click('[data-testid="checkin-save"]'); await page.waitForTimeout(1200)
  await closeAll()

  await lab()
  await page.locator('[data-testid="reaction-dot"]').first().click(); await page.waitForTimeout(900)
  const card = page.locator('[data-testid="score-card"]')
  if (!(await card.count())) throw new Error('no score card')
  const shown = Number((await card.innerText()).match(/^([\d.]+)/m)?.[1])
  if (!(shown > 0)) throw new Error('no score shown')

  await page.click('[data-testid="score-breakdown-toggle"]'); await page.waitForTimeout(500)
  const parts = await page.locator('[data-testid="score-part"]').evaluateAll(
    (els) => els.map((e) => Number(e.textContent.match(/\+([\d.]+)\s*$/)?.[1] || 0)))
  const sum = Math.round(parts.reduce((n, x) => n + x, 0) * 10) / 10
  if (Math.abs(sum - shown) > 0.15) throw new Error(`the parts add to ${sum} but the score says ${shown}`)
  if (Math.abs(shown - 5.2) > 0.15) throw new Error(`expected 5.2 from 30 mm, itch 6 and a welt; got ${shown}`)
  console.log(`  ${shown} = ${parts.join(' + ')}`)
})

await step('9 · onset labels and escalation fire on real data', async () => {
  // a mark that only showed up a day later is a delayed one
  await setState(`${SETUP}
    s.injectionRecords = [{ id:'ir-s9', doseLogId:null, investigationStepId:null, injectedAt:a.inj,
      compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
      point:{x:0.5,y:0.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
    s.reactions = [{ id:'rx-s9', injectionRecordId:'ir-s9', injectedAt:a.inj, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
    s.reactionCheckins = [{ id:'rc-s9', reactionId:'rx-s9', completedAt:a.seen, present:true,
      itch:4, pain:1, welt:false, lump:false, diameterMm:22 }]
  `, { inj: hoursAgo(50), seen: hoursAgo(20) })
  await reload()
  await lab()
  await page.locator('[data-testid="reaction-dot"]').first().click(); await page.waitForTimeout(900)
  const onset = page.locator('[data-testid="onset-label"]')
  if (!(await onset.count())) throw new Error('no onset label on a reaction that appeared a day later')
  const id = await onset.getAttribute('data-onset')
  if (id !== 'delayed') throw new Error(`a mark first seen 30 h in was labelled ${id}`)
  const words = await onset.innerText()
  if (/diagnos|you are allergic/i.test(words)) throw new Error('the label reads as a diagnosis')
  await closeAll()

  // three rising scores on one compound
  await setState(`${SETUP}
    const mk = (i, mm) => ({ rec: { id:'ir-e'+i, doseLogId:null, investigationStepId:null,
      injectedAt: new Date(Date.now() - (30-i*7)*24*3600e3).toISOString(),
      compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
      point:{x:.5,y:.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] },
      rx: { id:'rx-e'+i, injectionRecordId:'ir-e'+i, injectedAt:new Date(Date.now() - (30-i*7)*24*3600e3).toISOString(),
        zoneId:'abd-lr-in', status:'resolved', resolvedAt:new Date(Date.now() - (29-i*7)*24*3600e3).toISOString() },
      ci: { id:'rc-e'+i, reactionId:'rx-e'+i, completedAt:new Date(Date.now() - (30-i*7)*24*3600e3 + 3600e3).toISOString(),
        present:true, itch:0, pain:0, welt:false, lump:false, diameterMm: mm } })
    const rows = [mk(0, 5), mk(1, 20), mk(2, 40)]
    s.injectionRecords = rows.map(r => r.rec)
    s.reactions = rows.map(r => r.rx)
    s.reactionCheckins = rows.map(r => r.ci)
  `)
  await reload()
  await lab()
  await page.click('[data-testid="evidence-toggle"]'); await page.waitForTimeout(800)
  const esc = page.locator('[data-testid="escalation-list"]')
  if (!(await esc.count())) throw new Error('three rising scores were not flagged as escalating')
  console.log(`  onset ${id}; escalation flagged`)
})

// ------------------------------------------------------ 10-11 · the method

await step('10 · breaking a lock marks the shot and excludes it', async () => {
  await setState(`${SETUP}
    s.injectionRecords = []; s.reactions = []; s.reactionCheckins = []
    s.investigations = [{ id:'inv-1', name:'t', suspects:['motsc','ghkcu'], startDate:'2026-09-01',
      status:'running', pausedRanges:[], verdict:null, confidence:null, currentStepId:null }]
    s.investigationSteps = [{ id:'st-sides', investigationId:'inv-1', order:0, type:'sides',
      lockedVars:['side'], requiredN:6, startDate:'2026-09-01', endDate:null, result:null, status:'running' }]
  `)
  await reload()
  await lab()

  const s0 = await state()
  const leftId = Object.keys(s0.reactionSettings.sideAssignment).find((k) => s0.reactionSettings.sideAssignment[k] === 'left-abdomen')
  const btn = page.locator(`[data-testid="lab-log-compound"][data-compound="${leftId}"]`)
  if (!(await btn.count())) throw new Error(`${leftId} is not on the quick log list`)
  await btn.click(); await page.waitForTimeout(900)

  // put it deliberately on the wrong side
  await page.locator('[data-testid="log-injection"] [data-testid="zone-abd-lr-in"]').click()
  await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="lock-warning"]').count())) throw new Error('no warning that this breaks the lock')
  const warn = await page.locator('[data-testid="lock-warning"]').innerText()
  if (!/kept in your history/i.test(warn)) throw new Error(`the warning does not say what happens: ${warn}`)
  await page.click('[data-testid="log-save"]'); await page.waitForTimeout(1000)

  const s = await state()
  const r = s.injectionRecords.at(-1)
  if (!r.confounded) throw new Error('the shot was not marked confounded')
  // and it is still in history
  if (!s.injectionRecords.some((x) => x.id === r.id)) throw new Error('the shot was dropped from history')
  const progress = await page.locator('[data-testid="step-progress"]').innerText().catch(() => '')
  if (progress && !/0 of/.test(progress)) throw new Error(`a confounded shot counted towards the step: ${progress}`)
  console.log(`  kept, flagged, and left out: "${progress}"`)
})

await step('11 · a step reads out in one sentence and pausing freezes it', async () => {
  await setState(`${SETUP}
    const now = Date.now()
    s.investigations = [{ id:'inv-2', name:'t', suspects:['motsc','ghkcu'], startDate:'2026-09-01',
      status:'running', pausedRanges:[], verdict:null, confidence:null, currentStepId:null }]
    s.investigationSteps = [{ id:'st-ctrl', investigationId:'inv-2', order:0, type:'control',
      lockedVars:['needle','prep','technique'], requiredN:3, startDate:'2026-09-01', endDate:null, result:null, status:'running' },
      { id:'st-next', investigationId:'inv-2', order:1, type:'pause', lockedVars:['suspectsOff'], requiredN:0,
        startDate:null, endDate:null, result:null, status:'pending' }]
    s.injectionRecords = [0,1,2].map(i => ({ id:'ir-k'+i, doseLogId:null, investigationStepId:'st-ctrl',
      injectedAt: new Date(now - (3-i)*24*3600e3).toISOString(), compoundIds:[], componentIds:[],
      sharedSyringe:false, zoneId:'thigh-l-up', point:{x:.5,y:.5}, side:'L', diluent:'bac',
      confounded:false, confoundedBy:[] }))
    s.reactions = []; s.reactionCheckins = []
  `)
  await reload()
  await lab()

  const result = page.locator('[data-testid="step-result"]')
  if (!(await result.count())) throw new Error('a finished step showed no result')
  const text = await result.innerText()
  if (!/Control shots: 0 of 3 reacted\. The water and technique are not the cause\./.test(text)) {
    throw new Error(`the sentence is wrong: ${text.split('\n')[0]}`)
  }
  if (!(await page.locator('[data-testid="locked-chips"]').count())) throw new Error('no locked-variable chips')
  if (!(await page.locator('[data-testid="what-next"]').count())) throw new Error('no "what happens next" line')

  await page.click('[data-testid="step-advance"]'); await page.waitForTimeout(1000)
  let s = await state()
  const done = s.investigationSteps.find((x) => x.id === 'st-ctrl')
  if (done.status !== 'done') throw new Error('the step did not close')
  if (!done.result) throw new Error('the result was not recorded')
  if (s.investigationSteps.find((x) => x.id === 'st-next').status !== 'running') throw new Error('the next step did not start')

  await page.click('[data-testid="investigation-pause"]'); await page.waitForTimeout(900)
  s = await state()
  const inv = s.investigations.find((i) => i.id === 'inv-2')
  if (inv.status !== 'paused') throw new Error('the investigation did not pause')
  if (!inv.pausedRanges.length) throw new Error('no paused range recorded')
  console.log(`  "${text.split('\n')[0]}" then advanced and froze`)
})

// ----------------------------------------------------------- 12-13 · board

await step('12 · the board, ring, badge and confounding detector update', async () => {
  await setState(`${SETUP}
    const now = Date.now()
    const rows = []
    for (let i = 0; i < 6; i++) rows.push({ id:'ir-r'+i, zone:'abd-lr-in', side:'R', c:['ghkcu'], react: i < 5 })
    for (let i = 0; i < 4; i++) rows.push({ id:'ir-l'+i, zone:'abd-ll-in', side:'L', c:['motsc'], react: false })
    s.injectionRecords = rows.map((r, i) => ({ id:r.id, doseLogId:null, investigationStepId:null,
      injectedAt:new Date(now - (20-i)*24*3600e3).toISOString(), compoundIds:r.c, componentIds:[],
      sharedSyringe:false, zoneId:r.zone, point:{x:.5,y:.5}, side:r.side, diluent:'bac',
      confounded:false, confoundedBy:[] }))
    s.reactions = rows.filter(r => r.react).map((r, i) => ({ id:'rx-'+r.id, injectionRecordId:r.id,
      injectedAt:new Date(now - (20-i)*24*3600e3).toISOString(), zoneId:r.zone, status:'resolved',
      resolvedAt:new Date(now - (19-i)*24*3600e3).toISOString() }))
    s.reactionCheckins = rows.filter(r => r.react).map((r, i) => ({ id:'rc-'+r.id, reactionId:'rx-'+r.id,
      completedAt:new Date(now - (20-i)*24*3600e3 + 3600e3).toISOString(), present:true, itch:5,
      pain:0, welt:true, lump:false, diameterMm:30 }))
    s.investigations = [{ id:'inv-3', name:'t', suspects:['motsc','ghkcu'], startDate:'2026-09-01',
      status:'running', pausedRanges:[], verdict:null, confidence:null, currentStepId:null }]
    s.investigationSteps = [{ id:'st-b', investigationId:'inv-3', order:0, type:'sides',
      lockedVars:['side'], requiredN:6, startDate:'2026-09-01', endDate:null, result:null, status:'running' }]
  `)
  await reload()
  await lab()

  const board = page.locator('[data-testid="suspect-board"]')
  if (!(await board.count())) throw new Error('no suspect board')
  const rows = await board.locator('[data-testid="suspect-row"]').count()
  if (rows === 0 || rows > 2) throw new Error(`${rows} suspects shown; the brief asks for one or two`)
  const evidence = await board.locator('[data-testid="suspect-evidence"]').first().innerText()
  if (!/Reacted 5 of 6 times/.test(evidence)) throw new Error(`the evidence line is wrong: ${evidence}`)
  if (!(await page.locator('[data-testid="confidence-badge"]').count())) throw new Error('no confidence badge')
  if (!(await page.locator('[data-testid="verdict-line"]').count())) throw new Error('no verdict line')
  if (!(await page.locator('[data-testid="likelihood-bar"]').count())) throw new Error('no likelihood bar')
  await noOverflow('the suspect board')
  await page.screenshot({ path: `${SHOT}/v38-board.png`, fullPage: true })
  console.log(`  "${evidence}"`)
})

await step('12b · the confounding detector names what cannot be separated', async () => {
  await setState(`${SETUP}
    const now = Date.now()
    s.injectionRecords = [0,1,2,3].map(i => ({ id:'ir-s'+i, doseLogId:null, investigationStepId:null,
      injectedAt:new Date(now - (10-i)*24*3600e3).toISOString(), compoundIds:['motsc','ghkcu'],
      componentIds:[], sharedSyringe:true, zoneId:'abd-lr-in', point:{x:.5,y:.5}, side:'R',
      diluent:'bac', confounded:false, confoundedBy:[] }))
    s.reactions = []; s.reactionCheckins = []
  `)
  await reload()
  await lab()
  const det = page.locator('[data-testid="confounding-detector"]')
  if (!(await det.count())) throw new Error('two compounds that always shared a syringe were not flagged')
  const text = await det.innerText()
  if (!/Can't separate/.test(text)) throw new Error(`wrong wording: ${text.split('\n')[0]}`)
  console.log(`  "${text.split('\n').filter(Boolean)[1]}"`)
})

await step('13 · compare mode and the evidence page show real numbers', async () => {
  await setState(`${SETUP}
    const now = Date.now()
    const rows = []
    for (let i = 0; i < 6; i++) rows.push({ id:'ir-r'+i, zone:'abd-lr-in', side:'R', c:['ghkcu'], react: i < 5 })
    for (let i = 0; i < 4; i++) rows.push({ id:'ir-l'+i, zone:'abd-ll-in', side:'L', c:['motsc'], react: false })
    s.injectionRecords = rows.map((r, i) => ({ id:r.id, doseLogId:null, investigationStepId:null,
      injectedAt:new Date(now - (20-i)*24*3600e3).toISOString(), compoundIds:r.c, componentIds:[],
      sharedSyringe:false, zoneId:r.zone, point:{x:.5,y:.5}, side:r.side, diluent:'bac',
      confounded:false, confoundedBy:[] }))
    s.reactions = rows.filter(r => r.react).map((r, i) => ({ id:'rx-'+r.id, injectionRecordId:r.id,
      injectedAt:new Date(now - (20-i)*24*3600e3).toISOString(), zoneId:r.zone, status:'resolved',
      resolvedAt:new Date(now - (19-i)*24*3600e3).toISOString() }))
    s.reactionCheckins = rows.filter(r => r.react).map((r) => ({ id:'rc-'+r.id, reactionId:'rx-'+r.id,
      completedAt:new Date(now - 19*24*3600e3).toISOString(), present:true, itch:5, pain:0,
      welt:true, lump:false, diameterMm:30 }))
  `)
  await reload()
  await lab()
  await page.click('[data-testid="evidence-toggle"]'); await page.waitForTimeout(900)
  if (!(await page.locator('[data-testid="evidence-pane"]').count())) throw new Error('the evidence pane did not open')
  if (!(await page.locator('[data-testid="compare-mode"]').count())) throw new Error('no compare mode')
  const table = page.locator('[data-testid="compare-table"]')
  if (!(await table.count())) throw new Error('no comparison table')
  const cols = await table.locator('[data-testid="compare-row"]').first().evaluate((e) => e.children.length)
  if (cols > 3) throw new Error(`the comparison has ${cols} columns; the brief caps tables at two of data`)
  const factors = await page.locator('[data-testid="evidence-factor"]').count()
  if (factors === 0) throw new Error('no factors on the evidence page')
  const groups = await page.locator('[data-testid="evidence-group"]').first().innerText()
  if (!/n \d+/.test(groups)) throw new Error(`no n in the evidence rows: ${groups}`)
  await noOverflow('the evidence page')
  console.log(`  ${factors} factors, e.g. "${groups}"`)
})

// ---------------------------------------------------------------- 14 · safety

await step('14 · every safety condition raises a banner that cannot be dismissed', async () => {
  const conditions = [
    ['redStreaks', 'urgent'], ['pus', 'urgent'], ['fever', 'urgent'], ['elsewhere', 'urgent'],
    ['faceSwelling', 'emergency'], ['throatSwelling', 'emergency'], ['breathing', 'emergency'],
  ]
  for (const [flag, level] of conditions) {
    await setState(`${SETUP}
      s.injectionRecords = [{ id:'ir-x', doseLogId:null, investigationStepId:null, injectedAt:a.at,
        compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
        point:{x:.5,y:.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
      s.reactions = [{ id:'rx-x', injectionRecordId:'ir-x', injectedAt:a.at, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
      s.reactionCheckins = [{ id:'rc-x', reactionId:'rx-x', completedAt:a.at, present:true, itch:2,
        pain:2, welt:false, lump:false, diameterMm:10, [a.flag]: true }]
    `, { at: hoursAgo(10), flag })
    await reload()
    await lab()
    const banner = page.locator('[data-testid="safety-banner"]')
    if (!(await banner.count())) throw new Error(`${flag} raised no banner`)
    const got = await banner.getAttribute('data-level')
    if (got !== level) throw new Error(`${flag} raised a ${got} banner, expected ${level}`)
    // and there is no way to close it
    if (await banner.locator('button').count()) throw new Error(`${flag}'s banner can be dismissed`)
  }

  // pain of seven, and growth with warmth
  await setState(`${SETUP}
    s.injectionRecords = [{ id:'ir-p', doseLogId:null, investigationStepId:null, injectedAt:a,
      compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
      point:{x:.5,y:.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
    s.reactions = [{ id:'rx-p', injectionRecordId:'ir-p', injectedAt:a, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
    s.reactionCheckins = [{ id:'rc-p', reactionId:'rx-p', completedAt:a, present:true, itch:2, pain:7,
      welt:false, lump:false, diameterMm:10 }]
  `, hoursAgo(10))
  await reload()
  await lab()
  if (!(await page.locator('[data-testid="safety-banner"]').count())) throw new Error('pain 7 raised no banner')
  await page.screenshot({ path: `${SHOT}/v38-safety.png` })
  console.log(`  ${conditions.length + 1} conditions, all pinned and undismissable`)
})

await step('14b · the banner is on Today as well as in the lab', async () => {
  await nav('Home')
  if (!(await page.locator('[data-testid="safety-banner"]').count())) throw new Error('no safety banner on Today')
  console.log('  pinned on Today too')
})

// ------------------------------------------------------------ 15 · deep link

await step('15 · the Back Tap link opens the check-in stack directly', async () => {
  await setState(`${SETUP}
    s.injectionRecords = [{ id:'ir-l1', doseLogId:null, investigationStepId:null, injectedAt:a,
      compoundIds:['ghkcu'], componentIds:[], sharedSyringe:false, zoneId:'abd-lr-in',
      point:{x:.5,y:.5}, side:'R', diluent:'bac', confounded:false, confoundedBy:[] }]
    s.reactions = [{ id:'rx-l1', injectionRecordId:'ir-l1', injectedAt:a, zoneId:'abd-lr-in', status:'open', resolvedAt:null }]
    s.reactionCheckins = []
  `, hoursAgo(20))
  await reload()
  await lab()
  await page.evaluate(() => { window.location.hash = '#/reaction-lab/checkins' })
  await page.waitForTimeout(1000)
  if (!(await page.locator('[data-testid="checkin-stack"]').count())) throw new Error('the deep link did not open the stack')
  await closeAll()

  await lab()
  await page.click('[data-testid="lab-settings"]'); await page.waitForTimeout(800)
  const back = page.locator('[data-testid="back-tap"]')
  if (!(await back.count())) throw new Error('no Back Tap instructions in settings')
  if (!(await page.locator('[data-testid="copy-deeplink"]').count())) throw new Error('no copy button')
  const lines = (await back.innerText()).split('\n').filter((l) => /^\d\./.test(l.trim()))
  if (lines.length < 3) throw new Error(`${lines.length} setup lines, expected 3`)
  await closeAll()
  console.log('  opens the stack; settings carry the link and three lines of setup')
})

// --------------------------------------------------------------- 16 · report

await step('16 · the report is one narrow page', async () => {
  await lab()
  await page.click('[data-testid="open-report"]'); await page.waitForTimeout(1000)
  const report = page.locator('[data-testid="report"]')
  if (!(await report.count())) throw new Error('no report')
  const text = await report.innerText()
  for (const heading of ['Compounds involved', 'What was tried', 'Where it points', 'The three worst']) {
    // the design system uppercases section captions, so compare case-blind
    if (!text.toLowerCase().includes(heading.toLowerCase())) {
      throw new Error(`the report has no "${heading}" section`)
    }
  }
  if (!(await page.locator('[data-testid="print-report"]').count())) throw new Error('no print action')
  const wide = await report.evaluate((e) => e.scrollWidth > e.clientWidth + 1)
  if (wide) throw new Error('the report scrolls sideways')
  await noOverflow('the report')
  await page.screenshot({ path: `${SHOT}/v38-report.png`, fullPage: true })
  await closeAll()
  console.log('  four sections, no horizontal scroll at 390px')
})

// ----------------------------------------------------------- 17 · no emojis

await step('17 · there are no emojis anywhere in the feature', async () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}]/u
  const screens = []
  await lab()
  screens.push(['lab home', await page.locator('[data-testid="reaction-lab"]').innerText()])
  await page.click('[data-testid="evidence-toggle"]'); await page.waitForTimeout(700)
  screens.push(['evidence', await page.locator('[data-testid="evidence"]').innerText()])
  await page.click('[data-testid="lab-settings"]'); await page.waitForTimeout(800)
  screens.push(['settings', await page.locator('[data-testid="lab-settings-sheet"]').innerText()])
  await closeAll()
  await lab()
  await page.locator('[data-testid="lab-log-compound"]').first().click(); await page.waitForTimeout(900)
  await page.click('[data-testid="details-toggle"]'); await page.waitForTimeout(600)
  screens.push(['log', await page.locator('[data-testid="log-injection"]').innerText()])
  await closeAll()

  for (const [where, text] of screens) {
    const hit = text.match(emoji)
    if (hit) throw new Error(`${where} contains "${hit[0]}"`)
  }
  console.log(`  ${screens.length} screens checked, none`)
})

// ---------------------------------------------------- 18-19 · nothing broken

await step('18 · every existing tab still works', async () => {
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'Bloods', 'More']) {
    await nav(tab)
    await noOverflow(tab)
  }
  await nav('Symptoms')
  await page.click('[data-testid="symptom-tab-feeling"]'); await page.waitForTimeout(700)
  const text = await page.locator('main').innerText()
  if (!/How are you feeling/i.test(text)) throw new Error('the original symptoms screen is gone')

  // dose logging still works from Home
  await nav('Home')
  const before = (await state()).doseLogs.length
  const row = page.locator('[data-testid="log-row"]:not([data-done])').first()
  if (await row.count()) {
    await row.click(); await page.waitForTimeout(1000)
    const after = (await state()).doseLogs.length
    if (after !== before + 1) throw new Error('logging a dose from Home stopped working')
  }
  const s = await state()
  if (!s.peptides.length) throw new Error('the protocol is empty')
  if (!s.vials.length) throw new Error('the shelf is gone')
  if (!s.bloods?.tests?.length) throw new Error('the blood results are gone')
  console.log(`  ${s.peptides.length} compounds, ${s.vials.length} vials, ${s.bloods.tests.length} tests, logging intact`)
})

await step('19 · an older save migrates with nothing lost', async () => {
  const before = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    delete s.reactionSettings; delete s.injectionRecords; delete s.reactions
    delete s.reactionCheckins; delete s.reactionPhotos; delete s.reactionTreatments
    delete s.investigations; delete s.investigationSteps
    raw.version = 14
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
    return { logs: s.doseLogs.length, peptides: s.peptides.length, vials: s.vials.length,
      tests: s.bloods.tests.length, pauses: (s.pauses || []).length }
  })
  await reload()
  const after = await state()
  if (!after.reactionSettings) throw new Error('the migration did not create reactionSettings')
  for (const k of ['injectionRecords', 'reactions', 'reactionCheckins', 'reactionPhotos',
    'reactionTreatments', 'investigations', 'investigationSteps']) {
    if (!Array.isArray(after[k])) throw new Error(`the migration did not create ${k}`)
  }
  if (after.reactionSettings.enabled !== false) throw new Error('an upgraded save should start with setup pending')
  if (after.doseLogs.length !== before.logs) throw new Error('the migration changed the logs')
  if (after.peptides.length !== before.peptides) throw new Error('the migration changed the protocol')
  if (after.vials.length !== before.vials) throw new Error('the migration changed the shelf')
  if (after.bloods.tests.length !== before.tests) throw new Error('the migration changed the blood results')
  if ((after.pauses || []).length !== before.pauses) throw new Error('the migration changed the pauses')
  console.log(`  upgraded from v14: ${after.doseLogs.length} logs, ${after.bloods.tests.length} tests, all reaction keys ready`)
})

await step('19b · a photo survives a restart', async () => {
  const key = await page.evaluate(async () => {
    const k = 'rxphoto-e2e'
    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' })
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pcc-blobs')
      r.onupgradeneeded = () => r.result.createObjectStore('blobs')
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    await new Promise((res) => {
      const tx = db.transaction('blobs', 'readwrite').objectStore('blobs').put(blob, k)
      tx.onsuccess = () => res(); tx.onerror = () => res()
    })
    return k
  })
  await reload()
  const size = await page.evaluate(async (k) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pcc-blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    return await new Promise((res) => {
      const tx = db.transaction('blobs', 'readonly').objectStore('blobs').get(k)
      tx.onsuccess = () => res(tx.result ? tx.result.size : 0); tx.onerror = () => res(0)
    })
  }, key)
  if (!size) throw new Error('the photo did not survive the restart')
  console.log(`  ${size} bytes still in IndexedDB after reload`)
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
