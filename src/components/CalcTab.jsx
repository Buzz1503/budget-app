import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeftRight, Droplet, Plus, Check } from 'lucide-react'
import useStore from '../store/useStore'
import NumberField from './ui/NumberField'
import {
  concentration, concentrationOf, doseToUnits, unitsToDoseMg, unitsToMl,
  toMg, fromMg, round, isPremixed, premixedVialMg, isNasal,
} from '../lib/calc'
import Syringe from './ui/Syringe'
import CountUp from './ui/CountUp'

export default function CalcTab() {
  // nasal peptides are dosed in sprays, not drawn — nothing to calculate here
  const peptides = useStore((s) => s.peptides).filter((p) => !isNasal(p))
  const addPeptide = useStore((s) => s.addPeptide)
  // 'protocol' pre-fills from a compound you're running; 'manual' is the same maths
  // with nothing named and nothing saved — a vial in your hand that the app has
  // never heard of still needs working out.
  const [source, setSource] = useState('protocol')
  const manual = source === 'manual'
  const [pid, setPid] = useState(peptides[0]?.id || '')
  const selected = manual ? null : peptides.find((p) => p.id === pid)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [vialMg, setVialMg] = useState(selected?.recon.vialMg ?? 10)
  const [bacMl, setBacMl] = useState(selected?.recon.bacMl ?? 2)
  const [doseVal, setDoseVal] = useState(selected ? fromMg(toMg(selected.ladder.ceiling, selected.ladder.unit), selected.ladder.unit) : 500)
  const [unit, setUnit] = useState(selected?.ladder.unit ?? 'mcg')
  const [reverse, setReverse] = useState(false)
  const [unitsIn, setUnitsIn] = useState(10)
  // 'recon' = powder + BAC water; 'premixed' = an already-made solution sold at
  // a stated mg/mL (oil-based injectables), where there is nothing to dissolve.
  const [prep, setPrep] = useState(isPremixed(selected) ? 'premixed' : 'recon')
  const [concIn, setConcIn] = useState(selected && isPremixed(selected) ? concentrationOf(selected) : 250)
  const [vialMl, setVialMl] = useState(selected?.recon.bacMl ?? 10)

  const pick = (id) => {
    setPid(id)
    const p = peptides.find((x) => x.id === id)
    if (!p) return
    setUnit(p.ladder.unit)
    setDoseVal(p.ladder.ceiling)
    if (isPremixed(p)) {
      setPrep('premixed')
      setConcIn(concentrationOf(p))
      setVialMl(p.recon.bacMl)
    } else {
      setPrep('recon')
      setVialMg(p.recon.vialMg)
      setBacMl(p.recon.bacMl)
    }
  }

  const premixed = prep === 'premixed'
  const conc = useMemo(
    () => (premixed ? Math.max(0, +concIn || 0) : concentration(+vialMg, +bacMl)),
    [premixed, concIn, vialMg, bacMl]
  )
  const doseMg = toMg(+doseVal || 0, unit)
  const units = doseToUnits(doseMg, conc)
  const ml = unitsToMl(units)

  const revMg = unitsToDoseMg(+unitsIn || 0, conc)
  const revDisplay = fromMg(revMg, unit)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">Calc</h1>
        <motion.button whileTap={{ scale: 0.94 }} onClick={() => setReverse(!reverse)}
          className="chip !py-2 font-bold" style={{ color: 'var(--text-2)' }}>
          <ArrowLeftRight size={13} /> {reverse ? 'units → dose' : 'dose → units'}
        </motion.button>
      </div>

      {/* where the numbers come from */}
      <div className="flex rounded-full p-1" data-testid="calc-source" style={{ background: 'var(--surface-sunk)' }}>
        {[['protocol', 'From my protocol'], ['manual', 'Manual / any peptide']].map(([m, label]) => (
          <button key={m} onClick={() => { setSource(m); setSaved(false); setSaving(false) }}
            aria-label={label} className="relative flex-1 rounded-full py-2 text-xs font-black">
            {source === m && (
              <motion.span layoutId="calc-source-pill" className="absolute inset-0 rounded-full"
                style={{ background: 'var(--accent)' }} />
            )}
            <span className="relative" style={{ color: source === m ? 'var(--accent-fg)' : 'var(--text-2)' }}>{label}</span>
          </button>
        ))}
      </div>

      {manual ? (
        <p className="px-1 text-xs font-semibold" data-testid="calc-manual-hint" style={{ color: 'var(--text-2)' }}>
          No compound selected — enter whatever is on the vial in front of you. Nothing is saved
          to my protocol unless you ask.
        </p>
      ) : (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" data-testid="calc-protocol-picker">
          {peptides.map((p) => (
            <button key={p.id} onClick={() => pick(p.id)}
              className="shrink-0 rounded-full px-4 py-2 text-xs font-bold"
              style={pid === p.id
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="card space-y-3 p-3">
        {/* preparation mode — reconstitution vs. a vial that's already in solution */}
        <div className="flex gap-2">
          {[['recon', 'Reconstitute'], ['premixed', 'Pre-mixed solution']].map(([m, label]) => (
            <button key={m} onClick={() => setPrep(m)}
              className="flex-1 rounded-full py-2 text-xs font-black"
              style={prep === m
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {label}
            </button>
          ))}
        </div>

        {premixed ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Concentration (mg/mL)</span>
              <NumberField value={concIn} onChange={(n) => setConcIn(n ?? 0)} min={0} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Vial size (mL)</span>
              <NumberField value={vialMl} onChange={(n) => setVialMl(n ?? 0)} min={0} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Vial (mg)</span>
              <NumberField value={vialMg} onChange={(n) => setVialMg(n ?? 0)} min={0} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>BAC water (mL)</span>
              <NumberField value={bacMl} onChange={(n) => setBacMl(n ?? 0)} min={0} />
            </label>
          </div>
        )}
        <div className="rounded-[14px] p-3 text-center" style={{ background: 'var(--surface-sunk)' }}>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Concentration</p>
          <p className="text-base font-semibold num">{conc ? `${round(conc, 3)} mg/mL` : '—'}</p>
          {premixed && (
            <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              As supplied — no powder to dissolve{+vialMl > 0 ? ` · ${round(premixedVialMg(+concIn || 0, +vialMl || 0), 1)} mg per vial` : ''}
            </p>
          )}
        </div>

        {!reverse ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Target dose</span>
                <NumberField value={doseVal} onChange={(n) => setDoseVal(n ?? 0)} min={0} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Unit</span>
                <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="mcg">mcg</option><option value="mg">mg</option>
                </select>
              </label>
            </div>
            <motion.div layout className="sunk p-5 text-center">
              <p className="t-caption" style={{ color: 'var(--text-3)' }}>Draw</p>
              <p className="t-metric" style={{ color: 'var(--text)' }}>
                <CountUp value={isFinite(units) ? round(units, 1) : 0} decimals={1} />{' '}
                <span className="t-metric-sm">units</span>
              </p>
              <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                = <span style={{ color: 'var(--text)' }}>{round(ml, 3)} mL</span> {premixed ? '' : 'on a U-100 syringe'}
              </p>
              {premixed && (
                <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  {round(+doseVal || 0, 3)} {unit} ÷ {round(conc, 3)} mg/mL
                </p>
              )}
            </motion.div>
            {premixed && (
              <p className="flex items-start gap-2 rounded-[14px] p-3 text-xs font-semibold"
                style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>
                <Droplet size={13} className="mt-1 shrink-0" />
                <span>
                  Oil is viscous — it draws and pushes far slower than water. Use a wider needle to draw, swap to a fresh one to inject, and go slowly.
                </span>
              </p>
            )}
            <Syringe units={units} />
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Units drawn (U-100)</span>
              <NumberField value={unitsIn} onChange={(n) => setUnitsIn(n ?? 0)} min={0} />
            </label>
            <motion.div layout className="rounded-[14px] p-4 text-center"
              style={{ background: 'var(--surface-sunk)' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Delivered dose</p>
              <p className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>
                <CountUp value={isFinite(revDisplay) ? round(revDisplay, unit === 'mcg' ? 0 : 3) : 0} decimals={unit === 'mcg' ? 0 : 2} /> <span className="t-metric-sm">{unit}</span>
              </p>
              <p className="mt-1 text-sm font-bold" style={{ color: 'var(--text-2)' }}>= {round(unitsToMl(+unitsIn || 0), 3)} mL</p>
            </motion.div>
            <Syringe units={+unitsIn || 0} />
          </>
        )}
      </div>
      {/* opt-in, never automatic: the point of manual mode is working out a vial
          without it becoming part of my protocol */}
      {manual && (
        <div data-testid="calc-save">
          {saved ? (
            <p className="flex items-center justify-center gap-2 rounded-[14px] py-3 text-xs font-black"
              style={{ background: 'color-mix(in srgb, var(--good) 16%, transparent)', color: 'var(--good)' }}>
              <Check size={14} /> Added to my protocol
            </p>
          ) : saving ? (
            <div className="card space-y-2 p-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
                  Name it
                </span>
                <input className="input" autoFocus value={saveName} aria-label="New compound name"
                  placeholder="e.g. Ipamorelin" onChange={(e) => setSaveName(e.target.value)} />
              </label>
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                Saves the vial and water you entered. Dose, schedule and cycle are yours to set in
                the Library — nothing is guessed.
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setSaving(false); setSaveName('') }}
                  className="flex-1 rounded-full py-2 text-xs font-black"
                  style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  Cancel
                </button>
                <button
                  disabled={!saveName.trim()}
                  onClick={() => {
                    const id = addPeptide({
                      name: saveName.trim(),
                      recon: premixed
                        ? { vialMg: premixedVialMg(+concIn || 0, +vialMl || 0), bacMl: +vialMl || 0, expiryDays: 28 }
                        : { vialMg: +vialMg || 0, bacMl: +bacMl || 0, expiryDays: 28 },
                      ladder: { floor: 0, step: 0, intervalWeeks: 1, ceiling: 0, unit },
                    })
                    if (id) { setSaved(true); setSaving(false); setSaveName('') }
                  }}
                  className="btn-primary flex-1 rounded-full py-2 text-xs font-black disabled:opacity-40">
                  Save
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setSaving(true)}
              className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              <Plus size={14} /> Save this to my protocol
            </button>
          )}
        </div>
      )}

      <p className="px-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        U-100 insulin syringe: 1 unit = 0.01 mL. {manual
          ? 'Manual mode works from the numbers you type — no compound, no library entry, nothing stored.'
          : 'Selecting a compound pre-fills its own defaults and switches to the right mode — pre-mixed vials are divided by their label concentration, with no reconstitution step.'}
      </p>
    </div>
  )
}
