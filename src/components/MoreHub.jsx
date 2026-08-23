import { motion } from 'framer-motion'
import {
  Package, Settings, ChevronRight, Activity, History, Wand2, FlaskConical,
  Combine, Pill, ClipboardList,
} from 'lucide-react'

/**
 * More, grouped.
 *
 * A flat list of a dozen links stops being a menu and becomes a drawer you
 * rummage in. The three headings are the three reasons anyone comes here:
 * to work something out, to look at what they're on, or to deal with the data
 * itself. Nothing that already has a bottom-nav tab is repeated.
 */
/**
 * Tile colour is a property of the section, not the row. Nine differently
 * coloured tiles down one screen read as decoration and pull against the
 * headings doing the actual grouping; one hue per section means the colour
 * says the same thing the heading does.
 *
 * All three are chrome hues. The semantic scale — lime, amber, coral, rose —
 * is reserved for the safety states, and must never be spent on navigation.
 */
const SECTIONS = [
  {
    id: 'protocol',
    title: 'My protocol',
    tone: 'var(--violet)',
    links: [
      { id: 'wizard', label: 'Build / rebuild my protocol', desc: 'Add, remove or edit anything I take', icon: Wand2 },
      { id: 'protocol', label: 'Protocol overview', desc: 'Everything I’m on, at a glance', icon: ClipboardList },
      { id: 'supplies', label: 'Stock', desc: 'Vials I own, run-out dates and what to order', icon: Package },
      { id: 'supplements', label: 'Supplements', desc: 'What I take by mouth, AM and PM', icon: Pill },
      { id: 'history', label: 'History & adherence', desc: 'Every dose, rates, shareable summary', icon: History },
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    tone: 'var(--teal)',
    links: [
      { id: 'calc', label: 'Calculator', desc: 'Reconstitution & syringe units', icon: FlaskConical },
      { id: 'mix', label: 'Mix', desc: 'Can these two share a syringe?', icon: Combine },
      { id: 'now', label: 'Right Now', desc: 'What my protocol is doing today', icon: Activity },
    ],
  },
  {
    id: 'data',
    title: 'Data',
    tone: 'var(--muted)',
    links: [
      { id: 'settings', label: 'Settings, backup & export', desc: 'Theme, lead time, backup and reset', icon: Settings },
    ],
  },
]

export default function MoreHub({ goTo }) {
  return (
    <div className="space-y-2.5">
      <h1 className="text-2xl font-black tracking-tight">More</h1>

      {SECTIONS.map((section) => (
        <div key={section.id} className="space-y-1.5">
          <p className="px-1 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {section.title}
          </p>
          {section.links.map((l, i) => (
            <motion.button
              key={l.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => goTo(l.id)}
              data-testid={`more-${l.id}`}
              className="card flex w-full items-center gap-3 p-3 text-left"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl"
                style={{ background: `color-mix(in srgb, ${section.tone} 14%, transparent)`, color: section.tone }}>
                <l.icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-tight">{l.label}</p>
                <p className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--muted)' }}>{l.desc}</p>
              </div>
              <ChevronRight size={18} className="shrink-0" style={{ color: 'var(--muted)' }} />
            </motion.button>
          ))}
        </div>
      ))}

      <p className="pb-2 text-center text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        Pepito + · personal tracking tool, not medical advice
      </p>
    </div>
  )
}
