import { useMemo } from 'react'
import Modal from '../ui/Modal'
import { todayStr } from '../../store/useStore'
import TrendChart from '../charts/TrendChart'
import FamilyChart from '../charts/FamilyChart'
import useChartEvents from '../charts/useChartEvents'
import { useBodyInput, useBodyStart, latestCaption } from '../../lib/useBody'
import { dailySeries, seriesByFamily, FAMILY_FIELDS, getLatestMeasurement } from '../../body/bodySeries'
import { getStartValue } from '../../body/startPoint'
import { latestScanMeta } from '../../body/composition'

/**
 * One metric's chart, opened from a tile or a row. Body fat, fat mass and lean
 * mass show one line per device; everything else one merged line. The Evolt
 * reference range is a faint band where the scan gives one.
 */
export default function MetricSheet({ metric, onClose }) {
  const input = useBodyInput()
  const start = useBodyStart()
  const events = useChartEvents()
  const t = todayStr()
  const open = !!metric
  const key = metric?.key
  const data = useMemo(() => {
    if (!key) return null
    const meta = latestScanMeta(input.measurements || [], key)
    const refBand = meta.range ? { lo: meta.range[0], hi: meta.range[1], label: 'Evolt reference range' } : null
    if (metric.series) return { family: false, series: metric.series, refBand: null, startLine: null, latest: metric.series.at(-1) || null }
    if (FAMILY_FIELDS.has(key)) {
      const families = seriesByFamily(key, input)
      const fam = families.evolt ? 'evolt' : Object.keys(families)[0]
      return { family: true, families, refBand, startLine: getStartValue(key, start, input, { family: fam }) }
    }
    const series = dailySeries(key, input)
    return { family: false, series, refBand, startLine: getStartValue(key, start, input), latest: getLatestMeasurement(key, input, t) }
  }, [key, metric, input, start, t])

  return (
    <Modal open={open} onClose={onClose} title={metric?.label || ''} wide>
      {data && (
        <div className="space-y-2" data-testid="metric-sheet" data-metric={key}>
          {data.family ? (
            <FamilyChart metric={key} title={metric.label} unit={metric.unit} dp={metric.dp ?? 1} families={data.families}
              refBand={data.refBand} startLine={data.startLine} events={events} />
          ) : (
            <TrendChart metric={key} chartType={`metric-${key}`} title={metric.label} unit={metric.unit} dp={metric.dp ?? 1}
              series={data.series} events={events} defaultRange="All" refBand={data.refBand} startLine={data.startLine}
              current={data.latest?.value ?? null} currentCaption={data.latest ? latestCaption(data.latest) : null} />
          )}
          {metric.definition && <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{metric.definition}</p>}
        </div>
      )}
    </Modal>
  )
}
