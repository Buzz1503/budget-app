import useStore from '../../store/useStore'
import { PatternsView } from '../sauna/SaunaSections'
import useSaunaInput from './useSaunaInput'

/**
 * Sauna in Body › Effects: the same patterns card as the Sauna tab (sauna
 * nights against nights without, late sessions against earlier ones), from
 * the first session on.
 */
export default function SaunaEffectsView() {
  const connected = useStore((s) => s.healthSettings.connected)
  const { input } = useSaunaInput()
  if (!connected) return <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Connect Apple Health in More › Health to compare sauna nights with sleep and recovery.</p>
  if (!input.sessions.length) return <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="sauna-effects-empty">Log a few sessions to start comparing.</p>
  return <div data-testid="sauna-effects"><PatternsView input={input} /></div>
}
