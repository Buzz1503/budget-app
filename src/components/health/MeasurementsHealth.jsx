import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { movingAverage } from '../../health/engine/bodyComp'
import { weeklyChange, sevenDayAverage } from '../../body/bodySeries'
import { useBodySeries } from '../../lib/useBody'
import { round } from '../../health/engine/stats'
import useHealthModel from './useHealthModel'
import HealthChart from './HealthChart'
import { Stat } from './atoms'

const sourceLabel = (name) => (!name ? 'Apple Health' : /withings/i.test(name) ? 'Withings' : name)

/**
 * The Health side of Body › Measurements: scale readings from Apple Health
 * listed with their source, and weight, fat mass, lean mass and blood pressure
 * over time. Readings typed or scanned into the app always win on the same
 * day; the scale's numbers are kept, never written over them.
 */
export default function MeasurementsHealth() {
  const model = useHealthModel()
  const fromHealth = useMemo(() => model.daily
    .filter((r) => r.weight != null || r.bodyFatPct != null || r.leanMass != null)
    .slice(-6).reverse(), [model.daily])
  // one merged daily series (manual, scans and Apple Health) for every weight number here
  const weightDays = useBodySeries('weight')
  const weight = useMemo(() => weightDays.map((p) => ({ date: p.date, value: p.value })), [weightDays])
  const ma = useMemo(() => movingAverage(weight), [weight])
  const change = weeklyChange(weightDays)
  const avg7 = sevenDayAverage(weightDays)
  const fat = model.body.filter((b) => b.fatMass != null).map((b) => ({ date: b.date, value: b.fatMass }))
  const lean = model.body.filter((b) => b.leanMass != null).map((b) => ({ date: b.date, value: b.leanMass }))
  const sys = model.daily.filter((r) => r.bpSys != null).map((r) => ({ date: r.date, value: r.bpSys }))
  const dia = model.daily.filter((r) => r.bpDia != null).map((r) => ({ date: r.date, value: r.bpDia }))

  if (!weight.length && !fromHealth.length && !sys.length) return null

  return (
    <div className="mt-3 space-y-3" data-testid="measurements-health">
      {fromHealth.length > 0 && (
        <div className="card p-3" data-testid="health-entries">
          <p className="mb-1 text-sm font-bold">From Apple Health</p>
          <p className="mb-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>Filled in automatically. Anything you log yourself on the same day is used instead.</p>
          <div className="space-y-2">
            {fromHealth.map((r) => (
              <div key={r.date} className="flex items-center gap-2 text-xs font-semibold" data-testid="health-entry">
                <span className="w-14 shrink-0" style={{ color: 'var(--text-2)' }}>{format(parseISO(r.date), 'd MMM')}</span>
                <span className="flex-1 truncate tabular-nums">
                  {r.weight != null && `${round(r.weight, 1)}kg `}
                  {r.bodyFatPct != null && `· ${round(r.bodyFatPct, 1)}% BF `}
                  {r.leanMass != null && `· ${round(r.leanMass, 1)}kg lean`}
                </span>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="health-entry-source">
                  {sourceLabel(r.weightSource)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {weight.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat testid="weight-ma" label="Weight, 7-day average" value={avg7 != null ? `${round(avg7, 1)} kg` : '–'} />
            <Stat testid="weight-weekly" label="Change per week" value={change != null ? `${change > 0 ? '+' : ''}${round(change, 2)} kg` : '–'} sub={change != null ? 'Trend over the last 4 weeks, all sources' : 'Needs 4 weigh-ins across 2 weeks'} />
          </div>
          <HealthChart chartType="weight" title="Weight" unit="kg" series={weight} secondary={ma} secondaryLabel="Bold line: 7-day average" dp={1} />
        </>
      )}
      {fat.length > 1 && <HealthChart chartType="fatMass" title="Fat mass" unit="kg" series={fat} dp={1} />}
      {lean.length > 1 && <HealthChart chartType="leanMass" title="Lean mass" unit="kg" series={lean} dp={1} />}
      {sys.length > 0 && (
        <HealthChart chartType="bp" title="Blood pressure" unit="mmHg" series={dia} secondary={sys} secondaryLabel="Bold: systolic, thin: diastolic" />
      )}
      {(fat.length > 0 || fromHealth.some((r) => r.bodyFatPct != null)) && (
        <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }} data-testid="bodyfat-footnote">
          Scale body fat is an estimate that moves with hydration. Read trends over weeks, not days.
        </p>
      )}
    </div>
  )
}
