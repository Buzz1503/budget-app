// The Health screens, reachable only where Health can exist.
//
// HEALTH_BUILD folds to `false` in the GitHub Pages build, so every lazy import
// below is dead code there and none of the Health screens (or their libraries)
// ship to the web. The native build and the dev demo get them as lazy chunks.
import { lazy } from 'react'

export const HEALTH_BUILD = __NATIVE__ || (import.meta.env.DEV && import.meta.env.VITE_DEMO_HEALTH === '1')

const none = () => null

export const HealthBoot = HEALTH_BUILD ? lazy(() => import('../components/health/HealthBoot')) : none
export const HealthSettings = HEALTH_BUILD ? lazy(() => import('../components/health/HealthSettings')) : none
