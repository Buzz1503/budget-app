import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// The Capacitor shell: hide the launch image once the app has painted, and tell
// the layout when the native keyboard is up. Compiled out of the web build.
if (__NATIVE__) {
  import('./native').then((m) => m.startNative())
}
