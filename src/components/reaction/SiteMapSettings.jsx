import { useRef, useState } from 'react'
import { Upload, RotateCcw, Move } from 'lucide-react'
import useStore from '../../store/useStore'
import { putBlob, getBlob, deleteBlob } from '../../lib/blobStore'
import { loadMapPhoto, releaseMapPhoto, MAP_PHOTO_ERRORS } from '../../lib/mapPhoto'
import { importPhoto } from '../../lib/photoImport'
import { DEFAULT_CHECK_TIME } from '../../lib/reactionTracker'
import { PINS, checkPins, MIN_SPACING_PX, SCREEN_WIDTH } from '../../lib/sitePins'
import AdjustPins from './AdjustPins'
import { useMapPhoto } from './SiteMap'

/**
 * Settings &gt; Site map.
 *
 * The photograph is imported here and nowhere else, and it never leaves the
 * phone: it is written straight to IndexedDB, it is not in the repository, not
 * in the build, and not in a backup unless the switch below is turned on by
 * hand.
 */
export default function SiteMapSettings() {
  const siteMap = useStore((s) => s.siteMap)
  const settings = useStore((s) => s.reactionSettings)
  const setMapPhoto = useStore((s) => s.setMapPhoto)
  const clearMapPhoto = useStore((s) => s.clearMapPhoto)
  const setInclude = useStore((s) => s.setIncludeMapPhotoInBackup)
  const updateSettings = useStore((s) => s.updateReactionSettings)
  const resetAllPins = useStore((s) => s.resetAllPins)

  const photo = useMapPhoto()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const fileRef = useRef(null)

  const has = !!siteMap?.photoKey

  /**
   * Import, and do not hand over until the photo is genuinely on screen-ready.
   *
   * Adjust pins used to open the moment the store was told about the new key,
   * which is several steps too early: the blob may still be settling in
   * IndexedDB, the object URL does not exist yet, and the image has certainly
   * not decoded. The result was an adjust screen full of pins floating over
   * nothing. Now every one of those steps is awaited and checked, and a photo
   * that fails any of them is rejected rather than saved.
   */
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setBusy('Reading photo')
    const key = `sitemap-${Date.now()}`
    try {
      // HEIC to JPEG and EXIF rotation baked in, before anything is stored
      const out = await importPhoto(file)
      if (!out.ok) { setError(out.error || 'That photo could not be read.'); return }
      if (!out.blob?.size) { setError('That photo came back empty. Try importing it again.'); return }

      setBusy('Saving photo')
      const saved = await putBlob(key, out.blob)
      if (!saved) { setError('This device would not store the photo.'); return }

      // read it back rather than trusting the write
      const check = await getBlob(key)
      if (!check?.size) {
        await deleteBlob(key)
        setError('The photo did not save properly. Try importing it again.')
        return
      }

      setBusy('Loading photo')
      const loaded = await loadMapPhoto(key)
      if (loaded.status !== 'ready') {
        await deleteBlob(key)
        setError(MAP_PHOTO_ERRORS[loaded.reason] || 'That photo could not be opened.')
        return
      }

      const old = siteMap?.photoKey
      setMapPhoto(key)
      if (old && old !== key) {
        releaseMapPhoto(old)
        try { await deleteBlob(old) } catch { /* the old one is already gone */ }
      }
      // Replacing the photo keeps every pin, so the first thing worth doing is
      // checking they still land on skin — which is this, opened for you, and
      // only now that there is something to see.
      setAdjustOpen(true)
    } catch (err) {
      try { await deleteBlob(key) } catch { /* nothing to clean up */ }
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    const k = siteMap.photoKey
    clearMapPhoto()
    releaseMapPhoto(k)
    try { await deleteBlob(k) } catch { /* already gone */ }
  }

  return (
    <div className="card space-y-3 p-4" data-testid="site-map-settings">
      <div>
        <div className="text-sm font-black">Site map</div>
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>
          One full-body photo, front on the left and back on the right. It is stored on this
          phone only and is never uploaded.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="map-photo-input"
        onChange={onFile}
      />
      <button
        data-testid="import-map-photo"
        disabled={!!busy}
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black disabled:opacity-50"
        style={{ background: 'var(--surface-sunk)' }}
      >
        <Upload size={15} /> {busy ? `${busy}…` : has ? 'Replace map photo' : 'Import map photo'}
      </button>
      {error && (
        <div className="t-caption" data-testid="map-import-error" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <AspectNote photo={photo} />

      {has && (
        <>
          <button
            data-testid="adjust-pins"
            onClick={() => setAdjustOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black"
            style={{ background: 'var(--surface-sunk)' }}
          >
            <Move size={15} /> Adjust pins
          </button>
          <button
            data-testid="remove-map-photo"
            onClick={remove}
            className="t-caption underline"
            style={{ color: 'var(--text-3)' }}
          >
            Remove the photo from this phone
          </button>
        </>
      )}

      <Switch
        testId="include-map-in-backup"
        on={!!siteMap?.includePhotoInBackup}
        onChange={setInclude}
        label="Include map photo in backup"
        hint="Off by default — a backup file with this on contains a full-body photograph."
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Evening check time</span>
        <input
          type="time"
          data-testid="check-time"
          value={settings?.checkTime || DEFAULT_CHECK_TIME}
          onChange={(e) => updateSettings({ checkTime: e.target.value })}
          className="input w-32 text-center"
        />
      </div>

      <button
        data-testid="reset-all-pins"
        onClick={resetAllPins}
        className="t-caption flex items-center gap-1.5 underline"
        style={{ color: 'var(--text-3)' }}
      >
        <RotateCcw size={12} /> Reset every pin to its default position
      </button>

      <AdjustPins open={adjustOpen} onClose={() => setAdjustOpen(false)} />
    </div>
  )
}

/**
 * The photo's shape decides how far apart the pins land.
 *
 * Pin positions are percentages of the composite, so the gap between two rows
 * is a percentage of the photo's *height*. A squarer photo than the table was
 * drawn for pulls those rows together, and the 44 px a thumb needs quietly
 * becomes less. This says so once, rather than leaving someone to wonder why
 * two sites keep swapping under their finger.
 */
function AspectNote({ photo }) {
  if (photo.status !== 'ready' || !photo.natural) return null
  const aspect = photo.natural.h / photo.natural.w
  const { minSpacingPx } = checkPins(PINS, { screenWidth: SCREEN_WIDTH, aspect })
  if (minSpacingPx >= MIN_SPACING_PX) return null
  return (
    <div
      data-testid="map-aspect-note"
      className="rounded-[var(--r-sm)] px-3 py-2 t-caption"
      style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}
    >
      This photo is wider than the map expects, so some sites sit {Math.round(minSpacingPx)} px apart
      instead of {MIN_SPACING_PX}. A taller photo, or Adjust pins, will separate them.
    </div>
  )
}

/**
 * A switch that reads as off when it is off.
 *
 * A bare `<input type="checkbox">` inherits the platform's light-mode styling:
 * on this app's dark background an unchecked box renders as a filled white
 * square, which reads as ON. For a control whose whole job is to say whether a
 * body photograph goes into a backup file, "looks on when it is off" is not a
 * cosmetic problem.
 */
function Switch({ on, onChange, label, hint, testId }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 flex-1">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="t-caption block" style={{ color: 'var(--text-2)' }}>{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-testid={testId}
        data-on={on ? 'true' : 'false'}
        onClick={() => onChange(!on)}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{
          background: on ? 'var(--good)' : 'var(--surface-sunk)',
          border: `1px solid ${on ? 'transparent' : 'var(--border)'}`,
        }}
      >
        <span
          className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all"
          style={{
            left: on ? 'calc(100% - 22px)' : '2px',
            background: on ? 'var(--accent-fg)' : 'var(--text-3)',
          }}
        />
      </button>
    </div>
  )
}

export { Switch }
