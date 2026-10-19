import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { weeklyChange, sevenDayAverage } from '../../body/bodySeries'
import { useBodySeries } from '../../lib/useBody'
import { round } from '../../health/engine/stats'
import useHealthModel from './useHealthModel'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { Stat } from './atoms'

const sourceLabel = (name) => (!name ? 'Apple Health' : /withings/i.test(name) ? 'Withings' : name)

/**
 * The Health side of Body › Measurements › Stats: scale readings from Apple
 * Health listed with their source, the 7-day average and change per week, and
 * blood pressure. Weight, fat mass and lean mass are charted under Trends,
 * from the same merged series. Readings typed or scanned into the app win on
 * the same day; the scale's numbers are kept, never written over them.
 */
export default function MeasurementsHealth() {
  const model = useHealthModel()
  const fromHealth = useMemo(() => model.daily
    .filter((r) => r.weight != null || r.bodyFatPct != null || r.leanMass != null)
    .slice(-6).reverse(), [model.daily])
  // one merged daily series (manual, scans and Apple Health) for every weight number here
  const weightDays = useBodySeries('weight')
  const bp = useBodySeries('bp')
  const events = useChartEvents()
  const change = weeklyChange(weightDays)
  const avg7 = sevenDayAverage(weightDays)
  const hasFat = model.body.some((b) => b.fatMass != null)
  const lastBp = bp.at(-1)

  if (!weightDays.length && !fromHealth.length && !bp.length) return null

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

      {weightDays.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat testid="weight-ma" label="Weight, 7-day average" value={avg7 != null ? `${round(avg7, 1)} kg` : '–'} />
            <Stat testid="weight-weekly" label="Change per week" value={change != null ? `${change > 0 ? '+' : ''}${round(change, 2)} kg` : '–'} sub={change != null ? 'Trend over the last 4 weeks, all sources' : 'Needs 4 weigh-ins across 2 weeks'} />
          </div>
          <p className="px-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>Weight, fat mass and lean mass charts are under Trends.</p>
        </>
      )}
      {bp.length > 0 && (
        <TrendChart metric="bp" title="Blood pressure, systolic" unit="mmHg" dp={0} series={bp} events={events}
          currentCaption={lastBp?.extra != null ? `Latest ${lastBp.value}/${lastBp.extra}` : null} />
      )}
      {(hasFat || fromHealth.some((r) => r.bodyFatPct != null)) && (
        <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }} data-testid="bodyfat-footnote">
          Scale body fat is an estimate that moves with hydration. Read trends over weeks, not days.
        </p>
      )}
    </div>
  )
}
