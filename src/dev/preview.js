// The design review harness, dev builds only (`?preview=<screen>`). It seeds a
// realistic dataset once (two months of doses, five weeks of sauna, Sleep sounds
// nights, the Evolt scans the app already imports, the demo Health data), skips
// the Health connect screen, and opens the screen asked for. The screenshot
// script (scripts/design-review.mjs) walks every screen at 390 x 844.
//
// Never in a production build: main.jsx imports this only when import.meta.env.DEV.

import useStore, { todayStr } from '../store/useStore'
import { useHealth } from '../health/state'
import { useHealthLink } from '../lib/healthLink'
import { isDue } from '../lib/due'
import { addDays } from '../health/tz'
import { applyScanHistory } from '../body/scanHistory'
import evoltScans from '../data/evolt_scans.json'

/** Where each screen lives: the tab, and for Body the segment. */
export const PREVIEW_SCREENS = {
  home: { tab: 'today' },
  composition: { tab: 'body', seg: 'composition' },
  effects: { tab: 'body', seg: 'effects' },
  recovery: { tab: 'body', seg: 'recovery' },
  sleep: { tab: 'sleep' },
  'sleep-full': { tab: 'sleep' },
  'sleep-lab': { tab: 'sleep' },
  'sleep-sounds': { tab: 'sleep' },
  sauna: { tab: 'sauna' },
  more: { tab: 'more' },
  stock: { tab: 'supplies' },
  bloods: { tab: 'bloods' },
  import: { tab: 'scans' },
}

export const previewScreen = () => {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null
  const p = new URLSearchParams(location.search).get('preview')
  return p && PREVIEW_SCREENS[p] ? p : null
}

const SEEDED = 'pepito-preview-seeded'
const pad = (n) => String(n).padStart(2, '0')

/** Deterministic noise, so every run draws the same pictures. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function saunaFixture(t, r) {
  const out = []
  // five weeks, most days, mostly evenings, longer over time
  for (let i = 35; i >= 1; i--) {
    if (r() < 0.2) continue
    const date = addDays(t, -i)
    const evening = r() < 0.6
    const start = evening ? `${19 + Math.floor(r() * 2)}:${pad(Math.floor(r() * 6) * 10)}` : `0${7 + Math.floor(r() * 2)}:30`
    const lengthMin = Math.round(18 + (35 - i) * 0.35 + r() * 6)
    const tempC = r() < 0.7 ? 70 : 80
    const startedAt = new Date(`${date}T${start}:00`).getTime()
    const samples = []
    for (let s = 0; s <= lengthMin * 60; s += 5) samples.push([startedAt / 1000 + s, Math.round(82 + Math.min(40, s / 18) - (35 - i) * 0.12 + (r() - 0.5) * 4)])
    out.push({
      id: `preview-sauna-${date}`, date, start, lengthMin, tempC, type: 'Traditional', rounds: 1, coldMin: r() < 0.4 ? 2 : null,
      weightBeforeKg: null, weightAfterKg: null, notes: '', source: 'watch', workoutId: null, startedAt, endedAt: startedAt + lengthMin * 60000,
      hr: { samples },
      coolDown: { exitAt: startedAt + lengthMin * 60000, samples: [[startedAt / 1000 + lengthMin * 60, 128], [startedAt / 1000 + lengthMin * 60 + 120, 86], [startedAt / 1000 + lengthMin * 60 + 300, 78]] },
    })
  }
  return out
}

function soundsFixture(t, r) {
  const nights = {}
  for (let i = 0; i < 12; i++) {
    const wake = addDays(t, -i)
    if (i === 3) continue // a night it did not run
    const start = new Date(`${addDays(wake, -1)}T22:40:00`).getTime()
    const end = new Date(`${wake}T06:50:00`).getTime()
    const events = []
    if (i % 4 !== 1) {
      for (let k = 0; k < 6 + Math.floor(r() * 10); k++) {
        const s = start + (60 + r() * 380) * 60000
        events.push({ s, e: s + (1 + r() * 4) * 60000, label: 'snoring', c: 0.6 + r() * 0.35 })
      }
    }
    if (r() < 0.5) { const s = start + r() * 400 * 60000; events.push({ s, e: s + 2000, label: 'cough', c: 0.8 }) }
    events.sort((a, b) => a.s - b.s)
    const levels = []
    for (let m = start; m < end; m += 60000) levels.push([m, Math.round(-58 + (r() < 0.02 ? 25 : 0) + (r() - 0.5) * 4)])
    nights[wake] = {
      sounds: [{
        id: `preview-ss-${wake}`, start, end, events, levels, loudMinutes: 3, movingMinutes: 2, lowConfidence: false, room: [],
        startedBy: i % 2 ? 'schedule' : 'shortcut', stopReason: 'scheduled', gaps: [], checkpoints: 98, open: false, recovered: false,
      }],
    }
  }
  return nights
}

/** Seed the store once per browser profile, then connect the demo Health data. */
export async function seedPreview() {
  const t = todayStr()
  const s = useStore.getState()
  let seeded = false
  try { seeded = localStorage.getItem(SEEDED) === t } catch { /* private window */ }
  if (!seeded) {
    const r = rng(7)
    // two months of the protocol already in the app, on the days each was due
    for (let i = 60; i >= 1; i--) {
      const date = addDays(t, -i)
      for (const p of s.peptides) {
        if (!p.active && p.active !== undefined) continue
        if (isDue(p, date, { pushes: s.pushes || [], pauses: s.pauses || [] }) && r() < 0.95) useStore.getState().backfillDose(p.id, date)
      }
    }
    // the Evolt scans a real install has from the v22 migration
    const st = useStore.getState()
    const scans = applyScanHistory(st.measurements, st.bodyStart, evoltScans)
    useStore.setState({ measurements: scans.measurements, bodyStart: scans.bodyStart })
    const nightExtras = { ...useStore.getState().nightExtras, ...soundsFixture(t, r) }
    useStore.setState({
      saunaSessions: saunaFixture(t, r),
      nightExtras,
      sleepSettings: { ...useStore.getState().sleepSettings, sleepSounds: true, setupCardDismissed: true },
      healthSettings: { ...useStore.getState().healthSettings, connected: true },
      coachMarks: Object.fromEntries(Object.keys(useStore.getState().coachMarks || {}).map((k) => [k, true])),
    })
    try { localStorage.setItem(SEEDED, t) } catch { /* private window */ }
  }
  if (!useStore.getState().healthSettings.connected) useStore.setState({ healthSettings: { ...useStore.getState().healthSettings, connected: true } })
  await useHealth.getState().load?.()
  if (!useHealth.getState().data?.meta?.lastSyncAt) await useHealth.getState().connect({})
  const screen = previewScreen()
  const seg = PREVIEW_SCREENS[screen]?.seg
  if (seg) useHealthLink.getState().setBodySegment?.(seg)
  window.__previewReady = true
}
