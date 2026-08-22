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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Calc</h1>
        <motion.button whileTap={{ scale: 0.94 }} onClick={() => setReverse(!reverse)}
          className="chip !py-1.5 font-bold" style={{ color: 'var(--indigo)' }}>
          <ArrowLeftRight size={13} /> {reverse ? 'units → dose' : 'dose → units'}
        </motion.button>
      </div>

      {/* where the numbers come from */}
      <div className="flex rounded-xl p-1" data-testid="calc-source" style={{ background: 'var(--surface2)' }}>
        {[['protocol', 'From my protocol'], ['manual', 'Manual / any peptide']].map(([m, label]) => (
          <button key={m} onClick={() => { setSource(m); setSaved(false); setSaving(false) }}
            aria-label={label} className="relative flex-1 rounded-lg py-2 text-xs font-black">
            {source === m && (
              <motion.span layoutId="calc-source-pill" className="absolute inset-0 rounded-lg"
                style={{ backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))' }} />
            )}
            <span className="relative" style={{ color: source === m ? '#0c1200' : 'var(--muted)' }}>{label}</span>
          </button>
        ))}
      </div>

      {manual ? (
        <p className="px-1 text-[11px] font-semibold" data-testid="calc-manual-hint" style={{ color: 'var(--muted)' }}>
          No compound selected — enter whatever is on the vial in front of you. Nothing is saved
          to my protocol unless you ask.
        </p>
      ) : (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" data-testid="calc-protocol-picker">
          {peptides.map((p) => (
            <button key={p.id} onClick={() => pick(p.id)}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold"
              style={pid === p.id
                ? { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="card space-y-3 p-4">
        {/* preparation mode — reconstitution vs. a vial that's already in solution */}
        <div className="flex gap-1.5">
          {[['recon', 'Reconstitute'], ['premixed', 'Pre-mixed solution']].map(([m, label]) => (
            <button key={m} onClick={() => setPrep(m)}
              className="flex-1 rounded-lg py-1.5 text-xs font-black"
              style={prep === m
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {label}
            </button>
          ))}
        </div>

        {premixed ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Concentration (mg/mL)</span>
              <NumberField value={concIn} onChange={(n) => setConcIn(n ?? 0)} min={0} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Vial size (mL)</span>
              <NumberField value={vialMl} onChange={(n) => setVialMl(n ?? 0)} min={0} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Vial (mg)</span>
              <NumberField value={vialMg} onChange={(n) => setVialMg(n ?? 0)} min={0} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>BAC water (mL)</span>
              <NumberField value={bacMl} onChange={(n) => setBacMl(n ?? 0)} min={0} />
            </label>
          </div>
        )}
        <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface2)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Concentration</p>
          <p className="text-xl font-extrabold">{conc ? `${round(conc, 3)} mg/mL` : '—'}</p>
          {premixed && (
            <p className="mt-0.5 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
              As supplied — no powder to dissolve{+vialMl > 0 ? ` · ${round(premixedVialMg(+concIn || 0, +vialMl || 0), 1)} mg per vial` : ''}
            </p>
          )}
        </div>

        {!reverse ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Target dose</span>
                <NumberField value={doseVal} onChange={(n) => setDoseVal(n ?? 0)} min={0} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Unit</span>
                <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="mcg">mcg</option><option value="mg">mg</option>
                </select>
              </label>
            </div>
            <motion.div layout className="rounded-2xl p-4 text-center"
              style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--lime) 18%, transparent), color-mix(in srgb, var(--indigo) 14%, transparent))' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Draw</p>
              <p className="text-4xl font-extrabold tracking-tight" style={{ color: 'var(--lime)' }}>
                <CountUp value={isFinite(units) ? round(units, 1) : 0} decimals={1} /> <span className="text-xl">units</span>
              </p>
              <p className="mt-1 text-sm font-bold" style={{ color: 'var(--muted)' }}>
                = <span style={{ color: 'var(--text)' }}>{round(ml, 3)} mL</span> {premixed ? '' : 'on a U-100 syringe'}
              </p>
              {premixed && (
                <p className="mt-0.5 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                  {round(+doseVal || 0, 3)} {unit} ÷ {round(conc, 3)} mg/mL
                </p>
              )}
            </motion.div>
            {premixed && (
              <p className="flex items-start gap-1.5 rounded-xl p-2.5 text-[11px] font-semibold"
                style={{ background: 'color-mix(in srgb, var(--amber) 14%, transparent)', color: 'var(--amber)' }}>
                <Droplet size={13} className="mt-0.5 shrink-0" />
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
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Units drawn (U-100)</span>
              <NumberField value={unitsIn} onChange={(n) => setUnitsIn(n ?? 0)} min={0} />
            </label>
            <motion.div layout className="rounded-2xl p-4 text-center"
              style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--violet) 18%, transparent), color-mix(in srgb, var(--indigo) 14%, transparent))' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Delivered dose</p>
              <p className="text-4xl font-extrabold tracking-tight" style={{ color: 'var(--violet)' }}>
                <CountUp value={isFinite(revDisplay) ? round(revDisplay, unit === 'mcg' ? 0 : 3) : 0} decimals={unit === 'mcg' ? 0 : 2} /> <span className="text-xl">{unit}</span>
              </p>
              <p className="mt-1 text-sm font-bold" style={{ color: 'var(--muted)' }}>= {round(unitsToMl(+unitsIn || 0), 3)} mL</p>
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
            <p className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-black"
              style={{ background: 'color-mix(in srgb, var(--lime) 16%, transparent)', color: 'var(--lime)' }}>
              <Check size={14} /> Added to my protocol
            </p>
          ) : saving ? (
            <div className="card space-y-2 p-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  Name it
                </span>
                <input className="input" autoFocus value={saveName} aria-label="New compound name"
                  placeholder="e.g. Ipamorelin" onChange={(e) => setSaveName(e.target.value)} />
              </label>
              <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
                Saves the vial and water you entered. Dose, schedule and cycle are yours to set in
                the Library — nothing is guessed.
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setSaving(false); setSaveName('') }}
                  className="flex-1 rounded-xl py-2 text-xs font-black"
                  style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
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
                  className="btn-primary flex-1 rounded-xl py-2 text-xs font-black disabled:opacity-40">
                  Save
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setSaving(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-black"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
              <Plus size={14} /> Save this to my protocol
            </button>
          )}
        </div>
      )}

      <p className="px-1 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        U-100 insulin syringe: 1 unit = 0.01 mL. {manual
          ? 'Manual mode works from the numbers you type — no compound, no library entry, nothing stored.'
          : 'Selecting a compound pre-fills its own defaults and switches to the right mode — pre-mixed vials are divided by their label concentration, with no reconstitution step.'}
      </p>
    </div>
  )
}
