import { describe, expect, it } from 'vitest'
import { EXERCISES, HOME_DAY, KNEE_STAGE2_BLOCKS, MILESTONES, SESSIONS, SHOULDER_CARE, SWAPS, WRIST_STAGES } from './seed'
import type { SessionEntry, SessionItem } from './types'

const ids = new Set(EXERCISES.map((e) => e.id))
const isItem = (e: SessionEntry): e is SessionItem => 'exerciseId' in e

describe('seed integrity', () => {
  it('has unique exercise ids', () => {
    expect(ids.size).toBe(EXERCISES.length)
  })

  it('every referenced exercise exists', () => {
    const refs = [
      ...SESSIONS.flatMap((s) => s.entries.filter(isItem)),
      ...WRIST_STAGES.flatMap((w) => w.exercises),
      ...SHOULDER_CARE,
      ...HOME_DAY.filter(isItem),
    ].map((i) => i.exerciseId)
    refs.push(...MILESTONES.map((m) => m.exerciseId), ...SWAPS.flatMap((s) => s.exerciseIds))
    for (const r of refs) expect(ids, r).toContain(r)
  })

  it('knee Stage 2 blocks cover weeks 1 to 12 without gaps', () => {
    let next = 1
    for (const b of KNEE_STAGE2_BLOCKS) {
      expect(b.weeks.min).toBe(next)
      next = b.weeks.max + 1
    }
    expect(next).toBe(13)
  })

  it('every session follows the plan section order', () => {
    const order = ['warmup', 'kneePrimer', 'wristBlock', 'kneeStrength', 'gluteHam', 'upper', 'core', 'shoulderCare']
    for (const s of SESSIONS) {
      const idx = s.entries.map((e) => order.indexOf(e.section))
      expect(idx, s.id).toEqual([...idx].sort((a, b) => a - b))
    }
  })

  it('every session has two or more glute/hamstring machines', () => {
    for (const s of SESSIONS) {
      const gh = s.entries.filter(isItem).filter((i) => EXERCISES.find((e) => e.id === i.exerciseId)?.category === 'gluteHam')
      expect(gh.length, s.id).toBeGreaterThanOrEqual(2)
    }
  })

  it('weekly glute/ham sets match the plan totals', () => {
    const count = (id: string) =>
      SESSIONS.flatMap((s) => s.entries.filter(isItem))
        .filter((i) => i.exerciseId === id)
        .reduce((n, i) => n + (i.prescription.kind === 'fixed' ? i.prescription.sets : 0), 0)
    expect(count('hip-thrust')).toBe(6)
    expect(count('lying-hamstring-curl')).toBe(10)
    expect(count('cable-glute-kickback')).toBe(3)
    expect(count('hip-abduction')).toBe(3)
    expect(count('hip-adduction')).toBe(3)
  })

  it('no banned movements appear in any session', () => {
    const names = SESSIONS.flatMap((s) => s.entries.filter(isItem)).map((i) => i.exerciseId)
    expect(names).not.toContain('hack-squat')
  })
})

describe('approved defaults', () => {
  it('every session and block line has a rest period', () => {
    const lines = [
      ...SESSIONS.flatMap((s) => s.entries.filter(isItem)),
      ...WRIST_STAGES.flatMap((w) => w.exercises),
      ...SHOULDER_CARE,
    ].filter((i) => i.exerciseId !== 'bike')
    for (const l of lines) expect(l.restSec, l.exerciseId).not.toBeNull()
  })
})
