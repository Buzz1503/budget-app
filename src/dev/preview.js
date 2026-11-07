// The design review harness, dev builds only (`?preview=<screen>`). It seeds a
// realistic dataset once (two months of doses, five weeks of sauna,
// the Evolt scans the app already imports, the demo Health data), skips
// the Health connect screen, and opens the screen asked for. The screenshot
// script (scripts/design-review.mjs) walks every screen at 390 x 844.
//
// Never in a production build: main.jsx imports this only when import.meta.env.DEV.

import useStore, { todayStr } from '../store/useStore'
import { useHealth } from '../health/state'
import { useHealthLink } from '../lib/healthLink'
import { isDue } from '../lib/due'
import { addDays, daysBetween as addDaysBetween } from '../health/tz'
import { applyScanHistory } from '../body/scanHistory'
import evoltScans from '../data/evolt_scans.json'

/** Where each screen lives: the tab, and for Body the segment. */
export const PREVIEW_SCREENS = {
  home: { tab: 'today' },
  composition: { tab: 'body', seg: 'composition' },
  effects: { tab: 'body', seg: 'effects' },
  recovery: { tab: 'body', seg: 'recovery' },
  'recovery-full': { tab: 'body', seg: 'recovery' },
  sleep: { tab: 'sleep' },
  'sleep-full': { tab: 'sleep' },
  'sleep-lab': { tab: 'sleep' },
  sauna: { tab: 'sauna' },
  more: { tab: 'more' },
  stock: { tab: 'supplies' },
  bloods: { tab: 'bloods' },
  import: { tab: 'scans' },
  'import-list': { tab: 'scans' },
  'sleep-zoom': { tab: 'sleep' },
  'sleep-cross': { tab: 'sleep' },
  'import-check': { tab: 'scans' },
  measurements: { tab: 'body', seg: 'measurements' },
  'measurements-compare': { tab: 'body', seg: 'measurements' },
  photos: { tab: 'body' },
  'photos-compare': { tab: 'body' },
  'photos-adjust': { tab: 'body' },
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
    // tape every few weeks since January 2025, the way a real record grows
    const tape = []
    const days = [0, 28, 63, 105, 150, 196, 245, 300, 350, 400, 455, addDaysBetween('2025-01-01', t) - 3]
    days.forEach((d, i) => {
      const date = addDays('2025-01-01', d)
      if (date >= t) return
      const k = i / (days.length - 1)
      const e = { id: `preview-tape-${i}`, date, source: 'manual', waist: +(112 - 13 * k + (r() - 0.5)).toFixed(1), hips: +(114 - 8 * k).toFixed(1), chest: +(110 - 3 * k).toFixed(1), neck: +(43 - 1.6 * k).toFixed(1) }
      if (i % 2 === 0 || i === days.length - 1) Object.assign(e, { armL: +(36 + 1.4 * k).toFixed(1), armR: +(36.6 + 1.3 * k).toFixed(1), thighL: +(64 - 2 * k).toFixed(1), thighR: +(64.4 - 2.1 * k).toFixed(1), calfL: +(40 + 0.3 * k).toFixed(1), calfR: +(40.2 + 0.4 * k).toFixed(1) })
      tape.push(e)
    })
    useStore.setState({ measurements: [...useStore.getState().measurements, ...tape].sort((a, b) => a.date.localeCompare(b.date)) })
    // two drawn front "photos", the second zoomed in and off centre, to line up in the editor
    if (!useStore.getState().photos.length && typeof document !== 'undefined') {
      const { savePhotoBlob } = await import('../components/PhotosSection')
      const draw = (scale, dx) => new Promise((resolve) => {
        const c = document.createElement('canvas')
        c.width = 900; c.height = 1200
        const g = c.getContext('2d')
        g.fillStyle = '#2a2f3a'; g.fillRect(0, 0, 900, 1200)
        g.translate(450 + dx, 600); g.scale(scale, scale); g.fillStyle = '#c9a98c'
        g.beginPath(); g.arc(0, -380, 70, 0, Math.PI * 2); g.fill()
        g.fillRect(-150, -290, 300, 420); g.fillRect(-140, 130, 120, 420); g.fillRect(20, 130, 120, 420)
        g.fillRect(-230, -280, 70, 360); g.fillRect(160, -280, 70, 360)
        c.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
      })
      await savePhotoBlob(await draw(0.9, 0), { pose: 'front', date: addDays(t, -60) })
      await savePhotoBlob(await draw(1.15, 90), { pose: 'front', date: addDays(t, -2) })
    }
    useStore.setState({
      saunaSessions: saunaFixture(t, r),
      sleepSettings: { ...useStore.getState().sleepSettings, setupCardDismissed: true },
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
  if (screen === 'import-list' || screen === 'import-check') window.__previewImport = () => import('./importFixtures').then((m) => m.dropImportFixtures())
  if (screen === 'sleep-zoom' || screen === 'sleep-cross') {
    // pointer events on the night chart, as a finger would send them
    const fire = (type, id, x, y) => {
      const el = document.querySelector('[data-testid="night-card"] [data-testid="hypnogram"]')
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1 }))
    }
    const at = () => {
      const el = document.querySelector('[data-testid="night-card"] [data-testid="hypnogram"]')
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { r, y: r.top + r.height * 0.3 }
    }
    window.__previewNightZoom = async () => {
      const { r, y } = at()
      const cx = r.left + r.width * 0.55
      fire('pointerdown', 1, cx - 15, y); fire('pointerdown', 2, cx + 15, y)
      for (let i = 1; i <= 10; i++) { fire('pointermove', 1, cx - 15 - i * 6, y); fire('pointermove', 2, cx + 15 + i * 6, y); await new Promise((ok) => setTimeout(ok, 20)) }
      fire('pointerup', 2, cx + 75, y); fire('pointerup', 1, cx - 75, y)
      await new Promise((ok) => setTimeout(ok, 300))
      // then press, hold and drag for the crosshair
      const { r: r2, y: y2 } = at()
      fire('pointerdown', 1, r2.left + r2.width * 0.5, y2)
      await new Promise((ok) => setTimeout(ok, 300))
      fire('pointermove', 1, r2.left + r2.width * 0.62, y2)
    }
    window.__previewNightCross = async () => {
      const { r, y } = at()
      fire('pointerdown', 1, r.left + r.width * 0.5, y)
      fire('pointermove', 1, r.left + r.width * 0.5 + 14, y + 1)
      fire('pointermove', 1, r.left + r.width * 0.58, y + 1)
    }
  }
  window.__previewReady = true
}
