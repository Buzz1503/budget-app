/**
 * Getting a photograph out of the camera roll and into the app unchanged in
 * every way that matters.
 *
 * Three things go wrong with a picked file and all three are silent. An iPhone
 * hands over HEIC, which most canvases refuse to decode. A photo taken sideways
 * carries its rotation in EXIF rather than in the pixels, so it renders on its
 * side. And the date it was taken is in EXIF too, so an import without it dates
 * a photo from March to today and quietly ruins the comparison it was imported
 * for.
 *
 * Everything here is best-effort: a file that cannot be read still imports, it
 * just imports without the thing that could not be read, and says so.
 */

/** Same ceiling and quality the in-app camera uses, so imports look identical. */
export const MAX_EDGE = 1080
export const QUALITY = 0.82

const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

export function looksHeic(file) {
  if (!file) return false
  if (HEIC_TYPES.includes((file.type || '').toLowerCase())) return true
  // iOS sometimes hands over an empty type, leaving only the name to go on
  return /\.hei[cf]$/i.test(file.name || '')
}

/** The date the shutter actually fired, or null. */
export async function readTakenAt(file) {
  try {
    const { default: exifr } = await import('exifr')
    const tags = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate'])
    const when = tags?.DateTimeOriginal || tags?.CreateDate || tags?.ModifyDate
    if (!when) return null
    const d = when instanceof Date ? when : new Date(when)
    return isFinite(d.getTime()) ? d : null
  } catch {
    return null
  }
}

/** The EXIF orientation flag, 1 when absent or unreadable. */
export async function readOrientation(file) {
  try {
    const { default: exifr } = await import('exifr')
    const tags = await exifr.parse(file, ['Orientation'])
    const o = tags?.Orientation
    return typeof o === 'number' && o >= 1 && o <= 8 ? o : 1
  } catch {
    return 1
  }
}

/** HEIC in, JPEG out. Anything else passes straight through. */
export async function toJpegIfNeeded(file) {
  if (!looksHeic(file)) return file
  try {
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: QUALITY })
    const blob = Array.isArray(out) ? out[0] : out
    return new File([blob], (file.name || 'photo').replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' })
  } catch {
    // Safari decodes HEIC natively, so the original may still work downstream.
    return file
  }
}

/**
 * Bake the rotation into the pixels.
 *
 * The eight EXIF orientations are four rotations and their mirror images. Once
 * the canvas has drawn it the right way up, the flag is gone and every later
 * consumer — thumbnail, chart, report, backup — sees a picture that is simply
 * the right way round.
 */
function applyOrientation(ctx, orientation, w, h) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break
    case 7: ctx.transform(0, -1, -1, 0, h, w); break
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break
    default: break
  }
}

export function swapsAxes(orientation) {
  return orientation >= 5 && orientation <= 8
}

/** Downscale, rotate upright and re-encode. Returns a JPEG blob. */
export function normalise(file, orientation = 1, maxEdge = MAX_EDGE, quality = QUALITY) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const swap = swapsAxes(orientation)
      const srcW = swap ? img.height : img.width
      const srcH = swap ? img.width : img.height
      const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
      const w = Math.max(1, Math.round(srcW * scale))
      const h = Math.max(1, Math.round(srcH * scale))

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      // the transform is written in the *drawn* space, so it is set up against
      // the un-swapped dimensions and the image is drawn at its own size
      applyOrientation(ctx, orientation, w, h)
      if (swap) ctx.drawImage(img, 0, 0, h, w)
      else ctx.drawImage(img, 0, 0, w, h)

      URL.revokeObjectURL(url)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('could not encode the photo'))),
        'image/jpeg', quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read the photo')) }
    img.src = url
  })
}

/**
 * One picked file, ready to store.
 *
 * `takenAt` is null rather than today when EXIF has nothing to say, so the
 * caller can tell "taken today" from "we do not know" and highlight the date
 * field instead of quietly asserting a date it invented.
 */
export async function importPhoto(file) {
  const takenAt = await readTakenAt(file)
  const orientation = await readOrientation(file)
  const jpeg = await toJpegIfNeeded(file)
  let blob
  try {
    blob = await normalise(jpeg, orientation)
  } catch (e) {
    return { ok: false, error: e.message, name: file.name || 'photo', takenAt }
  }
  return {
    ok: true,
    blob,
    name: file.name || 'photo',
    takenAt,
    dateStr: takenAt ? localDateStr(takenAt) : null,
    timeStr: takenAt ? localTimeStr(takenAt) : null,
    orientation,
    wasHeic: looksHeic(file),
    size: blob.size,
  }
}

/** Several at once, in the order they were picked. */
export async function importPhotos(files = []) {
  const out = []
  for (const f of files) out.push(await importPhoto(f))
  return out
}

/** Local yyyy-MM-dd, not UTC — a photo taken at 9 pm is not tomorrow's. */
export function localDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function localTimeStr(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
