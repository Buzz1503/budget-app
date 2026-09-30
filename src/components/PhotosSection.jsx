import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Trash2, GitCompareArrows, Images, FolderOpen, Link2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { putBlob, blobUrl, deleteBlob, downscaleImage, revokeBlobUrl } from '../lib/blobStore'
import { importPhotos } from '../lib/photoImport'
import Modal from './ui/Modal'

const POSES = ['front', 'side', 'back']

export default function PhotosSection() {
  const photos = useStore((s) => s.photos)
  const addPhoto = useStore((s) => s.addPhoto)
  const removePhoto = useStore((s) => s.removePhoto)
  const [pose, setPose] = useState('front')
  const [busy, setBusy] = useState(false)
  const [compare, setCompare] = useState(false)
  const [review, setReview] = useState(null)
  const [reading, setReading] = useState(false)
  const [editing, setEditing] = useState(null)
  const fileRef = useRef(null)
  const libraryRef = useRef(null)

  // previous photo of this pose → ghost overlay
  const posePhotos = useMemo(
    () => photos.filter((p) => p.pose === pose).sort((a, b) => a.date.localeCompare(b.date)),
    [photos, pose]
  )
  const prev = posePhotos[posePhotos.length - 1]

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const blob = await downscaleImage(file).catch(() => file)
      const key = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const ok = await putBlob(key, blob)
      if (!ok) throw new Error('IndexedDB unavailable')
      addPhoto({ pose, blobKey: key, date: todayStr() })
    } catch (err) {
      alert(`Couldn't save photo: ${err.message}`)
    } finally {
      setBusy(false)
    }
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
      if (!good.length) { alert("Couldn't read those photos."); return }
      setReview(good.map((x, i) => ({
        key: `${Date.now()}-${i}`,
        blob: x.blob,
        name: x.name,
        // null rather than today when EXIF has nothing: the review sheet shows
        // today as a guess and highlights the field so it gets looked at
        date: x.dateStr || todayStr(),
        detected: !!x.dateStr,
        pose,
      })))
    } catch (err) {
      alert(`Import failed: ${err.message}`)
    } finally {
      setReading(false)
    }
  }

  const del = async (photo) => {
    await deleteBlob(photo.blobKey)
    revokeBlobUrl(photo.blobKey)
    removePhoto(photo.id)
  }

  return (
    <div className="space-y-3">
      {/* capture */}
      <div className="card p-3">
        <div className="mb-3 flex gap-2">
          {POSES.map((ps) => (
            <button key={ps} onClick={() => setPose(ps)}
              className="flex-1 rounded-full py-2 text-xs font-black capitalize"
              style={pose === ps
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {ps}
            </button>
          ))}
        </div>

        {/* framing guide with ghost overlay of previous same-pose photo */}
        <div className="relative mx-auto overflow-hidden rounded-[14px]" style={{ aspectRatio: '3/4', maxWidth: 260, background: 'var(--surface-sunk)' }}>
          <PoseGuide />
          {prev && <Ghost blobKey={prev.blobKey} />}
          <div className="absolute inset-x-0 bottom-2 text-center text-xs font-bold" style={{ color: 'var(--text-2)' }}>
            {prev ? 'Match the ghost pose · same distance & light' : 'Stand in frame · face forward'}
          </div>
        </div>

        {/* Two inputs on purpose. The capture attribute is what sends iOS
            straight to the camera, so the library button must not carry it —
            with it, "Choose from library" opens the camera instead. */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} data-testid="photo-camera-input" />
        <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" onChange={onLibrary} data-testid="photo-library-input" />
        <div className="mt-3 flex gap-2">
          <motion.button whileTap={{ scale: 0.97 }} disabled={busy || reading} onClick={() => fileRef.current?.click()}
            data-testid="take-photo"
            className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-black disabled:opacity-50">
            <Camera size={17} /> {busy ? 'Saving…' : 'Take photo'}
          </motion.button>
          <motion.button whileTap={{ scale: 0.97 }} disabled={busy || reading} onClick={() => libraryRef.current?.click()}
            data-testid="choose-from-library"
            className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-black disabled:opacity-50"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
            <FolderOpen size={17} /> {reading ? 'Reading…' : 'Choose from library'}
          </motion.button>
        </div>
        <p className="mt-2 text-center text-xs font-medium" style={{ color: 'var(--text-2)' }}>
          Library photos keep the date they were taken. Saved as {pose}.
        </p>
      </div>

      {/* timeline / compare */}
      {photos.length > 0 ? (
        <div className="card p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-bold"><Images size={15} style={{ color: 'var(--good)' }} /> Timeline</p>
            {posePhotos.length >= 2 && (
              <button onClick={() => setCompare(!compare)} className="chip !py-2 font-bold" style={{ color: 'var(--text-2)' }}>
                <GitCompareArrows size={13} /> {compare ? 'Grid' : 'Compare'}
              </button>
            )}
          </div>
          {compare && posePhotos.length >= 2 ? (
            <CompareSlider a={posePhotos[0]} b={posePhotos[posePhotos.length - 1]} />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {posePhotos.map((p) => <Thumb key={p.id} photo={p} onDelete={() => del(p)} onEdit={() => setEditing(p.id)} />)}
            </div>
          )}
          <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Showing {pose} photos · switch pose above. Stored privately on this device only.
          </p>
        </div>
      ) : (
        <p className="px-1 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          No photos yet — capture your first to start a visual timeline.
        </p>
      )}

      <ReviewImports
        items={review}
        pose={pose}
        onClose={() => setReview(null)}
      />
      <EditPhoto photoId={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function PoseGuide() {
  return (
    <svg viewBox="0 0 100 133" className="absolute inset-0 h-full w-full opacity-25">
      <g fill="none" stroke="var(--text)" strokeWidth="0.8" strokeDasharray="2 2">
        <circle cx="50" cy="20" r="9" />
        <path d="M38 30 L34 70 L40 72 L44 45 M62 30 L66 70 L60 72 L56 45" />
        <path d="M40 30 q10 -4 20 0 l2 42 -6 55 -8 0 -2 -40 -2 40 -8 0 -6 -55 z" />
      </g>
      <line x1="50" y1="4" x2="50" y2="130" stroke="var(--text)" strokeWidth="0.4" strokeDasharray="1 3" opacity="0.5" />
    </svg>
  )
}

function Ghost({ blobKey }) {
  const [url, setUrl] = useState(null)
  useEffect(() => { let a = true; blobUrl(blobKey).then((u) => a && setUrl(u)); return () => { a = false } }, [blobKey])
  if (!url) return null
  return <img src={url} alt="previous pose ghost" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: 0.4 }} />
}

function Thumb({ photo, onDelete, onEdit }) {
  const [url, setUrl] = useState(null)
  useEffect(() => { let a = true; blobUrl(photo.blobKey).then((u) => a && setUrl(u)); return () => { a = false } }, [photo.blobKey])
  return (
    <div className="relative overflow-hidden rounded-[14px]" style={{ aspectRatio: '3/4', background: 'var(--surface-sunk)' }}>
      {url && <img src={url} alt={`${photo.pose} ${photo.date}`} className="h-full w-full object-cover" />}
      <button onClick={onEdit} data-testid={`photo-thumb-${photo.id}`}
        className="absolute inset-x-0 bottom-0 bg-black/50 py-1 text-center text-xs font-bold text-white">
        {format(parseISO(photo.date), 'd MMM')}
      </button>
      <button onClick={onDelete} className="absolute right-1 top-1 rounded-full p-1" style={{ background: 'rgba(0,0,0,0.5)' }} aria-label="Delete photo">
        <Trash2 size={11} color="var(--accent-fg)" />
      </button>
    </div>
  )
}

function CompareSlider({ a, b }) {
  const [urlA, setUrlA] = useState(null)
  const [urlB, setUrlB] = useState(null)
  const [pos, setPos] = useState(50)
  useEffect(() => { let al = true; blobUrl(a.blobKey).then((u) => al && setUrlA(u)); blobUrl(b.blobKey).then((u) => al && setUrlB(u)); return () => { al = false } }, [a, b])

  return (
    <div>
      <div className="relative mx-auto overflow-hidden rounded-[14px]" style={{ aspectRatio: '3/4', maxWidth: 260, background: 'var(--surface-sunk)' }}>
        {urlB && <img src={urlB} alt="after" className="absolute inset-0 h-full w-full object-cover" />}
        {urlA && (
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
            <img src={urlA} alt="before" className="h-full w-full object-cover" style={{ width: `${260 * 100 / pos}%`, maxWidth: 'none' }} />
          </div>
        )}
        <div className="absolute inset-y-0" style={{ left: `${pos}%`, width: 2, background: 'var(--good)', boxShadow: '0 0 8px var(--good)' }} />
        <span className="absolute left-1 top-1 rounded-full bg-black/50 px-2 py-1 text-xs font-bold text-white">{format(parseISO(a.date), 'd MMM')}</span>
        <span className="absolute right-1 top-1 rounded-full bg-black/50 px-2 py-1 text-xs font-bold text-white">{format(parseISO(b.date), 'd MMM')}</span>
      </div>
      <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(+e.target.value)} className="mt-3 w-full" style={{ accentColor: 'var(--good)' }} />
      <p className="text-center text-xs font-bold" style={{ color: 'var(--text-2)' }}>Drag to compare before ↔ after</p>
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
  const addPhoto = useStore((s) => s.addPhoto)
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
        const key = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const ok = await putBlob(key, row.blob)
        if (!ok) continue
        const saved = addPhoto({ pose: row.pose || pose, blobKey: key, date: row.date })
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
                    {row.detected ? 'Date taken, from the photo' : 'No date in this photo — check it'}
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

/** A saved photo's date stays editable — imports are guesses until confirmed. */
function EditPhoto({ photoId, onClose }) {
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
        <button onClick={() => { updatePhoto(photo.id, { date }); onClose() }} data-testid="photo-date-save"
          className="btn-primary w-full rounded-full py-3 text-sm font-black">
          Save
        </button>
      </div>
    </Modal>
  )
}
