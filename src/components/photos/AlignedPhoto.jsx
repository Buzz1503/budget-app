import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { blobUrl, cachedBlobUrl, getBlob, putBlob } from '../../lib/blobStore'
import { makeThumb } from '../../lib/photoImage'
import { alignOf, cssTransform } from '../../lib/photoAlign'

const making = new Set()

/**
 * The URL of a photo's image: its thumbnail for small views, else the photo.
 * A photo saved before thumbnails existed gets one made once, in the
 * background; the original is never changed.
 */
export function usePhotoUrl(photo, { thumb = false } = {}) {
  const key = thumb ? (photo?.thumbKey || photo?.blobKey) : photo?.blobKey
  const [url, setUrl] = useState(() => cachedBlobUrl(key))
  useEffect(() => {
    let alive = true
    setUrl(cachedBlobUrl(key))
    if (key) blobUrl(key).then((u) => alive && setUrl(u))
    return () => { alive = false }
  }, [key])
  useEffect(() => {
    if (!thumb || !photo?.blobKey || photo.thumbKey || making.has(photo.id)) return
    making.add(photo.id)
    ;(async () => {
      try {
        const blob = await getBlob(photo.blobKey)
        if (!blob) return
        const t = await makeThumb(blob)
        const thumbKey = `${photo.blobKey}-thumb`
        if (await putBlob(thumbKey, t.thumb)) {
          useStore.getState().updatePhoto(photo.id, { thumbKey, width: photo.width || t.width, height: photo.height || t.height })
        }
      } catch { /* the full photo keeps showing */ }
    })()
  }, [thumb, photo?.id, photo?.blobKey, photo?.thumbKey, photo?.width, photo?.height])
  return url
}

/**
 * One photo filling its frame, moved by its own settings (`align`), or by
 * `align` given here while it is being adjusted. Put it inside a frame with
 * position: relative and overflow: hidden.
 */
export default function AlignedPhoto({ photo, align = null, thumb = false, opacity = 1, alt, onSize, testid }) {
  const url = usePhotoUrl(photo, { thumb })
  const a = align || alignOf(photo)
  if (!url) return null
  return (
    <img src={url} alt={alt ?? `${photo.pose} ${photo.date}`} draggable={false}
      onLoad={onSize ? (e) => onSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }) : undefined}
      className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
      style={{ transform: cssTransform(a), transformOrigin: '50% 50%', opacity }}
      data-testid={testid} data-align={`${a.scale},${a.x},${a.y},${a.rotation}`} />
  )
}

/** The 3:4 frame every progress photo is shown in. */
export function PhotoFrame({ children, maxWidth = 260, className = '', style, testid }) {
  return (
    <div className={`relative mx-auto w-full overflow-hidden rounded-[14px] ${className}`}
      style={{ aspectRatio: '3/4', maxWidth, background: 'var(--surface-sunk)', ...style }} data-testid={testid}>
      {children}
    </div>
  )
}
