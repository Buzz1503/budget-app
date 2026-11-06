import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import { getBlob } from '../../lib/blobStore'
import { detectPose } from '../../native/camera'
import {
  alignOf, applyGesture, autoAlign, toStored, snapRotation, previousOf, IDENTITY, AUTO_ALIGN_FAILED,
} from '../../lib/photoAlign'
import AlignedPhoto from './AlignedPhoto'

const soft = { color: 'var(--text-2)' }
const isNative = () => typeof __NATIVE__ !== 'undefined' && __NATIVE__
// where the guide lines sit: shoulders and hips, as a share of the frame's height
export const GUIDES = { shoulders: 0.27, hips: 0.55 }

function Toggle({ on, onChange, label, testid }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} data-testid={testid}
      className="flex min-h-[36px] items-center gap-2 rounded-full px-3 text-xs font-bold"
      style={{ background: on ? 'var(--surface2)' : 'var(--surface-sunk)', color: on ? 'var(--text)' : 'var(--text-3)', border: '1px solid var(--border)' }}>
      <span className="h-2 w-2 rounded-full" style={{ background: on ? 'var(--accent)' : 'var(--text-3)' }} />
      {label}
    </button>
  )
}

/**
 * Adjust: pinch to resize, drag to move, twist with two fingers to straighten
 * (snaps level near 0 degrees). The last photo of the same pose shows faintly
 * behind to line up with, with a centre line and shoulder and hip guides.
 * Only the photo's settings are saved; the image itself is never changed.
 */
export default function PhotoEditor({ photoId, onClose }) {
  const photos = useStore((s) => s.photos)
  const updatePhoto = useStore((s) => s.updatePhoto)
  const photo = photos.find((p) => p.id === photoId)
  const prev = useMemo(() => previousOf(photos, photo), [photos, photo])
  const [align, setAlign] = useState(() => alignOf(photo))
  const [showLast, setShowLast] = useState(true)
  const [guides, setGuides] = useState(true)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sizes, setSizes] = useState({})
  const frame = useRef(null)
  const pointers = useRef(new Map())

  useEffect(() => { setAlign(alignOf(photo)); setNote(null) }, [photoId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!photo) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [photo])
  if (!photo) return null

  const rel = (e) => {
    const r = frame.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const down = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, rel(e))
  }
  const move = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    const ids = [...pointers.current.keys()].slice(0, 2)
    const from = ids.map((id) => pointers.current.get(id))
    pointers.current.set(e.pointerId, rel(e))
    const to = ids.map((id) => pointers.current.get(id))
    setAlign((a) => applyGesture(a, from, to))
  }
  const up = (e) => {
    pointers.current.delete(e.pointerId)
    if (!pointers.current.size) setAlign((a) => ({ ...a, rotation: snapRotation(a.rotation) }))
  }

  const auto = async () => {
    setNote(null)
    if (!prev) { setNote('Auto align needs an earlier photo of this pose.'); return }
    if (!isNative()) { setNote('Auto align works in the iPhone app. Adjust by hand here.'); return }
    setBusy(true)
    try {
      const [refBlob, curBlob] = await Promise.all([getBlob(prev.blobKey), getBlob(photo.blobKey)])
      const [ref, cur] = await Promise.all([refBlob ? detectPose(refBlob) : null, curBlob ? detectPose(curBlob) : null])
      const aspect = (p, s) => (p.width && p.height ? p.width / p.height : s ? s.w / s.h : 3 / 4)
      const next = autoAlign({
        ref, refAspect: aspect(prev, sizes.prev), refAlign: alignOf(prev),
        cur, curAspect: aspect(photo, sizes.cur), curRotation: align.rotation,
      })
      if (!next) setNote(AUTO_ALIGN_FAILED)
      else { setAlign(next); setNote('Lined up with your last photo. Fine-tune if you like.') }
    } finally {
      setBusy(false)
    }
  }

  const done = () => {
    updatePhoto(photo.id, { align: toStored(align) })
    onClose()
  }

  const ui = (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'var(--bg)' }} role="dialog" aria-modal="true" aria-label="Adjust photo" data-testid="photo-editor">
      <div className="flex items-center gap-2 px-4 pb-2" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="min-h-[36px] rounded-full px-3 text-sm font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="editor-cancel">Cancel</button>
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold">Adjust · {format(parseISO(photo.date), 'd MMM yyyy')}</p>
        <button onClick={done} className="btn-primary min-h-[36px] rounded-full px-4 text-sm font-black" data-testid="editor-done">Done</button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div ref={frame} className="relative overflow-hidden rounded-[14px]"
          style={{ aspectRatio: '3/4', height: '100%', maxHeight: 'calc(100dvh - 240px)', maxWidth: '100%', background: 'var(--surface-sunk)', touchAction: 'none' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="editor-frame">
          <AlignedPhoto photo={photo} align={align} onSize={(s) => setSizes((x) => ({ ...x, cur: s }))} testid="editor-photo" />
          {prev && showLast && <AlignedPhoto photo={prev} opacity={0.4} alt="Last photo" onSize={(s) => setSizes((x) => ({ ...x, prev: s }))} testid="editor-last" />}
          {guides && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 300 400" preserveAspectRatio="none" data-testid="editor-guides">
              <line x1="150" x2="150" y1="0" y2="400" stroke="var(--text)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
              <line x1="0" x2="300" y1={400 * GUIDES.shoulders} y2={400 * GUIDES.shoulders} stroke="var(--text)" strokeOpacity="0.3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <line x1="0" x2="300" y1={400 * GUIDES.hips} y2={400 * GUIDES.hips} stroke="var(--text)" strokeOpacity="0.3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
        </div>
      </div>
      <div className="space-y-3 px-4 pt-3" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <p className="min-h-[20px] text-center text-sm font-medium" style={soft} data-testid="editor-note">
          {note || 'Pinch to resize, drag to move, twist to straighten.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {prev && <Toggle on={showLast} onChange={setShowLast} label="Show last photo" testid="editor-show-last" />}
          <Toggle on={guides} onChange={setGuides} label="Guides" testid="editor-guides-toggle" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setAlign(IDENTITY); setNote(null) }} className="min-h-[44px] flex-1 rounded-full text-sm font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="editor-reset">Reset</button>
          <button onClick={auto} disabled={busy} className="min-h-[44px] flex-1 rounded-full text-sm font-bold disabled:opacity-50" style={{ background: 'var(--surface-sunk)' }} data-testid="editor-auto">
            {busy ? 'Finding you' : 'Auto align'}
          </button>
        </div>
      </div>
    </div>
  )
  return createPortal(ui, document.body)
}
