import { COMPARE } from '../../health/engine/config'
import { useCompounds } from './useHealthModel'
import EffectsView from './EffectsView'

/**
 * A compound's Health view, inside History › compound: the same phase cards
 * as Body › Effects, kept to the phases where this compound started, stopped
 * or changed dose.
 */
export default function CompoundHealth({ peptideId }) {
  const compounds = useCompounds()
  const c = compounds.find((x) => x.id === peptideId)
  if (!c) return null
  return (
    <div className="space-y-2" data-testid="compound-health">
      <p className="px-1 t-caption" style={{ color: 'var(--text-2)' }}>Effects, phases where {c.name} changed</p>
      <EffectsView compoundId={peptideId} compact />
      <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{COMPARE.caveat}</p>
    </div>
  )
}
