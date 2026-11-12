import { Suspense } from 'react'
import { ChevronRight } from 'lucide-react'
import { Stagger, StaggerItem } from '../ui/Motion'
import { InfoButton } from '../ui/Glance'
import { SaunaHealthProvider } from '../../health/ui'
import { BeforeAfterHero, RecoveryAroundCard, CoolDownCard, PatternsCard, LongerTermCard } from './SaunaSections'

function SectionTitle({ children, info }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <h2 className="min-w-0 flex-1 text-[17px] font-semibold">{children}</h2>
      {info && <InfoButton title={typeof children === 'string' ? children : 'About this'}><p>{info}</p></InfoButton>}
    </div>
  )
}

/**
 * Insights › Sauna: is sauna making a difference? What has changed since you
 * started, recovery around sauna days, cool-down, patterns and the longer
 * term. Logging, the timer and history live in More › Sauna.
 */
export default function SaunaInsights({ goTo }) {
  return (
    <Suspense fallback={null}>
      <SaunaHealthProvider>
        <Stagger className="space-y-6" data-testid="sauna-insights">
          <StaggerItem><BeforeAfterHero /></StaggerItem>
          <StaggerItem><RecoveryAroundCard /></StaggerItem>
          <StaggerItem className="space-y-2">
            <SectionTitle info="Inside sauna days compares your sessions with each other; then sauna days against days off.">Patterns</SectionTitle>
            <PatternsCard />
          </StaggerItem>
          <StaggerItem className="space-y-2">
            <SectionTitle info="Heart rate after leaving the sauna, from Cool down on Apple Watch.">Cool-down recovery</SectionTitle>
            <CoolDownCard />
          </StaggerItem>
          <StaggerItem className="space-y-2">
            <SectionTitle info="Week by week from your first session.">Longer term</SectionTitle>
            <LongerTermCard />
          </StaggerItem>
          <StaggerItem>
            <button onClick={() => goTo?.('sauna')} className="card flex w-full items-center gap-3 p-4 text-left" data-testid="sauna-insights-log">
              <span className="min-w-0 flex-1">
                <span className="t-label block">Sauna log and timer</span>
                <span className="block text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>Log a session, start the timer, history. In More.</span>
              </span>
              <ChevronRight size={18} className="shrink-0" style={{ color: 'var(--text-3)' }} />
            </button>
          </StaggerItem>
        </Stagger>
      </SaunaHealthProvider>
    </Suspense>
  )
}
