import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MapPin, Check, ChevronDown, ChevronLeft, Sparkles, Clock, HelpCircle, Syringe,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import CoachTip from './ui/CoachTip'
import Term from './ui/Term'
import BodyMap from './BodyMap'
import {
  SITE_BY_ID, suggestSite, daysSince, sitesForRoute, regionsForRoute,
  sitesInRegionGroup, daysWords, restedWords, lastShot, suggestionReason,
} from '../lib/sites'
import { formatDose, formatUnitsLong, isPremixed } from '../lib/calc'

// Opens when the user taps Log. Built for someone who has never injected: the
// recommendation is spelled out in body landmarks, the map is labelled, and
// every spot answers "when did I last use this?" in words rather than colour.
export default function SitePicker({ open, onClose, peptide, dose, unit, units }) {
  const doseLogs = useStore((s) => s.doseLogs)
  const logDose = useStore((s) => s.logDose)
  const t = todayStr()

  const route = peptide?.route === 'IM' ? 'IM' : 'SubQ'
  const sites = useMemo(() => sitesForRoute(route), [route])
  const groups = useMemo(() => regionsForRoute(route), [route])
  const suggestion = useMemo(() => suggestSite(doseLogs, t, route), [doseLogs, t, route])

  const [picked, setPicked] = useState(null)
  const [zoom, setZoom] = useState(null)   // region group being enlarged
  const [howTo, setHowTo] = useState(false)
  const [done, setDone] = useState(null)   // post-log confirmation

  // a spot picked for one peptide isn't on the other route's map
  useEffect(() => { setPicked(null); setZoom(null); setDone(null) }, [peptide?.id])
  useEffect(() => { if (open) { setPicked(null); setZoom(null); setDone(null) } }, [open])

  const chosen = picked || suggestion
  const chosenSite = SITE_BY_ID[chosen]
  const rested = daysSince(chosen, doseLogs, t)
  const last = useMemo(() => lastShot(doseLogs, t, route), [doseLogs, t, route])
  const reason = useMemo(() => suggestionReason(suggestion, doseLogs, t), [suggestion, doseLogs, t])

  const confirm = () => {
    const site = SITE_BY_ID[chosen]
    logDose(peptide.id, chosen)
    // work out where we'd send them next, from the logs that now include this shot
    const after = useStore.getState().doseLogs
    const next = SITE_BY_ID[suggestSite(after, t, route)]
    setDone({ label: site?.short || site?.label || chosen, next: next?.short || next?.label })
  }

  const close = () => { setPicked(null); setZoom(null); setDone(null); onClose() }

  if (!peptide) return <Modal open={open} onClose={close} title="Log" />

  // ---- post-log confirmation ----
  if (done) {
    return (
      <Modal open={open} onClose={close} title="Logged">
        <div className="space-y-3">
          <div className="rounded-2xl p-4 text-center"
            style={{ background: 'color-mix(in srgb, var(--lime) 16%, transparent)' }}>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: 'var(--lime)', color: '#0c1200' }}>
              <Check size={26} strokeWidth={3} />
            </motion.div>
            <p className="text-base font-black">Logged — {done.label}</p>
            <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              {formatDose(dose, unit)} · {formatUnitsLong(units)} · {peptide.name}
            </p>
          </div>
          {done.next && (
            <p className="px-1 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              Next time we'll steer you to <span className="font-black" style={{ color: 'var(--text)' }}>{done.next}</span> to keep rotating.
            </p>
          )}
          <button onClick={close} className="btn-primary w-full rounded-xl py-3 text-sm font-black">Done</button>
        </div>
      </Modal>
    )
  }

  const zoomSites = zoom ? sitesInRegionGroup(zoom, route) : sites

  return (
    <Modal open={open} onClose={close} title={`Where to inject ${peptide.name}`}>
      <div className="space-y-3">
        {/* what you're about to give */}
        <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface2)' }}>
          <p className="text-2xl font-black tracking-tight">
            {formatDose(dose, unit)}
            <span className="ml-2 text-base font-bold" style={{ color: 'var(--lime)' }}>{formatUnitsLong(units)}</span>
          </p>
          <p className="mt-0.5 text-[11px] font-bold" style={{ color: 'var(--muted)' }}>
            {route === 'IM'
              ? <>Into the muscle (<Term id="im">IM</Term>){isPremixed(peptide) ? ' · oil solution' : ''}</>
              : <>Into the fat under the skin (<Term id="subq">SubQ</Term>)</>}
          </p>
        </div>

        {/* oil/IM is a different routine to the SubQ insulin-syringe flow, and
            the reminder belongs here, at the moment of injecting */}
        {route === 'IM' && (
          <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--amber) 14%, transparent)' }}>
            <p className="text-[11px] font-black" style={{ color: 'var(--amber)' }}>
              Intramuscular{isPremixed(peptide) ? ' · oil solution' : ''} — not the SubQ insulin-syringe routine
            </p>
            <p className="mt-0.5 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
              ~23–25 g, 1–1.5" into the muscle. Oil draws and pushes slowly — take your time.
            </p>
          </div>
        )}

        <CoachTip id="site-map">
          New to this? Start with the green <span className="font-black">INJECT HERE</span> spot — it's the one
          furthest from your recent shots. Tap any other numbered spot to pick it instead.
        </CoachTip>

        {/* where and when, in plain words */}
        <div className="flex items-start gap-2 rounded-xl p-2.5" style={{ background: 'var(--surface2)' }}>
          <Clock size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
          <p className="text-xs font-bold leading-relaxed">
            {last
              ? <>Last shot: <span style={{ color: 'var(--text)' }}>{last.when}</span> — {last.label}.</>
              : <>No injections logged yet — this will be your first.</>}
          </p>
        </div>

        {/* the recommendation, spelled out */}
        {!picked && chosenSite && (
          <motion.div layout className="rounded-2xl p-3.5"
            style={{
              background: 'color-mix(in srgb, var(--lime) 14%, transparent)',
              border: '1.5px solid color-mix(in srgb, var(--lime) 45%, transparent)',
            }}>
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide" style={{ color: 'var(--lime)' }}>
              <Sparkles size={13} /> Inject here — spot {chosenSite.n}
            </p>
            <p className="mt-1 text-sm font-black">{chosenSite.short || chosenSite.label}</p>
            <p className="mt-0.5 text-xs font-semibold leading-relaxed" style={{ color: 'var(--muted)' }}>
              {chosenSite.plain}
            </p>
            <p className="mt-1.5 text-[11px] font-bold" style={{ color: 'var(--lime)' }}>{reason}</p>
          </motion.div>
        )}

        {/* region zoom controls */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold">
            <MapPin size={13} style={{ color: 'var(--lime)' }} />
            {zoom ? zoom.label : 'Tap a spot on the map, or zoom into an area'}
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {zoom ? (
              <button onClick={() => setZoom(null)}
                className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-black"
                style={{ background: 'var(--surface2)' }}>
                <ChevronLeft size={12} /> Whole body
              </button>
            ) : groups.map((g) => (
              <button key={g.id} onClick={() => setZoom(g)}
                className="rounded-full px-3 py-1.5 text-[11px] font-black"
                style={{ background: 'var(--surface2)' }}>
                {g.label}
              </button>
            ))}
          </div>

          <BodyMap
            doseLogs={doseLogs} today={t} selected={picked} suggestion={suggestion}
            onPick={setPicked} sites={zoomSites} view={zoom?.view} zoom={!!zoom}
          />
        </div>

        {/* numbered list — the map's spots as readable text */}
        <div className="space-y-1" data-testid="spot-list">
          {zoomSites.map((s) => {
            const d = daysSince(s.id, doseLogs, t)
            const isSel = (picked || suggestion) === s.id
            return (
              <button key={s.id} onClick={() => setPicked(s.id)}
                className="flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left"
                style={isSel
                  ? { background: 'color-mix(in srgb, var(--lime) 16%, transparent)', border: '1px solid color-mix(in srgb, var(--lime) 45%, transparent)' }
                  : { background: 'var(--surface2)', border: '1px solid transparent' }}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black"
                  style={{ background: isSel ? 'var(--lime)' : 'var(--surface-solid)', color: isSel ? '#0c1200' : 'var(--muted)' }}>
                  {s.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black">{s.short || s.label}</span>
                  <span className="block text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>{s.plain}</span>
                  <span className="mt-0.5 block text-[11px] font-bold"
                    style={{ color: d == null || d > 4 ? 'var(--lime)' : d <= 1 ? 'var(--coral)' : 'var(--amber)' }}>
                    {daysWords(d)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {/* how-to, at the moment of injecting */}
        <div className="rounded-xl" style={{ background: 'var(--surface2)' }}>
          <button onClick={() => setHowTo((v) => !v)}
            className="flex w-full items-center justify-between gap-2 p-3 text-left">
            <span className="flex items-center gap-1.5 text-xs font-black">
              <HelpCircle size={14} style={{ color: 'var(--indigo)' }} /> How do I inject here?
            </span>
            <motion.span animate={{ rotate: howTo ? 180 : 0 }}><ChevronDown size={15} style={{ color: 'var(--muted)' }} /></motion.span>
          </button>
          <AnimatePresence initial={false}>
            {howTo && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden">
                <ol className="space-y-1.5 px-3 pb-3 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {(route === 'IM' ? IM_STEPS : SUBQ_STEPS).map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-black" style={{ color: 'var(--indigo)' }}>{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* selection readout + confirm */}
        <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--lime) 12%, transparent)' }}>
          <p className="text-xs font-black">
            {picked ? 'You picked: ' : 'Suggested: '}{chosenSite?.short || chosenSite?.label}
          </p>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>{restedWords(rested)}</p>
        </div>

        <motion.button whileTap={{ scale: 0.97 }} onClick={confirm}
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-black">
          <Syringe size={18} strokeWidth={2.5} /> Log here — {chosenSite?.short || chosenSite?.label}
        </motion.button>
      </div>
    </Modal>
  )
}

const SUBQ_STEPS = [
  'Wash your hands. Wipe the vial top and the skin with an alcohol swab and let it dry.',
  'Draw your dose to the unit mark on the syringe. Flick out any big air bubbles.',
  'Pinch a fold of skin at the spot and hold it.',
  'Push the needle all the way in at 45–90° — quick and steady, not slow.',
  'Press the plunger down at an even pace, then count to three before pulling out.',
  'Let go of the pinch. Light pressure with a clean cotton pad if it beads. Needle straight into the sharps bin.',
]

const IM_STEPS = [
  'Wash your hands. Wipe the vial top and the skin with an alcohol swab and let it dry.',
  'Draw the oil with a wider needle, then swap to a fresh injecting needle.',
  'Relax the muscle completely — standing with weight off that leg helps.',
  'Push the needle in at 90°, straight through the skin into the muscle.',
  'Press the plunger slowly — oil takes longer than water. Count to five.',
  'Withdraw, press with a clean cotton pad, and put the needle straight into the sharps bin.',
]
