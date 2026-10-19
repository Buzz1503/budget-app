// native — the Capacitor build, served from the root the way the iOS web view
// serves it, in a browser.
//
// This cannot prove what only a phone can (the status bar, the launch image,
// the notch, the keyboard resizing the view), but it does prove the part that
// otherwise fails silently: that the native bundle loads from "/" with no white
// screen and no service worker, and that localStorage and IndexedDB survive the
// app being closed and opened again. "Closed" here is a persistent browser
// profile shut down and relaunched, which is the nearest a test can get to a
// force-quit.
//
// It builds the native target itself and serves it from a throwaway static
// server inside this process, so it needs no port from the caller.
import { chromium } from 'playwright'
import { execSync } from 'child_process'
import { createServer } from 'http'
import { createReadStream, existsSync, mkdtempSync, statSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, extname } from 'path'

const ROOT = new URL('../', import.meta.url).pathname
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const DIST = mkdtempSync(join(tmpdir(), 'pepito-native-dist-'))
const PROFILE = mkdtempSync(join(tmpdir(), 'pepito-native-profile-'))

execSync(`npx vite build --mode native --outDir ${DIST} --emptyOutDir`, { cwd: ROOT, stdio: 'pipe' })

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' }
const requested = []
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  requested.push(path)
  let file = join(DIST, path === '/' ? 'index.html' : path)
  if (!existsSync(file) || statSync(file).isDirectory()) file = null
  if (!file) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}/`

const errors = []
let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const launch = async () => {
  const context = await chromium.launchPersistentContext(PROFILE, { executablePath: EXE, viewport: { width: 390, height: 844 } })
  const page = context.pages()[0] || await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  return { context, page }
}
const gotIt = async (page) => {
  const b = page.locator('button:has-text("Got it")')
  if (!(await b.count())) return
  try { await b.first().click({ timeout: 3000 }) } catch { /* left alone */ }
  await page.waitForTimeout(400)
}

let { context, page } = await launch()
await page.goto(BASE, { waitUntil: 'networkidle' })

await step('loads from the root: the app renders, not a white screen', async () => {
  await page.waitForSelector('nav button', { timeout: 15000 })
  if ((await page.locator('nav button').count()) !== 5) throw new Error('the tab bar did not render')
  const text = (await page.locator('body').innerText()).trim()
  if (text.length < 50) throw new Error(`the page is nearly empty: "${text}"`)
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  if (!/^rgb\(8, 10, 18\)$/.test(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))) {
    throw new Error(`the page background is ${bg}, not the app's dark`)
  }
})

await step('every asset came from the root, none from the Pages subpath', async () => {
  if (requested.some((p) => p.startsWith('/budget-app'))) throw new Error(`asked for ${requested.find((p) => p.startsWith('/budget-app'))}`)
  const assets = requested.filter((p) => p.startsWith('/assets/'))
  if (assets.length < 2) throw new Error(`only ${assets.length} assets requested`)
  // the native shell code (splash hide, keyboard events) ran, and ran without error
  if (!requested.some((p) => /^\/assets\/native-[^/]+\.js$/.test(p))) throw new Error('the native shell chunk was never loaded')
  if (requested.some((p) => p === '/sw.js' || p.includes('workbox') || p.endsWith('manifest.webmanifest'))) {
    throw new Error('the page asked for a service worker or manifest')
  }
})

await step('no service worker is registered, and the page links no manifest', async () => {
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)
  if (regs !== 0) throw new Error(`${regs} service worker(s) registered`)
  if (await page.locator('link[rel="manifest"]').count()) throw new Error('a manifest is linked')
})

await step('the page is set up for the notch: viewport-fit=cover and safe-area padding', async () => {
  const meta = await page.getAttribute('meta[name="viewport"]', 'content')
  if (!/viewport-fit=cover/.test(meta)) throw new Error(`viewport meta is "${meta}"`)
  const css = await page.evaluate(() => [...document.styleSheets].map((s) => [...s.cssRules].map((r) => r.cssText).join('')).join(''))
  if (!/safe-area-inset-top/.test(css) || !/safe-area-inset-bottom/.test(css)) throw new Error('the safe-area insets are not used')
})

await step('text boxes cannot zoom the app: viewport locked, and inputs are 16px', async () => {
  const meta = await page.getAttribute('meta[name="viewport"]', 'content')
  if (!/maximum-scale=1(\.0)?/.test(meta)) throw new Error(`viewport meta is "${meta}"`)
  if (!(await page.evaluate(() => document.documentElement.classList.contains('native')))) throw new Error('the native class is missing')
  // open a screen with a text box: Home has none, so make one the way the app does (class .input)
  const size = await page.evaluate(() => {
    const el = document.createElement('input')
    el.className = 'input'
    document.body.appendChild(el)
    const px = getComputedStyle(el).fontSize
    el.remove()
    return px
  })
  if (size !== '16px') throw new Error(`a text box is ${size}, so iOS would zoom into it`)
})

const MARK = 'native-persistence-check'
const BLOB_KEY = 'native-blob-check'
await step('localStorage (the Zustand store) and IndexedDB (blobs) both write and read back', async () => {
  await gotIt(page)
  // the store has been persisted by the app itself, not by the test
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('peptide-command-center')
    return raw ? Object.keys(JSON.parse(raw).state).length : 0
  })
  if (persisted < 10) throw new Error('the app did not persist its store')
  await page.evaluate(([mark, key]) => new Promise((resolve, reject) => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.symptomLogs = [...(raw.state.symptomLogs || []), { id: mark, date: '2026-01-02', tags: [], note: mark, activePeptides: [] }]
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
    const open = indexedDB.open('pcc-blobs')
    open.onupgradeneeded = () => open.result.createObjectStore('blobs')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction('blobs', 'readwrite')
      tx.objectStore('blobs').put(new Blob([new Uint8Array(200000).fill(7)], { type: 'image/jpeg' }), key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }
  }), [MARK, BLOB_KEY])
})

await step('after the app is closed and opened again, both are still there', async () => {
  await context.close()                       // the whole browser profile shut down
  ;({ context, page } = await launch())       // …and a fresh process on the same storage
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('nav button', { timeout: 15000 })
  const ls = await page.evaluate((mark) => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    return (s.symptomLogs || []).some((l) => l.id === mark)
  }, MARK)
  if (!ls) throw new Error('the localStorage entry did not survive')
  const blob = await page.evaluate((key) => new Promise((resolve, reject) => {
    const open = indexedDB.open('pcc-blobs')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const req = open.result.transaction('blobs').objectStore('blobs').get(key)
      req.onsuccess = () => resolve(req.result ? { size: req.result.size, type: req.result.type } : null)
      req.onerror = () => reject(req.error)
    }
  }), BLOB_KEY)
  if (!blob) throw new Error('the IndexedDB blob did not survive')
  if (blob.size !== 200000 || blob.type !== 'image/jpeg') throw new Error(`the blob came back as ${JSON.stringify(blob)}`)
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await context.close()
server.close()
rmSync(DIST, { recursive: true, force: true })
rmSync(PROFILE, { recursive: true, force: true })
process.exit(failures || noise.length ? 1 : 0)
