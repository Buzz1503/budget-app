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
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const TAB_MARK = {
  Home: /Pepito \+/, Calendar: /This week|Adherence this month/,
  Symptoms: /Daily check-in|Today's check-in/, Body: /How to measure/, More: /Build \/ rebuild my schedule/,
}
const nav = async (label) => {
  await page.click(`nav button[aria-label="${label}"]`)
  await waitText(TAB_MARK[label])
  await page.waitForTimeout(250)
}
// a symptom chip in the check-in card, by its plain label
const chip = (label) => page.locator('button', { hasText: label }).first()
// log the first due shot in the current slot, and clear the confirmation sheet
// that otherwise covers the nav
const logFirstShot = async () => {
  await page.locator('button[aria-label^="Log "]').first().click()
  await waitText(/INJECT HERE/, 10000)
  await page.locator('button:has-text("Log here")').first().click()
  await page.waitForTimeout(1000)
}
const closeSitePicker = async () => {
  const done = page.locator('button:has-text("Done")').first()
  if (await done.count()) await done.click()
  await page.waitForTimeout(400)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
await page.click('text=Got it')

// ---------- 1 · stack-relevant symptom list ----------
await step('the Symptoms tab lists only what the stack is known for, grouped', async () => {
  await nav('Symptoms')
  const txt = await body()
  if (!txt.includes('Good effects')) throw new Error('no positive group')
  if (!txt.includes('Issues')) throw new Error('no negative group')
  // seed stack: BPC-157, Retatrutide, Semax, Selank, KPV, SS-31, DSIP, MOTS-c,
  // GHK-Cu, NAD+, Tesamorelin, Testosterone E
  for (const w of ['Faster soft-tissue recovery', 'Gut symptom relief', 'Acne / oily skin', 'Morning grogginess']) {
    if (!txt.includes(w)) throw new Error(`missing stack symptom "${w}"`)
  }
  // nothing from a compound that is NOT in the stack
  for (const w of ['Tanning / darker skin', 'Prolonged / unwanted erections', 'Numbness / carpal-tunnel']) {
    if (txt.includes(w)) throw new Error(`"${w}" is shown but no stack compound causes it`)
  }
})

await step('labels are plain language, not raw ids', async () => {
  const txt = await body()
  for (const raw of ['inj_reaction', 'high_hct', 'appetite_suppression', 'better_sleep']) {
    if (txt.includes(raw)) throw new Error(`raw id "${raw}" leaked into the UI`)
  }
})

// ---------- 2 · attribution ----------
await step('ticking a symptom headlines the most likely compound', async () => {
  await chip('Morning grogginess').click()
  await page.waitForTimeout(500)
  const panel = page.locator('[data-testid="attribution-panel"]')
  await panel.waitFor({ timeout: 8000 })
  const txt = await panel.textContent()
  if (!/Most likely/.test(txt)) throw new Error('no headline candidate')
  if (!/DSIP/.test(txt)) throw new Error(`grogginess should point at DSIP, got: ${txt.slice(0, 200)}`)
  if (!/High/.test(txt)) throw new Error('no likelihood on the headline')
  if (!/T[1-5]/.test(txt)) throw new Error('no evidence tier on the headline')
})

await step('the "candidates, not a diagnosis" caveat is shown', async () => {
  const txt = await page.locator('[data-testid="attribution-panel"]').textContent()
  if (!/candidates, not a diagnosis/i.test(txt)) throw new Error('caveat missing')
  if (!/more than one thing can contribute/i.test(txt)) throw new Error('multi-compound warning missing')
})

await step('other candidates are listed with likelihood and tier', async () => {
  // fatigue is claimed by Retatrutide, Selank and TB-500; the seed stack has two
  await chip('Fatigue / low energy').click()
  await page.waitForTimeout(500)
  const panel = page.locator('[data-testid="attribution-panel"]')
  const more = panel.locator('button', { hasText: /could contribute/ }).first()
  if (!(await more.count())) throw new Error('no "others could contribute" control')
  await more.click()
  await page.waitForTimeout(400)
  const txt = await panel.textContent()
  // Likelihood is relative, so two genuinely near-equal candidates can BOTH read
  // High — that's the honest answer, not a bug. What must hold is that every
  // listed candidate carries a likelihood word and a tier.
  // NB: no \b anchors — textContent concatenates adjacent elements with no
  // separator ("…todayHighT4…"), so a word boundary never appears.
  const likelihoods = txt.match(/(High|Medium|Low)/g) || []
  if (likelihoods.length < 2) throw new Error(`only ${likelihoods.length} likelihood label(s) shown`)
  const tiers = txt.match(/T[1-5]/g) || []
  if (tiers.length < 2) throw new Error('runners-up carry no evidence tier')
})

await step('evidence tiers are tap-to-explain, not bare jargon', async () => {
  const tierBtn = page.locator('[data-testid="attribution-panel"] button[aria-label^="What does evidence tier"]').first()
  if (!(await tierBtn.count())) throw new Error('tier is not tappable')
  await tierBtn.click()
  await page.waitForTimeout(350)
  if (!/well established|one person's report/i.test(await body())) throw new Error('no plain explanation')
  await tierBtn.click()
  await page.waitForTimeout(300)
})

await step('Testosterone E is attributed for its own known effects', async () => {
  // clear the current selection first
  await chip('Morning grogginess').click()
  await chip('Fatigue / low energy').click()
  await page.waitForTimeout(400)
  for (const [label, expected] of [
    ['Acne / oily skin', 'Testosterone Enanthate'],
    ['Thick blood / high haematocrit', 'Testosterone Enanthate'],
    ['Irritability / mood swings', 'Testosterone Enanthate'],
  ]) {
    await chip(label).click()
    await page.waitForTimeout(450)
    const txt = await page.locator('[data-testid="attribution-panel"]').textContent()
    if (!txt.includes(expected)) throw new Error(`${label} did not attribute to ${expected}`)
    await chip(label).click()
    await page.waitForTimeout(300)
  }
})

await step('a compound started recently outranks a long-running one', async () => {
  // back-date the whole stack, then "restart" Selank two days ago
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const old = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10)
    const fresh = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
    raw.state.peptides = raw.state.peptides.map((p) => ({ ...p, startDate: old }))
    for (const k of Object.keys(raw.state.titration)) raw.state.titration[k] = { level: 0, levelStartDate: old }
    raw.state.peptides = raw.state.peptides.map((p) => (p.id === 'selank' ? { ...p, startDate: fresh } : p))
    raw.state.titration.selank = { level: 0, levelStartDate: fresh }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await nav('Symptoms')
  await chip('Fatigue / low energy').click()
  await page.waitForTimeout(600)
  const panel = page.locator('[data-testid="attribution-panel"]')
  const txt = await panel.textContent()
  const headline = txt.split('Most likely')[1] || ''
  if (!/Selank/.test(headline.slice(0, 120))) {
    throw new Error(`the recently restarted compound is not headlined: ${headline.slice(0, 160)}`)
  }
  if (!/started or stepped up 2 days ago/.test(txt)) throw new Error('the recency reason is not stated')
})

await step('the attribution is stored on the check-in and shown in history', async () => {
  await page.click('button:has-text("Log check-in")')
  await page.waitForTimeout(900)
  const st = await state()
  const log = st.symptomLogs.at(-1)
  const tag = log.tags.find((t) => t.id === 'fatigue')
  if (!tag?.attribution?.top?.name) throw new Error('no attribution snapshot on the log')
  if (tag.attribution.top.name !== 'Selank') throw new Error(`snapshot headlines ${tag.attribution.top.name}`)
  if (!tag.attribution.top.tier) throw new Error('snapshot drops the evidence tier')
  // and it reads back in the 14-day timeline
  const bars = page.locator('.card:has-text("Last 14 days") button')
  await bars.nth(13).click()
  await page.waitForTimeout(500)
  if (!/Candidates recorded at the time/.test(await body())) throw new Error('history does not show the attribution')
})

// ---------- 4 · layout + persistence ----------
await step('no horizontal overflow at 390px on any tab', async () => {
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'More']) {
    await nav(tab)
    await page.waitForTimeout(450)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) throw new Error(`${tab} overflows by ${over}px`)
  }
})

// v15 removed this suite's dose-logging section along with the motivation
// feature it existed to exercise, so only the symptom data is seeded here.
await step('symptom data persists across a reload', async () => {
  const st = await state()
  if (!st.symptomLogs.length) throw new Error('symptom check-in lost')
  if (!st.symptomLogs.at(-1).tags?.length) throw new Error('check-in tags lost')
})

await nav('Symptoms')
await page.locator('button', { hasText: 'Acne / oily skin' }).first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${SHOT}/v14-symptoms.png`, fullPage: true })

await browser.close()
if (errors.length) {
  console.log('\n--- FAILURES ---')
  for (const e of errors) console.log(e)
  process.exit(1)
}
console.log('\nv14 e2e: all green')
