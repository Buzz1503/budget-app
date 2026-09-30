import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown, ChevronRight, AlertTriangle, Mic } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import NumberField from '../ui/NumberField'
import { displayName } from '../../lib/naming'
import { currentRung } from '../../lib/schedule'
import { unitsFor, concentration, toMg } from '../../lib/calc'
import { ZONE_BY_ID, allowedZones } from '../../lib/reactionZones'
import { allZoneStatus, nextBestSite, blockReason, sideWarning } from '../../lib/reactionSites'
import { lockWarning } from '../../lib/investigation'
import { COMPONENTS } from './ReactionSetup'
import BodyMap from './BodyMap'

/**
 * Tap the site. That is the whole thing.
 *
 * Everything else on this screen is already known: the dose comes from the
 * protocol, the concentration from the vial, the needle and technique from the
 * last shot, and the step's locks from the investigation. Filling all of that in
 * by hand every evening is how a log stops being kept, so the only required
 * input is the one piece of information the app genuinely cannot infer.
 *
 * The details are there, one tap away, for the evening something was different
 * — which is exactly the evening the investigation most needs to hear about it.
 */

const SPEEDS = [['fast', 'Fast, under 3 s'], ['normal', 'Normal'], ['slow', 'Slow, 10 s+']]
const TEMPS = [['fridge', 'From the fridge'], ['room', 'Warmed to room temp']]
const PREPS = [['swab', 'Alcohol swab'], ['none', 'No swab']]
const DILUENTS = [['bac', 'BAC water'], ['sterile', 'Sterile water'], ['other', 'Other']]

export default function LogInjection({ open, peptideId, onClose, onLogged }) {
  const peptides = useStore((s) => s.peptides)
  const vials = useStore((s) => s.vials)
  const openVials = useStore((s) => s.openVials)
  const titration = useStore((s) => s.titration)
  const settings = useStore((s) => s.reactionSettings)
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const steps = useStore((s) => s.investigationSteps)
  const logInjection = useStore((s) => s.logInjection)
  const logDose = useStore((s) => s.logDose)
  const showToast = useStore((s) => s.showToast)
  const t = todayStr()

  const peptide = peptides.find((p) => p.id === peptideId)
  const step = steps.find((s) => s.status === 'running') || null

  const ctx = { records, reactions, todayStr: t, restDays: settings?.restDays ?? 3, sideAssignment: settings?.sideAssignment || {} }
  const statusByZone = useMemo(() => allZoneStatus(ctx), [records, reactions, t, settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const suggestion = useMemo(
    () => (peptideId ? nextBestSite(peptideId, ctx) : { zoneId: null }),
    [peptideId, records, reactions, t, settings] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const last = useMemo(
    () => [...records].sort((a, b) => String(b.injectedAt).localeCompare(String(a.injectedAt)))[0] || null,
    [records]
  )

  const [zoneId, setZoneId] = useState(null)
  const [point, setPoint] = useState(null)
  const [view, setView] = useState('front')
  const [details, setDetails] = useState(false)
  const [override, setOverride] = useState(false)
  const [d, setD] = useState({})
  const [note, setNote] = useState('')

  // auto-fill: the step's locks, then the protocol, then last time
  useEffect(() => {
    if (!open || !peptide) return
    const rung = currentRung(peptide, titration[peptide.id])
    const open_ = openVials[peptide.id]
    const vial = vials.find((v) => v.peptideId === peptide.id) || null
    const conc = concentration(peptide.recon?.vialMg, peptide.recon?.bacMl)
    setZoneId(suggestion.zoneId || null)
    setPoint(suggestion.zoneId ? { zoneId: suggestion.zoneId, x: 0.5, y: 0.5 } : null)
    setView(ZONE_BY_ID[suggestion.zoneId]?.view || 'front')
    setDetails(false); setOverride(false); setNote('')
    setD({
      dose: rung.dose,
      units: unitsFor(peptide, rung.dose),
      concentrationMgMl: conc || null,
      volumeMl: conc ? Math.round((toMg(rung.dose, peptide.ladder?.unit) / conc) * 1000) / 1000 : null,
      vialId: vial?.id || null,
      batch: vial?.batch || vial?.lot || null,
      vendor: vial?.vendor || null,
      daysSinceRecon: open_?.reconstitutedAt
        ? Math.max(0, Math.round((Date.now() - new Date(open_.reconstitutedAt).getTime()) / 86400000))
        : null,
      diluent: last?.diluent || 'bac',
      needleGauge: last?.needleGauge ?? 29,
      needleLength: last?.needleLength ?? 8,
      angle: last?.angle ?? 90,
      pinched: last?.pinched ?? true,
      speed: last?.speed || 'normal',
      temperature: last?.temperature || 'room',
      skinPrep: last?.skinPrep || 'swab',
      swabBrand: last?.swabBrand || '',
      swabDried: last?.swabDried ?? true,
      antihistamine: last?.antihistamine || '',
      antihistamineHours: last?.antihistamineHours ?? null,
    })
  }, [open, peptideId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !peptide) return null

  const compoundIds = [peptide.id]
  const componentIds = COMPONENTS[peptide.id] || []
  const allowed = allowedZones(peptide.id, settings?.sideAssignment || {})
  const blocked = zoneId ? blockReason(zoneId, ctx) : null
  const sideNote = zoneId ? sideWarning(peptide.id, zoneId, settings?.sideAssignment || {}) : null

  const draftRecord = {
    compoundIds, componentIds, zoneId, sharedSyringe: false,
    diluent: d.diluent, side: ZONE_BY_ID[zoneId]?.side || null,
  }
  const lockNote = step ? lockWarning(draftRecord, step, {
    sideAssignment: settings?.sideAssignment || {},
    suspects: settings?.suspects || [],
    allowedZonesFor: (id) => allowedZones(id, settings?.sideAssignment || {}),
  }) : null

  const canSave = !!zoneId && (!blocked || override)

  const save = () => {
    const confoundedBy = []
    if (lockNote) confoundedBy.push('lock')
    if (blocked && override) confoundedBy.push('blocked-site')
    // The dose log is the record of the dose; this is the record of the shot.
    // logDose returns nothing — it shows its own toast — so the id is read back
    // off the store, which is the only place it exists.
    logDose(peptide.id)
    const logs = useStore.getState().doseLogs
    const justLogged = [...logs].reverse().find((l) => l.peptideId === peptide.id) || null
    const rec = logInjection({
      ...d,
      doseLogId: justLogged?.id || null,
      compoundIds, componentIds,
      zoneId, point, side: ZONE_BY_ID[zoneId]?.side || null,
      note,
      confounded: confoundedBy.length > 0,
      confoundedBy,
    })
    showToast(`Logged at ${ZONE_BY_ID[zoneId]?.short || 'the site'}`)
    onLogged?.(rec)
    onClose()
  }

  return (
    <Modal open onClose={onClose} wide title={`Log ${displayName(peptide)}`}>
      <div className="space-y-3" data-testid="log-injection">
        {/* the one thing that has to be answered */}
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <p className="t-caption" style={{ color: 'var(--text-2)' }}>Where</p>
            {suggestion.zoneId && (
              <p className="text-xs font-medium" data-testid="site-suggestion" style={{ color: 'var(--text-3)' }}>
                Suggested: {ZONE_BY_ID[suggestion.zoneId]?.short} · {suggestion.reason}
              </p>
            )}
          </div>
          <BodyMap
            view={view} onView={setView}
            statusByZone={statusByZone}
            selectedZone={zoneId}
            onSelectZone={setZoneId}
            onSelectPoint={setPoint}
            allowedZoneIds={allowed}
            compact
          />
          <p className="px-1 text-xs font-bold" data-testid="chosen-site">
            {zoneId ? ZONE_BY_ID[zoneId]?.label : 'Tap a site'}
          </p>
        </div>

        {blocked && (
          <div className="card p-3" data-testid="site-blocked"
            style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}>
            <p className="flex items-start gap-1.5 text-xs font-bold" style={{ color: 'var(--danger)' }}>
              <AlertTriangle size={13} className="mt-px shrink-0" /> {blocked}
            </p>
            <button onClick={() => setOverride((v) => !v)} data-testid="site-override"
              className="mt-2 rounded-full px-3 py-2 text-xs font-black"
              style={override
                ? { background: 'var(--danger)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {override ? 'Using it anyway' : 'Use it anyway'}
            </button>
          </div>
        )}

        {sideNote && (
          <p className="px-1 text-xs font-medium leading-relaxed" data-testid="side-warning"
            style={{ color: 'var(--warn)' }}>{sideNote}</p>
        )}
        {lockNote && (
          <p className="px-1 text-xs font-medium leading-relaxed" data-testid="lock-warning"
            style={{ color: 'var(--warn)' }}>{lockNote}</p>
        )}

        {/* everything the app already knows */}
        <div className="card overflow-hidden">
          <button onClick={() => setDetails((v) => !v)} aria-expanded={details} data-testid="details-toggle"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
            {details ? <ChevronDown size={14} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />}
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold" style={{ color: 'var(--text-2)' }}>Details</span>
              <span className="block truncate text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
                {d.dose} {peptide.ladder?.unit} · {d.units} u · {d.needleGauge}G {d.needleLength}mm · {d.diluent === 'bac' ? 'BAC water' : d.diluent}
              </span>
            </span>
          </button>
          <AnimatePresence initial={false}>
            {details && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden" data-testid="details-pane">
                <div className="space-y-3 p-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <Pair>
                    <Field label={`Dose (${peptide.ladder?.unit})`}>
                      <NumberField value={d.dose} min={0} aria-label="Dose" data-testid="field-dose"
                        onChange={(v) => setD({ ...d, dose: v ?? 0 })} />
                    </Field>
                    <Field label="Units">
                      <NumberField value={d.units} min={0} aria-label="Units" data-testid="field-units"
                        onChange={(v) => setD({ ...d, units: v ?? 0 })} />
                    </Field>
                  </Pair>

                  <Chips label="Diluent" options={DILUENTS} value={d.diluent} testid="field-diluent"
                    onChange={(v) => setD({ ...d, diluent: v })}
                    hint="BAC water contains benzyl alcohol, a preservative that irritates some people's skin" />

                  <Pair>
                    <Field label="Needle gauge">
                      <NumberField value={d.needleGauge} min={0} integer aria-label="Needle gauge"
                        data-testid="field-gauge" onChange={(v) => setD({ ...d, needleGauge: v ?? 0 })} />
                    </Field>
                    <Field label="Length (mm)">
                      <NumberField value={d.needleLength} min={0} aria-label="Needle length"
                        data-testid="field-length" onChange={(v) => setD({ ...d, needleLength: v ?? 0 })} />
                    </Field>
                  </Pair>

                  <Chips label="Angle" options={[['90', '90 degrees'], ['45', '45 degrees']]}
                    value={String(d.angle)} testid="field-angle"
                    onChange={(v) => setD({ ...d, angle: Number(v) })} />
                  <Chips label="Skin pinched" options={[['yes', 'Pinched'], ['no', 'Not pinched']]}
                    value={d.pinched ? 'yes' : 'no'} testid="field-pinched"
                    onChange={(v) => setD({ ...d, pinched: v === 'yes' })} />
                  <Chips label="Injection speed" options={SPEEDS} value={d.speed} testid="field-speed"
                    onChange={(v) => setD({ ...d, speed: v })} />
                  <Chips label="Syringe temperature" options={TEMPS} value={d.temperature} testid="field-temp"
                    onChange={(v) => setD({ ...d, temperature: v })} />
                  <Chips label="Skin prep" options={PREPS} value={d.skinPrep} testid="field-prep"
                    onChange={(v) => setD({ ...d, skinPrep: v })} />

                  {d.skinPrep === 'swab' && (
                    <>
                      <Field label="Swab brand">
                        <input className="input" value={d.swabBrand} aria-label="Swab brand"
                          data-testid="field-swab-brand" onChange={(e) => setD({ ...d, swabBrand: e.target.value })} />
                      </Field>
                      <Chips label="Fully dried before the needle" options={[['yes', 'Yes'], ['no', 'No']]}
                        value={d.swabDried ? 'yes' : 'no'} testid="field-dried"
                        onChange={(v) => setD({ ...d, swabDried: v === 'yes' })} />
                    </>
                  )}

                  <Field label="Antihistamine taken before (name)">
                    <input className="input" value={d.antihistamine} aria-label="Antihistamine"
                      data-testid="field-antihistamine" placeholder="None"
                      onChange={(e) => setD({ ...d, antihistamine: e.target.value })} />
                  </Field>

                  <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    Vial {d.vialId || 'not linked'}{d.batch ? ` · batch ${d.batch}` : ''}
                    {d.vendor ? ` · ${d.vendor}` : ''}
                    {d.daysSinceRecon != null ? ` · mixed ${d.daysSinceRecon} days ago` : ''}
                    {d.concentrationMgMl ? ` · ${d.concentrationMgMl} mg/mL` : ''}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <label className="block">
          <span className="t-caption mb-1 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <Mic size={11} /> Note — tap the mic on your keyboard to dictate
          </span>
          <textarea className="input min-h-[52px] resize-y" value={note} aria-label="Note"
            data-testid="injection-note" placeholder="Anything different about this one"
            onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
          <button onClick={save} disabled={!canSave} data-testid="log-save"
            className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-xs font-black disabled:opacity-40">
            <Check size={14} /> Log it
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Pair({ children }) {
  return <div className="flex gap-2">{children}</div>
}
function Field({ label, children }) {
  return (
    <label className="min-w-0 flex-1 block">
      <span className="t-caption mb-1 block" style={{ color: 'var(--text-3)' }}>{label}</span>
      {children}
    </label>
  )
}
function Chips({ label, options, value, onChange, testid, hint }) {
  return (
    <div data-testid={testid}>
      <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} data-testid="chip" data-value={v}
            data-on={value === v ? 'true' : 'false'}
            className="flex min-h-[32px] items-center rounded-full px-2.5 text-xs font-black"
            style={value === v
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {l}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>{hint}</p>}
    </div>
  )
}
