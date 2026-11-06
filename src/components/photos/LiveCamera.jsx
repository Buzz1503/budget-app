import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw } from 'lucide-react'
import AlignedPhoto from './AlignedPhoto'

/**
 * The camera inside the app, used only when "Show last photo" is on: the last
 * photo of this pose sits faintly over the live view to line up with. The
 * shot is handed back as a Blob; the caller resizes and saves it like any
 * other photo. `onFail` gets 'denied' when camera access is off, else 'unavailable'.
 */
export default function LiveCamera({ last, onShot, onClose, onFail }) {
  const video = useRef(null)
  const [facing, setFacing] = useState('environment')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stream = null
    let alive = true
    setReady(false)
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera'), { name: 'NotFoundError' })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 3024 }, height: { ideal: 4032 } }, audio: false })
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return }
        video.current.srcObject = stream
        await video.current.play().catch(() => {})
        setReady(true)
      } catch (e) {
        if (alive) onFail?.(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : 'unavailable')
      }
    })()
    return () => { alive = false; stream?.getTracks().forEach((t) => t.stop()) }
  }, [facing]) // eslint-disable-line react-hooks/exhaustive-deps

  const shoot = () => {
    const v = video.current
    if (!v?.videoWidth) return
    setBusy(true)
    // the part of the frame shown: a 3:4 crop from the middle, like the preview
    const vw = v.videoWidth
    const vh = v.videoHeight
    const want = 3 / 4
    const cw = vw / vh > want ? Math.round(vh * want) : vw
    const ch = vw / vh > want ? vh : Math.round(vw / want)
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (facing === 'user') { ctx.translate(cw, 0); ctx.scale(-1, 1) }
    ctx.drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch)
    canvas.toBlob((blob) => {
      canvas.width = 0
      setBusy(false)
      if (blob) onShot(blob)
    }, 'image/jpeg', 0.92)
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: '#000' }} role="dialog" aria-modal="true" aria-label="Camera" data-testid="live-camera">
      <div className="flex items-center gap-2 px-4 pb-2" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="min-h-[36px] rounded-full px-3 text-sm font-bold text-white" style={{ background: 'rgba(255,255,255,0.14)' }} data-testid="live-cancel">Cancel</button>
        <p className="flex-1 text-center text-sm font-semibold text-white">Line up with your last photo</p>
        <button onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Switch camera"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ background: 'rgba(255,255,255,0.14)' }}><RefreshCw size={16} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="relative overflow-hidden rounded-[14px]" style={{ aspectRatio: '3/4', height: '100%', maxHeight: 'calc(100dvh - 200px)', maxWidth: '100%' }}>
          <video ref={video} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }} />
          {last && <AlignedPhoto photo={last} opacity={0.4} alt="Last photo" testid="live-last" />}
        </div>
      </div>
      <div className="flex justify-center pt-3" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
        <button onClick={shoot} disabled={!ready || busy} aria-label="Take photo" data-testid="live-shutter"
          className="h-[72px] w-[72px] rounded-full disabled:opacity-40" style={{ background: '#fff', boxShadow: '0 0 0 4px rgba(255,255,255,0.3)' }} />
      </div>
    </div>,
    document.body,
  )
}
