// Progress photos are resized before anything is stored. A 12 MP camera image
// decoded at full size several times over (the timeline, the compare, the
// editor) is what runs a web view out of memory, so:
//
//   - the photo kept: longest side 2000 px, JPEG quality 0.85
//   - its thumbnail, for the timeline grid: longest side 480 px, quality 0.8
//
// A photo that cannot be decoded is an error, never stored at full size.

export const PHOTO_MAX = 2000
export const PHOTO_QUALITY = 0.85
export const THUMB_MAX = 480
export const THUMB_QUALITY = 0.8

/** The size that fits inside `max` on the longest side, never larger than the original. */
export function fitWithin(w, h, max) {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0, scale: 0 }
  const scale = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale }
}

/** Decode a File or Blob to something drawable, with its EXIF orientation applied. */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() }
    } catch { /* fall back to an <img> */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ source: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, release: () => URL.revokeObjectURL(url) })
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read this photo")) }
    img.src = url
  })
}

/** Draw `source` at w x h and encode it as JPEG; the canvas is emptied afterwards to free its memory. */
function encodeJpeg(source, w, h, quality) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, w, h)
    canvas.toBlob((blob) => {
      canvas.width = 0
      canvas.height = 0
      if (blob) resolve(blob)
      else reject(new Error("Couldn't save this photo"))
    }, 'image/jpeg', quality)
  })
}

/**
 * The photo to store and its thumbnail. `deps` lets tests swap the browser's
 * decoder and encoder.
 */
export async function preparePhoto(file, deps = {}) {
  const decode = deps.decode || decodeImage
  const encode = deps.encode || encodeJpeg
  const img = await decode(file)
  try {
    const full = fitWithin(img.width, img.height, PHOTO_MAX)
    if (!full.w) throw new Error("Couldn't read this photo")
    const blob = await encode(img.source, full.w, full.h, PHOTO_QUALITY)
    const t = fitWithin(img.width, img.height, THUMB_MAX)
    const thumb = await encode(img.source, t.w, t.h, THUMB_QUALITY)
    return { blob, thumb, width: full.w, height: full.h }
  } finally {
    img.release?.()
  }
}

/** A thumbnail for a photo stored before thumbnails existed (the original is left as it is). */
export async function makeThumb(blob, deps = {}) {
  const decode = deps.decode || decodeImage
  const encode = deps.encode || encodeJpeg
  const img = await decode(blob)
  try {
    const t = fitWithin(img.width, img.height, THUMB_MAX)
    return { thumb: await encode(img.source, t.w, t.h, THUMB_QUALITY), width: img.width, height: img.height }
  } finally {
    img.release?.()
  }
}
