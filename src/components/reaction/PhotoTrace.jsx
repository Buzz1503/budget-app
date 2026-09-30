import { useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw, Check } from 'lucide-react'
import { COIN_BY_ID } from '../../lib/reactionZones'
import { simplify, traceMeasurements, toPath, traceSanity } from '../../lib/reactionTrace'
import { downscaleImage } from '../../lib/blobStore'

/**
 * Measuring a mark from a photograph.
 *
 * Three things happen in order and the order matters: take the picture with the
 * coin in it, fit a circle to the coin, then draw round the redness. Without
 * the coin the trace is in pixels and means nothing; the app refuses to produce
 * a number until it has one.
 *
 * The previous outline is drawn on top throughout, which is the whole reason
 * this is worth doing at all — "is it bigger than yesterday" is a question
 * nobody can answer from memory and everybody can answer from two lines.
 */

const STAGES = { photo: 0, coin: 1, trace: 2 }

export default function PhotoTrace({
  coinId = 'aud-20c',
  ghostUrl = null,
  previousTrace = null,
  onDone,
  onCancel,
}) {
  const coin = COIN_BY_ID[coinId] || COIN_BY_ID['aud-20c']
  const [stage, setStage] = useState(STAGES.photo)
  const [imgUrl, setImgUrl] = useState(null)
  const [blob, setBlob] = useState(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [circle, setCircle] = useState(null)      // { x, y, r } in display px
  const [path, setPath] = useState([])
  const [weltPath, setWeltPath] = useState([])
  const [tracingWelt, setTracingWelt] = useState(false)
  const fileRef = useRef(null)
  const boxRef = useRef(null)
  const drawing = useRef(false)

  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl) }, [imgUrl])

  const take = async (file) => {
    if (!file) return
    try {
      const small = await downscaleImage(file, 1080, 0.82)
      setBlob(small)
      const url = URL.createObjectURL(small)
      setImgUrl(url)
      const img = new Image()
      img.onload = () => setDims({ w: img.width, h: img.height })
      img.src = url
      setStage(STAGES.coin)
    } catch {
      // a device that cannot decode the file still lets the number be typed in
      onDone?.({ blob: null, measurements: null, failed: true })
    }
  }

  const local = (e) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return null
    const t = e.touches?.[0] || e
    return { x: t.clientX - box.left, y: t.clientY - box.top }
  }

  // ---- coin: drag from the centre outwards to set the radius
  const coinDown = (e) => {
    const p = local(e)
    if (!p) return
    drawing.current = true
    setCircle({ x: p.x, y: p.y, r: 0 })
  }
  const coinMove = (e) => {
    if (!drawing.current || !circle) return
    const p = local(e)
    if (!p) return
    const r = Math.sqrt((p.x - circle.x) ** 2 + (p.y - circle.y) ** 2)
    setCircle((c) => ({ ...c, r }))
  }
  const coinUp = () => { drawing.current = false }

  // ---- trace: drag round the edge
  const traceDown = (e) => {
    const p = local(e)
    if (!p) return
    drawing.current = true
    if (tracingWelt) setWeltPath([p]); else setPath([p])
  }
  const traceMove = (e) => {
    if (!drawing.current) return
    const p = local(e)
    if (!p) return
    if (tracingWelt) setWeltPath((x) => [...x, p]); else setPath((x) => [...x, p])
  }
  const traceUp = () => {
    drawing.current = false
    if (tracingWelt) setWeltPath((x) => simplify(x)); else setPath((x) => simplify(x))
  }

  const measurements = circle?.r > 2 && path.length > 2
    ? traceMeasurements(path, { coinRadiusPx: circle.r, coinMm: coin.mm })
    : null
  const weltMeasurements = circle?.r > 2 && weltPath.length > 2
    ? traceMeasurements(weltPath, { coinRadiusPx: circle.r, coinMm: coin.mm })
    : null
  const sanity = traceSanity(measurements)

  const save = () => {
    onDone?.({
      blob,
      width: dims.w,
      height: dims.h,
      coinCalibration: circle ? { ...circle, coinMm: coin.mm, mmPerPx: measurements?.mmPerPx ?? null } : null,
      tracePaths: { redness: path, welt: weltPath.length > 2 ? weltPath : null },
      measurements,
      weltMeasurements,
    })
  }

  return (
    <div className="space-y-3" data-testid="photo-trace" data-stage={stage}>
      {stage === STAGES.photo && (
        <div className="space-y-3">
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Put the {coin.label} flat next to the mark, in the same shot. Fill the frame with the site and
            keep the phone square on.
          </p>
          {ghostUrl && (
            <div className="relative overflow-hidden rounded-[14px]" style={{ background: 'var(--surface-sunk)' }}>
              <img src={ghostUrl} alt="" className="w-full opacity-40" />
              <p className="absolute inset-x-0 bottom-0 p-2 text-xs font-bold"
                style={{ background: 'color-mix(in srgb, var(--bg) 70%, transparent)', color: 'var(--text-2)' }}>
                Last photo of this site — line the new one up the same way
              </p>
            </div>
          )}
          <button onClick={() => fileRef.current?.click()} data-testid="trace-capture"
            className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
            <Camera size={16} /> Take the photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            aria-label="Site photo" data-testid="trace-file"
            onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }} />
          <button onClick={onCancel} className="w-full rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            Skip the photo
          </button>
        </div>
      )}

      {stage > STAGES.photo && imgUrl && (
        <div className="space-y-2">
          <p className="text-xs font-bold" data-testid="trace-instruction">
            {stage === STAGES.coin
              ? `Press on the middle of the ${coin.label} and drag out to its edge`
              : tracingWelt
                ? 'Draw round the raised welt'
                : 'Draw round the edge of the redness'}
          </p>

          <div ref={boxRef} className="relative touch-none select-none overflow-hidden rounded-[14px]"
            style={{ background: 'var(--surface-sunk)' }}
            onPointerDown={stage === STAGES.coin ? coinDown : traceDown}
            onPointerMove={stage === STAGES.coin ? coinMove : traceMove}
            onPointerUp={stage === STAGES.coin ? coinUp : traceUp}
            onPointerLeave={stage === STAGES.coin ? coinUp : traceUp}>
            <img src={imgUrl} alt="Injection site" className="pointer-events-none w-full" draggable={false} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {/* what was traced last time, for comparison */}
              {previousTrace?.length > 2 && (
                <path d={toPath(previousTrace)} fill="none" stroke="var(--text-3)"
                  strokeWidth="1.5" strokeDasharray="4 3" data-testid="previous-outline" />
              )}
              {circle && circle.r > 0 && (
                <circle cx={circle.x} cy={circle.y} r={circle.r} fill="none"
                  stroke="var(--info)" strokeWidth="2" data-testid="coin-circle" />
              )}
              {path.length > 1 && (
                <path d={toPath(path)} fill="color-mix(in srgb, var(--danger) 18%, transparent)"
                  stroke="var(--danger)" strokeWidth="2" data-testid="redness-outline" />
              )}
              {weltPath.length > 1 && (
                <path d={toPath(weltPath)} fill="none" stroke="var(--warn)" strokeWidth="2"
                  data-testid="welt-outline" />
              )}
            </svg>
          </div>

          {stage === STAGES.coin && (
            <div className="flex gap-2">
              <button onClick={() => setCircle(null)} className="rounded-full px-3 py-2.5 text-xs font-black"
                style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                <RotateCcw size={12} />
              </button>
              <button onClick={() => setStage(STAGES.trace)} disabled={!(circle?.r > 2)}
                data-testid="coin-done"
                className="btn-primary flex-1 rounded-full py-2.5 text-xs font-black disabled:opacity-40">
                That is the coin
              </button>
            </div>
          )}

          {stage === STAGES.trace && (
            <>
              {measurements && (
                <div className="card p-3" data-testid="trace-measurements">
                  <p className="t-metric-sm tabular-nums">
                    {measurements.diameterMm} mm
                    <span className="ml-2 text-xs font-bold" style={{ color: 'var(--text-3)' }}>across</span>
                  </p>
                  <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
                    {Math.round(measurements.areaMm2)} mm² traced
                    {weltMeasurements ? ` · welt ${weltMeasurements.diameterMm} mm` : ''}
                  </p>
                  {sanity && (
                    <p className="mt-1 text-xs font-medium" style={{ color: 'var(--warn)' }}>{sanity}</p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { if (tracingWelt) setWeltPath([]); else setPath([]) }}
                  className="rounded-full px-3 py-2.5 text-xs font-black"
                  style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  <RotateCcw size={12} />
                </button>
                <button onClick={() => setTracingWelt((v) => !v)} data-testid="trace-welt-toggle"
                  className="rounded-full px-3 py-2.5 text-xs font-black"
                  style={tracingWelt
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  {tracingWelt ? 'Tracing welt' : 'Trace a welt too'}
                </button>
                <button onClick={save} disabled={!measurements} data-testid="trace-save"
                  className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black disabled:opacity-40">
                  <Check size={13} /> Use this
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
