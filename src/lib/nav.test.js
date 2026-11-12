// Where things live: two taps or fewer from a tab, one home per feature, and
// every route a notification, widget, the Watch or Siri can send still lands.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { DESTINATIONS, FEATURE_HOMES, SLEEP_SEGMENTS, BODY_SEGMENTS, INSIGHTS_SEGMENTS, openDestination, useNav } from './nav'
import { useHealthLink } from './healthLink'

const app = readFileSync('src/App.jsx', 'utf8')
const screens = new Set([...app.matchAll(/^\s{2}([a-z]+): [A-Z]\w+,$/gm)].map((m) => m[1]).concat(['health', 'sleep', 'readiness', 'shortcuts', 'notifications', 'watch', 'lock']))

describe('navigation', () => {
  beforeEach(() => { useNav.setState({ sleepSegment: 'night', insightsSegment: 'compounds', labView: null }); useHealthLink.setState({ bodySegment: 'composition' }) })

  it('five tabs in order, at most three segments each', () => {
    const tabs = [...app.matchAll(/\{ id: '(\w+)', label: '(\w+)', icon/g)].map((m) => m[2])
    expect(tabs).toEqual(['Today', 'Sleep', 'Body', 'Insights', 'More'])
    for (const segs of [SLEEP_SEGMENTS, BODY_SEGMENTS, INSIGHTS_SEGMENTS]) expect(segs.length).toBeLessThanOrEqual(3)
    expect(SLEEP_SEGMENTS.map((s) => s.label)).toEqual(['Last night', 'Heart', 'Trends'])
    expect(BODY_SEGMENTS.map((s) => s.label)).toEqual(['Composition', 'Measurements', 'Photos'])
    expect(INSIGHTS_SEGMENTS.map((s) => s.label)).toEqual(['Compounds', 'Sleep Lab', 'Sauna'])
  })

  it('every feature is two taps or fewer from a tab, and has exactly one home', () => {
    for (const f of FEATURE_HOMES) expect(f.taps, f.feature).toBeLessThanOrEqual(2)
    const names = FEATURE_HOMES.map((f) => f.feature)
    expect(new Set(names).size).toBe(names.length)
  })

  it('routes from notifications, widgets, the Watch and Siri land on a screen', () => {
    const sources = ['src/native/notifySchedule.js', 'src/native/stockNotices.js', 'ios/App/App/Native/NotificationHandler.swift', 'ios/PepitoKit/Sources/PepitoCore/WatchModel.swift']
      .map((f) => readFileSync(f, 'utf8')).join('\n')
    const routes = new Set([...sources.matchAll(/route: '([a-z-]+)'|RouteBox\.open\("([a-z-]+)"\)|pepito:\/\/([a-z-]+)/g)].map((m) => m[1] || m[2] || m[3]))
    expect(routes.size).toBeGreaterThan(5)
    for (const r of routes) {
      if (r === 'count') continue // opens Stock and its count sheet
      const dest = openDestination(r)
      expect(dest ? screens.has(dest) : screens.has(r), r).toBe(true)
    }
  })

  it('old places still land: Body › Effects, Body › Recovery, the Sauna tab', () => {
    expect(openDestination('effects')).toBe('insights')
    expect(useNav.getState().insightsSegment).toBe('compounds')
    expect(openDestination('recovery')).toBe('readiness')
    expect(openDestination('heart')).toBe('sleep')
    expect(useNav.getState().sleepSegment).toBe('heart')
    expect(openDestination('measurements')).toBe('body')
    expect(useHealthLink.getState().bodySegment).toBe('measurements')
    expect(openDestination('sleep-lab')).toBe('insights')
    expect(useNav.getState().insightsSegment).toBe('lab')
    expect(openDestination('sauna')).toBe('sauna')
    expect(Object.keys(DESTINATIONS).every((k) => /^[a-z-]+$/.test(k))).toBe(true)
  })

  it('no duplicate entry points: Effects, Compare and the Heart screen each live in one place', () => {
    const body = readFileSync('src/components/BodyTab.jsx', 'utf8')
    const readiness = readFileSync('src/components/health/BodyHealthView.jsx', 'utf8')
    const sleep = readFileSync('src/components/health/SleepTab.jsx', 'utf8')
    const sauna = readFileSync('src/components/sauna/SaunaTab.jsx', 'utf8')
    expect(body).not.toMatch(/EffectsView|OutcomeEngine/)
    expect(readiness).not.toMatch(/CompareSheet|HeartView/)
    expect(sleep).not.toMatch(/AnalysisScreen|LabTeaser/)
    expect(sauna).not.toMatch(/PatternsCard|BeforeAfterHero|LongerTermCard/)
  })
})
