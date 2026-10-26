import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import Modal from '../ui/Modal'
import TrendChart from '../charts/TrendChart'
import useStore, { todayStr } from '../../store/useStore'
import { addDays } from '../../health/tz'
import { useLatestMeasurement } from '../../lib/useBody'
import { stopBang, likelihood, signals, APNEA_LABEL, AIRWAY_NOTE, TESTOSTERONE_NOTE, SPO2_NOTE, APNEA } from '../../sleep/apnea'
import { BackHeader, Updating } from './SleepAnalysis'
import useSleepAnalysis from './useSleepAnalysis'
import SleepReportButtons from './SleepReport'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }
const RELATED_BLOODS = ['Haematocrit', 'Haemoglobin', 'Testosterone']

/** The latest result for each related blood marker, with its date. */
export function relatedBloods(tests) {
  return RELATED_BLOODS.map((name) => {
    const hit = [...(tests || [])].filter((t) => t.values?.[name] != null).sort((a, b) => b.date.localeCompare(a.date))[0]
    return { name, value: hit ? hit.values[name] : null, date: hit?.date ?? null }
  })
}

/** The STOP-BANG inputs and the 30-night signals, from the lab data and the store. */
export function useApnea(lab) {
  const morningChecks = useStore((s) => s.morningChecks)
  const overrides = useStore((s) => s.apneaOverrides)
  const profileHeight = useStore((s) => s.bodyProfile?.heightCm ?? null)
  const measurements = useStore((s) => s.measurements)
  // height: the profile's, else the newest scan's
  const heightCm = useMemo(() => profileHeight ?? ([...(measurements || [])].filter((m) => m.heightCm > 0).sort((a, b) => b.date.localeCompare(a.date))[0]?.heightCm ?? null), [profileHeight, measurements])
  const weight = useLatestMeasurement('weight')
  const neck = useLatestMeasurement('neck')
  const t = todayStr()
  return useMemo(() => {
    const extras = [...lab.extras.values()].sort((a, b) => a.night.date.localeCompare(b.night.date))
    const since90 = addDays(t, -90)
    const since30 = addDays(t, -APNEA.signalDays)
    const bp = lab.model.daily.filter((r) => r.date >= addDays(t, -APNEA.bpDays) && r.bpSys != null && r.bpDia != null).map((r) => ({ sys: r.bpSys, dia: r.bpDia }))
    const sb = stopBang({
      soundNights: extras.filter((e) => e.night.date >= since90 && e.sounds?.eligible).map((e) => ({ date: e.night.date, snoringMin: e.sounds.snoringMin, lowConfidence: e.sounds.lowConfidence })),
      morning: Object.entries(morningChecks).filter(([d]) => d >= since90).sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => ({ date, ...m })),
      bp,
      weightKg: weight?.value ?? null,
      heightCm,
      age: lab.model.age ?? null,
      neckCm: neck?.value ?? null,
      sex: lab.model.characteristics?.biologicalSex ?? null,
      overrides,
    })
    const recent = extras.filter((e) => e.night.date >= since30)
    const sig = signals(recent.map((e) => ({
      date: e.night.date, breathing: e.overnight?.breathing ?? null, elevated: e.overnight?.breathingElevated ?? null,
      spo2: e.spo2?.readings ? e.spo2 : null, snoringMin: e.sounds?.eligible ? e.sounds.snoringMin : null, lowConfidence: !!e.sounds?.lowConfidence,
      awakenings: e.overnight?.awakenings ?? null, morning: morningChecks[e.night.date] || null,
    })))
    return { sb, sig, like: likelihood(sb.band, sig), recent }
  }, [lab, morningChecks, overrides, heightCm, weight, neck, t])
}

function Answer({ v }) {
  return <span className="shrink-0 text-sm font-black" style={{ color: v == null ? 'var(--text-3)' : 'var(--text)' }}>{v == null ? 'Unknown' : v ? 'Yes' : 'No'}</span>
}

/** Sleep › Apnea screen. A screen, not a diagnosis. */
export default function ApneaScreen({ lab, onBack }) {
  const setOverride = useStore((s) => s.setApneaOverride)
  const tests = useStore((s) => s.bloods?.tests)
  const { sb, sig, like } = useApnea(lab)
  const { result: r, updating } = useSleepAnalysis(lab)
  const [editing, setEditing] = useState(null)
  const [info, setInfo] = useState(false)
  const bloods = relatedBloods(tests)
  const breathingRows = useMemo(() => (r ? [...r.factors.comparisons, ...r.carryOver].filter((c) => ['breathing', 'spo2Dips', 'snoring'].includes(c.outcome))
    .sort((a, b) => (a.label === b.label ? Math.abs(b.diff) - Math.abs(a.diff) : a.label === 'Clear' ? -1 : 1)) : []), [r])
  const item = sb.items.find((i) => i.key === editing)

  return (
    <div className="space-y-4" data-testid="lab-apnea">
      <BackHeader title="Apnea screen" onBack={onBack} info={() => setInfo(true)} />
      <p className="rounded-[14px] p-3 text-sm font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="apnea-label">{APNEA_LABEL}</p>

      <section className="card p-4" data-testid="apnea-likelihood">
        <p className="t-caption" style={muted}>Overall likelihood</p>
        <p className="text-3xl font-black" data-testid="apnea-level">{like.level}</p>
        <ul className="mt-1 space-y-0.5">
          {like.reasons.map((x) => <li key={x} className="text-sm font-medium" style={soft}>{x}.</li>)}
        </ul>
      </section>

      <section className="card p-4" data-testid="apnea-stopbang">
        <div className="flex items-baseline gap-2">
          <p className="t-label flex-1">STOP-BANG</p>
          <p className="text-sm font-black tabular-nums" data-testid="apnea-score">{sb.score} of 8</p>
        </div>
        <p className="text-xs font-medium" style={muted}>0 to 2 low, 3 to 4 intermediate, 5 to 8 high. {sb.known} of 8 known.</p>
        <div className="rows mt-2">
          {sb.items.map((i) => (
            <button key={i.key} onClick={() => setEditing(i.key)} className="flex w-full items-start gap-3 py-2.5 text-left" data-testid={`apnea-item-${i.key}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{i.label}</span>
                <span className="block text-[11px] font-medium" style={muted}>{i.source}</span>
              </span>
              <Answer v={i.answer} />
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4" data-testid="apnea-signals">
        <p className="t-label">Overnight signals, last 30 nights</p>
        <div className="grid grid-cols-2 gap-3 text-sm tabular-nums">
          <Stat label="Breathing disturbances elevated" value={sig.breathingNights ? `${sig.elevatedNights} of ${sig.breathingNights} nights` : 'No data'} />
          <Stat label="Lowest SpO2" value={sig.spo2Lowest != null ? `${sig.spo2Lowest}%` : 'No data'} />
          <Stat label="Readings below 90%" value={sig.spo2PctBelow90 != null ? `${sig.spo2PctBelow90}%` : 'No data'} />
          <Stat label="Nights with SpO2 dips" value={sig.spo2Nights ? `${sig.dipNights} of ${sig.spo2Nights}` : 'No data'} />
          <Stat label="Snoring, average" value={sig.snoringMinAvg != null ? `${sig.snoringMinAvg} min` : 'No data'} />
          <Stat label="Awakenings, average" value={sig.awakeningsAvg != null ? String(sig.awakeningsAvg) : 'No data'} />
          <Stat label="Morning headache" value={sig.mornings ? `${sig.headacheMornings} mornings` : 'No data'} />
          <Stat label="Dry mouth" value={sig.mornings ? `${sig.dryMouthMornings} mornings` : 'No data'} />
          <Stat label="Up to pee, average" value={sig.peeAvg != null ? `${sig.peeAvg} times` : 'No data'} />
        </div>
        <p className="text-[11px] font-medium" style={muted}>{SPO2_NOTE}</p>
      </section>
      {sig.breathing.length >= 1 && <TrendChart metric="breathing" chartType="sleepBreathing" title="Breathing disturbances" dp={1} series={sig.breathing} defaultRange="30D" testid="apnea-breathing-chart" pinsDefault={false} />}

      <section className="card p-4" data-testid="apnea-goes">
        <p className="t-label">What goes with worse breathing nights</p>
        <Updating on={updating} />
        {breathingRows.length ? breathingRows.slice(0, 8).map((c) => (
          <div key={`${c.factor}-${c.outcome}`} className="mt-2">
            <p className="text-sm font-medium" style={soft}>{c.text}</p>
            <p className="text-[11px] font-bold tabular-nums" style={muted}>{c.label} · {c.nWith} nights with, {c.nWithout} without</p>
          </div>
        )) : <p className="mt-1 text-sm font-medium" style={soft}>Appears once breathing, SpO2 or snoring has 7 recorded nights with and without a factor.</p>}
      </section>

      <section className="card p-4" data-testid="apnea-bloods">
        <p className="t-label">Related bloods</p>
        <div className="mt-1 space-y-1">
          {bloods.map((b) => (
            <p key={b.name} className="flex justify-between text-sm font-medium tabular-nums" style={soft}>
              <span>{b.name}</span>
              <span style={{ color: 'var(--text)' }}>{b.value != null ? `${b.value} · ${format(parseISO(b.date), 'd MMM yyyy')}` : 'No result'}</span>
            </p>
          ))}
        </div>
        <p className="mt-2 text-xs font-medium" style={muted}>{TESTOSTERONE_NOTE}</p>
      </section>

      <section className="card space-y-2 p-4" data-testid="apnea-share">
        <p className="t-label">Share with your doctor</p>
        <p className="text-xs font-medium" style={muted}>A plain PDF with this screen, breathing, blood oxygen, snoring, what was logged in the evenings, weight, blood pressure and these bloods.</p>
        <SleepReportButtons />
      </section>

      <Modal open={!!item} onClose={() => setEditing(null)} title={item?.label || ''}>
        {item && (
          <div className="space-y-3" data-testid="apnea-edit">
            <p className="text-sm font-medium" style={soft}>{item.source}</p>
            <div className="grid grid-cols-3 gap-2">
              {[['Yes', true], ['No', false], ['Automatic', null]].map(([l, v]) => (
                <button key={l} onClick={() => { setOverride(item.key, v); setEditing(null) }} data-testid={`apnea-set-${l.toLowerCase()}`}
                  className="rounded-full py-2.5 text-sm font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>{l}</button>
              ))}
            </div>
          </div>
        )}
      </Modal>
      <Modal open={info} onClose={() => setInfo(false)} title="About the apnea screen">
        <div className="space-y-2 text-sm font-medium" style={soft} data-testid="apnea-info">
          <p>{APNEA_LABEL}</p>
          <p>STOP-BANG is a validated eight-question screen. Each answer here comes from your own data where it can, and you can set any of them yourself.</p>
          <p>The likelihood follows the STOP-BANG band and is raised one level when Apple's breathing disturbances are elevated, or blood oxygen dips, on more than a quarter of nights.</p>
          <p>{SPO2_NOTE}</p>
          <p>{AIRWAY_NOTE}</p>
        </div>
      </Modal>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-medium" style={muted}>{label}</p>
      <p className="text-sm font-black">{value}</p>
    </div>
  )
}
