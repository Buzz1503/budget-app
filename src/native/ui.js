// The native-only screens (More › Shortcuts, Notifications, Apple Watch), as
// lazy chunks. Like the Health screens they exist in the iPhone app and the
// dev demo and are compiled out of the GitHub Pages build.
import { lazy } from 'react'
import { HEALTH_BUILD } from '../health/ui'

const none = () => null

export const ShortcutsScreen = HEALTH_BUILD ? lazy(() => import('../components/native/ShortcutsScreen')) : none
