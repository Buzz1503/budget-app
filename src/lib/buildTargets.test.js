/**
 * The two build targets.
 *
 * The web build serves from the GitHub Pages repo subpath; the native (Capacitor)
 * build serves from the root of the app's own web view and must carry no service
 * worker. A wrong base is a white screen and a stray service worker is stale
 * assets forever, and neither shows up in any other test — so these run the real
 * Vite build for each target and read what it wrote.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { build, resolveConfig } from 'vite'
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname
const out = mkdtempSync(join(tmpdir(), 'pepito-targets-'))
let savedBase

beforeAll(() => { savedBase = process.env.VITE_BASE; delete process.env.VITE_BASE })
afterAll(() => {
  if (savedBase !== undefined) process.env.VITE_BASE = savedBase
  rmSync(out, { recursive: true, force: true })
})

const configFor = (mode) => resolveConfig({ root, configFile: join(root, 'vite.config.js'), logLevel: 'silent' }, 'build', mode)

describe('base path per target', () => {
  it('web serves from the Pages repo subpath', async () => {
    expect((await configFor('web')).base).toBe('/budget-app/')
  })
  it('the Pages workflow can still set the base', async () => {
    process.env.VITE_BASE = '/some-repo/'
    try { expect((await configFor('web')).base).toBe('/some-repo/') } finally { delete process.env.VITE_BASE }
  })
  it('native serves from the root, whatever VITE_BASE says', async () => {
    expect((await configFor('native')).base).toBe('/')
    process.env.VITE_BASE = '/budget-app/'
    try { expect((await configFor('native')).base).toBe('/') } finally { delete process.env.VITE_BASE }
  })
  it('the native build writes to its own folder, never over the web build', async () => {
    const native = await configFor('native')
    const web = await configFor('web')
    expect(native.build.outDir).toBe('dist-native')
    expect(web.build.outDir).toBe('dist')
  })
  it('the default and dev modes are the web target', async () => {
    expect((await configFor('production')).base).toBe('/budget-app/')
    expect((await configFor('development')).base).toBe('/budget-app/')
  })
})

const bundle = (dir) => readdirSync(join(dir, 'assets')).filter((f) => /\.(m?js)$/.test(f))
  .map((f) => readFileSync(join(dir, 'assets', f), 'utf8'))

describe('what each build writes', { timeout: 240000 }, () => {
  const dirs = { web: join(out, 'web'), native: join(out, 'native') }

  beforeAll(async () => {
    for (const mode of ['web', 'native']) {
      await build({ root, configFile: join(root, 'vite.config.js'), mode, logLevel: 'silent', build: { outDir: dirs[mode], emptyOutDir: true } })
    }
  }, 240000)

  it('web: assets are under the subpath, with a manifest and a service worker', () => {
    const html = readFileSync(join(dirs.web, 'index.html'), 'utf8')
    expect(html).toMatch(/src="\/budget-app\/assets\/index-[^"]+\.js"/)
    expect(html).toMatch(/href="\/budget-app\/assets\/index-[^"]+\.css"/)
    expect(html).not.toMatch(/(src|href)="\/assets\//)
    expect(html).toContain('/budget-app/manifest.webmanifest')
    expect(existsSync(join(dirs.web, 'sw.js'))).toBe(true)
    expect(existsSync(join(dirs.web, 'manifest.webmanifest'))).toBe(true)
  })

  it('web: the viewport is left alone (pinch-zoom stays available in the browser)', () => {
    const html = readFileSync(join(dirs.web, 'index.html'), 'utf8')
    expect(html).toContain('content="width=device-width, initial-scale=1.0, viewport-fit=cover"')
    expect(html).not.toContain('maximum-scale')
  })

  it('native: the viewport is locked so focusing a text box does not zoom the app in', () => {
    const html = readFileSync(join(dirs.native, 'index.html'), 'utf8')
    expect(html).toContain('maximum-scale=1.0')
    expect(html).toContain('viewport-fit=cover')
  })

  it('web: the service worker is still registered', () => {
    expect(bundle(dirs.web).some((js) => js.includes('serviceWorker'))).toBe(true)
  })

  it('native: assets load from the root', () => {
    const html = readFileSync(join(dirs.native, 'index.html'), 'utf8')
    expect(html).toMatch(/src="\/assets\/index-[^"]+\.js"/)
    expect(html).toMatch(/href="\/assets\/index-[^"]+\.css"/)
    expect(html).not.toContain('/budget-app/')
    // every file the page points at is really there
    for (const m of html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)) {
      expect(existsSync(join(dirs.native, m[1]))).toBe(true)
    }
  })

  it('native: no service worker, no manifest, no registration in the bundle', () => {
    const files = readdirSync(dirs.native)
    expect(files.filter((f) => /^(sw|workbox)/.test(f))).toEqual([])
    expect(files).not.toContain('manifest.webmanifest')
    expect(readFileSync(join(dirs.native, 'index.html'), 'utf8')).not.toMatch(/manifest|registerSW|serviceWorker/)
    const js = bundle(dirs.native)
    expect(js.length).toBeGreaterThan(0)
    for (const src of js) {
      expect(src).not.toContain('serviceWorker')
      expect(src).not.toContain('registerSW')
    }
  })
})
