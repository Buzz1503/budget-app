import { Suspense, lazy, useState } from 'react'
import { ChevronRight, HeartPulse, GitCompareArrows } from 'lucide-react'
import useStore from '../../store/useStore'
import useHealthModel from './useHealthModel'
import EffectsView from './EffectsView'

const CompareSheet = lazy(() => import('./CompareSheet'))

function LinkRow({ title, sub, onClick, testid, icon: Icon }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left" data-testid={testid}>
      {Icon && <Icon size={18} className="shrink-0" style={{ color: 'var(--text-2)' }} />}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{sub}</span>
      </span>
      <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />
    </button>
  )
}

/**
 * Insights › Compounds, the Apple Health half: each tracked compound's
 * effects (before against since starting), then the comparisons that take a
 * question to answer: sleep and heart by dose (Sleep › Heart) and Compare
 * (dose timing, before and after, habits). Room below for a switch
 * comparison between two compounds.
 */
export default function CompoundInsights({ goTo }) {
  const model = useHealthModel()
  const switches = useStore((s) => s.switches || [])
  const [compare, setCompare] = useState(false)
  return (
    <div className="space-y-3" data-testid="compound-insights">
      <EffectsView withSauna={false} />
      <div className="card rows p-0">
        <LinkRow icon={HeartPulse} title="Sleep and heart by dose" sub="Resting HR, sleeping HR and wake-ups per dose level, around changes and by day since injection" onClick={() => goTo?.('heart')} testid="insights-open-heart" />
        {model.hasData && <LinkRow icon={GitCompareArrows} title="Compare" sub="Dose timing, before and after, habits" onClick={() => setCompare(true)} testid="open-compare" />}
        {switches.length > 0 && <LinkRow icon={GitCompareArrows} title="Switch comparison" sub={`${switches.length} switch${switches.length === 1 ? '' : 'es'} recorded, in Sleep › Heart`} onClick={() => goTo?.('heart')} testid="insights-open-switch" />}
      </div>
      {compare && <Suspense fallback={null}><CompareSheet model={model} onClose={() => setCompare(false)} /></Suspense>}
    </div>
  )
}
