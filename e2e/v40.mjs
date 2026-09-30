// v40 — the Adjust pins screen, at two phone sizes.
//
// Separate from v39 because the point of it is the viewport: the bug it guards
// against was a fixed-height sheet that fitted one screen and clipped another,
// so checking it at a single size would miss exactly the thing that broke.
// 390x844 and 375x667 are the two shapes the brief names.
import { chromium } from 'playwright'
import { deflateSync } from 'zlib'
const BASE = 'http://localhost:5174/budget-app/'
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
function crc32(buf){let c;const t=new Int32Array(256);for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c}let crc=-1;for(let i=0;i<buf.length;i++)crc=(crc>>>8)^t[(crc^buf[i])&0xFF];return (crc^-1)>>>0}
function makePng(w,h){const stride=w*3+1;const raw=Buffer.alloc(stride*h);for(let y=0;y<h;y++){const o=y*stride;raw[o]=0;for(let x=0;x<w;x++){raw[o+1+x*3]=(x/w*255)|0;raw[o+2+x*3]=(y/h*255)|0;raw[o+3+x*3]=140}}
const chunk=(ty,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(ty,'ascii'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c])}
const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2
return Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
const PNG = makePng(250, 300)

let fails = 0
const step = async (n, fn) => { try { await fn(); console.log('PASS', n) } catch (e) { fails++; console.log('FAIL', n, '—', e.message.split('\n')[0]) } }

for (const [W, H] of [[390, 844], [375, 667]]) {
  const browser = await chromium.launch({ executablePath: EXE })
  const ctx = await browser.newContext({ viewport: { width: W, height: H } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1400)
  const got = page.locator('button:has-text("Got it")')
  if (await got.count()) { await got.first().click().catch(()=>{}); await page.waitForTimeout(400) }

  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(600)
  const tab = page.locator('button:has-text("Settings")')
  if (await tab.count()) { await tab.first().click(); await page.waitForTimeout(700) }
  await page.locator('[data-testid="site-map-settings"]').scrollIntoViewIfNeeded()
  await page.setInputFiles('[data-testid="map-photo-input"]', { name: 'm.png', mimeType: 'image/png', buffer: PNG })
  await page.waitForTimeout(3000)

  await step(`${W}x${H} · adjust opens full-screen with the photo ready`, async () => {
    if (!(await page.locator('[data-testid="adjust-pins-screen"]').count())) throw new Error('did not open')
    const st = await page.getAttribute('[data-testid="site-map"]', 'data-photo')
    if (st !== 'ready') throw new Error(`photo state ${st}`)
    const s = await page.locator('[data-testid="adjust-pins-screen"]').boundingBox()
    if (s.height < H - 2) throw new Error(`${s.height} of ${H}`)
  })

  await step(`${W}x${H} · no pin clipped in either view, Done reachable`, async () => {
    for (const v of ['front', 'back']) {
      await page.click(`[data-testid="adjust-view-${v}"]`); await page.waitForTimeout(500)
      const clipped = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="site-map"]').getBoundingClientRect()
        return [...document.querySelectorAll('[data-testid="site-map"] [data-testid^="pin-"]')]
          .filter((el) => { const r = el.getBoundingClientRect()
            return r.top < b.top - .5 || r.bottom > b.bottom + .5 || r.left < b.left - .5 || r.right > b.right + .5 })
          .map((el) => el.dataset.testid)
      })
      if (clipped.length) throw new Error(`${v}: ${clipped.length} clipped (${clipped.slice(0,3)})`)
      const vis = await page.locator('[data-testid="site-map"] [data-testid^="pin-"]').count()
      if (!vis) throw new Error(`${v}: no pins`)
    }
    if (!(await page.locator('[data-testid="adjust-done"]').isVisible())) throw new Error('Done not visible')
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    if (w > W + 1) throw new Error(`overflows to ${w}`)
  })

  await step(`${W}x${H} · photo survives a cold start`, async () => {
    await page.click('[data-testid="adjust-done"]'); await page.waitForTimeout(500)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('nav button'); await page.waitForTimeout(1600)
    await page.click('nav button[aria-label="Symptoms"]'); await page.waitForTimeout(600)
    await page.click('[data-testid="symptom-tab-reactions"]'); await page.waitForTimeout(1500)
    const st = await page.getAttribute('[data-testid="site-map"]', 'data-photo')
    if (st !== 'ready') throw new Error(`after restart the map is "${st}"`)
    const src = await page.getAttribute('[data-testid="site-map"] img', 'src')
    if (!src?.startsWith('blob:')) throw new Error('no fresh object URL after restart')
  })

  await step(`${W}x${H} · returns to Settings at the same scroll position`, async () => {
    await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(600)
    const t2 = page.locator('button:has-text("Settings")')
    if (await t2.count()) { await t2.first().click(); await page.waitForTimeout(700) }
    await page.locator('[data-testid="site-map-settings"]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const before = await page.evaluate(() => window.scrollY)
    await page.click('[data-testid="adjust-pins"]'); await page.waitForTimeout(900)
    await page.click('[data-testid="adjust-done"]'); await page.waitForTimeout(700)
    const after = await page.evaluate(() => window.scrollY)
    if (Math.abs(after - before) > 4) throw new Error(`scroll moved ${before} to ${after}`)
    const navOk = await page.evaluate(() => !!document.querySelector('nav')?.getBoundingClientRect().height)
    if (!navOk) throw new Error('tab bar did not come back')
  })

  if (errs.length) { fails++; console.log('FAIL page errors:', errs.slice(0, 3)) }
  await browser.close()
}
console.log(`\nfailures: ${fails}`)
process.exit(fails ? 1 : 0)
