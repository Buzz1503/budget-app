// Lining progress photos up, without ever changing the photo itself.
//
// Every photo is shown in the same 3:4 frame, filling it (like CSS
// object-fit: cover), and then moved by its own settings: `align` on the photo
// record { scale, x, y, rotation }. x and y are fractions of the frame's width
// and height, so the same settings place the photo the same way in a
// thumbnail, the compare slider and the full screen editor. Reset is simply
// "no settings": the original image was never touched.

export interface Align { scale: number; x: number; y: number; rotation: number }
export interface Pt { x: number; y: number }

export const FRAME_ASPECT = 3 / 4 // width / height
export const IDENTITY: Align = { scale: 1, x: 0, y: 0, rotation: 0 }
export const ALIGN_LIMITS = { minScale: 0.5, maxScale: 4, snapDeg: 2 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp

/** A photo's settings, or the identity when it has none or they are broken. */
export function alignOf(photo: { align?: Partial<Align> | null } | null | undefined): Align {
  const a = photo?.align
  if (!a) return IDENTITY
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    scale: clamp(num(a.scale, 1), ALIGN_LIMITS.minScale, ALIGN_LIMITS.maxScale),
    x: clamp(num(a.x, 0), -1, 1),
    y: clamp(num(a.y, 0), -1, 1),
    rotation: clamp(num(a.rotation, 0), -45, 45),
  }
}

export const isIdentity = (a: Align) => a.scale === 1 && a.x === 0 && a.y === 0 && a.rotation === 0

/** What to store: rounded, the rotation snapped to 0 near level, and null for no change. */
export function toStored(a: Align): Align | null {
  const rotation = Math.abs(a.rotation) <= ALIGN_LIMITS.snapDeg ? 0 : round(a.rotation, 2)
  const out = alignOf({ align: { scale: round(a.scale), x: round(a.x), y: round(a.y), rotation } })
  return isIdentity(out) ? null : out
}

/** The CSS transform for an element that fills the frame (translate % is of the element itself). */
export function cssTransform(a: Align): string {
  return `translate(${round(a.x * 100, 3)}%, ${round(a.y * 100, 3)}%) rotate(${round(a.rotation, 3)}deg) scale(${round(a.scale, 4)})`
}

/** Snap a rotation to level within a couple of degrees. */
export const snapRotation = (deg: number) => (Math.abs(deg) <= ALIGN_LIMITS.snapDeg ? 0 : deg)

/**
 * One gesture step in the editor. `from` and `to` are the pointer positions in
 * frame fractions (0 to 1) before and after: one finger moves, two fingers
 * also resize (distance) and turn (angle).
 */
export function applyGesture(a: Align, from: Pt[], to: Pt[]): Align {
  if (!from.length || from.length !== to.length) return a
  const mid = (ps: Pt[]) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length })
  const m0 = mid(from)
  const m1 = mid(to)
  let { scale, rotation } = a
  if (from.length >= 2) {
    // in frame units with true proportions, so a turn is a real angle
    const H = 1 / FRAME_ASPECT
    const v0 = { x: from[1].x - from[0].x, y: (from[1].y - from[0].y) * H }
    const v1 = { x: to[1].x - to[0].x, y: (to[1].y - to[0].y) * H }
    const d0 = Math.hypot(v0.x, v0.y)
    const d1 = Math.hypot(v1.x, v1.y)
    if (d0 > 0.01 && d1 > 0.01) {
      scale = clamp(scale * (d1 / d0), ALIGN_LIMITS.minScale, ALIGN_LIMITS.maxScale)
      rotation = clamp(rotation + ((Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x)) * 180) / Math.PI, -45, 45)
    }
  }
  return { scale, rotation, x: clamp(a.x + (m1.x - m0.x), -1, 1), y: clamp(a.y + (m1.y - m0.y), -1, 1) }
}

// ------------------------------------------------------------- auto align

/** An image point (0 to 1 of the image, origin top left) to the frame (0 to 1), before any settings. */
export function imageToFrame(p: Pt, imageAspect: number): Pt {
  if (imageAspect > FRAME_ASPECT) return { x: (p.x - 0.5) * (imageAspect / FRAME_ASPECT) + 0.5, y: p.y }
  return { x: p.x, y: (p.y - 0.5) * (FRAME_ASPECT / imageAspect) + 0.5 }
}

/** Where a frame point lands once the photo's settings are applied (about the frame's centre). */
export function applyAlign(p: Pt, a: Align): Pt {
  const H = 1 / FRAME_ASPECT
  const cx = p.x - 0.5
  const cy = (p.y - 0.5) * H
  const r = (a.rotation * Math.PI) / 180
  const x = a.scale * (cx * Math.cos(r) - cy * Math.sin(r)) + a.x
  const y = a.scale * (cx * Math.sin(r) + cy * Math.cos(r)) + a.y * H
  return { x: x + 0.5, y: y / H + 0.5 }
}

type Joints = Record<string, { x: number; y: number; c?: number } | undefined>

const midOf = (...ps: Array<Pt | undefined>): Pt | null => {
  const got = ps.filter(Boolean) as Pt[]
  if (!got.length) return null
  return { x: got.reduce((s, p) => s + p.x, 0) / got.length, y: got.reduce((s, p) => s + p.y, 0) / got.length }
}

/** Shoulders and hips from the joints Vision found: the middle of each pair, or neck and root when a side is hidden. */
export function torso(j: Joints | null | undefined): { shoulders: Pt; hips: Pt } | null {
  if (!j) return null
  const shoulders = midOf(j.leftShoulder, j.rightShoulder) || midOf(j.neck)
  const hips = midOf(j.leftHip, j.rightHip) || midOf(j.root)
  if (!shoulders || !hips) return null
  if (Math.hypot(hips.x - shoulders.x, hips.y - shoulders.y) < 0.03) return null
  return { shoulders, hips }
}

/**
 * Settings for the new photo so its shoulders and hips sit where the last
 * photo's do (as that photo is shown, with its own settings). The torso length
 * sets the scale, the middle of the torso sets the offset; the new photo's
 * rotation is kept so a lean is never "corrected". Null when either photo has
 * no torso to match.
 */
export function autoAlign(input: {
  ref: Joints | null; refAspect: number; refAlign: Align
  cur: Joints | null; curAspect: number; curRotation?: number
}): Align | null {
  const r = torso(input.ref)
  const c = torso(input.cur)
  if (!r || !c) return null
  const H = 1 / FRAME_ASPECT
  const toUnits = (p: Pt) => ({ x: p.x - 0.5, y: (p.y - 0.5) * H })
  // the target, where the last photo shows them
  const rs = toUnits(applyAlign(imageToFrame(r.shoulders, input.refAspect), input.refAlign))
  const rh = toUnits(applyAlign(imageToFrame(r.hips, input.refAspect), input.refAlign))
  // the new photo, before any settings
  const cs = toUnits(imageToFrame(c.shoulders, input.curAspect))
  const ch = toUnits(imageToFrame(c.hips, input.curAspect))
  const scale = clamp(Math.hypot(rh.x - rs.x, rh.y - rs.y) / Math.hypot(ch.x - cs.x, ch.y - cs.y), ALIGN_LIMITS.minScale, ALIGN_LIMITS.maxScale)
  const rotation = input.curRotation ?? 0
  const rad = (rotation * Math.PI) / 180
  const cm = { x: (cs.x + ch.x) / 2, y: (cs.y + ch.y) / 2 }
  const tm = { x: (rs.x + rh.x) / 2, y: (rs.y + rh.y) / 2 }
  const moved = { x: scale * (cm.x * Math.cos(rad) - cm.y * Math.sin(rad)), y: scale * (cm.x * Math.sin(rad) + cm.y * Math.cos(rad)) }
  return { scale: round(scale), rotation, x: clamp(round(tm.x - moved.x), -1, 1), y: clamp(round((tm.y - moved.y) / H), -1, 1) }
}

export const AUTO_ALIGN_FAILED = "Couldn't find you in this photo, adjust by hand."

// ------------------------------------------------------------- choosing

/** The photo of the same pose taken before this one (by date, then by when it was added). */
export function previousOf<T extends { id: string; pose: string; date: string }>(photos: T[], photo: T | null | undefined): T | null {
  if (!photo) return null
  const same = photos.filter((p) => p.pose === photo.pose).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const i = same.findIndex((p) => p.id === photo.id)
  return i > 0 ? same[i - 1] : null
}

/** Before and after for the compare view: the ids chosen if they still exist, else the first and the latest. */
export function comparePair<T extends { id: string; date: string }>(list: T[], chosen: { a?: string | null; b?: string | null } = {}): { a: T; b: T } | null {
  const sorted = [...list].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id))
  if (sorted.length < 2) return null
  const a = sorted.find((p) => p.id === chosen.a) || sorted[0]
  let b = sorted.find((p) => p.id === chosen.b) || sorted[sorted.length - 1]
  if (b.id === a.id) b = sorted.find((p) => p.id !== a.id) as T
  return { a, b }
}

/** The photo of a pose nearest a date (ties go to the earlier one), with how many days away it is. */
export function nearestPhoto<T extends { pose: string; date: string; id: string }>(photos: T[], pose: string, date: string): { photo: T; days: number } | null {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000
  let best: { photo: T; days: number } | null = null
  for (const p of photos) {
    if (p.pose !== pose) continue
    const days = Math.round(Math.abs(day(p.date) - day(date)))
    if (!best || days < best.days || (days === best.days && p.date < best.photo.date)) best = { photo: p, days }
  }
  return best
}
