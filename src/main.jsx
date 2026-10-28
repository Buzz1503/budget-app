import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installErrorLog } from './lib/errorLog'

installErrorLog()

const render = () => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// The design review harness (?preview=<screen>): dev builds only, compiled out of every other build.
if (import.meta.env.DEV && /[?&]preview=/.test(location.search)) {
  import('./dev/preview').then(async (m) => {
    const screen = m.previewScreen()
    if (screen) {
      window.__previewTab = m.PREVIEW_SCREENS[screen].tab
      await m.seedPreview()
    }
    render()
  })
} else render()

// The Capacitor shell: hide the launch image once the app has painted, and tell
// the layout when the native keyboard is up. Compiled out of the web build.
if (__NATIVE__) {
  document.documentElement.classList.add('native')
  import('./native').then((m) => m.startNative())
}
