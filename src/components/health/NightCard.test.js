import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import NightCard from './NightCard'

const T = Date.parse('2026-10-26T23:00:00Z')
const m = (min) => T + min * 60000
const tz = { hourOf: (ms) => new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60 }

const night = {
  date: '2026-10-27', start: m(0), end: m(480), asleepMin: 470, hasStages: true,
  segments: [
    { start: m(0), end: m(60), stage: 'core' }, { start: m(60), end: m(64), stage: 'awake' },
    { start: m(64), end: m(150), stage: 'deep' }, { start: m(150), end: m(480), stage: 'rem' },
  ],
}
const overnight = {
  hr: [[0, 55], [30, 53], [61, 62], [90, 51], [200, 54], [300, 70], [301, 72], [302, 70], [400, 52]],
  hrv: [[60, 40], [240, 55]],
  spo2: [[120, 95], [250, 88]],
  resp: [[60, 15], [300, 14]],
}

describe('the night card lanes', () => {
  it('stages, heart rate, HRV, SpO2 and breathing rate, with no Move or Sound lane', () => {
    const html = renderToStaticMarkup(createElement(NightCard, { night, overnight, tz, events: [] }))
    for (const k of ['hr', 'hrv', 'spo2', 'resp']) expect(html).toContain(`data-testid="strip-${k}"`)
    expect(html).toContain('data-testid="hypno-seg-deep"')
    expect(html).not.toMatch(/strip-(move|sound|movement)/)
    expect(html).not.toMatch(/>(Move|Sound)</)
    // the SpO2 dip is amber, HRV and breathing are dots, the spike is a band
    expect(html).toContain('data-low="true"')
    expect(html).toContain('data-testid="hrv-dot"')
    expect(html).toContain('data-testid="resp-dot"')
    expect(html).toContain('data-testid="hr-spike"')
    expect(html).toContain('Woke once, 4 min awake. 1 heart rate spike.')
  })

  it('a lane with no readings is left out', () => {
    const html = renderToStaticMarkup(createElement(NightCard, { night, overnight: { hr: overnight.hr }, tz, events: [] }))
    expect(html).toContain('data-testid="strip-hr"')
    expect(html).not.toContain('data-testid="strip-hrv"')
    expect(html).not.toContain('data-testid="strip-resp"')
  })
})
