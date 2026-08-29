import { useState } from 'react'
import {
  Package, Settings, ChevronRight, Activity, History, Wand2, FlaskConical,
  Combine, Pill, ClipboardList, CalendarPlus,
} from 'lucide-react'
import BackfillSheet from './BackfillSheet'

/**
 * More, as grouped inset lists.
 *
 * Each section is one card of rows divided by hairlines, rather than a stack
 * of separate floating cards — nine cards down a screen is nine shadows and
 * nine sets of corners competing for the attention the headings already have.
 * The icons are monochrome: nothing here is a status, so nothing here earns
 * colour.
 */
const SECTIONS = [
  {
    id: 'protocol',
    title: 'My protocol',
    links: [
      { id: 'wizard', label: 'Build / rebuild my protocol', desc: 'Add, remove or edit anything I take', icon: Wand2 },
      { id: 'protocol', label: 'Protocol overview', desc: 'Everything I’m on, at a glance', icon: ClipboardList },
      { id: 'supplies', label: 'Stock', desc: 'Vials I own, run-out dates and what to order', icon: Package },
      { id: 'supplements', label: 'Supplements', desc: 'What I take by mouth, AM and PM', icon: Pill },
      { id: 'history', label: 'History & adherence', desc: 'Every dose, rates, shareable summary', icon: History },
      // a sheet, not a screen: it is a correction to make and be done with
      { id: 'backfill', label: 'Add a past dose', desc: 'Log something I took but never recorded', icon: CalendarPlus, sheet: true },
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    links: [
      { id: 'calc', label: 'Calculator', desc: 'Reconstitution & syringe units', icon: FlaskConical },
      { id: 'mix', label: 'Mix', desc: 'Can these two share a syringe?', icon: Combine },
      { id: 'now', label: 'Right Now', desc: 'What my protocol is doing today', icon: Activity },
    ],
  },
  {
    id: 'data',
    title: 'Data',
    links: [
      { id: 'settings', label: 'Settings, backup & export', desc: 'Theme, lead time, backup and reset', icon: Settings },
    ],
  },
]

export default function MoreHub({ goTo }) {
  const [backfill, setBackfill] = useState(false)

  return (
    <div>
      <h1 className="t-display">More</h1>

      {SECTIONS.map((section) => (
        <section key={section.id} className="mt-8">
          <h2 className="t-caption mb-3 px-1" style={{ color: 'var(--text-3)' }}>
            {section.title}
          </h2>
          <div className="card rows overflow-hidden">
            {section.links.map((l) => (
              <button
                key={l.id}
                onClick={() => (l.sheet ? setBackfill(true) : goTo(l.id))}
                data-testid={`more-${l.id}`}
                className="flex w-full items-center gap-4 p-4 text-left"
              >
                <l.icon size={20} className="shrink-0" style={{ color: 'var(--text-2)' }} />
                <span className="min-w-0 flex-1">
                  <span className="t-label block" style={{ color: 'var(--text)' }}>{l.label}</span>
                  <span className="block text-xs font-medium" style={{ color: 'var(--text-3)' }}>{l.desc}</span>
                </span>
                <ChevronRight size={18} className="shrink-0" style={{ color: 'var(--text-3)' }} />
              </button>
            ))}
          </div>
        </section>
      ))}

      <BackfillSheet open={backfill} onClose={() => setBackfill(false)} />

      <p className="mt-8 text-center text-xs font-medium" style={{ color: 'var(--text-3)' }}>
        Pepito + · personal tracking tool, not medical advice
      </p>
    </div>
  )
}
