import { describe, it, expect } from 'vitest'
import { viewportState, setNativeKeyboard, sheetMaxHeight, ACCESSORY_BAR } from './viewport'
import { readFileSync } from 'node:fs'

describe('keyboard handling in the native shell', () => {
  it('web: a keyboard is the gap between the window and the visual viewport', () => {
    const s = viewportState({ innerHeight: 844, vv: { height: 500, offsetTop: 0 } })
    expect(s).toMatchObject({ height: 500, keyboard: 344, keyboardOpen: true, native: false })
  })

  it('web: a collapsing URL bar is not a keyboard', () => {
    expect(viewportState({ innerHeight: 844, vv: { height: 790, offsetTop: 0 } }).keyboardOpen).toBe(false)
  })

  it('native: the web view is already resized, so the difference is zero — the plugin says whether the keyboard is up', () => {
    // innerHeight has shrunk to the area above the keyboard; the visual viewport matches it
    const closed = viewportState({ native: true, innerHeight: 500, vv: { height: 500, offsetTop: 0 }, kb: { open: false, height: 0 } })
    expect(closed).toMatchObject({ height: 500, keyboardOpen: false, native: true })
    const open = viewportState({ native: true, innerHeight: 500, vv: { height: 500, offsetTop: 0 }, kb: { open: true, height: 344 } })
    expect(open).toMatchObject({ height: 500, keyboard: 344, keyboardOpen: true, native: true })
  })

  it('native: without the plugin signal the web fallback would have reported no keyboard — so the signal is what hides the tab bar', () => {
    const wouldBeWeb = viewportState({ innerHeight: 500, vv: { height: 500, offsetTop: 0 } })
    expect(wouldBeWeb.keyboardOpen).toBe(false)
    setNativeKeyboard({ open: true, height: 300 })
    expect(viewportState({ native: true, innerHeight: 500 }).keyboardOpen).toBe(true)
    setNativeKeyboard({ open: false, height: 0 })
    expect(viewportState({ native: true, innerHeight: 500 }).keyboardOpen).toBe(false)
  })

  it('a sheet reserves the accessory strip on the web but not natively, where the view already ends above it', () => {
    const web = { height: 500, keyboardOpen: true, native: false }
    const native = { height: 500, keyboardOpen: true, native: true }
    expect(sheetMaxHeight(web)).toBe(500 - ACCESSORY_BAR)
    expect(sheetMaxHeight(native)).toBe(500 - 12)
    expect(sheetMaxHeight({ height: 800, keyboardOpen: false, native: true })).toBe(Math.round(800 * 0.88))
  })
})

describe('native shell configuration', () => {
  const cfg = JSON.parse(readFileSync(new URL('../../capacitor.config.json', import.meta.url), 'utf8'))

  it('identifies the app', () => {
    expect(cfg.appId).toBe('com.buzz.pepito')
    expect(cfg.appName).toBe('Pepito+')
  })
  it('loads the native build, never the web build', () => {
    expect(cfg.webDir).toBe('dist-native')
  })
  it('is dark: background, status bar and keyboard', () => {
    expect(cfg.backgroundColor).toBe('#080a12')
    expect(cfg.plugins.StatusBar.style).toBe('DARK')
    expect(cfg.plugins.Keyboard.style).toBe('DARK')
  })
  it('resizes the view for the keyboard', () => {
    expect(cfg.plugins.Keyboard.resize).toBe('native')
  })
  it('holds the launch image until the page has painted, then fades it out briefly', () => {
    expect(cfg.plugins.SplashScreen.launchAutoHide).toBe(false)
    expect(cfg.plugins.SplashScreen.launchFadeOutDuration).toBeLessThanOrEqual(300)
  })
  it('the iOS target is dark only and light status-bar content', () => {
    const plist = readFileSync(new URL('../../ios/App/App/Info.plist', import.meta.url), 'utf8')
    expect(plist).toMatch(/<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/)
    expect(plist).toMatch(/<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleLightContent<\/string>/)
  })
})
