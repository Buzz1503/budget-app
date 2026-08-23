import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, ChevronDown, Clock, HelpCircle, Syringe, Wind,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import CoachTip from './ui/CoachTip'
import Term from './ui/Term'
import SiteChooser from './SiteChooser'
import { SITE_BY_ID, lastShot, zoneOf } from '../lib/sites'
import { nextOnPath, suggestBest } from '../lib/rotation'
import {
  formatDose, formatUnitsLong, isPremixed, isNasal, fromMg, nasalStrength, NASAL_RECIPE, round,
} from '../lib/calc'

// Opens when the user taps Log. Built for someone who has never injected: the
// recommendation is spelled out in body landmarks, the map is labelled, and
// every spot answers "when did I last use this?" in words rather than colour.
export default function SitePicker({ open, onClose, peptide, dose, unit, units }) {
  const doseLogs = useStore((s) => s.doseLogs)
  const reactions = useStore((s) => s.siteReactions)
  const mode = useStore((s) => s.rotation?.mode || 'suggest')
  const logDose = useStore((s) => s.logDose)
  const openVial = useStore((s) => s.openVials?.[peptide?.id])
  const t = todayStr()

  const route = peptide?.route === 'IM' ? 'IM' : 'SubQ'
  const zone = zoneOf(peptide)

  const [picked, setPicked] = useState(null)
  const [resolved, setResolved] = useState(null)
  const [howTo, setHowTo] = useState(false)
  const [done, setDone] = useState(null)   // post-log confirmation

  // a spot picked for one peptide isn't on the other route's map
  useEffect(() => { setPicked(null); setDone(null) }, [peptide?.id])
  useEffect(() => { if (open) { setPicked(null); setDone(null) } }, [open])

  const chosen = picked || resolved
  const chosenSite = SITE_BY_ID[chosen]
  const last = useMemo(() => lastShot(doseLogs, t, route), [doseLogs, t, route])

  const confirmNasal = () => {
    logDose(peptide.id, null)
    setDone({ label: `${formatDose(dose, unit)}`, nasal: true })
  }

  const confirm = () => {
    const site = SITE_BY_ID[chosen]
    logDose(peptide.id, chosen)
    // where we'd send them next, from the logs that now include this shot
    const after = useStore.getState()
    const ctx = { doseLogs: after.doseLogs, reactions: after.siteReactions, todayStr: t, route }
    const nextId = mode === 'path' ? nextOnPath(ctx).siteId : suggestBest(ctx)
    const next = SITE_BY_ID[nextId]
    setDone({ label: site?.short || site?.label || chosen, next: next?.short || next?.label })
  }

  const close = () => { setPicked(null); setDone(null); onClose() }

  if (!peptide) return <Modal open={open} onClose={close} title="Log" />

  // ---- post-log confirmation ----
  if (done) {
    return (
      <Modal open={open} onClose={close} title="Logged">
        <div className="space-y-3">
          <div className="rounded-[14px] p-4 text-center"
            style={{ background: 'color-mix(in srgb, var(--good) 16%, transparent)' }}>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              <Check size={26} strokeWidth={3} />
            </motion.div>
            <p className="text-base font-black">Logged — {done.label}</p>
            <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              {done.nasal
                ? `${peptide.name} · nasal spray`
                : `${formatDose(dose, unit)} · ${formatUnitsLong(units)} · ${peptide.name}`}
            </p>
          </div>
          {done.nasal && (
            <p className="px-1 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              Nothing to rotate — sprays alternate nostrils, not injection sites.
            </p>
          )}
          {done.next && (
            <p className="px-1 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              Next time we'll steer you to <span className="font-black" style={{ color: 'var(--text)' }}>{done.next}</span> to keep rotating.
            </p>
          )}
          <button onClick={close} className="btn-primary w-full rounded-full py-3 text-sm font-black">Done</button>
        </div>
      </Modal>
    )
  }

  // ---- nasal: no site, no syringe, no map ----
  if (isNasal(peptide)) {
    const strength = nasalStrength(peptide.nasal || NASAL_RECIPE)
    const spraysLeft = openVial?.remainingMg > 0
      ? Math.floor(fromMg(openVial.remainingMg, 'spray'))
      : null
    return (
      <Modal open={open} onClose={close} title={`Take ${peptide.name}`}>
        <div className="space-y-3">
          <div className="rounded-[14px] p-4 text-center" style={{ background: 'var(--surface-sunk)' }}>
            <p className="text-2xl font-black tracking-tight">{formatDose(dose, unit)}</p>
            <p className="mt-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
              Nasal spray · {strength.mcgPerSpray} mcg per spray
            </p>
          </div>

          <CoachTip id="nasal-spray" tone="indigo">
            Blow your nose first. Aim the nozzle slightly outward, toward the same-side ear —
            not straight up — and sniff gently. Alternate nostrils if you're taking more than one spray.
          </CoachTip>

          {spraysLeft != null && (
            <p className="flex items-center gap-2 rounded-[14px] p-3 text-xs font-bold" style={{ background: 'var(--surface-sunk)' }}>
              <Wind size={13} className="shrink-0" style={{ color: 'var(--text-2)' }} />
              About {spraysLeft} spray{spraysLeft === 1 ? '' : 's'} left in the bottle.
            </p>
          )}

          <div className="rounded-[14px]" style={{ background: 'var(--surface-sunk)' }}>
            <button onClick={() => setHowTo((v) => !v)}
              className="flex w-full items-center justify-between gap-2 p-3 text-left">
              <span className="flex items-center gap-2 text-xs font-black">
                <HelpCircle size={14} style={{ color: 'var(--text-2)' }} /> How do I prepare the spray?
              </span>
              <motion.span animate={{ rotate: howTo ? 180 : 0 }}><ChevronDown size={15} style={{ color: 'var(--text-2)' }} /></motion.span>
            </button>
            <AnimatePresence initial={false}>
              {howTo && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden">
                  <NasalRecipe recipe={peptide.nasal || NASAL_RECIPE} strength={strength} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.button whileTap={{ scale: 0.97 }} onClick={confirmNasal}
            className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-black">
            <Wind size={18} strokeWidth={2.5} /> Log {formatDose(dose, unit)}
          </motion.button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={close} title={`Where to inject ${peptide.name}`}>
      <div className="space-y-3">
        {/* what you're about to give */}
        <div className="rounded-[14px] p-3 text-center" style={{ background: 'var(--surface-sunk)' }}>
          <p className="text-2xl font-black tracking-tight">
            {formatDose(dose, unit)}
            <span className="ml-2 text-base font-bold" style={{ color: 'var(--good)' }}>{formatUnitsLong(units)}</span>
          </p>
          <p className="mt-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
            {route === 'IM'
              ? <>Into the muscle (<Term id="im">IM</Term>){isPremixed(peptide) ? ' · oil solution' : ''}</>
              : <>Into the fat under the skin (<Term id="subq">SubQ</Term>)</>}
          </p>
        </div>

        {/* oil/IM is a different routine to the SubQ insulin-syringe flow, and
            the reminder belongs here, at the moment of injecting */}
        {route === 'IM' && (
          <div className="rounded-[14px] p-3" style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)' }}>
            <p className="text-xs font-black" style={{ color: 'var(--warn)' }}>
              Intramuscular{isPremixed(peptide) ? ' · oil solution' : ''} — not the SubQ insulin-syringe routine
            </p>
            <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
              ~23–25 g, 1–1.5" into the muscle. Oil draws and pushes slowly — take your time.
            </p>
          </div>
        )}

        <CoachTip id="site-map">
          New to this? Start with the green <span className="font-black">INJECT HERE</span> spot — it's the one
          furthest from your recent shots. Tap any other numbered spot to pick it instead.
        </CoachTip>

        {/* where and when, in plain words */}
        <div className="flex items-start gap-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
          <Clock size={14} className="mt-1 shrink-0" style={{ color: 'var(--text-2)' }} />
          <p className="text-xs font-bold leading-relaxed">
            {last
              ? <>Last shot: <span style={{ color: 'var(--text)' }}>{last.when}</span> — {last.label}.</>
              : <>No injections logged yet — this will be your first.</>}
          </p>
        </div>

        <SiteChooser route={route} zone={zone} picked={picked} onPick={setPicked} onResolve={setResolved} />

        {/* how-to, at the moment of injecting */}
        <div className="rounded-[14px]" style={{ background: 'var(--surface-sunk)' }}>
          <button onClick={() => setHowTo((v) => !v)}
            className="flex w-full items-center justify-between gap-2 p-3 text-left">
            <span className="flex items-center gap-2 text-xs font-black">
              <HelpCircle size={14} style={{ color: 'var(--text-2)' }} /> How do I inject here?
            </span>
            <motion.span animate={{ rotate: howTo ? 180 : 0 }}><ChevronDown size={15} style={{ color: 'var(--text-2)' }} /></motion.span>
          </button>
          <AnimatePresence initial={false}>
            {howTo && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden">
                <ol className="space-y-2 px-3 pb-3 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {(route === 'IM' ? IM_STEPS : SUBQ_STEPS).map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-black" style={{ color: 'var(--text-2)' }}>{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.button whileTap={{ scale: 0.97 }} onClick={confirm}
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-black">
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

// The prep, spelled out. Every number is derived from the recipe above it, so
// an edited vial or bottle size stays self-consistent.
export function NasalRecipe({ recipe = NASAL_RECIPE, strength = null }) {
  const s = strength || nasalStrength(recipe)
  const steps = [
    `Reconstitute a ${recipe.vialMg} mg vial with ${recipe.bacMl} mL bacteriostatic water.`,
    `Transfer the entire ${recipe.bacMl} mL (all ${recipe.vialMg} mg) into a nasal spray bottle.`,
    `Add ${recipe.salineMl} mL sterile saline → final volume ${s.bottleMl} mL.`,
  ]
  return (
    <div className="px-3 pb-3">
      <ol className="space-y-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {steps.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="font-black" style={{ color: 'var(--text-2)' }}>{i + 1}.</span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 rounded-[10px] p-2 text-xs font-bold leading-relaxed"
        style={{ background: 'color-mix(in srgb, var(--info) 14%, transparent)' }}>
        {recipe.vialMg} mg ÷ {s.bottleMl} mL = {round(s.mgPerMl, 3)} mg/mL ({s.mcgPerMl.toLocaleString()} mcg/mL).
        At {recipe.sprayMl} mL per spray that is{' '}
        <span style={{ color: 'var(--good)' }}>{s.mcgPerSpray} mcg per spray</span> — about {s.spraysPerBottle} sprays
        per bottle ({s.totalMcg.toLocaleString()} mcg total).
      </p>
      <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        1 spray = {s.mcgPerSpray} mcg · 2 = {s.mcgPerSpray * 2} mcg · 3 = {s.mcgPerSpray * 3} mcg. Editable — these are
        the defaults, not medical advice.
      </p>
    </div>
  )
}
