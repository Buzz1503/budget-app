import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Check, ChevronLeft, ChevronRight, AlertTriangle, Wand2, Wind, Syringe, Info,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import Term from './ui/Term'
import ReferenceInfo, { TierBadge } from './ReferenceInfo'
import { loadMatrix, compoundColor } from '../lib/mixMatrix'
import { wizardSuggestion, nasalDefaults } from '../lib/wizardDefaults'
import { testosteroneEnanthate, TEST_E_ID } from '../data/seed'
import { WEEKDAYS, weekdayPickCount, scheduledWeekdaySet } from '../lib/daily'
import {
  formatDose, concentration, doseToUnits, toMg, round, MCG_PER_SPRAY, convertLadderForRoute,
} from '../lib/calc'

const FREQ_LABELS = {
  daily: 'Daily', nightly: 'Nightly', weekly: 'Weekly',
  '2xweek': '2×/week', '3xweek': '3×/week', '5on2off': '5 on / 2 off',
}

const SOURCE_NOTE = {
  seed: 'Pre-filled from this app’s own starting protocol for this compound.',
  reference: 'Ladder built from the range stated in the reference below — floor at the low end, ceiling at the high end.',
  none: 'The reference gives no clear numeric range for this compound, so no dose has been invented. Set your own below.',
  excluded: 'Dosing is deliberately withheld for this compound. Read the safety notes and leave the dose blank.',
}

const ROUTE_LABEL = { SubQ: 'SubQ', IM: 'IM', Nasal: 'Nasal spray' }

export default function ScheduleWizard({ open, onClose }) {
  const peptides = useStore((s) => s.peptides)
  const applyWizard = useStore((s) => s.applyWizard)
  const t = todayStr()

  const [matrix, setMatrix] = useState(null)
  const [step, setStep] = useState('intro') // intro | pick | config | start | review | done
  const [idx, setIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState([])      // configured, in pick order
  const [startDate, setStartDate] = useState(t)
  const [startOver, setStartOver] = useState(false)

  useEffect(() => {
    if (!open || matrix) return
    let alive = true
    loadMatrix().then((m) => alive && setMatrix(m)).catch(() => alive && setMatrix(false))
    return () => { alive = false }
  }, [open, matrix])

  useEffect(() => {
    if (!open) return
    setStep('intro'); setIdx(0); setQuery(''); setEntries([]); setStartDate(t); setStartOver(false)
  }, [open, t])

  // every compound in the matrix, plus the oil injectable the app ships
  const catalogue = useMemo(() => {
    const te = testosteroneEnanthate(t)
    const extra = [{ id: TEST_E_ID, name: te.name, class: 'OIL' }]
    if (!matrix) return extra
    return [...matrix.compounds, ...extra].sort((a, b) => a.name.localeCompare(b.name))
  }, [matrix, t])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalogue
    return catalogue.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q) || (c.class || '').toLowerCase().includes(q))
  }, [catalogue, query])

  const picked = new Set(entries.map((e) => e.id))
  const toggle = (c) => {
    setEntries((prev) => prev.some((e) => e.id === c.id)
      ? prev.filter((e) => e.id !== c.id)
      : [...prev, { ...wizardSuggestion(c), stockVials: 0, costAud: 0 }])
  }

  const patch = (i, p) => setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, ...p } : e)))

  const current = entries[idx]
  const inStack = (id) => peptides.some((p) => p.id === id)

  const finish = () => {
    applyWizard(entries, { startOver, startDate })
    setStep('done')
  }

  const title = {
    intro: 'Build my schedule',
    pick: `Pick your compounds${entries.length ? ` · ${entries.length}` : ''}`,
    config: current ? `${current.name} · ${idx + 1} of ${entries.length}` : 'Set up',
    start: 'Start date',
    review: 'Review & confirm',
    done: 'Schedule built',
  }[step]

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <AnimatePresence mode="wait">
        <motion.div key={step + idx} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.15 }} className="space-y-3">

          {step === 'intro' && (
            <>
              <div className="rounded-2xl p-4" style={{ background: 'color-mix(in srgb, var(--violet) 14%, transparent)' }}>
                <p className="flex items-center gap-1.5 text-sm font-black" style={{ color: 'var(--violet)' }}>
                  <Wand2 size={16} /> A few minutes, and your whole stack is set up
                </p>
                <p className="mt-1.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                  Every field opens with a starting point already filled in, so you're never staring at a blank box.
                  Those are <span className="font-bold" style={{ color: 'var(--text)' }}>editable anecdotal starting points, not medical advice</span> —
                  you'll see the evidence tier and confidence next to each one, and where a number came from.
                </p>
              </div>
              <ul className="space-y-1.5 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                {[
                  'Pick your compounds from the full list.',
                  'Check the suggested dose, ladder and reconstitution — change anything.',
                  'Choose the route: SubQ, IM, or a nasal spray where it applies.',
                  'Set the days, the AM/PM slot and a start date.',
                  'Confirm, and Home, Plan, Library, Mix and Stock all fill in.',
                ].map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-black" style={{ color: 'var(--violet)' }}>{i + 1}.</span><span>{line}</span>
                  </li>
                ))}
              </ul>
              {peptides.length > 0 && (
                <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
                  <p className="text-[11px] font-bold">You already have {peptides.length} compounds set up.</p>
                  <p className="mt-0.5 text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                    Anything you add here is added alongside them; picking one you already have updates it.
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-[11px] font-bold" style={{ color: 'var(--coral)' }}>
                    <input type="checkbox" checked={startOver} onChange={(e) => setStartOver(e.target.checked)} className="mt-0.5" />
                    <span>
                      Start over — clear my current compounds and their stock first.
                      <span className="block font-medium" style={{ color: 'var(--muted)' }}>
                        Your logged history, measurements and photos are kept.
                      </span>
                    </span>
                  </label>
                </div>
              )}
              <button onClick={() => setStep('pick')} className="btn-primary w-full rounded-xl py-3 text-sm font-black">
                Start
              </button>
            </>
          )}

          {step === 'pick' && (
            <>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
                <input className="input !pl-9" autoFocus placeholder={`Search ${catalogue.length} compounds…`}
                  value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="max-h-[44vh] space-y-1.5 overflow-y-auto pr-0.5" data-testid="wizard-list">
                {results.map((c) => {
                  const on = picked.has(c.id)
                  const s = wizardSuggestion(c)
                  return (
                    <button key={c.id} onClick={() => toggle(c)}
                      className="flex w-full items-center gap-2 rounded-xl p-2.5 text-left"
                      style={on
                        ? { background: 'color-mix(in srgb, var(--lime) 16%, transparent)', border: '1px solid color-mix(in srgb, var(--lime) 45%, transparent)' }
                        : { background: 'var(--surface2)', border: '1px solid transparent' }}>
                      <span className="h-6 w-6 shrink-0 rounded-full" style={{ background: compoundColor(c) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{c.name}</span>
                        <span className="flex flex-wrap items-center gap-1 pt-0.5">
                          {s.tier && <TierBadge tier={s.tier} confidence={s.confidence} compact />}
                          {inStack(c.id) && (
                            <span className="rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: 'var(--surface-solid)', color: 'var(--indigo)' }}>in your stack</span>
                          )}
                          {s.source === 'none' && (
                            <span className="rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>no suggested dose</span>
                          )}
                          {s.excluded && (
                            <span className="rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: 'var(--surface-solid)', color: 'var(--rose)' }}>dosing withheld</span>
                          )}
                        </span>
                      </span>
                      {on ? <Check size={16} className="shrink-0" style={{ color: 'var(--lime)' }} /> : null}
                    </button>
                  )
                })}
                {results.length === 0 && (
                  <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>Nothing matches “{query}”.</p>
                )}
              </div>
              <Nav
                back={() => setStep('intro')}
                next={() => { setIdx(0); setStep('config') }}
                nextLabel={`Set up ${entries.length || ''}`.trim()}
                disabled={entries.length === 0}
              />
            </>
          )}

          {step === 'config' && current && (
            <>
              <PeptideStep entry={current} onPatch={(p) => patch(idx, p)} />
              <Nav
                back={() => (idx === 0 ? setStep('pick') : setIdx(idx - 1))}
                next={() => (idx + 1 < entries.length ? setIdx(idx + 1) : setStep('start'))}
                nextLabel={idx + 1 < entries.length ? `Next · ${entries[idx + 1].name}` : 'Start date'}
              />
            </>
          )}

          {step === 'start' && (
            <>
              <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                This sets the clock for every <Term id="titration" /> ladder and <Term id="cycle" /> you just configured.
                Today is usually right; pick the day you actually started if you're catching up.
              </p>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Start date</span>
                <input type="date" className="input" value={startDate}
                  onChange={(e) => e.target.value && setStartDate(e.target.value)} />
              </label>
              <Nav back={() => { setIdx(Math.max(0, entries.length - 1)); setStep('config') }} next={() => setStep('review')} nextLabel="Review" />
            </>
          )}

          {step === 'review' && (
            <>
              {startOver && (
                <p className="flex items-start gap-1.5 rounded-xl p-3 text-[11px] font-bold"
                  style={{ background: 'color-mix(in srgb, var(--coral) 14%, transparent)', color: 'var(--coral)' }}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  Starting over: your current {peptides.length} compounds and their stock will be cleared first. Logged history is kept.
                </p>
              )}
              <div className="space-y-1.5">
                {entries.map((e) => (
                  <div key={e.id} className="rounded-xl p-2.5" style={{ background: 'var(--surface2)' }}>
                    <p className="flex items-center gap-1.5 text-sm font-black">
                      {e.route === 'Nasal' ? <Wind size={12} style={{ color: 'var(--indigo)' }} /> : <Syringe size={12} style={{ color: 'var(--lime)' }} />}
                      {e.name}
                      {inStack(e.id) && <span className="chip !py-0 text-[9px]" style={{ color: 'var(--indigo)' }}>updates existing</span>}
                    </p>
                    <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                      {e.ladder
                        ? `${formatDose(e.ladder.floor, e.ladder.unit)} → ${formatDose(e.ladder.ceiling, e.ladder.unit)}`
                        : 'no dose set — you’ll add it in the Library'}
                      {' · '}{FREQ_LABELS[e.frequency] || e.frequency} · {e.slot} · {ROUTE_LABEL[e.route] || e.route}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                Everything stays editable in the Library afterwards. Personal tracking tool — not medical advice.
              </p>
              <Nav back={() => setStep('start')} next={finish} nextLabel={`Build my schedule · ${entries.length}`} />
            </>
          )}

          {step === 'done' && (
            <div className="space-y-3 text-center">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'var(--lime)', color: '#0c1200' }}>
                <Check size={30} strokeWidth={3} />
              </motion.div>
              <p className="text-base font-black">{entries.length} compound{entries.length === 1 ? '' : 's'} set up</p>
              <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                Home, Plan, Library, Mix and Stock are populated. Change anything from the Library.
              </p>
              <button onClick={onClose} className="btn-primary w-full rounded-xl py-3 text-sm font-black">Done</button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  )
}

function Nav({ back, next, nextLabel = 'Next', disabled }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <button onClick={back} className="flex items-center gap-1 rounded-xl px-3 py-2.5 text-xs font-bold"
        style={{ background: 'var(--surface2)' }}>
        <ChevronLeft size={14} /> Back
      </button>
      <motion.button whileTap={{ scale: 0.97 }} onClick={next} disabled={disabled}
        className="btn-primary flex flex-1 items-center justify-center gap-1 rounded-xl py-2.5 text-sm font-black disabled:opacity-40">
        {nextLabel} <ChevronRight size={15} />
      </motion.button>
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

function Num({ value, onChange, step = 'any' }) {
  return (
    <NumberField value={value} onChange={(v) => onChange(v ?? 0)} step={step} min={0} />
  )
}

function PeptideStep({ entry: e, onPatch }) {
  const nasal = e.route === 'Nasal'
  const ladder = e.ladder
  const conc = concentration(e.recon?.vialMg, e.recon?.bacMl)
  const units = ladder && !nasal ? doseToUnits(toMg(ladder.floor, ladder.unit), conc) : null

  const setRoute = (route) => {
    if (route === e.route) return
    if (route === 'Nasal') {
      const d = nasalDefaults()
      onPatch({ route, ladder: d.ladder, recon: { ...e.recon, ...d.recon } })
    } else if (e.route === 'Nasal') {
      onPatch({ route, ladder: ladder ? convertLadderForRoute(ladder, false) : null })
    } else {
      onPatch({ route })
    }
  }

  const setLadder = (p) => onPatch({ ladder: { ...(ladder || { floor: 0, step: 0, intervalWeeks: 2, ceiling: 0, unit: 'mcg' }), ...p } })
  const days = scheduledWeekdaySet({ ...e, startDate: '2026-01-01' })
  const pickCount = weekdayPickCount(e.frequency)
  const toggleDay = (d) => {
    const cur = new Set(days)
    if (cur.has(d)) cur.delete(d)
    else {
      if (pickCount === 1) cur.clear()
      else if (cur.size >= pickCount) return
      cur.add(d)
    }
    onPatch({ scheduleWeekdays: [...cur].sort((a, b) => a - b) })
  }

  return (
    <div className="space-y-3">
      {/* what the evidence says */}
      <div className="rounded-2xl p-3" style={{ background: 'var(--surface2)' }}>
        <div className="flex flex-wrap items-center gap-1.5">
          {e.tier && <TierBadge tier={e.tier} confidence={e.confidence} />}
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {e.source === 'seed' ? 'app protocol' : e.source === 'reference' ? 'from the reference range' : e.source === 'excluded' ? 'dosing withheld' : 'no suggested dose'}
          </span>
        </div>
        {e.mechanism && (
          <p className="mt-1.5 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            <span className="font-black" style={{ color: 'var(--text)' }}>How it works. </span>{e.mechanism}
          </p>
        )}
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-semibold leading-relaxed"
          style={{ color: e.source === 'excluded' ? 'var(--rose)' : 'var(--muted)' }}>
          <Info size={12} className="mt-0.5 shrink-0" />{SOURCE_NOTE[e.source]}
        </p>
        {e.rangeText && (
          <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--lime)' }}>Reference range: {e.rangeText}</p>
        )}
      </div>

      {/* TX safety instead of a dose */}
      {e.excluded && e.safety?.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--rose) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--rose) 45%, transparent)' }}>
          <p className="flex items-center gap-1.5 text-xs font-black" style={{ color: 'var(--rose)' }}>
            <AlertTriangle size={13} /> Why no dose is given
          </p>
          <ul className="mt-1.5 space-y-1">
            {e.safety.map((s, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                <span style={{ color: 'var(--rose)' }}>•</span><span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* the reference's own words */}
      {(e.doseText || e.frequencyText || e.cycleText) && (
        <details className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
          <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--indigo)' }}>
            What the reference says
          </summary>
          <div className="mt-2 space-y-1.5 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            {e.doseText && <p><span className="font-black" style={{ color: 'var(--text)' }}>Dose. </span>{e.doseText}</p>}
            {e.frequencyText && <p><span className="font-black" style={{ color: 'var(--text)' }}>Frequency. </span>{e.frequencyText}</p>}
            {e.cycleText && <p><span className="font-black" style={{ color: 'var(--text)' }}>Cycle. </span>{e.cycleText}</p>}
          </div>
        </details>
      )}

      {/* established vs reported, never merged */}
      {e.reference && (
        <details className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
          <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
            Evidence · established vs reported
          </summary>
          <div className="mt-3"><ReferenceInfo reference={e.reference} /></div>
        </details>
      )}

      {/* route */}
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--coral)' }}>Route</p>
        <div className="flex gap-1.5">
          {e.routes.map((r) => (
            <button key={r} onClick={() => setRoute(r)}
              className="flex-1 rounded-lg py-2 text-[11px] font-black"
              style={e.route === r
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {ROUTE_LABEL[r]}
            </button>
          ))}
        </div>
        {nasal && (
          <p className="mt-1.5 text-[11px] font-semibold" style={{ color: 'var(--indigo)' }}>
            Nasal spray at {MCG_PER_SPRAY} mcg a spray — 10 mg vial + 2 mL BAC water, all of it into a bottle,
            + 3 mL saline = 5 mL, about 50 sprays. Dosed in whole sprays.
          </p>
        )}
      </div>

      {/* ladder */}
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
          Dose ladder {nasal ? '(sprays)' : ''}
        </p>
        {!ladder && (
          <p className="mb-2 text-[11px] font-bold" style={{ color: 'var(--amber)' }}>
            No dose pre-filled. Enter your own, or leave it blank and set it later.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={`Start at (${nasal ? 'sprays' : ladder?.unit || 'mcg'})`}>
            <Num value={ladder?.floor ?? 0} onChange={(v) => setLadder({ floor: v })} />
          </Field>
          <Field label={`Build up to (${nasal ? 'sprays' : ladder?.unit || 'mcg'})`}>
            <Num value={ladder?.ceiling ?? 0} onChange={(v) => setLadder({ ceiling: v })} />
          </Field>
          <Field label="Step by">
            <Num value={ladder?.step ?? 0} onChange={(v) => setLadder({ step: v })} />
          </Field>
          <Field label="Every (weeks)">
            <Num value={ladder?.intervalWeeks ?? 2} step="1" onChange={(v) => setLadder({ intervalWeeks: Math.max(1, Math.round(v)) })} />
          </Field>
          {!nasal && (
            <Field label="Unit">
              <select className="input" value={ladder?.unit || 'mcg'} onChange={(ev) => setLadder({ unit: ev.target.value })}>
                <option value="mcg">mcg</option><option value="mg">mg</option>
              </select>
            </Field>
          )}
        </div>
      </div>

      {/* reconstitution */}
      {!nasal && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--lime)' }}>Reconstitution</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Vial (mg)"><Num value={e.recon?.vialMg ?? 0} onChange={(v) => onPatch({ recon: { ...e.recon, vialMg: v } })} /></Field>
            <Field label="BAC water (mL)"><Num value={e.recon?.bacMl ?? 0} onChange={(v) => onPatch({ recon: { ...e.recon, bacMl: v } })} /></Field>
          </div>
          <p className="mt-1 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            {conc > 0 ? <>{round(conc, 3)} mg/mL{units != null && isFinite(units) ? <> · first dose is <span style={{ color: 'var(--lime)' }}>{round(units, 1)} units</span></> : null}</> : 'Set the vial and water to see the units to draw.'}
            {e.source !== 'seed' && ' · typical default — check your actual vial.'}
          </p>
        </div>
      )}

      {/* schedule */}
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--amber)' }}>Schedule</p>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Frequency">
            <select className="input" value={e.frequency} onChange={(ev) => onPatch({ frequency: ev.target.value })}>
              {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Slot">
            <select className="input" value={e.slot} onChange={(ev) => onPatch({ slot: ev.target.value })}>
              <option value="AM">AM</option><option value="PM">PM</option>
            </select>
          </Field>
        </div>
        {pickCount > 0 && (
          <>
            <p className="mb-1 mt-2 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
              {pickCount === 1 ? 'Which day each week?' : `Pick ${pickCount} days`}
            </p>
            <div className="flex gap-1">
              {WEEKDAYS.map((label, d) => (
                <button key={d} onClick={() => toggleDay(d)} className="flex-1 rounded-lg py-1.5 text-[10px] font-black"
                  style={days.has(d)
                    ? { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200' }
                    : { background: 'var(--surface2)', color: 'var(--muted)' }}>
                  {label[0]}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          <Field label="Cycle on (days, 0 = ongoing)">
            <Num value={e.cycleOnDays} step="1" onChange={(v) => onPatch({ cycleOnDays: Math.round(v) })} />
          </Field>
          <Field label="Cycle off (days)">
            <Num value={e.cycleOffDays} step="1" onChange={(v) => onPatch({ cycleOffDays: Math.round(v) })} />
          </Field>
        </div>
      </div>

      {/* optional stock */}
      <details className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--indigo)' }}>
          Optional · cost and what you already have
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          <Field label="Cost per vial (AUD)"><Num value={e.costAud || 0} onChange={(v) => onPatch({ costAud: v })} /></Field>
          <Field label="Vials on hand"><Num value={e.stockVials || 0} step="1" onChange={(v) => onPatch({ stockVials: Math.max(0, Math.round(v)) })} /></Field>
        </div>
        <p className="mt-1.5 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
          Feeds Stock and the restock list — run-out dates and order quantities come from these.
        </p>
      </details>
    </div>
  )
}
