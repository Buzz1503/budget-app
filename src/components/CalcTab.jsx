import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeftRight } from 'lucide-react'
import useStore from '../store/useStore'
import { concentration, doseToUnits, unitsToDoseMg, unitsToMl, toMg, fromMg, round } from '../lib/calc'
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

  const pick = (id) => {
    setPid(id)
    const p = peptides.find((x) => x.id === id)
    if (p) {
      setVialMg(p.recon.vialMg)
      setBacMl(p.recon.bacMl)
      setUnit(p.ladder.unit)
      setDoseVal(p.ladder.ceiling)
    }
  }

  const conc = useMemo(() => concentration(+vialMg, +bacMl), [vialMg, bacMl])
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
        <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface2)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Concentration</p>
          <p className="text-xl font-extrabold">{conc ? `${round(conc, 3)} mg/mL` : '—'}</p>
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
              <p className="mt-1 text-sm font-bold" style={{ color: 'var(--muted)' }}>= {round(ml, 3)} mL on a U-100 syringe</p>
            </motion.div>
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
        U-100 insulin syringe: 1 unit = 0.01 mL. Selecting a peptide pre-fills its reconstitution defaults.
      </p>
    </div>
  )
}
