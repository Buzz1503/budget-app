import { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus, ChevronDown, Trash2, Search, Check, AlertTriangle, Zap, Pause, ChevronUp, SlidersHorizontal } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { currentRung, cycleInfo, stepUpDue, nextStepUpDate } from '../lib/schedule'
import { ZONES, ZONE_BY_ID, zoneOf } from '../lib/sites'
import {
  formatDose, formatUnitsLong, round, isPremixed, concentrationOf, premixedVialMg, unitsFor,
  isNasal, NASAL_RECIPE, nasalStrength,
} from '../lib/calc'
import { WEEKDAYS, weekdayPickCount, scheduledWeekdaySet, slotOf, needsProtocolSetup } from '../lib/daily'
import { loadMatrix, compoundColor } from '../lib/mixMatrix'
import { referenceFor, protocolTextFrom, referenceAttachment, isExcludedTier } from '../lib/reference'
import ReferenceInfo, { TierBadge } from './ReferenceInfo'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import Term from './ui/Term'
import { NasalRecipe } from './SitePicker'

const FREQ_LABELS = {
  daily: 'Daily', nightly: 'Nightly', weekly: 'Weekly', '2xweek': '2×/week', '3xweek': '3×/week', '5on2off': '5 on / 2 off',
}

const ROUTES = [
  ['SubQ', 'Subcutaneous (injected)'],
  ['IM', 'Intramuscular (injected)'],
]
// Only offered on compounds flagged intranasal-capable — the same prep and
// strength applies to all of them.
const NASAL_ROUTE = ['Nasal', 'Intranasal (spray)']

const isNasalRoute = isNasal

function routesFor(p) {
  return p?.intranasalCapable ? [...ROUTES, NASAL_ROUTE] : ROUTES
}

// The ladder is counted in sprays for a nasal peptide, mcg/mg otherwise.
function unitLabel(unit) {
  return unit === 'spray' ? 'sprays' : unit
}

// Route-specific needle guidance. Oil is a different routine to the SubQ
// insulin-syringe peptide flow and says so wherever it appears.
export function needleHint(p) {
  if (p.route === 'Nasal') {
    return 'No needle — one actuation of the nasal spray per "spray". Blow your nose first, aim slightly outward toward the same-side ear, and sniff gently.'
  }
  const oil = p.vehicle === 'oil'
  if (p.route === 'IM') {
    return oil
      ? '~23–25 g, 1–1.5" IM (glute / delt / quad). Oil is viscous — draw with a wider needle, swap to a fresh one to inject, and push slowly. Not the SubQ insulin-syringe routine.'
      : '~23–25 g, 1–1.5" into muscle (glute / delt / quad).'
  }
  return oil
    ? 'SubQ TRT: ~27–29 g, 1/2". Still oil — slower to draw and push than an aqueous peptide, and never co-drawn with one.'
    : 'U-100 insulin syringe, 29–31 g, 4–8 mm SubQ. Pinch, 45–90°, inject slowly.'
}

function cycleLabel(p) {
  if (!p.cycleOnDays || !p.cycleOffDays) return 'Ongoing'
  const f = (d) => (d % 7 === 0 ? `${d / 7} wk` : `${d} d`)
  return `${f(p.cycleOnDays)} on / ${f(p.cycleOffDays)} off`
}

export default function Library() {
  const peptides = useStore((s) => s.peptides)
  const [adding, setAdding] = useState(false)
  const [expandId, setExpandId] = useState(null)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Library</h1>
        <motion.button whileTap={{ scale: 0.92 }} onClick={() => setAdding(true)}
          className="btn-violet flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-bold">
          <Plus size={16} /> Add
        </motion.button>
      </div>
      {peptides.map((p, i) => (
        <PeptideCard key={p.id} peptide={p} index={i}
          defaultOpen={expandId === p.id} onOpened={() => setExpandId(null)} />
      ))}
      <AddPeptideModal open={adding} onClose={() => setAdding(false)} onAdded={setExpandId} />
    </div>
  )
}

function PeptideCard({ peptide: p, index, defaultOpen, onOpened }) {
  const titration = useStore((s) => s.titration)
  const [open, setOpen] = useState(false)
  const cardRef = useRef(null)
  const { dose, level, maxLevel } = currentRung(p, titration[p.id])
  const setupNeeded = needsProtocolSetup(p)

  // A freshly added peptide opens straight to its protocol fields and scrolls
  // into view (new entries append to the bottom of a long list). Guarded by a
  // ref and left uncancelled: clearing expandId re-renders this card, and a
  // dep-tied cleanup would cancel the scroll before it ever ran.
  const handledRef = useRef(false)
  useEffect(() => {
    if (!defaultOpen || handledRef.current) return
    handledRef.current = true
    setOpen(true)
    // let the card mount + its entrance animation start before scrolling
    setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      onOpened?.()
    }, 260)
  }, [defaultOpen, onOpened])

  return (
    <motion.div ref={cardRef} layout className="card overflow-hidden"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: index * 0.03 }}>
      <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold">{p.name}</h3>
            {setupNeeded ? (
              <span className="chip" style={{ color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 18%, transparent)' }}>
                <AlertTriangle size={11} /> Set your protocol
              </span>
            ) : (
              <span className="chip" style={{ color: 'var(--violet)' }}>
                {maxLevel === 0 ? 'Fixed dose' : `Lvl ${level + 1}/${maxLevel + 1}`}
              </span>
            )}
          </div>
          {setupNeeded ? (
            <p className="mt-1 text-sm font-medium" style={{ color: 'var(--muted)' }}>
              Tap to set dose, frequency, cycle and reconstitution.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold">
                {formatDose(dose, p.ladder.unit)}
                <span className="font-medium" style={{ color: 'var(--muted)' }}>
                  {' '}· {FREQ_LABELS[p.frequency] || p.frequency}{p.timing ? ` · ${p.timing}` : ''} · {p.route}
                </span>
              </p>
              <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{cycleLabel(p)}</p>
            </>
          )}
          {(p.compoundClass || p.charge || p.reference) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {p.reference?.tier && <TierBadge tier={p.reference.tier} confidence={p.reference.confidence} compact />}
              {p.compoundClass && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{p.compoundClass}</span>}
              {p.charge && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{p.charge}</span>}
              {(p.flags || []).slice(0, 1).map((f) => (
                <span key={f} className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{f}</span>
              ))}
            </div>
          )}
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={18} style={{ color: 'var(--muted)' }} /></motion.div>
      </button>
      {open && <PeptideEditor peptide={p} />}
    </motion.div>
  )
}

function ScheduleConfig({ peptide: p, onPatch }) {
  const pickCount = weekdayPickCount(p.frequency)
  const days = scheduledWeekdaySet(p)
  const slot = slotOf(p)

  const toggleDay = (d) => {
    const cur = new Set(days)
    if (cur.has(d)) cur.delete(d)
    else {
      if (pickCount === 1) { cur.clear() } // weekly = single day
      else if (cur.size >= pickCount) return // cap for N×week / 5-2
      cur.add(d)
    }
    onPatch({ scheduleWeekdays: [...cur].sort((a, b) => a - b) })
  }

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--amber)' }}>Daily schedule</p>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold">Inject in the</span>
        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--surface-solid)' }}>
          {['AM', 'PM'].map((s) => (
            <button key={s} onClick={() => onPatch({ slot: s })}
              className="rounded-md px-3 py-1 text-xs font-black"
              style={slot === s
                ? { backgroundImage: s === 'AM' ? 'linear-gradient(135deg, var(--amber), #ff8a1a)' : 'linear-gradient(135deg, var(--indigo), var(--violet))', color: '#fff' }
                : { color: 'var(--muted)' }}>
              {s}
            </button>
          ))}
        </div>
      </div>
      {pickCount > 0 ? (
        <>
          <p className="mb-1.5 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
            {pickCount === 1 ? 'Which day each week?' : `Pick ${pickCount} day${pickCount > 1 ? 's' : ''}`}
          </p>
          <div className="flex gap-1">
            {WEEKDAYS.map((label, d) => {
              const on = days.has(d)
              return (
                <button key={d} onClick={() => toggleDay(d)}
                  className="flex-1 rounded-lg py-1.5 text-[10px] font-black"
                  style={on
                    ? { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200' }
                    : { background: 'var(--surface-solid)', color: 'var(--muted)' }}>
                  {label[0]}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <p className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>Every day (daily frequency).</p>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  )
}

function Num({ value, onChange, step = 'any', min = 0, integer = false }) {
  return <NumberField value={value} onChange={(v) => onChange(v ?? 0)} step={step} min={min} integer={integer} />
}

export function PeptideEditor({ peptide: p }) {
  const updatePeptide = useStore((s) => s.updatePeptide)
  const updateLadder = useStore((s) => s.updateLadder)
  const updateRecon = useStore((s) => s.updateRecon)
  const removePeptide = useStore((s) => s.removePeptide)
  const setRoute = useStore((s) => s.setRoute)
  const titration = useStore((s) => s.titration)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const currentDose = currentRung(p, titration[p.id]).dose

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="overflow-hidden">
      <div className="space-y-3 border-t p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className="input" value={p.name} onChange={(e) => updatePeptide(p.id, { name: e.target.value })} />
          </Field>
          <Field label="Timing">
            <input className="input" value={p.timing} onChange={(e) => updatePeptide(p.id, { timing: e.target.value })} />
          </Field>
          <Field label="Frequency">
            <select className="input" value={p.frequency} onChange={(e) => updatePeptide(p.id, { frequency: e.target.value })}>
              {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Start date">
            <input type="date" className="input" value={p.startDate} onChange={(e) => e.target.value && updatePeptide(p.id, { startDate: e.target.value })} />
          </Field>
          <Field label="Route">
            <select className="input" value={['IM', 'Nasal'].includes(p.route) ? p.route : 'SubQ'}
              onChange={(e) => setRoute(p.id, e.target.value)}>
              {routesFor(p).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {/* Only meaningful on the SubQ map — the IM pool has no belly sites
              to keep a reaction-prone compound away from. */}
          {p.route !== 'IM' && p.route !== 'Nasal' && (
            <Field label="Allowed injection zone">
              <select className="input" aria-label="Allowed injection zone"
                value={zoneOf(p)}
                onChange={(e) => updatePeptide(p.id, { allowedZone: e.target.value })}>
                {ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
              </select>
              <span className="mt-1 block text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
                {ZONE_BY_ID[zoneOf(p)]?.hint}
              </span>
            </Field>
          )}
          <Field label="Preparation">
            <select className="input" value={isPremixed(p) ? 'premixed' : 'reconstituted'}
              onChange={(e) => updatePeptide(p.id, { preparation: e.target.value === 'premixed' ? 'premixed' : 'reconstituted' })}>
              <option value="reconstituted">Powder + BAC water</option>
              <option value="premixed">Pre-mixed solution</option>
            </select>
          </Field>
          <Field label="Cycle on (days, 0 = ongoing)">
            <Num value={p.cycleOnDays} step="1" integer onChange={(v) => updatePeptide(p.id, { cycleOnDays: v })} />
          </Field>
          <Field label="Cycle off (days)">
            <Num value={p.cycleOffDays} step="1" integer onChange={(v) => updatePeptide(p.id, { cycleOffDays: v })} />
          </Field>
        </div>

        <ScheduleConfig peptide={p} onPatch={(patch) => updatePeptide(p.id, patch)} />

        {/* TX: dosing is deliberately withheld — show the reason in place of a dose */}
        {isExcludedTier(p.reference?.tier) && (
          <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--rose) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--rose) 45%, transparent)' }}>
            <p className="flex items-center gap-1.5 text-xs font-black" style={{ color: 'var(--rose)' }}>
              <AlertTriangle size={14} /> No dosing provided for this compound
            </p>
            <ul className="mt-1.5 space-y-1">
              {(p.reference.safety || []).map((s, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                  <span style={{ color: 'var(--rose)' }}>•</span><span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* descriptive protocol seeded from the reference — free text, editable */}
        <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--indigo)' }}>
            Protocol notes {p.reference && !isExcludedTier(p.reference.tier) ? '· seeded from reference' : ''}
          </p>
          <div className="space-y-2">
            <Field label="Suggested dose">
              <textarea className="input min-h-[52px] leading-relaxed" value={p.doseText || ''} placeholder="e.g. 200–500 mcg per day"
                onChange={(e) => updatePeptide(p.id, { doseText: e.target.value })} />
            </Field>
            <Field label="Suggested frequency">
              <textarea className="input min-h-[40px] leading-relaxed" value={p.frequencyText || ''}
                onChange={(e) => updatePeptide(p.id, { frequencyText: e.target.value })} />
            </Field>
            <Field label="Suggested cycle">
              <textarea className="input min-h-[40px] leading-relaxed" value={p.cycleText || ''}
                onChange={(e) => updatePeptide(p.id, { cycleText: e.target.value })} />
            </Field>
          </div>
          <p className="mt-2 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
            Text guidance only. Set the numbers you'll actually inject in the ladder and reconstitution below.
          </p>
        </div>

        {p.reference && (
          <details className="rounded-xl p-3" open={isExcludedTier(p.reference.tier)} style={{ background: 'var(--surface2)' }}>
            <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
              Reference · evidence, effects, safety
            </summary>
            <div className="mt-3"><ReferenceInfo reference={p.reference} /></div>
          </details>
        )}

        <p className="flex items-center gap-1.5 pt-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
          <Term id="titration">Titration</Term> ladder
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Floor (${unitLabel(p.ladder.unit)})`}><Num value={p.ladder.floor} onChange={(v) => updateLadder(p.id, { floor: v })} /></Field>
          <Field label={`Step (${unitLabel(p.ladder.unit)})`}><Num value={p.ladder.step} onChange={(v) => updateLadder(p.id, { step: v })} /></Field>
          <Field label="Interval (weeks)"><Num value={p.ladder.intervalWeeks} step="1" min={1} integer onChange={(v) => updateLadder(p.id, { intervalWeeks: Math.max(1, v) })} /></Field>
          <Field label={`Ceiling (${unitLabel(p.ladder.unit)})`}><Num value={p.ladder.ceiling} onChange={(v) => updateLadder(p.id, { ceiling: v })} /></Field>
          <Field label="Unit">
            <select className="input" value={p.ladder.unit} onChange={(e) => updateLadder(p.id, { unit: e.target.value })}
              disabled={isNasalRoute(p)}>
              {isNasalRoute(p)
                ? <option value="spray">sprays</option>
                : <><option value="mcg">mcg</option><option value="mg">mg</option></>}
            </select>
          </Field>
        </div>

        <LadderClimb peptide={p} />

        {isNasalRoute(p) ? (
          <>
            <p className="pt-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--indigo)' }}>
              Nasal spray prep
            </p>
            <div className="rounded-xl" style={{ background: 'var(--surface2)' }}>
              <div className="px-3 pt-3">
                <p className="text-[11px] font-bold">
                  Dosed in sprays — {formatDose(currentDose, p.ladder.unit)} at the current rung.
                </p>
              </div>
              <NasalRecipe recipe={p.nasal || NASAL_RECIPE} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Vial (mg)"><Num value={p.recon.vialMg} onChange={(v) => updateRecon(p.id, { vialMg: v })} /></Field>
              <Field label="BAC water (mL)"><Num value={p.recon.bacMl} onChange={(v) => updateRecon(p.id, { bacMl: v })} /></Field>
              <Field label="Expiry (days)"><Num value={p.recon.expiryDays} step="1" integer onChange={(v) => updateRecon(p.id, { expiryDays: v })} /></Field>
            </div>
            <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
              One bottle is about {nasalStrength(p.nasal || NASAL_RECIPE).spraysPerBottle} sprays; stock counts down as you log.
            </p>
          </>
        ) : isPremixed(p) ? (
          <>
            <p className="pt-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--lime)' }}>
              Pre-mixed solution
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Conc. (mg/mL)">
                <Num value={concentrationOf(p)} onChange={(v) => updateRecon(p.id, {
                  vialMg: premixedVialMg(v, p.recon.bacMl), // keep vial size, restate its total
                })} />
              </Field>
              <Field label="Vial size (mL)">
                <Num value={p.recon.bacMl} onChange={(v) => updateRecon(p.id, {
                  bacMl: v, vialMg: premixedVialMg(concentrationOf(p), v),
                })} />
              </Field>
              <Field label="Expiry (days, 0 = none)">
                <Num value={p.recon.expiryDays} step="1" integer onChange={(v) => updateRecon(p.id, { expiryDays: v })} />
              </Field>
            </div>
            <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
              Already in solution — nothing to reconstitute. {formatDose(currentDose, p.ladder.unit)} ÷ {round(concentrationOf(p), 3)} mg/mL
              = <span className="font-bold" style={{ color: 'var(--lime)' }}>{round(unitsFor(p, currentDose) / 100, 3)} mL · {formatUnitsLong(unitsFor(p, currentDose))}</span> on a U-100 syringe.
            </p>
          </>
        ) : (
          <>
            <p className="pt-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--lime)' }}>Reconstitution</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Vial (mg)"><Num value={p.recon.vialMg} onChange={(v) => updateRecon(p.id, { vialMg: v })} /></Field>
              <Field label="BAC water (mL)"><Num value={p.recon.bacMl} onChange={(v) => updateRecon(p.id, { bacMl: v })} /></Field>
              <Field label="Expiry (days)"><Num value={p.recon.expiryDays} step="1" integer onChange={(v) => updateRecon(p.id, { expiryDays: v })} /></Field>
            </div>
          </>
        )}

        {/* route + needle, and the co-draw exclusion where it applies */}
        <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--coral)' }}>
            Needle & route · {p.route === 'IM' ? 'intramuscular' : 'subcutaneous'}
          </p>
          <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>{needleHint(p)}</p>
          {p.alwaysSeparate && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] font-bold" style={{ color: 'var(--rose)' }}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>Never co-drawn: excluded from “log together” and always “inject separately” in Mix.</span>
            </p>
          )}
        </div>

        {confirmDelete ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold" style={{ color: 'var(--coral)' }}>Delete {p.name} and all its logs?</span>
            <button className="rounded-lg px-3 py-1.5 font-bold" style={{ background: 'var(--coral)', color: '#fff' }}
              onClick={() => removePeptide(p.id)}>Delete</button>
            <button className="rounded-lg px-3 py-1.5 font-bold" style={{ background: 'var(--surface2)' }}
              onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        ) : (
          <button className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--coral)' }} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={13} /> Remove peptide
          </button>
        )}
      </div>
    </motion.div>
  )
}

/**
 * Where this peptide currently sits on its ladder, and the only controls that
 * move it. This used to be a separate Plan screen; the Calendar is the timeline
 * now, so the climb lives next to the ladder it climbs.
 */
function LadderClimb({ peptide: p }) {
  const titration = useStore((s) => s.titration)
  const confirmStepUp = useStore((s) => s.confirmStepUp)
  const holdStepUp = useStore((s) => s.holdStepUp)
  const setRungLevel = useStore((s) => s.setRungLevel)
  const [showOverride, setShowOverride] = useState(false)

  const t = todayStr()
  const tState = titration[p.id] || { level: 0, levelStartDate: p.startDate }
  const { dose, level, maxLevel, rungs } = currentRung(p, tState)
  const due = stepUpDue(p, tState, t)
  const nextDate = nextStepUpDate(p, tState)

  if (!(p.ladder?.ceiling > 0)) return null

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
        Where you are on the ladder
      </p>
      <p className="text-xl font-black tracking-tight" style={{ color: 'var(--lime)' }}>
        {formatDose(dose, p.ladder.unit)}
      </p>
      <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
        {maxLevel === 0 ? 'Fixed dose — no titration' : `Level ${level + 1} of ${maxLevel + 1}`}
        {maxLevel > 0 && level < maxLevel && nextDate && ` · next step-up ${format(parseISO(nextDate), 'd MMM')}`}
        {maxLevel > 0 && level === maxLevel && ' · at ceiling 🏔️'}
      </p>

      {maxLevel > 0 && (
        <>
          <div className="mt-3 flex items-end gap-1.5">
            {rungs.map((r, i) => (
              <motion.button key={i} onClick={() => setRungLevel(p.id, i)} whileTap={{ scale: 0.9 }}
                className="flex-1 rounded-t-md" initial={false}
                aria-label={`Set level ${i + 1}: ${formatDose(r, p.ladder.unit)}`}
                animate={{ height: 14 + (i / Math.max(1, rungs.length - 1)) * 30 }}
                style={{
                  background: i <= level ? 'linear-gradient(180deg, var(--violet), var(--indigo))' : 'var(--surface-solid)',
                  opacity: i <= level ? 1 : 0.7,
                }}
                title={`Set level ${i + 1}: ${formatDose(r, p.ladder.unit)}`} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-bold" style={{ color: 'var(--muted)' }}>
            <span>{formatDose(rungs[0], p.ladder.unit)}</span>
            <span>tap a rung to hand-set</span>
            <span>{formatDose(rungs[maxLevel], p.ladder.unit)}</span>
          </div>
        </>
      )}

      {due && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="mt-3 rounded-xl p-3"
          style={{ background: 'var(--surface-solid)', border: '1px solid color-mix(in srgb, var(--violet) 45%, transparent)' }}>
          <p className="flex items-center gap-1.5 text-xs font-black">
            <Zap size={14} style={{ color: 'var(--violet)' }} />
            Tolerating well — advance to {formatDose(rungs[level + 1], p.ladder.unit)}?
          </p>
          <p className="mt-1 text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
            You've held {formatDose(dose, p.ladder.unit)} for {p.ladder.intervalWeeks} week{p.ladder.intervalWeeks > 1 ? 's' : ''}.
            Declining holds the dose and asks again next interval.
          </p>
          <div className="mt-2 flex gap-2">
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => confirmStepUp(p.id)}
              className="btn-violet flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-black">
              <ChevronUp size={14} /> Advance — Lvl {level + 2}
            </motion.button>
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => holdStepUp(p.id)}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-black"
              style={{ background: 'var(--surface2)' }}>
              <Pause size={13} /> Hold dose
            </motion.button>
          </div>
        </motion.div>
      )}

      {maxLevel > 0 && (
        <>
          <button className="mt-2.5 flex w-full items-center justify-between text-xs font-bold"
            onClick={() => setShowOverride(!showOverride)}>
            <span className="flex items-center gap-1.5"><SlidersHorizontal size={13} style={{ color: 'var(--amber)' }} /> Per-step override</span>
            <span className="font-semibold" style={{ color: 'var(--muted)' }}>{showOverride ? 'hide' : 'show'}</span>
          </button>
          {showOverride && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 grid grid-cols-2 gap-2">
              <button className="rounded-xl px-2 py-2 text-[11px] font-bold disabled:opacity-40"
                style={{ background: 'var(--surface-solid)' }} disabled={level >= maxLevel}
                onClick={() => confirmStepUp(p.id)}>
                Advance early → {level < maxLevel ? formatDose(rungs[level + 1], p.ladder.unit) : '—'}
              </button>
              <button className="rounded-xl px-2 py-2 text-[11px] font-bold disabled:opacity-40"
                style={{ background: 'var(--surface-solid)' }} disabled={level >= maxLevel}
                onClick={() => setRungLevel(p.id, Math.min(level + 2, maxLevel))}>
                Skip a rung → {formatDose(rungs[Math.min(level + 2, maxLevel)], p.ladder.unit)}
              </button>
              <button className="rounded-xl px-2 py-2 text-[11px] font-bold"
                style={{ background: 'var(--surface-solid)' }} onClick={() => holdStepUp(p.id)}>
                Hold — restart interval
              </button>
              <button className="rounded-xl px-2 py-2 text-[11px] font-bold disabled:opacity-40"
                style={{ background: 'var(--surface-solid)' }} disabled={level === 0}
                onClick={() => setRungLevel(p.id, level - 1)}>
                Step back down
              </button>
              <p className="col-span-2 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
                Any override re-anchors the interval to today and regenerates the downstream schedule.
                The Calendar picks the change up straight away.
              </p>
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}

// Blank protocol — the matrix has no dosing data, so we never invent values.
// The 2 mL reconstitution default deliberately does NOT apply here: this is the
// "nothing is known about this compound" path, and a BAC volume beside a vial
// size of zero would be a fabricated number dressed as a suggestion.
const BLANK_PROTOCOL = {
  frequency: 'daily', timing: '', cycleOnDays: 0, cycleOffDays: 0,
  ladder: { floor: 0, step: 0, intervalWeeks: 1, ceiling: 0, unit: 'mcg' },
  recon: { vialMg: 0, bacMl: 0, expiryDays: 28 },
}

function AddPeptideModal({ open, onClose, onAdded }) {
  const peptides = useStore((s) => s.peptides)
  const addPeptide = useStore((s) => s.addPeptide)
  const [mode, setMode] = useState('list')
  const [matrix, setMatrix] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [customName, setCustomName] = useState('')

  // lazy-load the compound matrix only when the picker opens
  useEffect(() => {
    if (!open || matrix) return
    let alive = true
    loadMatrix().then((m) => alive && setMatrix(m)).catch(() => alive && setLoadFailed(true))
    return () => { alive = false }
  }, [open, matrix])

  const existingIds = useMemo(() => new Set(peptides.map((p) => p.id)), [peptides])
  const existingNames = useMemo(
    () => new Set(peptides.map((p) => p.name.trim().toLowerCase())), [peptides]
  )

  const results = useMemo(() => {
    if (!matrix) return []
    const q = query.trim().toLowerCase()
    if (!q) return matrix.compounds
    return matrix.compounds.filter(
      (c) => c.name.toLowerCase().includes(q) || c.class.toLowerCase().includes(q) || c.id.includes(q)
    )
  }, [matrix, query])

  const refFor = referenceFor // evidence tier for a picker row

  const addFromCompound = (c) => {
    if (existingIds.has(c.id)) return
    // keeping the compound id as the peptide id wires Mix + co-draw automatically
    const id = addPeptide({
      ...BLANK_PROTOCOL,
      id: c.id, name: c.name,
      compoundClass: c.class, charge: c.charge, flags: c.flags || [],
    })
    if (id) { setQuery(''); onClose(); onAdded?.(id) }
  }

  const addCustom = () => {
    const name = customName.trim()
    if (!name || existingNames.has(name.toLowerCase())) return
    const id = addPeptide({ ...BLANK_PROTOCOL, name })
    if (id) { setCustomName(''); onClose(); onAdded?.(id) }
  }

  const customDupe = customName.trim() && existingNames.has(customName.trim().toLowerCase())

  return (
    <Modal open={open} onClose={onClose} title="Add peptide" wide>
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {[['list', 'From list'], ['custom', 'Custom']].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className="flex-1 rounded-lg py-1.5 text-xs font-black"
              style={mode === m
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'list' ? (
          <>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
              <input className="input !pl-9" autoFocus placeholder={`Search ${matrix ? matrix.compounds.length : 86} compounds…`}
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>

            {loadFailed ? (
              <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--amber)' }}>
                Couldn't load the compound list — use Custom to add by name.
              </p>
            ) : !matrix ? (
              <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>Loading compounds…</p>
            ) : (
              <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-0.5">
                {results.map((c) => {
                  const added = existingIds.has(c.id)
                  return (
                    <button key={c.id} onClick={() => addFromCompound(c)} disabled={added}
                      className="flex w-full items-center gap-2 rounded-xl p-2.5 text-left"
                      style={{ background: 'var(--surface2)', opacity: added ? 0.55 : 1 }}>
                      <span className="h-6 w-6 shrink-0 rounded-full" style={{ background: compoundColor(c) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{c.name}</span>
                        <span className="flex flex-wrap items-center gap-1 pt-0.5">
                          {refFor(c.id) && <TierBadge tier={refFor(c.id).tier} confidence={refFor(c.id).confidence} compact />}
                          <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>{c.class}</span>
                          {(c.flags || []).slice(0, 1).map((f) => (
                            <span key={f} className="rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>{f}</span>
                          ))}
                        </span>
                        {isExcludedTier(refFor(c.id)?.tier) && (
                          <span className="mt-0.5 block text-[9px] font-bold" style={{ color: 'var(--rose)' }}>
                            No dosing provided — safety exclusion
                          </span>
                        )}
                      </span>
                      {added ? (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] font-black" style={{ color: 'var(--lime)' }}>
                          <Check size={13} /> Added
                        </span>
                      ) : (
                        <Plus size={16} className="shrink-0" style={{ color: 'var(--violet)' }} />
                      )}
                    </button>
                  )
                })}
                {results.length === 0 && (
                  <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    No compound matches “{query}”. Use Custom to add it by name.
                  </p>
                )}
              </div>
            )}
            <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
              Picking from the list links the compound to the Mix tab and co-draw checks automatically. You'll set your own dose, frequency and cycle next — the list carries no dosing data.
            </p>
          </>
        ) : (
          <>
            <Field label="Name">
              <input className="input" value={customName} autoFocus placeholder="e.g. My blend"
                onChange={(e) => setCustomName(e.target.value)} />
            </Field>
            {customDupe && (
              <p className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>That name is already in your Library.</p>
            )}
            <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
              A custom peptide isn't in the chemistry matrix, so the Mix tab will show “no data” for it. You'll set your protocol next.
            </p>
            <button className="btn-primary w-full rounded-xl py-2.5 text-sm font-extrabold disabled:opacity-40"
              disabled={!customName.trim() || !!customDupe} onClick={addCustom}>
              Add to stack
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
