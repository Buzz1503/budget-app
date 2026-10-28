import { useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import TrendChart from '../charts/TrendChart'
import useStore from '../../store/useStore'
import { BackHeader, Updating, FactorRow } from './SleepAnalysis'
import useSleepAnalysis from './useSleepAnalysis'

const soft = { color: 'var(--text-2)' }

/** Sleep › Restlessness: the index over 30 and 90 days, what goes with restless nights, and how it is measured. */
export default function RestlessnessScreen({ lab, onBack }) {
  const on = useStore((s) => s.sleepSettings.restlessness !== false)
  const { result: r, updating } = useSleepAnalysis(lab)
  const [info, setInfo] = useState(false)
  const series = useMemo(() => [...lab.extras.values()].filter((e) => e.restless).map((e) => ({ date: e.night.date, value: e.restless.indexPerHour })).sort((a, b) => a.date.localeCompare(b.date)), [lab])
  const moves = useMemo(() => [...lab.extras.values()].filter((e) => e.restless).map((e) => ({ date: e.night.date, value: e.restless.movementMin })).sort((a, b) => a.date.localeCompare(b.date)), [lab])
  const goes = useMemo(() => (r ? r.factors.comparisons.filter((c) => c.outcome === 'restlessness').sort((a, b) => (a.label === b.label ? Math.abs(b.diff) - Math.abs(a.diff) : a.label === 'Clear' ? -1 : 1)) : []), [r])
  return (
    <div className="space-y-4" data-testid="lab-restlessness">
      <BackHeader title="Restlessness" onBack={onBack} info={() => setInfo(true)} />
      {!on && <p className="px-1 text-sm font-medium" style={soft}>Movement from Apple Watch is off in More › Health › Sleep.</p>}
      {on && !series.length && <p className="px-1 text-sm font-medium" style={soft} data-testid="restless-none">The first night appears the morning after wearing the Watch to bed with the Pepito+ app installed on it.</p>}
      <TrendChart metric="restlessness" title="Restlessness index" unit="per h" dp={1} series={series} defaultRange="30D" testid="restless-chart" />
      <TrendChart metric="restlessness" chartType="restlessMove" title="Minutes moving" unit="min" dp={0} series={moves} defaultRange="30D" testid="restless-moves" pinsDefault={false} />
      <section className="card p-4" data-testid="restless-goes">
        <p className="text-[17px] font-semibold">What goes with restless nights</p>
        <Updating on={updating} />
        {goes.length ? <div className="rows">{goes.slice(0, 8).map((c) => <FactorRow key={`${c.factor}-${c.outcome}`} c={c} names={lab.names} showOutcome={false} />)}</div> : <p className="mt-1 text-sm font-medium" style={soft}>Appears once a factor has 7 recorded nights with it and 7 without.</p>}
      </section>
      <Modal open={info} onClose={() => setInfo(false)} title="How restlessness is measured">
        <div className="space-y-2 text-sm font-medium" style={soft} data-testid="restless-info">
          <p>Each evening the Watch records its accelerometer for 12 hours. The next morning it reads the part inside your main sleep and keeps one row a second.</p>
          <p>A second counts as moving when the wrist's acceleration varies by more than a still wrist does. A restless period is a 5-minute stretch with 30 seconds or more of movement. A change of position is the wrist settling at a new angle for at least a minute, a rough stand-in for rolling over.</p>
          <p>The index is restless periods plus changes of position per hour. Only this summary and one movement value a minute reach your iPhone. The raw recording stays on the Watch.</p>
          <p>Battery: the recording uses a little more of the Watch battery overnight. Going to bed with at least 30% is plenty.</p>
        </div>
      </Modal>
    </div>
  )
}
