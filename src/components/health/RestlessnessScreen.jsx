import { useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import TrendChart from '../charts/TrendChart'
import { BackHeader, Updating, FactorRow } from './SleepAnalysis'
import useSleepAnalysis from './useSleepAnalysis'
import { RESTLESS } from '../../sleep/restless'

const soft = { color: 'var(--text-2)' }

/** One measure per night, from the chosen sleep source only (fallback nights are left out). */
const seriesOf = (lab, key) => [...lab.extras.values()]
  .filter((e) => !e.night.fallback && e.restless?.[key] != null)
  .map((e) => ({ date: e.night.date, value: e.restless[key] }))
  .sort((a, b) => a.date.localeCompare(b.date))

const OUTCOMES = ['wakeUps', 'wasoMin', 'fragmentation', 'hrSpikes']

/** Sleep › Restless nights: wake-ups, awake minutes, stage changes and heart rate spikes from Apple Health. */
export default function RestlessnessScreen({ lab, onBack }) {
  const { result: r, updating } = useSleepAnalysis(lab)
  const [info, setInfo] = useState(false)
  const wakes = useMemo(() => seriesOf(lab, 'wakeUps'), [lab])
  const awake = useMemo(() => seriesOf(lab, 'awakeMin'), [lab])
  const frag = useMemo(() => seriesOf(lab, 'fragmentation'), [lab])
  const spikes = useMemo(() => seriesOf(lab, 'hrSpikes'), [lab])
  const goes = useMemo(() => (r ? r.factors.comparisons.filter((c) => OUTCOMES.includes(c.outcome)).sort((a, b) => (a.label === b.label ? Math.abs(b.diff) - Math.abs(a.diff) : a.label === 'Clear' ? -1 : 1)) : []), [r])
  return (
    <div className="space-y-4" data-testid="lab-restlessness">
      <BackHeader title="Restless nights" onBack={onBack} info={() => setInfo(true)} />
      {!wakes.length && !spikes.length && <p className="px-1 text-sm font-medium" style={soft} data-testid="restless-none">Appears once Apple Health has a night with sleep stages or heart rate from your sleep source.</p>}
      <TrendChart metric="wakeUps" title="Wake-ups" unit="times" dp={0} series={wakes} defaultRange="30D" testid="restless-wakeups" />
      <TrendChart metric="wasoMin" title="Awake after falling asleep" unit="min" dp={0} series={awake} defaultRange="30D" testid="restless-awake" pinsDefault={false} />
      <TrendChart metric="fragmentation" title="Stage changes" unit="per h" dp={1} series={frag} defaultRange="30D" testid="restless-fragmentation" pinsDefault={false} />
      <TrendChart metric="hrSpikes" title="Heart rate spikes" unit="spikes" dp={0} series={spikes} defaultRange="30D" testid="restless-spikes" pinsDefault={false} />
      <section className="card p-4" data-testid="restless-goes">
        <p className="text-[17px] font-semibold">What goes with restless nights</p>
        <Updating on={updating} />
        {goes.length ? <div className="rows">{goes.slice(0, 8).map((c) => <FactorRow key={`${c.factor}-${c.outcome}`} c={c} names={lab.names} showOutcome />)}</div> : <p className="mt-1 text-sm font-medium" style={soft}>Appears once a factor has 7 recorded nights with it and 7 without.</p>}
      </section>
      <Modal open={info} onClose={() => setInfo(false)} title="How restless nights are measured">
        <div className="space-y-2 text-sm font-medium" style={soft} data-testid="restless-info">
          <p>Everything here comes from Apple Health: the sleep stages and heart rate your chosen sleep source wrote.</p>
          <p>Wake-ups: awake periods after you first fell asleep and before your final wake. Two awake periods a minute or less apart count as one. Awake after falling asleep is their total minutes.</p>
          <p>Stage changes: how often the stage changed (Awake, REM, Core, Deep) per hour, from falling asleep to the final wake. Higher means more broken up.</p>
          <p>Heart rate spikes: heart rate more than {RESTLESS.spikeBpm} bpm above that night's median for {RESTLESS.spikeMin} minutes or more.</p>
          <p>Nights from another source (shown as Other source) are left out of these charts and the comparisons.</p>
        </div>
      </Modal>
    </div>
  )
}
