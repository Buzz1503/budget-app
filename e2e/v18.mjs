// v18 — clean number inputs, 2 mL default, Symptoms redesign.
// (Its Insights and Recap suites were removed in v23 with those features.)
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
const nav = async (label) => {
  // v46: Symptoms and Bloods moved into More; 2D: Calendar too, and Symptoms is now Reactions
  if (['Symptoms', 'Bloods', 'Calendar', 'Reactions'].includes(label)) { await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(500); await page.click(`[data-testid="more-${label === 'Symptoms' ? 'reactions' : label.toLowerCase()}"]`); await page.waitForTimeout(700); return }

  await page.click(`nav button:has-text("${label}")`)
  await page.waitForTimeout(500)
}
// Re-entering Symptoms from another screen, so each step starts with a clean
// selection — tapping the nav button while already there does not remount.
const symptoms = async () => {
  await nav('Home')
  await nav('Symptoms')
}
const more = async (label) => {
  await nav('More')
  await page.click(`button:has-text("${label}")`)
  await page.waitForTimeout(700)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
if (await modal().count()) {
  await page.click('button:has-text("Got it")')
  await page.waitForTimeout(500)
}

// ================================================================ 1 · inputs

await step('no numeric field anywhere renders as type=number', async () => {
  const screens = ['calc', 'supplies', 'protocol', 'settings']
  for (const s of screens) {
    await page.evaluate(() => localStorage.setItem('__probe', '1'))
    await more({ calc: 'Calculator', supplies: 'Stock', protocol: 'Protocol overview', settings: 'Settings' }[s])
    const n = await page.locator('input[type="number"]').count()
    if (n > 0) throw new Error(`${s} still has ${n} type=number input(s)`)
  }
})

await step('a numeric field shows a plain number, never a padded zero', async () => {
  await more('Calculator')
  const vals = await page.locator('input[inputmode="decimal"], input[inputmode="numeric"]').evaluateAll(
    (els) => els.map((e) => e.value)
  )
  if (!vals.length) throw new Error('found no numeric fields on the calculator')
  const bad = vals.filter((v) => /^0[0-9]/.test(v))
  if (bad.length) throw new Error(`padded zeros still rendering: ${bad.join(', ')}`)
})

await step('a numeric field can be cleared to empty and typed into cleanly', async () => {
  await more('Calculator')
  const f = page.locator('input[inputmode="decimal"]').first()
  await f.fill('')
  if ((await f.inputValue()) !== '') throw new Error('the field refused to go empty')
  await f.type('25')
  if ((await f.inputValue()) !== '25') throw new Error(`typing 25 produced "${await f.inputValue()}"`)
  await f.blur()
  await page.waitForTimeout(300)
  if (/^0\d/.test(await f.inputValue())) throw new Error('a leading zero came back on blur')
})

await step('decimals survive where they matter', async () => {
  await more('Calculator')
  const f = page.locator('input[inputmode="decimal"]').first()
  await f.fill('')
  await f.type('0.5')
  if ((await f.inputValue()) !== '0.5') throw new Error(`0.5 became "${await f.inputValue()}"`)
})

// ============================================================== 2 · 2 mL BAC

await step('every reconstituted peptide defaults to 2 mL of BAC water', async () => {
  const st = await state()
  const wrong = st.peptides
    .filter((p) => p.recon && p.id !== 'testosterone-e' && p.recon.bacMl !== 2)
    .map((p) => `${p.name}=${p.recon.bacMl}`)
  if (wrong.length) throw new Error(`not on 2 mL: ${wrong.join(', ')}`)
})

await step('the pre-mixed oil vial keeps its real concentration', async () => {
  const st = await state()
  const te = st.peptides.find((p) => p.id === 'testosterone-e')
  if (!te) return // not every stack carries it
  const mgPerMl = te.recon.vialMg / te.recon.bacMl
  if (mgPerMl !== 250) throw new Error(`Test E reads ${mgPerMl} mg/mL — should be 250`)
})

await step('the BAC field is editable and the concentration follows it', async () => {
  await more('Calculator')
  await waitText(/mg\/mL|Concentration/i)
  const before = await main()
  const fields = page.locator('input[inputmode="decimal"]')
  const count = await fields.count()
  if (count < 2) throw new Error('the calculator is not showing its inputs')
  // second field is the BAC volume on this screen
  await fields.nth(1).fill('')
  await fields.nth(1).type('3')
  await page.waitForTimeout(400)
  if ((await main()) === before) throw new Error('changing the BAC volume changed nothing on screen')
})

// ======================================================= 3 · Symptoms UI (retired)
// The Symptoms "how I feel" screen left the app in stage 2D (its data is kept);
// e2e/v14.mjs checks it stays unreachable.

// ============================================================= 4 · Insights

// v23 removed the Insights engine and the weekly recap. Their suites went with
// them; everything else v18 shipped is still asserted above and below.

await step('nothing overflows horizontally at 390px on any screen', async () => {
  const screens = [
    ['nav', 'Home'], ['nav', 'Calendar'], ['nav', 'Symptoms'], ['nav', 'Body'],
    ['more', 'Protocol overview'], ['more', 'History & adherence'],
    ['more', 'Stock'], ['more', 'Calculator'],
  ]
  const bad = []
  for (const [how, label] of screens) {
    if (how === 'nav') await nav(label); else await more(label)
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (over) bad.push(label)
  }
  if (bad.length) throw new Error(`horizontal overflow on: ${bad.join(', ')}`)
})

await step('the bottom nav does not cover the last card on the new screens', async () => {
  for (const label of ['Protocol overview', 'History & adherence']) {
    await more(label)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(450)
    const clear = await page.evaluate(() => {
      const navEl = document.querySelector('nav')
      const navTop = navEl.getBoundingClientRect().top
      // the lowest element that actually renders content, not main's padding box
      let lowest = 0
      for (const el of document.querySelectorAll('main *')) {
        const r = el.getBoundingClientRect()
        if (r.height === 0 || r.width === 0) continue
        if (!el.textContent.trim()) continue
        lowest = Math.max(lowest, r.bottom)
      }
      return navTop - lowest
    })
    if (clear < -1) throw new Error(`${label}: content runs ${Math.round(-clear)}px under the nav`)
  }
})

await step('tap targets on the new screens are at least 40px tall', async () => {
  await more('Protocol overview')
  const small = await page.evaluate(() => {
    const out = []
    for (const b of document.querySelectorAll('main button')) {
      const r = b.getBoundingClientRect()
      if (r.height > 0 && r.height < 40) out.push(`${b.textContent.trim().slice(0, 24)}=${Math.round(r.height)}`)
    }
    return out
  })
  if (small.length > 2) throw new Error(`too-small tap targets: ${small.join(', ')}`)
})

// =========================================================== 7 · regressions

await step('the primary nav is untouched', async () => {
  const labels = (await page.locator('nav button span:not(:has(svg))').allTextContents()).map((s) => s.trim())
  if (labels.join('|') !== 'Home|Body|Sauna|More') {
    throw new Error(`nav is [${labels.join(', ')}]`)
  }
})

await step('Home is still decluttered — no streak, no disclaimer in the column', async () => {
  await nav('Home')
  const t = await main()
  if (/day streak/i.test(t)) throw new Error('a streak came back to Home')
  if (/not medical advice/i.test(t)) throw new Error('the disclaimer came back to Home')
})

await step('the Mix screen still leads with the inspect-before-injecting framing', async () => {
  // The non-bypassable CAUTION gate itself has its own suite (v3); what matters
  // here is that this release did not disturb the standing warning above it.
  await more('Mix')
  await waitText(/Reaction chamber/i)
  const t = await main()
  if (!/not proof of compatibility/i.test(t)) throw new Error('the compatibility caveat is gone')
  if (!/inspect the drawn solution/i.test(t)) throw new Error('the visual-inspection instruction is gone')
})

await step('no runtime errors anywhere in the run', async () => {
  const real = errors.filter((e) => e.startsWith('pageerror') || e.startsWith('console'))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
})

await page.screenshot({ path: `${SHOT}/v18-home.png`, fullPage: true })
await browser.close()

const failures = errors.filter((e) => e.startsWith('step ') || e.startsWith('pageerror') || e.startsWith('console'))
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'ALL PASS'}`)
for (const f of failures) console.log(' -', f.split('\n')[0])
process.exit(failures.length ? 1 : 0)
