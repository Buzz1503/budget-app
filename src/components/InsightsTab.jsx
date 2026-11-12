import { Suspense } from 'react'
import useStore from '../store/useStore'
import Segments from './ui/Segments'
import OutcomeEngine from './OutcomeEngine'
import { useNav, INSIGHTS_SEGMENTS } from '../lib/nav'
import { useHealthLink } from '../lib/healthLink'
import { HEALTH_BUILD, CompoundInsights, SleepLabView, SaunaInsights } from '../health/ui'

/**
 * Insights: everything that answers "is this making a difference?".
 * Compounds (per-compound effects, dose levels, injection timing, body
 * outcomes), Sleep Lab (good and bad nights, factors) and Sauna (what has
 * changed since sauna). Sleep Lab and Sauna read Apple Health, so the web
 * shows Compounds alone.
 */
export default function InsightsTab({ goTo }) {
  const available = useHealthLink((s) => s.available)
  const connected = useStore((s) => s.healthSettings?.connected)
  const health = HEALTH_BUILD && available
  const items = INSIGHTS_SEGMENTS.filter((s) => !s.health || health)
  const chosen = useNav((s) => s.insightsSegment)
  const setSegment = useNav((s) => s.setInsightsSegment)
  const segment = items.some((s) => s.id === chosen) ? chosen : 'compounds'
  return (
    <div className="space-y-3" data-testid="insights-tab">
      <h1 className="text-2xl font-black tracking-tight">Insights</h1>
      <Segments items={items} value={segment} onChange={setSegment} testid="insights-segments" idPrefix="insights-seg" />
      {segment === 'compounds' && (
        <div className="space-y-6" data-testid="insights-compounds">
          {health && connected && <Suspense fallback={null}><CompoundInsights goTo={goTo} /></Suspense>}
          <OutcomeEngine />
        </div>
      )}
      {segment === 'lab' && <Suspense fallback={null}><SleepLabView goTo={goTo} /></Suspense>}
      {segment === 'sauna' && <Suspense fallback={null}><SaunaInsights goTo={goTo} /></Suspense>}
    </div>
  )
}
