import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Camera, Trash2, GitCompareArrows, Images, FolderOpen, Link2, Move, Settings as SettingsIcon } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { putBlob, deleteBlob, revokeBlobUrl } from '../lib/blobStore'
import { importPhotos } from '../lib/photoImport'
import { preparePhoto } from '../lib/photoImage'
import { cameraStatus, cameraBlocked, openAppSettings, captureRoute } from '../native/camera'
import Modal from './ui/Modal'
import AlignedPhoto, { PhotoFrame } from './photos/AlignedPhoto'
import PhotoEditor from './photos/PhotoEditor'
import PhotoCompare from './photos/PhotoCompare'
import LiveCamera from './photos/LiveCamera'

const POSES = ['front', 'side', 'back']
export const PHOTO_TIP = 'Same spot, same distance, same light.'
export const CAMERA_OFF = 'Camera access is off for Pepito. Turn it on in Settings to take progress photos.'

/** Resize, make a thumbnail, store both; the metadata goes in the store. */
export async function savePhotoBlob(fileOrBlob, { pose, date }) {
  const { blob, thumb, width, height } = await preparePhoto(fileOrBlob)
  const key = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  if (!(await putBlob(key, blob))) throw new Error('Storage on this device is unavailable')
  const thumbKey = (await putBlob(`${key}-thumb`, thumb)) ? `${key}-thumb` : null
  return useStore.getState().addPhoto({ pose, blobKey: key, thumbKey, width, height, date })
}

export default function PhotosSection() {
  const photos = useStore((s) => s.photos)
  const removePhoto = useStore((s) => s.removePhoto)
  const guideOn = useStore((s) => !!s.settings?.photoCameraGuide)
  const updateSettings = useStore((s) => s.updateSettings)
  const [pose, setPose] = useState('front')
  const [busy, setBusy] = useState(false)
  const [compare, setCompare] = useState(false)
  const [review, setReview] = useState(null)
  const [reading, setReading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [adjusting, setAdjusting] = useState(null)
  const [justSaved, setJustSaved] = useState(null)
  const [camera, setCamera] = useState('unknown')
  const [blocked, setBlocked] = useState(false)
  const [live, setLive] = useState(false)
  const [liveFailed, setLiveFailed] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const libraryRef = useRef(null)

  const posePhotos = useMemo(
    () => photos.filter((p) => p.pose === pose).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    [photos, pose]
  )
  const prev = posePhotos[posePhotos.length - 1]

  // camera access, asked of iOS ahead of the tap (a file input must open from the tap itself)
  useEffect(() => {
    const check = () => { void cameraStatus().then((st) => { setCamera(st); if (!cameraBlocked(st)) setBlocked(false) }) }
    check()
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', check)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', check) }
  }, [])

  const save = async (fileOrBlob) => {
    setBusy(true)
    setError(null)
    try {
      const saved = await savePhotoBlob(fileOrBlob, { pose, date: todayStr() })
      setJustSaved(saved ? { id: saved.id, hasPrev: !!prev } : null)
    } catch (err) {
      setError(`Couldn't save the photo. ${err.message || ''}`.trim())
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) {
      // cancelled: iOS may just have been told no
      void cameraStatus().then((st) => { setCamera(st); setBlocked(cameraBlocked(st)) })
      return
    }
    await save(file)
  }

  const takePhoto = () => {
    setError(null)
    const route = captureRoute({ camera, guideOn, hasPrev: !!prev, liveFailed })
    if (route === 'blocked') setBlocked(true)
    else if (route === 'live') setLive(true)
    else fileRef.current?.click()
  }

  /**
   * Photos picked out of the camera roll.
   *
   * Nothing is written until the review sheet is confirmed. A photo taken in
   * March that silently files itself under today is worse than no import at
   * all: the whole point of a progress photo is the date on it.
   */
  const onLibrary = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setReading(true)
    try {
      const out = await importPhotos(files)
      const good = out.filter((x) => x.ok)
      if (!good.length) { setError("Couldn't read those photos."); return }
      setReview(good.map((x, i) => ({
        key: `${Date.now()}-${i}`,
        blob: x.blob,
        name: x.name,
        // today as a guess when EXIF has nothing: the review sheet highlights the field so it gets looked at
        date: x.dateStr || todayStr(),
        detected: !!x.dateStr,
        pose,
      })))
    } catch (err) {
      setError(`Import failed: ${err.message}`)
    } finally {
      setReading(false)
    }
  }

  const del = async (photo) => {
    await deleteBlob(photo.blobKey)
    if (photo.thumbKey) await deleteBlob(photo.thumbKey)
    revokeBlobUrl(photo.blobKey)
    if (photo.thumbKey) revokeBlobUrl(photo.thumbKey)
    removePhoto(photo.id)
  }

  return (
    <div className="space-y-3">
      {/* capture */}
      <div className="card p-3" data-testid="photo-capture">
        <div className="mb-3 flex gap-2">
          {POSES.map((ps) => (
            <button key={ps} onClick={() => setPose(ps)} data-testid={`pose-${ps}`}
              className="flex-1 rounded-full py-2 text-xs font-black capitalize"
              style={pose === ps
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {ps}
            </button>
          ))}
        </div>

        {/* the last photo of this pose, as it was lined up */}
        <PhotoFrame testid="capture-preview">
          {prev
            ? <AlignedPhoto photo={prev} thumb alt={`Last ${pose} photo`} />
            : <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm font-medium" style={{ color: 'var(--text-3)' }}>No {pose} photo yet</div>}
          {prev && <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white">Last: {format(parseISO(prev.date), 'd MMM')}</span>}
        </PhotoFrame>

        {/* Two inputs on purpose. The capture attribute is what sends iOS
            straight to the camera, so the library button must not carry it,
            with it, "Choose from library" opens the camera instead. */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} data-testid="photo-camera-input" />
        <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" onChange={onLibrary} data-testid="photo-library-input" />
        <div className="mt-3 flex gap-2">
          <motion.button whileTap={{ scale: 0.97 }} disabled={busy || reading} onClick={takePhoto}
            data-testid="take-photo"
            className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-black disabled:opacity-50">
            <Camera size={17} /> {busy ? 'Saving' : 'Take photo'}
          </motion.button>
          <motion.button whileTap={{ scale: 0.97 }} disabled={busy || reading} onClick={() => libraryRef.current?.click()}
            data-testid="choose-from-library"
            className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-black disabled:opacity-50"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
            <FolderOpen size={17} /> {reading ? 'Reading' : 'Choose from library'}
          </motion.button>
        </div>
        <p className="mt-2 text-center text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="photo-tip">{PHOTO_TIP}</p>
        {prev && (
          <label className="mt-2 flex items-center justify-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            <input type="checkbox" checked={guideOn} onChange={(e) => { updateSettings({ photoCameraGuide: e.target.checked }); setLiveFailed(false) }} data-testid="camera-guide-toggle" />
            Show last photo in the camera
          </label>
        )}
        {blocked && (
          <div className="mt-3 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} role="alert" data-testid="camera-denied">
            <p className="text-sm font-semibold">{CAMERA_OFF}</p>
            <button onClick={() => { void openAppSettings() }} className="mt-2 flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-bold"
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }} data-testid="camera-open-settings">
              <SettingsIcon size={13} /> Open Settings
            </button>
          </div>
        )}
        {liveFailed && !blocked && (
          <p className="mt-2 text-center text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="live-unavailable">
            The live guide isn&apos;t available here, so Take photo opens the camera.
          </p>
        )}
        {error && <p className="mt-2 text-center text-xs font-semibold" style={{ color: 'var(--warn)' }} role="alert" data-testid="photo-error">{error}</p>}
        {justSaved && (
          <div className="mt-3 flex items-center gap-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="photo-saved">
            <p className="min-w-0 flex-1 text-sm font-semibold">{justSaved.hasPrev ? 'Saved. Line it up with your last photo?' : 'Saved.'}</p>
            <button onClick={() => { setAdjusting(justSaved.id); setJustSaved(null) }} className="min-h-[36px] rounded-full px-3 text-xs font-bold"
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }} data-testid="photo-saved-adjust">Adjust</button>
            <button onClick={() => setJustSaved(null)} className="min-h-[36px] px-2 text-xs font-bold" style={{ color: 'var(--text-3)' }}>Not now</button>
          </div>
        )}
      </div>

      {/* timeline / compare */}
      {photos.length > 0 ? (
        <div className="card p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-bold"><Images size={15} style={{ color: 'var(--text-2)' }} /> Timeline</p>
            {posePhotos.length >= 2 && (
              <button onClick={() => setCompare(!compare)} className="chip !py-2 font-bold" style={{ color: 'var(--text-2)' }} data-testid="photo-compare-toggle">
                <GitCompareArrows size={13} /> {compare ? 'Grid' : 'Compare'}
              </button>
            )}
          </div>
          {compare && posePhotos.length >= 2 ? (
            <PhotoCompare photos={posePhotos} />
          ) : (
            <div className="grid grid-cols-3 gap-2" data-testid="photo-grid">
              {posePhotos.map((p) => <Thumb key={p.id} photo={p} onDelete={() => del(p)} onEdit={() => setEditing(p.id)} onAdjust={() => setAdjusting(p.id)} />)}
            </div>
          )}
          <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Showing {pose} photos · switch pose above. Stored privately on this device only.
          </p>
        </div>
      ) : (
        <p className="px-1 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          No photos yet, capture your first to start a visual timeline.
        </p>
      )}

      <ReviewImports
        items={review}
        pose={pose}
        onClose={() => setReview(null)}
      />
      <EditPhoto photoId={editing} onClose={() => setEditing(null)} onAdjust={(id) => { setEditing(null); setAdjusting(id) }} />
      {adjusting && <PhotoEditor photoId={adjusting} onClose={() => setAdjusting(null)} />}
      {live && (
        <LiveCamera last={prev} onClose={() => setLive(false)}
          onShot={(blob) => { setLive(false); void save(blob) }}
          onFail={(why) => {
            setLive(false)
            if (why === 'denied') { setCamera('denied'); setBlocked(true) } else setLiveFailed(true)
          }} />
      )}
    </div>
  )
}

export function Thumb({ photo, onDelete, onEdit, onAdjust }) {
  return (
    <div className="relative overflow-hidden rounded-[14px]" style={{ aspectRatio: '3/4', background: 'var(--surface-sunk)' }} data-testid="photo-thumb">
      <AlignedPhoto photo={photo} thumb />
      <button onClick={onEdit} data-testid={`photo-thumb-${photo.id}`}
        className="absolute inset-x-0 bottom-0 bg-black/50 py-1 text-center text-xs font-bold text-white">
        {format(parseISO(photo.date), 'd MMM')}
      </button>
      <button onClick={onAdjust} className="absolute left-1 top-1 flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-white" style={{ background: 'rgba(0,0,0,0.55)' }}
        aria-label="Adjust photo" data-testid={`photo-adjust-${photo.id}`}>
        <Move size={11} /> Adjust
      </button>
      <button onClick={onDelete} className="absolute right-1 top-1 rounded-full p-1.5" style={{ background: 'rgba(0,0,0,0.55)' }} aria-label="Delete photo">
        <Trash2 size={11} color="#fff" />
      </button>
    </div>
  )
}

/**
 * The review list.
 *
 * One row per picked photo: thumbnail, the date the camera recorded, and the
 * chance to change it before anything is written. A photo whose date had to be
 * guessed is marked, because a guess that looks like a fact is the one thing
 * this screen must not produce.
 */
function ReviewImports({ items, pose, onClose }) {
  const measurements = useStore((s) => s.measurements)
  const updateMeasurement = useStore((s) => s.updateMeasurement)
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { setRows(items ? items.map((x) => ({ ...x, link: true })) : []) }, [items])

  const setRow = (key, patch) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  const saveAll = async () => {
    setSaving(true)
    try {
      for (const row of rows) {
        let saved = null
        try { saved = await savePhotoBlob(row.blob, { pose: row.pose || pose, date: row.date }) } catch { continue }
        // a photo and a reading taken the same day belong together, so the
        // offer is made per row and taken only where it was left ticked
        const sameDay = measurements.find((m) => m.date === row.date)
        if (row.link && sameDay && saved) updateMeasurement(sameDay.id, { photoId: saved.id })
      }
      onClose?.()
    } finally {
      setSaving(false)
    }
  }

  if (!items) return null
  return (
    <Modal open onClose={onClose} title={`Import ${rows.length} photo${rows.length === 1 ? '' : 's'}`} wide>
      <div className="space-y-3">
        <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
          Check the dates before saving. Highlighted rows had no date in the photo.
        </p>
        <div className="space-y-2" data-testid="import-review">
          {rows.map((row) => {
            const sameDay = measurements.find((m) => m.date === row.date)
            return (
              <div key={row.key} className="flex gap-3 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
                <ImportThumb blob={row.blob} />
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    type="date"
                    className="input !py-2"
                    data-testid={`import-date-${row.key}`}
                    data-detected={row.detected ? '1' : '0'}
                    value={row.date}
                    onChange={(e) => e.target.value && setRow(row.key, { date: e.target.value, detected: true })}
                    style={row.detected ? undefined : { borderColor: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 14%, transparent)' }}
                  />
                  <p className="text-xs font-semibold" style={{ color: row.detected ? 'var(--text-2)' : 'var(--warn)' }}>
                    {row.detected ? 'Date taken, from the photo' : 'No date in this photo, check it'}
                  </p>
                  {sameDay && (
                    <label className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
                      <input
                        type="checkbox"
                        data-testid={`import-link-${row.key}`}
                        checked={!!row.link}
                        onChange={(e) => setRow(row.key, { link: e.target.checked })}
                      />
                      <Link2 size={12} /> Link to the measurement on this date
                    </label>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <button onClick={saveAll} disabled={saving || !rows.length} data-testid="import-save-all"
          className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40">
          {saving ? 'Saving…' : `Save all ${rows.length}`}
        </button>
      </div>
    </Modal>
  )
}

function ImportThumb({ blob }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return (
    <div className="h-20 w-16 shrink-0 overflow-hidden rounded-[10px]" style={{ background: 'var(--surface)' }}>
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </div>
  )
}

/** A saved photo's date stays editable: imports are guesses until confirmed. */
function EditPhoto({ photoId, onClose, onAdjust }) {
  const photos = useStore((s) => s.photos)
  const updatePhoto = useStore((s) => s.updatePhoto)
  const photo = photos.find((p) => p.id === photoId)
  const [date, setDate] = useState('')
  useEffect(() => { if (photo) setDate(photo.date) }, [photoId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!photo) return null
  return (
    <Modal open onClose={onClose} title="Photo date">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Date taken</span>
          <input type="date" className="input" data-testid="photo-date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <div className="flex gap-2">
          {POSES.map((ps) => (
            <button key={ps} onClick={() => updatePhoto(photo.id, { pose: ps })}
              className="flex-1 rounded-full py-2 text-xs font-black capitalize"
              style={photo.pose === ps
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {ps}
            </button>
          ))}
        </div>
        <button onClick={() => onAdjust(photo.id)} data-testid="photo-edit-adjust"
          className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold" style={{ background: 'var(--surface-sunk)' }}>
          <Move size={15} /> Adjust{photo.align ? ' (lined up)' : ''}
        </button>
        <button onClick={() => { updatePhoto(photo.id, { date }); onClose() }} data-testid="photo-date-save"
          className="btn-primary w-full rounded-full py-3 text-sm font-black">
          Save
        </button>
      </div>
    </Modal>
  )
}
