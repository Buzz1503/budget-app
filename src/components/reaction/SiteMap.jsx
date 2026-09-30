import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageOff, Loader } from 'lucide-react'
import useStore from '../../store/useStore'
import { loadMapPhoto, MAP_PHOTO_ERRORS } from '../../lib/mapPhoto'
import {
  WINDOWS, GROUPS, PIN_DIAMETER_PX, COMPOSITE_ASPECT, SCREEN_WIDTH,
  pinsFor, toScreen, windowHeightPx, nearestPin, validatePosition,
} from '../../lib/sitePins'
import { allPinStatus } from '../../lib/reactionTracker'
import { recentUses, usesByPin, pinBadge, visibleChips, suggestSite, DEFAULT_WINDOW_DAYS } from '../../lib/siteRotation'
import { colourHex } from '../../lib/peptideIdentity'
import { displayName } from '../../lib/naming'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const LONG_PRESS_MS = 300
const DOUBLE_TAP_MS = 320
const MOVE_SLOP_PX = 6

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

/** The map photo, loaded once per photo id and only "ready" once decoded. */
export function useMapPhoto() {
  const photoKey = useStore((s) => s.siteMap?.photoKey)
  const [state, setState] = useState({ status: photoKey ? 'loading' : 'none', url: null, natural: null })

  useEffect(() => {
    let dead = false
    if (!photoKey) { setState({ status: 'none', url: null, natural: null }); return undefined }
    setState({ status: 'loading', url: null, natural: null })
    loadMapPhoto(photoKey).then((r) => { if (!dead) setState(r) })
    // deliberately no revoke here: blobUrl caches one URL per key, and tearing
    // it down on every unmount would make the next mount of any map re-fetch
    // and re-decode the same photograph
    return () => { dead = true }
  }, [photoKey])

  return state
}

/**
 * The photo site map. One implementation, used everywhere a body map appears.
 *
 * The image and the pins live inside a single transformed wrapper, so zoom and
 * pan move both by exactly the same amount and they cannot drift apart. Pins
 * counter-scale by 1/zoom, which keeps their drawn size constant while the
 * distance between them grows — zooming a map is for seeing the gap between two
 * sites, not for making the markers bigger.
 *
 * Positions are percentages of the *crop window*, derived from percentages of
 * the whole composite, so nothing here depends on the rendered pixel size. The
 * 44 px spacing rule is evaluated separately at the 390 px reference width,
 * because it is a claim about a thumb on a phone, not about whatever size this
 * happens to be drawn at.
 */
export default function SiteMap({
  onSelect, selectedId = null, adjust = false, groupFilter: groupFilterProp,
  onAdjustWarning, fit = 'width', maxHeight, view: viewProp, onView, showChrome = true,
  bleed = false, forPeptideId = null, highlight = null,
}) {
  const siteMap = useStore((s) => s.siteMap)
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const peptides = useStore((s) => s.peptides)
  const windowDays = useStore((s) => s.reactionSettings?.windowDays ?? DEFAULT_WINDOW_DAYS)
  const setPinOverride = useStore((s) => s.setPinOverride)
  const photo = useMapPhoto()

  const [ownView, setOwnView] = useState('front')
  const view = viewProp ?? ownView
  const setView = onView ?? setOwnView

  const [groups, setGroups] = useState([])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(null)
  const [dragPct, setDragPct] = useState(null)
  const [warning, setWarning] = useState(null)
  const [box, setBox] = useState({ w: SCREEN_WIDTH, h: 0 })

  const outerRef = useRef(null)
  const gesture = useRef({})
  const press = useRef(null)

  const overrides = siteMap?.pinOverrides || {}
  const activeGroups = groupFilterProp ?? groups
  const w = WINDOWS[view]
  const aspect = photo.natural ? photo.natural.h / photo.natural.w : COMPOSITE_ASPECT

  // the crop window's own shape, in image pixels — the container matches it so
  // the photo is never stretched and never letterboxed
  const cropRatio = useMemo(() => {
    const cw = (w.x1 - w.x0) * (photo.natural?.w ?? 1000)
    const ch = (w.y1 - w.y0) * (photo.natural?.h ?? 1000 * COMPOSITE_ASPECT)
    return ch / cw
  }, [w, photo.natural])

  useEffect(() => {
    const el = outerRef.current
    if (!el) return undefined
    const measure = () => {
      const availW = el.clientWidth || SCREEN_WIDTH
      const availH = maxHeight ?? Infinity
      // fit to width, or to whichever of the two is smaller, so that at default
      // zoom the whole window is on screen and no pin can be clipped
      let width = availW
      let height = width * cropRatio
      if (fit === 'contain' && height > availH) {
        height = availH
        width = height / cropRatio
      }
      setBox({ w: Math.round(width), h: Math.round(height) })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cropRatio, fit, maxHeight])

  const pins = useMemo(() => pinsFor(view, overrides), [view, overrides])
  const status = useMemo(
    () => allPinStatus({ records, reactions, nowIso: new Date().toISOString() }),
    [records, reactions],
  )
  // One query over the window, shared by the fills, the chips, the legend and
  // the suggestion — rather than four passes over the same records.
  const nowIso = useMemo(() => new Date().toISOString(), [records, reactions]) // eslint-disable-line react-hooks/exhaustive-deps
  const uses = useMemo(
    () => recentUses({ records, reactions, nowIso, windowDays }),
    [records, reactions, nowIso, windowDays],
  )
  const byPin = useMemo(() => usesByPin(uses), [uses])

  const peptideById = useMemo(() => Object.fromEntries(peptides.map((p) => [p.id, p])), [peptides])
  const codeOf = useCallback((id) => peptideById[id]?.code || '?', [peptideById])
  const colourOf = useCallback((id) => colourHex(peptideById[id]), [peptideById])

  const badges = useMemo(() => {
    const out = {}
    for (const pin of pins) {
      const b = pinBadge(pin.id, uses, codeOf)
      if (b) out[pin.id] = b
    }
    return out
  }, [pins, uses, codeOf])

  const suggested = useMemo(() => (
    suggestSite(forPeptideId, {
      records, reactions, nowIso, windowDays,
      overrides, aspect,
    })?.pinId || null
  ), [forPeptideId, records, reactions, nowIso, windowDays, overrides, aspect])

  const reset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  useEffect(() => { reset() }, [view, reset])

  /** Keep the window full of photo: pan is clamped to the scaled edges. */
  const clamp = useCallback((p, z) => {
    const maxX = (box.w * z - box.w) / 2
    const maxY = (box.h * z - box.h) / 2
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    }
  }, [box])

  // ------------------------------------------------- coordinate conversions

  /** A touch on the container, as percentages of the whole composite. */
  const pointToPct = (pt) => {
    const fx = ((pt.x - box.w / 2 - pan.x) / zoom + box.w / 2) / box.w
    const fy = ((pt.y - box.h / 2 - pan.y) / zoom + box.h / 2) / box.h
    return {
      x: w.x0 + fx * (w.x1 - w.x0),
      y: w.y0 + fy * (w.y1 - w.y0),
    }
  }

  const localPoint = (e) => {
    const r = outerRef.current.getBoundingClientRect()
    const t = e.touches?.[0] || e.changedTouches?.[0] || e
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }

  // ------------------------------------------------------------- gestures

  const pickNearest = (pct) => {
    // measured against the 390 px reference, so which pin a tap belongs to is
    // the same question at every rendered size
    const at = toScreen({ ...pct, view }, { screenWidth: SCREEN_WIDTH, aspect })
    return nearestPin(view, at, { overrides, screenWidth: SCREEN_WIDTH, aspect, groups: activeGroups })
  }

  const onDown = (e) => {
    if (e.touches?.length === 2) {
      clearTimeout(press.current)
      const [a, b] = e.touches
      gesture.current = {
        ...gesture.current,
        pinch: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        zoom0: zoom,
        pan0: { ...pan },
      }
      return
    }
    const pt = localPoint(e)
    gesture.current = {
      start: pt, pan0: { ...pan }, moved: false, at: Date.now(),
      lastTap: gesture.current.lastTap,
    }
    if (!adjust) return
    const near = pickNearest(pointToPct(pt))
    press.current = setTimeout(() => {
      if (!near) return
      try { navigator.vibrate?.(8) } catch { /* optional */ }
      setDragging(near.pin.id)
      setDragPct({ x: near.pin.x, y: near.pin.y })
      setWarning(null)
    }, LONG_PRESS_MS)
  }

  const onMove = (e) => {
    if (gesture.current.pinch && e.touches?.length === 2) {
      const [a, b] = e.touches
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gesture.current.zoom0 * (d / gesture.current.pinch)))
      setZoom(next)
      setPan((p) => clamp(p, next))
      return
    }
    const pt = localPoint(e)

    if (dragging) {
      // a pin being dragged never pans and never zooms the map under it
      e.preventDefault?.()
      const pct = pointToPct(pt)
      setDragPct(pct)
      const v = validatePosition(dragging, pct, { overrides, screenWidth: SCREEN_WIDTH, aspect })
      setWarning(v.ok ? null : v.reason)
      onAdjustWarning?.(v.ok ? null : v.reason)
      gesture.current.pending = { pos: pct, ok: v.ok }
      return
    }

    if (!gesture.current.start) return
    const dx = pt.x - gesture.current.start.x
    const dy = pt.y - gesture.current.start.y
    if (!gesture.current.moved && Math.hypot(dx, dy) > MOVE_SLOP_PX) {
      gesture.current.moved = true
      clearTimeout(press.current)
    }
    if (zoom > 1 && gesture.current.moved) {
      e.preventDefault?.()
      setPan(clamp({ x: gesture.current.pan0.x + dx, y: gesture.current.pan0.y + dy }, zoom))
    }
  }

  const onUp = (e) => {
    clearTimeout(press.current)

    if (dragging) {
      const pending = gesture.current.pending
      // a position that breaks a rule is never saved: the pin springs back and
      // the reason stays on screen, because a silent refusal reads as a bug
      if (pending?.ok) { setPinOverride(dragging, pending.pos); setWarning(null); onAdjustWarning?.(null) }
      setDragging(null)
      setDragPct(null)
      gesture.current = {}
      return
    }
    if (gesture.current.pinch) { gesture.current = { lastTap: gesture.current.lastTap }; return }

    const now = Date.now()
    if (gesture.current.moved) { gesture.current = { lastTap: gesture.current.lastTap }; return }

    if (gesture.current.lastTap && now - gesture.current.lastTap < DOUBLE_TAP_MS) {
      reset()
      gesture.current = {}
      return
    }
    const near = pickNearest(pointToPct(localPoint(e)))
    if (near) onSelect?.(near.pin)
    gesture.current = { lastTap: now }
  }

  // ----------------------------------------------------------------- view

  const cropW = w.x1 - w.x0
  const cropH = w.y1 - w.y0
  const ready = photo.status === 'ready'

  // While a pin is held it follows the finger; every other pin sits where it is
  // stored. Both are expressed the same way, so the dragged one is never in a
  // different coordinate space from its neighbours.
  const pctOf = (pin) => (dragging === pin.id && dragPct ? dragPct : pin)

  /** A pin's centre in container pixels, after the zoom and pan transform. */
  const centreOf = (pin) => {
    const at = pctOf(pin)
    const fx = (at.x - w.x0) / cropW
    const fy = (at.y - w.y0) / cropH
    return {
      x: (fx * box.w - box.w / 2) * zoom + box.w / 2 + pan.x,
      y: (fy * box.h - box.h / 2) * zoom + box.h / 2 + pan.y,
    }
  }

  /**
   * Which code chips survive at this zoom.
   *
   * Pins sit 44 px apart at default zoom and a chip is wider than that, so most
   * of them would land on a neighbour. An overlapping chip is worse than none:
   * it is unreadable and it hides the pin it is labelling. Newest first, so the
   * most recent shot is the one that keeps its label — and the colour fill is
   * on the pin itself, so a dropped chip loses the code, never the identity.
   */
  const shownChips = useMemo(() => {
    const withBadge = pins.filter((p) => badges[p.id])
    if (!withBadge.length) return new Set()
    const pinBoxes = pins.map((p) => {
      const c = centreOf(p)
      return { id: p.id, box: { x: c.x - PIN_DIAMETER_PX / 2, y: c.y - PIN_DIAMETER_PX / 2, w: PIN_DIAMETER_PX, h: PIN_DIAMETER_PX } }
    })
    // newest use first, so priority follows recency
    const order = [...withBadge].sort((a, b) => {
      const ta = byPin[a.id]?.[0]?.record.timestamp || ''
      const tb = byPin[b.id]?.[0]?.record.timestamp || ''
      return String(tb).localeCompare(String(ta))
    })
    const chips = order.map((p) => {
      const c = centreOf(p)
      const text = badges[p.id].label + (badges[p.id].extra ? ` +${badges[p.id].extra}` : '')
      const cw = text.length * 5.6 + 8
      return { pinId: p.id, box: { x: c.x - cw / 2, y: c.y + PIN_DIAMETER_PX / 2 + 2, w: cw, h: 12 } }
    })
    return new Set(visibleChips(chips, pinBoxes))
  }, [pins, badges, byPin, box, zoom, pan, dragPct, dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  const legend = useMemo(() => {
    const seen = []
    for (const pin of pins) {
      const b = badges[pin.id]
      if (!b) continue
      for (const id of String(b.label).split('/')) {
        const pep = peptides.find((x) => (x.code || '') === id)
        if (pep && !seen.some((y) => y.id === pep.id)) seen.push(pep)
      }
    }
    return seen
  }, [pins, badges, peptides])

  return (
    <div className="flex min-h-0 flex-col">
      {showChrome && (
        <div className="mb-3 flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
          {['front', 'back'].map((v) => (
            <button
              key={v}
              data-testid={`map-view-${v}`}
              data-on={view === v ? 'true' : 'false'}
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
      )}

      {showChrome && groupFilterProp === undefined && (
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

      {/* Only the compounds actually on the map right now. A fixed key listing
          everything in the library would be mostly dead entries. */}
      {legend.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap gap-x-3 gap-y-1" data-testid="map-legend">
          {legend.map((pep) => (
            <span key={pep.id} className="flex items-center gap-1.5 text-xs font-bold" data-testid={`legend-${pep.id}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colourHex(pep) }} />
              <span style={{ color: 'var(--text-2)' }}>{pep.code} {displayName(pep)}</span>
            </span>
          ))}
        </div>
      )}

      {/*
        In-page maps break out of their container's padding.

        The pin table guarantees 44 px between sites at 390 px of window. Let a
        card's padding shrink that to 324 and the guarantee quietly becomes
        37 px — two sites a thumb cannot tell apart. The adjust screen does not
        need this: it has the whole screen and fits the crop to it instead.
      */}
      <div
        ref={outerRef}
        className="flex min-h-0 flex-1 justify-center"
        style={bleed ? { width: '100vw', marginLeft: 'calc(50% - 50vw)' } : undefined}
      >
        <div
          data-testid="site-map"
          data-photo={photo.status}
          className="relative shrink-0 select-none overflow-hidden rounded-[var(--r-lg)]"
          style={{
            width: box.w,
            height: box.h,
            background: 'var(--surface-sunk)',
            // vertical page scroll still works over an unzoomed in-page map;
            // once zoomed, or while adjusting, every touch belongs to the map
            touchAction: adjust || zoom > 1 ? 'none' : 'pan-y',
          }}
          onTouchStart={onDown}
          onTouchMove={onMove}
          onTouchEnd={onUp}
          onMouseDown={onDown}
          onMouseMove={(e) => { if (gesture.current.start || dragging) onMove(e) }}
          onMouseUp={onUp}
        >
          {photo.status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" data-testid="map-loading">
              <Loader size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
              <span className="t-caption" style={{ color: 'var(--text-2)' }}>Loading photo</span>
            </div>
          )}

          {photo.status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center" data-testid="map-error">
              <ImageOff size={20} style={{ color: 'var(--danger)' }} />
              <span className="t-caption" style={{ color: 'var(--text-2)' }}>
                {MAP_PHOTO_ERRORS[photo.reason] || 'Photo could not load'}
              </span>
              <MapPhotoRetry />
            </div>
          )}

          {photo.status === 'none' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center" data-testid="map-no-photo">
              <ImageOff size={20} style={{ color: 'var(--text-3)' }} />
              <span className="t-caption" style={{ color: 'var(--text-2)' }}>
                No map photo yet. Import one in Settings &gt; Site map. It stays on this phone.
              </span>
            </div>
          )}

          {/*
            One wrapper, one transform. The photograph and every pin are inside
            it, so no amount of zooming or panning can put a pin somewhere the
            skin under it is not.
          */}
          <div
            className="absolute inset-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
            {ready && (
              <img
                src={photo.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{
                  width: `${100 / cropW * 100}%`,
                  height: `${100 / cropH * 100}%`,
                  left: `${-w.x0 / cropW * 100}%`,
                  top: `${-w.y0 / cropH * 100}%`,
                }}
              />
            )}

            {/* pins draw only over a photo that is actually there */}
            {(ready || photo.status === 'none') && pins.map((pin) => {
              const at = pctOf(pin)
              const st = status[pin.id]
              const dim = activeGroups.length && !activeGroups.includes(pin.group)
              const isSuggested = suggested === pin.id
              const big = selectedId === pin.id || dragging === pin.id
              const d = PIN_DIAMETER_PX * (big ? 1.5 : 1)
              const badge = badges[pin.id]
              const lit = highlight?.includes(pin.id)
              // A pin used inside the window wears its peptide's colour; one
              // that is reacting keeps the severity ring around it, so "whose
              // is this" and "is it angry" are two separate readings rather
              // than one colour trying to say both.
              const fill = badge ? colourOf(badge.peptideId) : fillFor(st)
              const ring = st?.status === 'reacting'
                ? FILL[st.severity] || FILL.mild
                : isSuggested ? 'var(--lime)' : 'rgba(255,255,255,0.9)'
              const chipText = badge ? badge.label + (badge.extra ? ` +${badge.extra}` : '') : null
              return (
                <div
                  key={pin.id}
                  data-testid={`pin-${pin.id}`}
                  data-status={st?.status || 'unused'}
                  data-dim={dim ? '1' : '0'}
                  data-suggested={isSuggested ? '1' : '0'}
                  data-peptide={badge?.peptideId || ''}
                  className="pointer-events-none absolute"
                  style={{
                    left: `${(at.x - w.x0) / cropW * 100}%`,
                    top: `${(at.y - w.y0) / cropH * 100}%`,
                    // counter-scale: the gap between pins grows with the zoom,
                    // the pins themselves never do
                    transform: `scale(${1 / zoom})`,
                    transformOrigin: 'center center',
                    opacity: dim ? 0.18 : opacityFor(st),
                  }}
                >
                  <div
                    className="absolute rounded-full"
                    style={{
                      left: -d / 2,
                      top: -d / 2,
                      width: d,
                      height: d,
                      background: fill,
                      border: `2px solid ${ring}`,
                      boxShadow: isSuggested
                        ? '0 0 0 3px color-mix(in srgb, var(--lime) 35%, transparent)'
                        : lit ? '0 0 0 3px color-mix(in srgb, var(--info) 45%, transparent)' : 'none',
                    }}
                  />
                  {chipText && shownChips.has(pin.id) && (
                    <span
                      data-testid={`chip-${pin.id}`}
                      className="absolute whitespace-nowrap rounded-full px-1.5 text-[8px] font-black leading-[12px]"
                      style={{
                        top: d / 2 + 2,
                        left: 0,
                        transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.65)',
                        color: fill,
                      }}
                    >
                      {chipText}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {adjust && warning && (
        <div
          data-testid="adjust-warning"
          className="mt-2 shrink-0 rounded-[var(--r-sm)] px-3 py-2 t-caption"
          style={{ background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)' }}
        >
          {warning}
        </div>
      )}
      {!adjust && zoom > 1 && (
        <div className="mt-2 shrink-0 t-caption" style={{ color: 'var(--text-3)' }}>Double tap to reset the zoom.</div>
      )}
    </div>
  )
}

/** Straight back to the importer, from wherever the photo failed to load. */
function MapPhotoRetry() {
  const clearMapPhoto = useStore((s) => s.clearMapPhoto)
  return (
    <button className="chip mt-1" data-testid="map-import-again" onClick={clearMapPhoto}>
      Import again
    </button>
  )
}
