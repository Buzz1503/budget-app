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
const SECTIONS = [
  {
    id: 'protocol',
    title: 'My protocol',
    links: [
      { id: 'wizard', label: 'Build / rebuild my protocol', desc: 'Add, remove or edit anything I take', icon: Wand2, color: 'var(--violet)' },
      { id: 'protocol', label: 'Protocol overview', desc: 'Everything I’m on, at a glance', icon: ClipboardList, color: 'var(--lime)' },
      { id: 'supplies', label: 'Stock', desc: 'Vials I own, run-out dates and what to order', icon: Package, color: 'var(--amber)' },
      { id: 'supplements', label: 'Supplements', desc: 'What I take by mouth, AM and PM', icon: Pill, color: 'var(--amber)' },
      { id: 'history', label: 'History & adherence', desc: 'Every dose, rates, shareable summary', icon: History, color: 'var(--indigo)' },
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    links: [
      { id: 'calc', label: 'Calculator', desc: 'Reconstitution & syringe units', icon: FlaskConical, color: 'var(--lime)' },
      { id: 'mix', label: 'Mix', desc: 'Can these two share a syringe?', icon: Combine, color: 'var(--indigo)' },
      { id: 'now', label: 'Right Now', desc: 'What my protocol is doing today', icon: Activity, color: 'var(--lime)' },
    ],
  },
  {
    id: 'data',
    title: 'Data',
    links: [
      { id: 'settings', label: 'Settings, backup & export', desc: 'Theme, lead time, backup and reset', icon: Settings, color: 'var(--violet)' },
    ],
  },
]

export default function MoreHub({ goTo }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black tracking-tight">More</h1>

      {SECTIONS.map((section) => (
        <div key={section.id} className="space-y-2">
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
              className="card flex w-full items-center gap-3 p-4 text-left"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ background: `color-mix(in srgb, ${l.color} 18%, transparent)`, color: l.color }}>
                <l.icon size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">{l.label}</p>
                <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>{l.desc}</p>
              </div>
              <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
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
