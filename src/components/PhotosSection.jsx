import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Trash2, GitCompareArrows, Images } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { putBlob, blobUrl, deleteBlob, downscaleImage, revokeBlobUrl } from '../lib/blobStore'

const POSES = ['front', 'side', 'back']

export default function PhotosSection() {
  const photos = useStore((s) => s.photos)
  const addPhoto = useStore((s) => s.addPhoto)
  const removePhoto = useStore((s) => s.removePhoto)
  const [pose, setPose] = useState('front')
  const [busy, setBusy] = useState(false)
  const [compare, setCompare] = useState(false)
  const fileRef = useRef(null)

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

  const del = async (photo) => {
    await deleteBlob(photo.blobKey)
    revokeBlobUrl(photo.blobKey)
    removePhoto(photo.id)
  }

  return (
    <div className="space-y-4">
      {/* capture */}
      <div className="card p-4">
        <div className="mb-3 flex gap-1.5">
          {POSES.map((ps) => (
            <button key={ps} onClick={() => setPose(ps)}
              className="flex-1 rounded-full py-1.5 text-xs font-black capitalize"
              style={pose === ps
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {ps}
            </button>
          ))}
        </div>

        {/* framing guide with ghost overlay of previous same-pose photo */}
        <div className="relative mx-auto overflow-hidden rounded-2xl" style={{ aspectRatio: '3/4', maxWidth: 260, background: 'var(--surface2)' }}>
          <PoseGuide />
          {prev && <Ghost blobKey={prev.blobKey} />}
          <div className="absolute inset-x-0 bottom-2 text-center text-[10px] font-bold" style={{ color: 'var(--muted)' }}>
            {prev ? 'Match the ghost pose · same distance & light' : 'Stand in frame · face forward'}
          </div>
        </div>

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
        <motion.button whileTap={{ scale: 0.97 }} disabled={busy} onClick={() => fileRef.current?.click()}
          className="btn-violet mt-3 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-black disabled:opacity-50">
          <Camera size={17} /> {busy ? 'Saving…' : `Capture ${pose} photo`}
        </motion.button>
      </div>

      {/* timeline / compare */}
      {photos.length > 0 ? (
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Images size={15} style={{ color: 'var(--lime)' }} /> Timeline</p>
            {posePhotos.length >= 2 && (
              <button onClick={() => setCompare(!compare)} className="chip !py-1.5 font-bold" style={{ color: 'var(--indigo)' }}>
                <GitCompareArrows size={13} /> {compare ? 'Grid' : 'Compare'}
              </button>
            )}
          </div>
          {compare && posePhotos.length >= 2 ? (
            <CompareSlider a={posePhotos[0]} b={posePhotos[posePhotos.length - 1]} />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {posePhotos.map((p) => <Thumb key={p.id} photo={p} onDelete={() => del(p)} />)}
            </div>
          )}
          <p className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
            Showing {pose} photos · switch pose above. Stored privately on this device only.
          </p>
        </div>
      ) : (
        <p className="px-1 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          No photos yet — capture your first to start a visual timeline.
        </p>
      )}
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

function Thumb({ photo, onDelete }) {
  const [url, setUrl] = useState(null)
  useEffect(() => { let a = true; blobUrl(photo.blobKey).then((u) => a && setUrl(u)); return () => { a = false } }, [photo.blobKey])
  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ aspectRatio: '3/4', background: 'var(--surface2)' }}>
      {url && <img src={url} alt={`${photo.pose} ${photo.date}`} className="h-full w-full object-cover" />}
      <span className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-center text-[9px] font-bold text-white">
        {format(parseISO(photo.date), 'd MMM')}
      </span>
      <button onClick={onDelete} className="absolute right-1 top-1 rounded-full p-1" style={{ background: 'rgba(0,0,0,0.5)' }} aria-label="Delete photo">
        <Trash2 size={11} color="#fff" />
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
      <div className="relative mx-auto overflow-hidden rounded-2xl" style={{ aspectRatio: '3/4', maxWidth: 260, background: 'var(--surface2)' }}>
        {urlB && <img src={urlB} alt="after" className="absolute inset-0 h-full w-full object-cover" />}
        {urlA && (
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
            <img src={urlA} alt="before" className="h-full w-full object-cover" style={{ width: `${260 * 100 / pos}%`, maxWidth: 'none' }} />
          </div>
        )}
        <div className="absolute inset-y-0" style={{ left: `${pos}%`, width: 2, background: 'var(--lime)', boxShadow: '0 0 8px var(--lime)' }} />
        <span className="absolute left-1 top-1 rounded-full bg-black/50 px-2 py-0.5 text-[9px] font-bold text-white">{format(parseISO(a.date), 'd MMM')}</span>
        <span className="absolute right-1 top-1 rounded-full bg-black/50 px-2 py-0.5 text-[9px] font-bold text-white">{format(parseISO(b.date), 'd MMM')}</span>
      </div>
      <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(+e.target.value)} className="mt-3 w-full" style={{ accentColor: 'var(--lime)' }} />
      <p className="text-center text-[10px] font-bold" style={{ color: 'var(--muted)' }}>Drag to compare before ↔ after</p>
    </div>
  )
}
