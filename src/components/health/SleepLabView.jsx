import { useEffect } from 'react'
import useStore from '../../store/useStore'
import useHealthModel from './useHealthModel'
import useSleepLab from './useSleepLab'
import { NotConnected, EmptyState } from './BodyHealthView'
import { LabTeaser } from './SleepMain'
import AnalysisScreen from './SleepAnalysis'
import RestlessnessScreen from './RestlessnessScreen'
import ApneaScreen from './ApneaScreen'
import NightmaresScreen from './NightmaresScreen'
import { useNav } from '../../lib/nav'

/**
 * Insights › Sleep Lab: good and bad nights, what goes with each, and the
 * analysis screens (factors, restless nights, apnea screen, nightmares).
 */
export default function SleepLabView({ goTo }) {
  const connected = useStore((s) => s.healthSettings.connected)
  const model = useHealthModel()
  const lab = useSleepLab()
  const view = useNav((s) => s.labView)
  const setView = useNav((s) => s.setLabView)
  useEffect(() => { try { window.scrollTo(0, 0) } catch { /* no window */ } }, [view])
  if (!connected) return <NotConnected goTo={goTo} />
  if (!model.hasData) return <EmptyState />
  const back = () => setView(null)
  if (view === 'analysis') return <AnalysisScreen lab={lab} onBack={back} />
  if (view === 'restless') return <RestlessnessScreen lab={lab} onBack={back} />
  if (view === 'apnea') return <ApneaScreen lab={lab} onBack={back} />
  if (view === 'nightmares') return <NightmaresScreen lab={lab} onBack={back} />
  return (
    <div className="space-y-6" data-testid="sleep-lab">
      <LabTeaser lab={lab} onOpen={() => setView('analysis')} onOpenView={setView} />
    </div>
  )
}
