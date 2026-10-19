import { useMemo } from 'react'
import { todayStr } from '../../store/useStore'
import { compoundEffects } from '../../health/engine/compoundEffects'
import { useCompounds } from './useHealthModel'
import { CompoundEffectsDetail, useEffectInput } from './EffectsView'

/**
 * History › compound: the same page as Body › Effects › compound, for this
 * one, whether or not it is tracked.
 */
export default function CompoundHealth({ peptideId }) {
  const compounds = useCompounds()
  const input = useEffectInput()
  const t = todayStr()
  const c = compounds.find((x) => x.id === peptideId)
  const fx = useMemo(() => (c ? compoundEffects(c, compounds, input, t) : null), [c, compounds, input, t])
  if (!c || !fx) return null
  return (
    <div data-testid="compound-health">
      <p className="t-caption mb-2 px-1" style={{ color: 'var(--text-2)' }}>Effects</p>
      <CompoundEffectsDetail compound={c} fx={fx} input={input} />
    </div>
  )
}
