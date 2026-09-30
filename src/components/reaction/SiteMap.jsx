import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import useStore from '../../store/useStore'
import { blobUrl, revokeBlobUrl, getBlob } from '../../lib/blobStore'
import {
  WINDOWS, GROUPS, PIN_DIAMETER_PX, COMPOSITE_ASPECT,
  pinsFor, toScreen, fromScreen, windowHeightPx, nearestPin, validatePosition,
} from '../../lib/sitePins'
import { allPinStatus, suggestedPin } from '../../lib/reactionTracker'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const LONG_PRESS_MS = 400

/** One fill per status, so a glance says which sites are in play. */
const FILL = {
  unused: 'var(--text-3)',
  recent: 'var(--info)',
  clear: 'var(--good)',
  mild: 'var(--warn)',
  moderate: 'var(--warn)',
  severe: 'var(--danger)',
}
const OPACITY = { mild: 0.45, moderate: 0.75, severe: 1 }

function fillFor(status) {
  if (status?.status === 'reacting') return FILL[status.severity] || FILL.mild
  return FILL[status?.status] || FILL.unused
}
function opacityFor(status) {
  if (status?.status === 'reacting') return OPACITY[status.severity] ?? 0.75
  return status?.status === 'unused' ? 0.45 : 0.9
}

/**
 * The photo site map.
 *
 * Two fixed crops of one composite — front on the left half, back on the right
 * — each scaled so its width fills the phone. The photograph itself is an
 * IndexedDB blob on this device: it is never in the repository, never in a
 * build, and never sent anywhere.
 *
 * The pins live *outside* the zoom transform. Zooming a map is for seeing the
 * gap between two sites, not for making the markers bigger, so the transform is
 * applied to their positions by hand and their drawn size never changes.
 */
export default function SiteMap({
  onSelect, selectedId = null, adjust = false, groupFilter: groupFilterProp,
  onAdjustWarning, height,
}) {
  const siteMap = useStore((s) => s.siteMap)
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const setPinOverride = useStore((s) => s.setPinOverride)

  const [view, setView] = useState('front')
  const [groups, setGroups] = useState([])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(null)
  const [dragPoint, setDragPoint] = useState(null)
  const [warning, setWarning] = useState(null)
  const [url, setUrl] = useState(null)
  const [width, setWidth] = useState(390)

  const boxRef = useRef(null)
  const gesture = useRef({})
  const press = useRef(null)

  const overrides = siteMap?.pinOverrides || {}
  const activeGroups = groupFilterProp ?? groups

  // the window is measured rather than assumed: the pin table is specified at
  // 390 px but the component has to be right on a wider phone too
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth || 390)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let dead = false
    let made = null
    if (!siteMap?.photoKey) { setUrl(null); return undefined }
    getBlob(siteMap.photoKey).then((b) => {
      if (dead || !b) return
      made = blobUrl(b)
      setUrl(made)
    })
    return () => { dead = true; if (made) revokeBlobUrl(made) }
  }, [siteMap?.photoKey])

  const geom = { screenWidth: width, aspect: COMPOSITE_ASPECT }
  const winH = windowHeightPx(view, width, COMPOSITE_ASPECT)
  const boxH = height ?? winH
  const w = WINDOWS[view]
  const fullW = (width / (w.x1 - w.x0)) * 100
  const fullH = fullW * COMPOSITE_ASPECT

  const pins = useMemo(() => pinsFor(view, overrides), [view, overrides])
  const status = useMemo(
    () => allPinStatus({ records, reactions, nowIso: new Date().toISOString() }),
    [records, reactions],
  )
  const suggested = useMemo(
    () => suggestedPin({ records, reactions, nowIso: new Date().toISOString() }),
    [records, reactions],
  )

  const reset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  useEffect(() => { reset() }, [view, reset])

  /** Keep the window full of photo: pan is clamped to the scaled edges. */
  const clamp = useCallback((p, z) => {
    const maxX = (width * z - width) / 2
    const maxY = (winH * z - winH) / 2
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    }
  }, [width, winH])

  // pins are drawn at base position, then the same transform is applied to the
  // *centre* only — never to the radius
  const place = (pin) => {
    const s = toScreen(pin, geom)
    return {
      x: (s.x - width / 2) * zoom + width / 2 + pan.x,
      y: (s.y - winH / 2) * zoom + winH / 2 + pan.y,
    }
  }
  const unplace = (pt) => ({
    x: (pt.x - width / 2 - pan.x) / zoom + width / 2,
    y: (pt.y - winH / 2 - pan.y) / zoom + winH / 2,
  })

  const localPoint = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    const t = e.touches?.[0] || e.changedTouches?.[0] || e
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }

  // ------------------------------------------------------------- gestures

  const onPointerDown = (e) => {
    if (e.touches?.length === 2) {
      const [a, b] = e.touches
      gesture.current = {
        pinch: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        zoom0: zoom,
      }
      return
    }
    const pt = localPoint(e)
    // lastTap has to survive the press that might become the second half of a
    // double tap — overwrite it here and no double tap can ever be detected
    gesture.current = {
      start: pt, pan0: { ...pan }, moved: false, at: Date.now(),
      lastTap: gesture.current.lastTap,
    }
    if (!adjust) return
    // in adjust mode a long press picks the pin up; a short tap still selects
    const near = nearestPin(view, unplace(pt), { overrides, ...geom, groups: activeGroups })
    press.current = setTimeout(() => {
      if (!near) return
      setDragging(near.pin.id)
      setDragPoint(place(near.pin))
      setWarning(null)
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e) => {
    if (e.touches?.length === 2 && gesture.current.pinch) {
      const [a, b] = e.touches
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gesture.current.zoom0 * (d / gesture.current.pinch)))
      setZoom(next)
      setPan((p) => clamp(p, next))
      return
    }
    const pt = localPoint(e)
    if (dragging) {
      e.preventDefault?.()
      const pos = fromScreen(view, unplace(pt), geom)
      const v = validatePosition(dragging, pos, { overrides, ...geom })
      setWarning(v.ok ? null : v.reason)
      onAdjustWarning?.(v.ok ? null : v.reason)
      gesture.current.pending = { pos, ok: v.ok }
      setDragPoint(pt)
      return
    }
    if (!gesture.current.start) return
    const dx = pt.x - gesture.current.start.x
    const dy = pt.y - gesture.current.start.y
    if (Math.hypot(dx, dy) > 6) {
      gesture.current.moved = true
      clearTimeout(press.current)
    }
    if (zoom > 1 && gesture.current.moved) {
      setPan(clamp({ x: gesture.current.pan0.x + dx, y: gesture.current.pan0.y + dy }, zoom))
    }
  }

  const onPointerUp = (e) => {
    clearTimeout(press.current)
    if (gesture.current.pinch) { gesture.current = {}; return }
    if (dragging) {
      const pending = gesture.current.pending
      // a position that breaks a rule is never saved: the pin springs back and
      // the reason stays on screen, because a silent refusal reads as a bug
      if (pending?.ok) { setPinOverride(dragging, pending.pos); setWarning(null); onAdjustWarning?.(null) }
      setDragging(null)
      setDragPoint(null)
      gesture.current = {}
      return
    }
    const now = Date.now()
    if (!gesture.current.moved) {
      if (gesture.current.lastTap && now - gesture.current.lastTap < 300) {
        reset()
        gesture.current = {}
        return
      }
      const pt = localPoint(e)
      const near = nearestPin(view, unplace(pt), { overrides, ...geom, groups: activeGroups })
      if (near) onSelect?.(near.pin)
      const last = now
      gesture.current = { lastTap: last }
      return
    }
    gesture.current = { lastTap: gesture.current.lastTap }
  }

  const dragPos = dragging ? dragPoint : null

  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
        {['front', 'back'].map((v) => (
          <button
            key={v}
            data-testid={`map-view-${v}`}
            onClick={() => setView(v)}
            className="flex-1 rounded-full py-2 text-sm font-bold capitalize"
            style={view === v
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { color: 'var(--text-2)' }}
          >
            {v}
          </button>
        ))}
      </div>

      {groupFilterProp === undefined && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" data-testid="map-groups">
          {[{ id: null, label: 'All' }, ...GROUPS].map((g) => {
            const on = g.id === null ? !groups.length : groups.includes(g.id)
            return (
              <button
                key={g.id || 'all'}
                data-testid={`map-group-${g.id || 'all'}`}
                onClick={() => setGroups(g.id === null ? [] : (groups.includes(g.id) ? groups.filter((x) => x !== g.id) : [...groups, g.id]))}
                className="chip shrink-0"
                style={on ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' } : undefined}
              >
                {g.label}
              </button>
            )
          })}
        </div>
      )}

      {/*
        Full-bleed, whatever it is nested in.

        The pin table guarantees 44 px between sites *at 390 px of window*. Let
        a card's padding shrink the window to 324 and that guarantee quietly
        becomes 37 px — two sites a thumb cannot tell apart. So the map escapes
        its container's padding rather than trusting every caller to have none.
      */}
      <div
        ref={boxRef}
        data-testid="site-map"
        className="relative select-none overflow-hidden"
        style={{
          height: boxH,
          width: '100vw',
          marginLeft: 'calc(50% - 50vw)',
          background: 'var(--surface-sunk)',
          touchAction: 'none',
        }}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
        onMouseDown={onPointerDown}
        onMouseMove={(e) => { if (gesture.current.start || dragging) onPointerMove(e) }}
        onMouseUp={onPointerUp}
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{
              width: fullW * zoom,
              height: fullH * zoom,
              left: -(w.x0 / 100) * fullW * zoom + (width - width * zoom) / 2 + pan.x,
              top: -(w.y0 / 100) * fullH * zoom + (winH - winH * zoom) / 2 + pan.y,
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center" data-testid="map-no-photo">
            <ImageOff size={22} style={{ color: 'var(--text-3)' }} />
            <div className="t-caption" style={{ color: 'var(--text-2)' }}>
              No map photo yet. Import one in Settings &gt; Site map. It stays on this phone.
            </div>
          </div>
        )}

        {pins.map((pin) => {
          const p = dragging === pin.id && dragPos ? dragPos : place(pin)
          const st = status[pin.id]
          const dim = activeGroups.length && !activeGroups.includes(pin.group)
          const isSuggested = suggested === pin.id
          const isSelected = selectedId === pin.id
          const r = (isSelected || dragging === pin.id ? PIN_DIAMETER_PX * 1.5 : PIN_DIAMETER_PX) / 2
          return (
            <div
              key={pin.id}
              data-testid={`pin-${pin.id}`}
              data-status={st?.status || 'unused'}
              data-dim={dim ? '1' : '0'}
              data-suggested={isSuggested ? '1' : '0'}
              className="pointer-events-none absolute rounded-full"
              style={{
                left: p.x - r,
                top: p.y - r,
                width: r * 2,
                height: r * 2,
                background: fillFor(st),
                opacity: dim ? 0.18 : opacityFor(st),
                border: `2px solid ${isSuggested ? 'var(--lime)' : 'rgba(255,255,255,0.9)'}`,
                boxShadow: isSuggested ? '0 0 0 3px color-mix(in srgb, var(--lime) 35%, transparent)' : 'none',
                transition: dragging === pin.id ? 'none' : 'width 120ms, height 120ms',
              }}
            />
          )
        })}
      </div>

      {adjust && warning && (
        <div
          data-testid="adjust-warning"
          className="mt-2 rounded-[var(--r-sm)] px-3 py-2 t-caption"
          style={{ background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)' }}
        >
          {warning}
        </div>
      )}
      {adjust && !warning && (
        <div className="mt-2 t-caption" style={{ color: 'var(--text-3)' }}>
          Press and hold a pin, then drag. Release to save.
        </div>
      )}
      {!adjust && zoom > 1 && (
        <div className="mt-2 t-caption" style={{ color: 'var(--text-3)' }}>Double tap to reset the zoom.</div>
      )}
    </div>
  )
}
