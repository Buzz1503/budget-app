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
export const HomeHealthCard = HEALTH_BUILD ? lazy(() => import('../components/health/HomeHealthCard')) : none
export const BodyHealthView = HEALTH_BUILD ? lazy(() => import('../components/health/BodyHealthView')) : none
export const MeasurementsHealth = HEALTH_BUILD ? lazy(() => import('../components/health/MeasurementsHealth')) : none
export const DayHealth = HEALTH_BUILD ? lazy(() => import('../components/health/DayHealth')) : none
export const CompoundHealth = HEALTH_BUILD ? lazy(() => import('../components/health/CompoundHealth')) : none
export const MarkerHealthOverlay = HEALTH_BUILD ? lazy(() => import('../components/health/MarkerHealthOverlay')) : none
