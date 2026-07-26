import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:4173/pcc/'
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
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`${name}: ${e.message}`) }
}

await page.goto(BASE, { waitUntil: 'networkidle' })

const BASE_PATH = new URL(BASE).pathname

await step(`app boots at the ${new URL(BASE).pathname} base path`, async () => {
  await page.waitForSelector('nav button', { timeout: 10000 })
  if ((await page.locator('nav button').count()) !== 6) throw new Error('nav did not render')
})

await step('manifest is linked, valid, and standalone/portrait', async () => {
  const href = await page.getAttribute('link[rel="manifest"]', 'href')
  if (!href) throw new Error('no manifest link')
  const m = await (await page.request.get(new URL(href, BASE).toString())).json()
  if (m.name !== 'Peptide Command Center') throw new Error('wrong name')
  if (m.short_name !== 'Peptide CC') throw new Error('wrong short_name')
  if (m.display !== 'standalone') throw new Error('not standalone')
  if (m.orientation !== 'portrait') throw new Error('not portrait')
  if (!m.description) throw new Error('no description')
  if (m.theme_color !== '#080a12' || m.background_color !== '#080a12') throw new Error('theme colours wrong')
  const sizes = m.icons.map((i) => `${i.sizes}${i.purpose === 'maskable' ? '-maskable' : ''}`)
  for (const need of ['192x192', '512x512', '512x512-maskable']) {
    if (!sizes.includes(need)) throw new Error(`missing icon ${need}`)
  }
  // every declared icon must actually be fetchable
  for (const i of m.icons) {
    const r = await page.request.get(new URL(i.src, new URL(href, BASE)).toString())
    if (!r.ok()) throw new Error(`icon 404: ${i.src}`)
  }
})

await step('iOS standalone meta tags present', async () => {
  const need = {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'Peptide CC',
    'theme-color': '#080a12',
  }
  for (const [name, val] of Object.entries(need)) {
    const got = await page.getAttribute(`meta[name="${name}"]`, 'content')
    if (got !== val) throw new Error(`meta ${name}="${got}" (want "${val}")`)
  }
  const vp = await page.getAttribute('meta[name="viewport"]', 'content')
  if (!/viewport-fit=cover/.test(vp)) throw new Error('viewport-fit=cover missing (notch)')
  const touch = await page.getAttribute('link[rel="apple-touch-icon"]', 'href')
  if (!touch) throw new Error('no apple-touch-icon link')
  const r = await page.request.get(new URL(touch, BASE).toString())
  if (!r.ok()) throw new Error('apple-touch-icon 404')
})

await step('service worker registers and activates', async () => {
  await page.waitForFunction(async () => {
    const r = await navigator.serviceWorker.getRegistration()
    return !!(r && (r.active || r.installing || r.waiting))
  }, null, { timeout: 25000 })
  const state = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready
    return { scope: r.scope, active: !!r.active }
  })
  if (!state.active) throw new Error('SW not active')
  if (new URL(state.scope).pathname !== BASE_PATH) throw new Error(`SW scope ${state.scope} != base ${BASE_PATH}`)
  console.log(`  scope ${state.scope}`)
})

await step('app shell + chemistry data are precached', async () => {
  const info = await page.evaluate(async () => {
    const names = await caches.keys()
    let total = 0
    const urls = []
    for (const n of names) {
      const keys = await (await caches.open(n)).keys()
      total += keys.length
      urls.push(...keys.map((k) => k.url))
    }
    return { names, total, urls }
  })
  if (info.total === 0) throw new Error('nothing cached')
  if (!info.urls.some((u) => /index-.*\.js/.test(u))) throw new Error('app shell not precached')
  if (!info.urls.some((u) => /peptide_mix_matrix/.test(u))) throw new Error('chemistry matrix not precached')
  console.log(`  ${info.total} cached entries across ${info.names.length} cache(s)`)
})

await step('OFFLINE: app still opens and data tabs work with no network', async () => {
  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button', { timeout: 15000 })
  const dismiss = page.locator('text=Got it')
  if (await dismiss.count()) await dismiss.click()
  // Mix tab is the hard case: it lazy-loads the 1.8 MB matrix chunk
  await page.click('nav button:has-text("Mix")')
  const start = Date.now()
  let ok = false
  while (Date.now() - start < 20000) {
    if (/Compatibility Codex/.test(await page.textContent('body'))) { ok = true; break }
    await page.waitForTimeout(200)
  }
  if (!ok) throw new Error('Mix tab did not load offline')
  await page.click('button:has-text("BPC-157")')
  await page.click('button:has-text("KPV")')
  const s2 = Date.now()
  let verdict = false
  while (Date.now() - s2 < 15000) {
    if (/Safe to mix/.test(await page.textContent('body'))) { verdict = true; break }
    await page.waitForTimeout(200)
  }
  if (!verdict) throw new Error('chemistry lookup failed offline')
  await page.screenshot({ path: `${SHOT}/pwa-offline.png` })
  await ctx.setOffline(false)
})

await step('existing app data still persists across reload', async () => {
  await page.click('nav button:has-text("Home")')
  await page.waitForTimeout(400)
  const before = await page.evaluate(() => localStorage.getItem('peptide-command-center'))
  if (!before) throw new Error('store not written')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!after.peptides?.length) throw new Error('peptides lost after reload')
  console.log(`  ${after.peptides.length} peptides persisted`)
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 200)))
await browser.close()
process.exit(errors.length ? 1 : 0)
