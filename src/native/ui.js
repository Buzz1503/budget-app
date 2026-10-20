// The native-only screens (More › Shortcuts, Notifications, Apple Watch, Face
// ID lock), as lazy chunks. Like the Health screens they exist in the iPhone
// app and the dev demo and are compiled out of the GitHub Pages build. The
// lock itself only exists in the iPhone app.
import { lazy } from 'react'
import { HEALTH_BUILD } from '../health/ui'

const none = () => null

export const ShortcutsScreen = HEALTH_BUILD ? lazy(() => import('../components/native/ShortcutsScreen')) : none
export const NotificationsScreen = HEALTH_BUILD ? lazy(() => import('../components/native/NotificationsScreen')) : none
export const WatchScreen = HEALTH_BUILD ? lazy(() => import('../components/native/WatchScreen')) : none
export const LockSettingsScreen = HEALTH_BUILD ? lazy(() => import('../components/native/LockScreen')) : none
export const LockGate = __NATIVE__ ? lazy(() => import('../components/native/LockGate')) : none
