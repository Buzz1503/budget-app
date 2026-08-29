import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MapPin, ChevronLeft, ChevronDown, Sparkles, Route, Target, Info, Clock,
  ShieldCheck, AlertTriangle, RotateCcw, Plus, X,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import BodyMap, { ColourKey, statusColor } from './BodyMap'
import {
  allSiteStates, suggestBest, suggestReason, nextOnPath, pathPreview, rotationHealth,
  siteHistory, reactionState, repeatReactors, REACTION_KINDS, SITE_STATUS, restDaysFor,
  zoneLoad,
} from '../lib/rotation'
import {
  SITE_BY_ID, regionsForRoute, regionsForZone, sitesInRegionGroup, sitesForRoute, restedWords,
  THIGH_ONLY_NOTE,
} from '../lib/sites'
import { haptic } from '../lib/feedback'
import { useVisualViewport, sheetMaxHeight, useKeyboardSafeFocus } from '../lib/viewport'

/**
 * Everything about choosing a spot, shared by the single-dose picker and the
 * co-draw sheet so the two can never drift apart on what's safe to use.
 *
 * The caller owns the picked id; this reports the resolved choice back through
 * `onResolve` so it can label its own confirm button.
 */
export default function SiteChooser({ route = 'SubQ', zone = 'all', picked, onPick, onResolve }) {
  const doseLogs = useStore((s) => s.doseLogs)
  const reactions = useStore((s) => s.siteReactions)
  const peptides = useStore((s) => s.peptides)
  const mode = useStore((s) => s.rotation?.mode || 'suggest')
  const setRotationMode = useStore((s) => s.setRotationMode)
  const hapticsOn = useStore((s) => s.settings.haptics)
  const t = todayStr()

  const ctx = useMemo(
    () => ({ doseLogs, reactions, todayStr: t, route, zone }),
    [doseLogs, reactions, t, route, zone]
  )
  const load = useMemo(() => zoneLoad(ctx), [ctx])

  const states = useMemo(() => allSiteStates(ctx), [ctx])
  const suggestion = useMemo(() => suggestBest(ctx), [ctx])
  const path = useMemo(() => nextOnPath(ctx), [ctx])
  const preview = useMemo(() => pathPreview(ctx, 3), [ctx])
  const health = useMemo(() => rotationHealth(ctx), [ctx])
  const repeats = useMemo(() => repeatReactors(reactions, t), [reactions, t])

  const recommended = mode === 'path' ? path.siteId : suggestion
  const chosen = picked || recommended
  const chosenSite = SITE_BY_ID[chosen]
  const chosenState = states[chosen]

  useEffect(() => { onResolve?.(chosen) }, [chosen, onResolve])

  // faces present in this route's pool — the toggle only appears when there's
  // genuinely something on the other side
  const faces = useMemo(() => {
    const set = new Set(sitesForRoute(route, zone).map((s) => s.face || 'front'))
    return ['front', 'back'].filter((f) => set.has(f))
  }, [route, zone])
  const [face, setFace] = useState('front')
  const [zoom, setZoom] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showKey, setShowKey] = useState(false)
  const pinNonce = useRef(0)
  const [pinAt, setPinAt] = useState(null)

  // follow the recommendation onto its own side of the body
  useEffect(() => {
    const f = SITE_BY_ID[recommended]?.face || 'front'
    if (faces.includes(f)) setFace(f)
  }, [recommended, faces])
  useEffect(() => { setZoom(null) }, [face])

  const groups = useMemo(
    () => regionsForZone(route, zone).filter((g) => (g.face || 'front') === face),
    [route, zone, face]
  )
  const faceSites = useMemo(
    () => sitesForRoute(route, zone).filter((s) => (s.face || 'front') === face),
    [route, zone, face]
  )
  const visible = zoom ? sitesInRegionGroup(zoom, route) : faceSites

  // The pin-drop: a chosen spot lands with a ripple and a tap you can feel.
  const pick = useCallback((id) => {
    onPick?.(id)
    pinNonce.current += 1
    setPinAt({ id, nonce: pinNonce.current })
    try { if (hapticsOn) haptic([8, 26, 14]) } catch { /* haptics are optional */ }
    const f = SITE_BY_ID[id]?.face || 'front'
    if (f !== face && faces.includes(f)) setFace(f)
  }, [onPick, hapticsOn, face, faces])

  useEffect(() => {
    if (!pinAt) return
    const timer = setTimeout(() => setPinAt(null), 800)
    return () => clearTimeout(timer)
  }, [pinAt])

  const rest = restDaysFor(route)

  return (
    <div className="space-y-3">
      {/* mode: decide for me, or just tell me the next one */}
      <div className="flex rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
        {[
          ['suggest', 'Suggest a spot', Target],
          ['path', 'Follow the path', Route],
        ].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setRotationMode(id)}
            aria-label={label}
            className="relative flex flex-1 items-center justify-center gap-2 rounded-full py-2 text-xs font-black">
            {mode === id && (
              <motion.span layoutId="rot-mode-pill" className="absolute inset-0 rounded-full"
                style={{ background: 'var(--accent)' }} />
            )}
            <span className="relative flex items-center gap-2" style={{ color: mode === id ? 'var(--accent-fg)' : 'var(--text-2)' }}>
              <Icon size={13} /> {label}
            </span>
          </button>
        ))}
      </div>

      {/* why two thirds of the map is missing */}
      {zone === 'thigh' && (
        <p className="flex items-start gap-2 rounded-[14px] p-3 text-xs font-semibold leading-relaxed"
          data-testid="zone-note"
          style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>{THIGH_ONLY_NOTE}</span>
        </p>
      )}

      {/* the pool as a whole is running tight — said before it is too late */}
      {load.message && (
        <p className="flex items-start gap-2 rounded-[14px] p-3 text-xs font-semibold leading-relaxed"
          data-testid="zone-load"
          style={load.level === 'watch'
            ? { background: 'var(--surface-sunk)', color: 'var(--text-2)' }
            : { background: 'color-mix(in srgb, var(--danger) 14%, transparent)', color: 'var(--danger)' }}>
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>{load.message}</span>
        </p>
      )}

      {/* the recommendation, spelled out */}
      {chosenSite && (
        <motion.div layout data-testid="recommendation"
          className="rounded-[14px] p-4"
          style={{
            background: 'color-mix(in srgb, var(--good) 13%, transparent)',
            border: '1.5px solid color-mix(in srgb, var(--good) 42%, transparent)',
          }}>
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide" style={{ color: 'var(--good)' }}>
            {picked ? <><MapPin size={13} /> Your pick</>
              : mode === 'path' ? <><Route size={13} /> Next on your path</>
                : <><Sparkles size={13} /> Inject here — spot {chosenSite.n}</>}
          </p>
          <p className="mt-1 text-base font-black leading-tight">{chosenSite.short || chosenSite.label}</p>
          <p className="mt-1 text-xs font-semibold leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {chosenSite.plain}
          </p>
          <p className="mt-2 text-xs font-bold" style={{ color: 'var(--good)' }}>
            {picked ? restedWords(chosenState?.days) : suggestReason(chosen, ctx)}
          </p>
          {mode === 'path' && !picked && preview.length > 1 && (
            <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              Then: {preview.slice(1).map((id) => SITE_BY_ID[id]?.short || id).join(' → ')}
            </p>
          )}
          {path.allParked && mode === 'path' && (
            <p className="mt-2 flex items-start gap-2 text-xs font-bold" style={{ color: 'var(--warn)' }}>
              <AlertTriangle size={12} className="mt-1 shrink-0" />
              <span>Every spot is resting or over-used right now — this is the least-worn one. Clear a reaction, or give it a day.</span>
            </p>
          )}
        </motion.div>
      )}

      {/* front / back + region zoom */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {faces.length > 1 && (
            <div className="flex rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
              {faces.map((f) => (
                <button key={f} onClick={() => setFace(f)}
                  aria-label={`${f} view`}
                  className="relative rounded-full px-3 py-1 text-xs font-black">
                  {face === f && (
                    <motion.span layoutId="face-pill" className="absolute inset-0 rounded-full"
                      style={{ background: 'var(--surface)' }} />
                  )}
                  <span className="relative" style={{ color: face === f ? 'var(--text)' : 'var(--text-2)' }}>
                    {f === 'front' ? 'Front' : 'Back'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {zoom ? (
            <button onClick={() => setZoom(null)}
              className="flex items-center gap-1 rounded-full px-3 py-2 text-xs font-black"
              style={{ background: 'var(--surface-sunk)' }}>
              <ChevronLeft size={12} /> Whole body
            </button>
          ) : groups.map((g) => (
            <button key={g.id} onClick={() => setZoom(g)}
              className="rounded-full px-3 py-2 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {g.label}
            </button>
          ))}
        </div>

        <BodyMap
          states={states} selected={picked} suggestion={picked ? null : recommended}
          onPick={pick} sites={visible} view={zoom?.view} zoom={!!zoom}
          face={face} pinAt={pinAt}
        />

        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Colours heal over {rest} days. Tap any spot to pick it; tap it again for its history.
          </p>
          <button onClick={() => setShowKey((v) => !v)} aria-label="What do the colours mean?"
            className="shrink-0 rounded-full p-2" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            <Info size={13} />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {showKey && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden">
              <div className="mt-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
                <ColourKey />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* rotation health */}
      {health.ready && <RotationHealth health={health} />}

      {repeats.length > 0 && (
        <p className="flex items-start gap-2 rounded-[14px] p-3 text-xs font-bold"
          style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>
          <AlertTriangle size={13} className="mt-1 shrink-0" />
          <span>
            {SITE_BY_ID[repeats[0].siteId]?.short} has reacted {repeats[0].count} times lately — worth resting it
            properly, or checking your technique there.
          </span>
        </p>
      )}

      {/* the spots, as readable text */}
      <SpotList
        sites={visible} states={states} chosen={chosen} onPick={pick}
        onOpen={(id) => setDetail(id)}
      />

      <SiteDetail
        siteId={detail} onClose={() => setDetail(null)}
        states={states} doseLogs={doseLogs} peptides={peptides} reactions={reactions} today={t}
        onPick={(id) => { pick(id); setDetail(null) }}
      />
    </div>
  )
}

// ---- rotation health ----
function RotationHealth({ health }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-[14px] p-3" data-testid="rotation-health" style={{ background: 'var(--surface-sunk)' }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(${health.tone} ${health.score}%, var(--surface) 0)` }}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-black"
            style={{ background: 'var(--surface-sunk)' }}>
            {health.score}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs font-black">
            <ShieldCheck size={13} style={{ color: health.tone }} /> Rotation health · {health.grade}
          </span>
          <span className="mt-1 block text-xs font-semibold leading-snug" style={{ color: 'var(--text-2)' }}>
            {health.nudge}
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: 'inline-flex' }}>
          <ChevronDown size={15} style={{ color: 'var(--text-2)' }} />
        </motion.span>
      </button>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 space-y-2">
          <Bar label="Spread across the map" value={health.spread} />
          <Bar label="Rest between reuses" value={health.rest} />
          <Bar label="Left / right balance" value={health.balance} />
          <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
            From your last {health.logs} injections over {health.window} days
            {' '}({health.left} left · {health.right} right · {health.distinct} different spots).
          </p>
        </motion.div>
      )}
    </div>
  )
}

function Bar({ label, value }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-bold">
        <span style={{ color: 'var(--text-2)' }}>{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface)' }}>
        <motion.div className="h-full rounded-full"
          initial={{ width: 0 }} animate={{ width: `${value}%` }}
          style={{ background: value >= 75 ? 'var(--good)' : value >= 55 ? 'var(--warn)' : 'var(--danger)' }} />
      </div>
    </div>
  )
}

// ---- the list ----
function SpotList({ sites, states, chosen, onPick, onOpen }) {
  const [open, setOpen] = useState(false)
  // Collapsed, the list answers the two questions worth answering without
  // scrolling: where am I going, and where have I just been.
  const shown = open ? sites : sites.filter((s) => {
    const st = states[s.id]
    return s.id === chosen || !st?.usable || st.heat > 0
  })

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-xs font-black"
        style={{ color: 'var(--text-2)' }}>
        <span>{open ? 'Hide the full list' : `All ${sites.length} spots in words`}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: 'inline-flex' }}>
          <ChevronDown size={14} />
        </motion.span>
      </button>
      <div className="space-y-1" data-testid="spot-list">
        {shown.map((s) => {
          const st = states[s.id]
          const isSel = chosen === s.id
          const meta = st ? SITE_STATUS[st.status] : null
          return (
            <div key={s.id}
              className="flex w-full items-start gap-3 rounded-[14px] p-3"
              style={isSel
                ? { background: 'color-mix(in srgb, var(--good) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 40%, transparent)' }
                : { background: 'var(--surface-sunk)', border: '1px solid transparent' }}>
              {/* Tapping the row picks the spot — that's what a list of places
                  to inject is for. The story is a deliberate second tap. */}
              <button onClick={() => onPick(s.id)} disabled={st && !st.usable}
                aria-label={`Pick ${s.label}`}
                className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:opacity-50">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black"
                  style={{ background: isSel ? 'var(--good)' : statusColor(st), color: 'var(--accent-fg)' }}>
                  {s.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black">{s.short || s.label}</span>
                  <span className="block text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{s.plain}</span>
                  <span className="mt-1 block text-xs font-bold" style={{ color: meta?.tone }}>
                    {meta?.words}{st?.days != null && st.status !== 'resting' ? ` · used ${st.days === 0 ? 'today' : st.days === 1 ? 'yesterday' : `${st.days} days ago`}` : ''}
                  </span>
                </span>
              </button>
              <button onClick={() => onOpen(s.id)} aria-label={`History and reactions for ${s.label}`}
                className="shrink-0 rounded-full p-2" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                <Clock size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- one site's story + reaction log ----
function SiteDetail({ siteId, onClose, states, doseLogs, peptides, reactions, today, onPick }) {
  const logSiteReaction = useStore((s) => s.logSiteReaction)
  const clearSiteReactions = useStore((s) => s.clearSiteReactions)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const vp = useVisualViewport()
  const sheetRef = useRef(null)
  useKeyboardSafeFocus(sheetRef, !!siteId)

  useEffect(() => { setAdding(false); setNote('') }, [siteId])

  if (!siteId) return null
  const site = SITE_BY_ID[siteId]
  const st = states[siteId]
  const history = siteHistory(siteId, doseLogs, peptides).slice(0, 8)
  const rx = reactionState(siteId, reactions, today)
  const meta = st ? SITE_STATUS[st.status] : null

  return (
    <AnimatePresence>
      <motion.div key={siteId}
        className="fixed inset-0 z-[55] flex items-end justify-center"
        // sized to what the keyboard has left of the window, not to the window:
        // this sheet carries a note field, and 80dvh puts it under the keys
        style={{ top: vp.offsetTop, bottom: 'auto', height: vp.height }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <motion.div
          ref={sheetRef}
          className="card relative w-full overflow-y-auto overscroll-contain rounded-b-none p-4 sm:max-w-md sm:rounded-b-[20px]"
          style={{
            background: 'var(--surface)',
            maxHeight: sheetMaxHeight(vp),
            paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
          }}
          initial={{ y: 60 }} animate={{ y: 0 }} exit={{ y: 60 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          data-testid="site-detail"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-black">{site?.short || site?.label}</h2>
              <p className="text-xs font-semibold" style={{ color: meta?.tone }}>{meta?.words}</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}>
              <X size={15} />
            </button>
          </div>

          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{site?.plain}</p>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="last used" value={st?.days == null ? 'never' : st.days === 0 ? 'today' : `${st.days}d ago`} />
            <Stat label="uses · 90d" value={st?.uses ?? 0} />
            <Stat label="vs its turn" value={st?.wearRatio ? `${st.wearRatio}×` : '—'}
              warn={st?.overworn} />
          </div>

          {st?.overworn && (
            <p className="mt-2 flex items-start gap-2 rounded-[14px] p-3 text-xs font-bold"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
              <AlertTriangle size={13} className="mt-1 shrink-0" />
              <span>This one has taken well over its share lately. It's on extended rest — nothing will route here
                until the others catch up.</span>
            </p>
          )}

          {/* reactions */}
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--danger)' }}>
                Reactions
              </p>
              {rx.resting ? (
                <button onClick={() => clearSiteReactions(siteId)}
                  className="flex items-center gap-1 text-xs font-black" style={{ color: 'var(--good)' }}>
                  <RotateCcw size={12} /> It's healed — clear
                </button>
              ) : (
                <button onClick={() => setAdding((v) => !v)}
                  className="flex items-center gap-1 text-xs font-black" style={{ color: 'var(--text-2)' }}>
                  <Plus size={12} /> Log a reaction
                </button>
              )}
            </div>

            {rx.resting && (
              <p className="mb-2 rounded-[14px] p-3 text-xs font-bold"
                style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)', color: 'var(--danger)' }}>
                Resting — {rx.active.meta?.label.toLowerCase()} logged {rx.active.date}.
                {rx.daysLeft > 0 ? ` Suggested rest: another ${rx.daysLeft} day${rx.daysLeft === 1 ? '' : 's'}.` : ' Check it before using it again.'}
                {' '}It's excluded from suggestions and the path until you clear it.
              </p>
            )}

            {(adding || (!rx.resting && rx.history.length === 0)) && adding && (
              <div className="mb-2 space-y-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
                <div className="flex flex-wrap gap-2">
                  {REACTION_KINDS.map((k) => (
                    <button key={k.id}
                      onClick={() => { logSiteReaction(siteId, k.id, note); setAdding(false); setNote('') }}
                      className="rounded-full px-3 py-2 text-xs font-black"
                      style={{ background: 'var(--surface)' }}>
                      {k.icon} {k.label}
                    </button>
                  ))}
                </div>
                <input className="input !py-2 !text-xs" placeholder="Optional note…"
                  value={note} onChange={(e) => setNote(e.target.value)} />
                <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                  Logging one rests this spot and routes around it until you clear it.
                </p>
              </div>
            )}

            {rx.history.length > 0 ? (
              <div className="space-y-1">
                {rx.history.slice().reverse().slice(0, 6).map((r) => (
                  <p key={r.id} className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                    <span>{REACTION_KINDS.find((k) => k.id === r.kind)?.icon}</span>
                    <span className="font-bold" style={{ color: r.cleared ? 'var(--text-2)' : 'var(--danger)' }}>
                      {REACTION_KINDS.find((k) => k.id === r.kind)?.label}
                    </span>
                    <span>· {format(parseISO(r.date), 'd MMM')}</span>
                    {r.cleared && <span>· cleared</span>}
                    {r.note && <span className="truncate italic leading-tight">“{r.note}”</span>}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                No reactions logged here.
              </p>
            )}
          </div>

          {/* story */}
          <div className="mt-3">
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
              <Clock size={12} /> Recent shots here
            </p>
            {history.length === 0 ? (
              <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                Never used — this spot is fully rested.
              </p>
            ) : (
              <div className="space-y-1">
                {history.map((h) => (
                  <p key={h.id} className="flex items-center gap-2 text-xs font-semibold">
                    <span className="w-14 shrink-0" style={{ color: 'var(--text-2)' }}>{format(parseISO(h.date), 'd MMM')}</span>
                    <span className="min-w-0 flex-1 truncate leading-tight">{h.name}</span>
                    {h.coDrawId && <span className="shrink-0 text-xs" style={{ color: 'var(--good)' }}>co-draw</span>}
                  </p>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => onPick(siteId)}
            disabled={st && !st.usable}
            className="btn-primary mt-4 w-full rounded-full py-3 text-sm font-black disabled:opacity-40">
            {st && !st.usable ? 'Resting — pick another spot' : 'Use this spot'}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div className="rounded-[14px] py-2" style={{ background: 'var(--surface-sunk)' }}>
      <p className="text-sm font-black" style={warn ? { color: 'var(--text)' } : undefined}>{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>{label}</p>
    </div>
  )
}
