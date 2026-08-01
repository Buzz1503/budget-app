import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeftRight, Droplet } from 'lucide-react'
import useStore from '../store/useStore'
import {
  concentration, concentrationOf, doseToUnits, unitsToDoseMg, unitsToMl,
  toMg, fromMg, round, isPremixed, premixedVialMg,
} from '../lib/calc'
import Syringe from './ui/Syringe'
import CountUp from './ui/CountUp'

export default function CalcTab() {
  const peptides = useStore((s) => s.peptides)
  const [pid, setPid] = useState(peptides[0]?.id || '')
  const selected = peptides.find((p) => p.id === pid)

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

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
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
              <input type="number" inputMode="decimal" className="input" value={concIn} onChange={(e) => setConcIn(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Vial size (mL)</span>
              <input type="number" inputMode="decimal" className="input" value={vialMl} onChange={(e) => setVialMl(e.target.value)} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Vial (mg)</span>
              <input type="number" inputMode="decimal" className="input" value={vialMg} onChange={(e) => setVialMg(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>BAC water (mL)</span>
              <input type="number" inputMode="decimal" className="input" value={bacMl} onChange={(e) => setBacMl(e.target.value)} />
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
                <input type="number" inputMode="decimal" className="input" value={doseVal} onChange={(e) => setDoseVal(e.target.value)} />
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
              <input type="number" inputMode="decimal" className="input" value={unitsIn} onChange={(e) => setUnitsIn(e.target.value)} />
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
      <p className="px-1 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        U-100 insulin syringe: 1 unit = 0.01 mL. Selecting a compound pre-fills its own defaults and switches to the right mode —
        pre-mixed vials are divided by their label concentration, with no reconstitution step.
      </p>
    </div>
  )
}
