// Binary blobs (progress photos, scan files) are too large for localStorage,
// so they live in IndexedDB keyed by a stable id. The Zustand store keeps only
// the metadata + blobKey reference. Everything degrades gracefully if IDB is
// unavailable (private mode, etc.).
import { get, set, del, keys, createStore } from 'idb-keyval'

const store = createStore('pcc-blobs', 'blobs')

export async function putBlob(key, blob) {
  try { await set(key, blob, store); return true } catch { return false }
}

export async function getBlob(key) {
  try { return (await get(key, store)) || null } catch { return null }
}

export async function deleteBlob(key) {
  try { await del(key, store) } catch { /* ignore */ }
}

export async function allBlobKeys() {
  try { return await keys(store) } catch { return [] }
}

// Object URL cache so we don't re-create URLs on every render.
const urlCache = new Map()
export async function blobUrl(key) {
  if (!key) return null
  if (urlCache.has(key)) return urlCache.get(key)
  const blob = await getBlob(key)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(key, url)
  return url
}
export function revokeBlobUrl(key) {
  const url = urlCache.get(key)
  if (url) { URL.revokeObjectURL(url); urlCache.delete(key) }
}

// Downscale a captured photo to keep IndexedDB lean (max edge ~1080px, JPEG).
export function downscaleImage(file, maxEdge = 1080, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load failed')) }
    img.src = url
  })
}
