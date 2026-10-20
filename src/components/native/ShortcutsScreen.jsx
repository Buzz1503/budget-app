// More › Shortcuts and widgets: plain steps for the Action Button, Siri,
// widgets and the Watch. Nothing to set up in the app itself; the phrases and
// widgets are there as soon as Pepito+ is installed.

const STEPS = [
  {
    id: 'action-button',
    title: 'Action Button on iPhone',
    note: 'iPhone 15 Pro and later.',
    steps: [
      'Open Settings, then Action Button.',
      'Swipe to Shortcut, then tap Choose a Shortcut.',
      'Pick Pepito+, then Start sauna.',
      'One press now starts a session with your usual length and temperature, and starts the sauna workout on your Apple Watch.',
    ],
  },
  {
    id: 'siri',
    title: 'Siri',
    note: 'Say these to your iPhone or your Apple Watch.',
    steps: [
      '"Start sauna in Pepito"',
      '"Stop sauna in Pepito"',
      '"Log my doses in Pepito"',
      '"What\'s my readiness in Pepito"',
    ],
  },
  {
    id: 'home-widgets',
    title: 'Home Screen widgets',
    steps: [
      'Touch and hold an empty part of the Home Screen, then tap Edit and Add Widget.',
      'Search for Pepito+.',
      'Today has a tick for each dose due next. Sauna starts and stops a session. Readiness shows today\'s score.',
    ],
  },
  {
    id: 'lock-widgets',
    title: 'Lock Screen widgets',
    steps: [
      'Touch and hold the Lock Screen, then tap Customize and Lock Screen.',
      'Tap the row under the time to add the next dose line ("Next: Reta 3 mg, 8 pm").',
      'Tap the widget area below the time to add the readiness circle.',
    ],
  },
  {
    id: 'watch-ultra',
    title: 'Action Button on Apple Watch Ultra',
    steps: [
      'On the Watch, open Settings, then Action Button.',
      'Tap Action and choose Workout, then choose Pepito+ as the app.',
      'One press starts a sauna session with your usual length and temperature. Each press after that marks the next round.',
    ],
  },
  {
    id: 'watch-face',
    title: 'Apple Watch face and Smart Stack',
    steps: [
      'Touch and hold the watch face, tap Edit, then swipe to Complications.',
      'Choose Pepito+ for readiness, the next dose, or sauna quick start.',
      'Turn the Digital Crown up from the face to see the Smart Stack; a running sauna session shows there too.',
    ],
  },
]

export default function ShortcutsScreen() {
  return (
    <div className="space-y-6" data-testid="shortcuts-screen">
      <p className="px-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>
        Pepito+ works from the Action Button, Siri, widgets and your Apple Watch. Everything you log there goes into the app the same way as a tap on Home.
      </p>
      {STEPS.map((s) => (
        <section key={s.id} data-testid={`shortcut-${s.id}`}>
          <h2 className="t-caption mb-2 px-1" style={{ color: 'var(--text-3)' }}>{s.title}</h2>
          <div className="card p-4">
            {s.note && <p className="mb-2 text-xs font-medium" style={{ color: 'var(--text-3)' }}>{s.note}</p>}
            <ol className="space-y-2">
              {s.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm font-medium leading-snug">
                  <span className="w-4 shrink-0 text-right tabular-nums" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ))}
    </div>
  )
}
