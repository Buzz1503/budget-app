/**
 * Getting the site map photograph on screen, or saying why it is not.
 *
 * There are four ways this fails and all of them look the same to the user —
 * a grey rectangle with pins floating on it. The blob was never written; the
 * blob was written empty; the object URL was built from the wrong thing; or
 * the URL is fine but the image has not decoded yet and the pins render first.
 *
 * So "ready" is defined once, here, as: a blob exists, it has a non-zero size,
 * an object URL was made from its key, and the browser has decoded it. Nothing
 * draws pins until that is true, and the import flow waits on the same
 * definition before it opens the adjust screen.
 */
import { getBlob, blobUrl, revokeBlobUrl } from './blobStore'

/**
 * Load and decode the map photo.
 *
 * The URL comes from `blobUrl(key)`, which caches one URL per key — so this is
 * memoised by photo id for free, and a re-render never mints a second URL for
 * the same photo. Revoking is the caller's job, and only on replace.
 */
export async function loadMapPhoto(photoKey) {
  if (!photoKey) return { status: 'none', url: null, natural: null }

  const blob = await getBlob(photoKey)
  if (!blob) return { status: 'error', url: null, natural: null, reason: 'missing' }
  if (!blob.size) return { status: 'error', url: null, natural: null, reason: 'empty' }

  const url = await blobUrl(photoKey)
  if (!url) return { status: 'error', url: null, natural: null, reason: 'unreadable' }

  const img = new Image()
  img.src = url
  try {
    // decode() rather than onload: onload fires before the pixels are usable in
    // some WebKit builds, which is exactly long enough to paint the pins onto
    // nothing
    if (img.decode) await img.decode()
    else await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
  } catch {
    return { status: 'error', url: null, natural: null, reason: 'undecodable' }
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    return { status: 'error', url: null, natural: null, reason: 'undecodable' }
  }

  return {
    status: 'ready',
    url,
    natural: { w: img.naturalWidth, h: img.naturalHeight },
  }
}

export const MAP_PHOTO_ERRORS = {
  missing: 'The map photo is not on this device any more.',
  empty: 'The map photo was saved empty.',
  unreadable: 'The map photo could not be opened.',
  undecodable: 'The map photo could not be decoded.',
}

/** Free the URL for a photo that is being replaced or removed. */
export function releaseMapPhoto(photoKey) {
  if (photoKey) revokeBlobUrl(photoKey)
}
