import { useMemo } from 'react'
import useStore from '../store/useStore'
import { fxRate, audPerVial, audPerDose, currentDoseMg } from './cost'

/**
 * Money, worked out at the moment it is drawn.
 *
 * Every screen that shows a price goes through here rather than reading a
 * stored figure, which is what makes one edit to the rate in Settings move the
 * whole app at once. A price it cannot work out comes back as null and the
 * screen says so — never as $0.00, which is a claim that something was free.
 */
export function useMoney() {
  const fx = useStore((s) => fxRate(s.settings))
  const currency = useStore((s) => s.settings.currency || 'AUD')
  const titration = useStore((s) => s.titration)
  const peptides = useStore((s) => s.peptides)

  return useMemo(() => {
    const fmt = (n) => (n == null || !Number.isFinite(n) ? null : `$${n.toFixed(2)}`)
    const settings = { fx_usd_to_aud: fx }
    return {
      fx,
      currency,
      /** USD → local, as a number. */
      vial: (usdPerVial) => audPerVial(usdPerVial, settings),
      /** USD per vial + how much of it a dose takes → what that dose costs. */
      dose: (usdPerVial, mgPerVial, doseMg) => audPerDose(usdPerVial, mgPerVial, doseMg, settings),
      /** The same, for the rung a stack item is on right now. */
      doseFor: (peptideId, usdPerVial, mgPerVial) => {
        const p = peptides.find((x) => x.id === peptideId)
        const mg = p ? currentDoseMg(p, titration[peptideId]) : null
        return mg == null ? null : audPerDose(usdPerVial, mgPerVial, mg, settings)
      },
      doseMgFor: (peptideId) => {
        const p = peptides.find((x) => x.id === peptideId)
        return p ? currentDoseMg(p, titration[peptideId]) : null
      },
      fmt,
      /** "$21.45", or the given fallback when there is no price to show. */
      show: (n, fallback = 'No price set') => fmt(n) ?? fallback,
    }
  }, [fx, currency, titration, peptides])
}
