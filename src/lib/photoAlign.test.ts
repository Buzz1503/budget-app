import { describe, it, expect } from 'vitest'
import {
  alignOf, toStored, cssTransform, applyGesture, imageToFrame, applyAlign, autoAlign, torso,
  previousOf, comparePair, nearestPhoto, IDENTITY, snapRotation, AUTO_ALIGN_FAILED,
} from './photoAlign'

const close = (a: number, b: number, e = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(e)

describe('photo settings: stored, never the image', () => {
  it('no settings is the original; broken values fall back', () => {
    expect(alignOf({})).toEqual(IDENTITY)
    expect(alignOf({ align: { scale: 'x' as unknown as number, x: 0.1 } })).toEqual({ scale: 1, x: 0.1, y: 0, rotation: 0 })
    expect(alignOf({ align: { scale: 99 } }).scale).toBe(4)
  })

  it('what is stored: rounded, level snapped, and nothing at all for Reset', () => {
    expect(toStored({ scale: 1.234567, x: 0.0123456, y: -0.2, rotation: 1.5 })).toEqual({ scale: 1.2346, x: 0.0123, y: -0.2, rotation: 0 })
    expect(toStored({ scale: 1, x: 0, y: 0, rotation: 1 })).toBeNull()
    expect(toStored(IDENTITY)).toBeNull()
    expect(snapRotation(-1.9)).toBe(0)
    expect(snapRotation(5)).toBe(5)
  })

  it('the CSS transform moves, turns and scales about the centre', () => {
    expect(cssTransform({ scale: 1.2, x: 0.05, y: -0.1, rotation: 3 })).toBe('translate(5%, -10%) rotate(3deg) scale(1.2)')
    expect(cssTransform(IDENTITY)).toBe('translate(0%, 0%) rotate(0deg) scale(1)')
  })

  it('drag moves, pinch resizes, twist turns', () => {
    const moved = applyGesture(IDENTITY, [{ x: 0.5, y: 0.5 }], [{ x: 0.6, y: 0.45 }])
    close(moved.x, 0.1); close(moved.y, -0.05)
    const pinched = applyGesture(IDENTITY, [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }], [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }])
    close(pinched.scale, 2); close(pinched.x, 0)
    // a quarter turn of the fingers, measured with the frame's real proportions
    const turned = applyGesture(IDENTITY, [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }], [{ x: 0.5, y: 0.5 - 0.1 * 0.75 }, { x: 0.5, y: 0.5 + 0.1 * 0.75 }])
    close(turned.rotation, 45, 0.01) // clamped at 45
  })
})

describe('auto align from shoulders and hips', () => {
  // a portrait photo the shape of the frame, so image and frame points match
  const body = (sx: number, sy: number, hy: number) => ({
    leftShoulder: { x: sx - 0.1, y: sy }, rightShoulder: { x: sx + 0.1, y: sy },
    leftHip: { x: sx - 0.07, y: hy }, rightHip: { x: sx + 0.07, y: hy },
  })

  it('image points land in the frame like object-fit cover', () => {
    expect(imageToFrame({ x: 0.5, y: 0.5 }, 0.75)).toEqual({ x: 0.5, y: 0.5 })
    // a landscape photo overflows sideways: its middle half fills the frame
    const p = imageToFrame({ x: 0.75, y: 0.2 }, 1.5)
    close(p.x, 1); close(p.y, 0.2)
  })

  it('scales the new photo so the torso is the same length, and centres it on the last one', () => {
    // last photo: torso from 0.3 to 0.6 at the centre; new photo: half as big and off to the right
    const ref = body(0.5, 0.3, 0.6)
    const cur = body(0.7, 0.4, 0.55)
    const a = autoAlign({ ref, refAspect: 0.75, refAlign: IDENTITY, cur, curAspect: 0.75 })!
    close(a.scale, 2)
    expect(a.rotation).toBe(0)
    const t = torso(cur)!
    const s = applyAlign(t.shoulders, a)
    const h = applyAlign(t.hips, a)
    close(s.x, 0.5); close(s.y, 0.3)
    close(h.x, 0.5); close(h.y, 0.6)
  })

  it('matches the last photo as it is shown, with its own settings', () => {
    const ref = body(0.5, 0.3, 0.6)
    const refAlign = { scale: 1.2, x: 0.05, y: 0, rotation: 0 }
    const a = autoAlign({ ref, refAspect: 0.75, refAlign, cur: ref, curAspect: 0.75 })!
    close(a.scale, 1.2); close(a.x, 0.05); close(a.y, 0)
  })

  it('a side photo with one shoulder still works; no torso means adjust by hand', () => {
    const side = { leftShoulder: { x: 0.5, y: 0.3 }, leftHip: { x: 0.52, y: 0.6 } }
    expect(torso(side)).toEqual({ shoulders: { x: 0.5, y: 0.3 }, hips: { x: 0.52, y: 0.6 } })
    expect(autoAlign({ ref: side, refAspect: 0.75, refAlign: IDENTITY, cur: null, curAspect: 0.75 })).toBeNull()
    expect(autoAlign({ ref: side, refAspect: 0.75, refAlign: IDENTITY, cur: { nose: { x: 0.5, y: 0.1 } }, curAspect: 0.75 })).toBeNull()
    expect(AUTO_ALIGN_FAILED).toBe("Couldn't find you in this photo, adjust by hand.")
  })
})

describe('choosing photos', () => {
  const ph = [
    { id: 'a', pose: 'front', date: '2026-01-01' }, { id: 'b', pose: 'side', date: '2026-02-01' },
    { id: 'c', pose: 'front', date: '2026-03-01' }, { id: 'd', pose: 'front', date: '2026-05-01' },
  ]

  it('the last photo of the same pose', () => {
    expect(previousOf(ph, ph[3])!.id).toBe('c')
    expect(previousOf(ph, ph[0])).toBeNull()
    expect(previousOf(ph, ph[1])).toBeNull()
  })

  it('before and after: first and latest by default, any two when chosen', () => {
    const front = ph.filter((p) => p.pose === 'front')
    expect(comparePair(front)).toMatchObject({ a: { id: 'a' }, b: { id: 'd' } })
    expect(comparePair(front, { a: 'c', b: 'a' })).toMatchObject({ a: { id: 'c' }, b: { id: 'a' } })
    // the same photo on both sides is not a comparison
    expect(comparePair(front, { a: 'd', b: 'd' })).toMatchObject({ a: { id: 'd' }, b: { id: 'a' } })
    // a deleted choice falls back
    expect(comparePair(front, { a: 'gone' }).a.id).toBe('a')
    expect(comparePair([ph[0]])).toBeNull()
  })

  it('the photo nearest a date, of that pose', () => {
    expect(nearestPhoto(ph, 'front', '2026-02-20')).toMatchObject({ photo: { id: 'c' }, days: 9 })
    expect(nearestPhoto(ph, 'front', '2026-01-25')).toMatchObject({ photo: { id: 'a' }, days: 24 })
    expect(nearestPhoto(ph, 'back', '2026-01-01')).toBeNull()
  })
})
