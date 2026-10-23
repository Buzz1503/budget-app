import { createContext, useContext } from 'react'
import useStore from '../../store/useStore'
import { ownSeries } from '../../sauna/analytics'
import { minutesOf } from '../../sauna/sauna'

/**
 * Health lookups for the Sauna tab, provided by the lazy native-only
 * SaunaHealthProvider. Null in the web build and before Health is connected:
 * then the tab reads only what is in the store (the Watch's own heart rate and
 * cool-down are saved with the session).
 *
 * { h: SaunaHealth, toMs, maxHR, seriesFor(session), patternInput }
 */
export const SaunaHealthContext = createContext(null)

const localToMs = (date, hhmm) => new Date(`${date}T00:00:00`).getTime() + minutesOf(hhmm) * 60000

/** The context, plus fallbacks that work without Health. */
export function useSaunaHealth() {
  const ctx = useContext(SaunaHealthContext)
  const maxHRSetting = useStore((s) => s.healthSettings?.maxHR)
  if (ctx) return ctx
  return {
    h: null,
    toMs: localToMs,
    maxHR: maxHRSetting || 190,
    seriesFor: (session) => ownSeries(session, localToMs),
    patternInput: null,
  }
}
