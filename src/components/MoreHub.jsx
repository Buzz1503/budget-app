import { useState } from 'react'
import {
  Package, Settings, ChevronRight, Activity, History, Wand2, FlaskConical,
  Combine, Pill, ClipboardList, CalendarPlus, HeartPulse, Upload, Droplet, CalendarDays, MapPin, Zap, Bell, Watch, Lock, FileText,
} from 'lucide-react'
import { HEALTH_BUILD } from '../health/ui'
import useLowStockDot from '../lib/useLowStock'
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
    id: 'track',
    title: 'Track',
    links: [
      { id: 'calendar', label: 'Calendar', desc: 'Every day, with doses, notes and the day sheet', icon: CalendarDays },
      { id: 'reactions', label: 'Reactions', desc: 'Injection sites, reactions and the site map', icon: MapPin },
      { id: 'bloods', label: 'Bloods', desc: 'Results, ranges and trends', icon: Droplet },
      { id: 'supplies', label: 'Stock', desc: 'Vials I own, run-out dates and what to order', icon: Package, lowDot: true },
    ],
  },
  {
    id: 'protocol',
    title: 'My protocol',
    links: [
      { id: 'wizard', label: 'Build / rebuild my protocol', desc: 'Add, remove or edit anything I take', icon: Wand2 },
      { id: 'protocol', label: 'Protocol overview', desc: 'Everything I’m on, at a glance', icon: ClipboardList },
      { id: 'supplements', label: 'Supplements', desc: 'What I take daily, AM and PM', icon: Pill },
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
  // native app only: reminders, the Watch, Siri and widgets, the lock
  ...(HEALTH_BUILD ? [{
    id: 'iphone',
    title: 'This iPhone',
    links: [
      { id: 'notifications', label: 'Notifications', desc: 'AM and PM reminders, nudges, stock and sauna', icon: Bell },
      { id: 'watch', label: 'Apple Watch', desc: 'Install status, last sync and a test', icon: Watch },
      { id: 'shortcuts', label: 'Shortcuts and widgets', desc: 'Action Button, Siri, widgets and Watch faces', icon: Zap },
      { id: 'lock', label: 'Face ID lock', desc: 'Ask for Face ID when the app opens', icon: Lock },
    ],
  }] : []),
  {
    id: 'data',
    title: 'Data',
    links: [
      // native app only: Apple Health is read on the iPhone, never on the web
      ...(HEALTH_BUILD ? [{ id: 'health', label: 'Health', desc: 'Apple Health connection, sleep and training settings', icon: HeartPulse }] : []),

      { id: 'scans', label: 'Import', desc: 'Evolt PDFs, Withings exports and reports', icon: Upload },
      { id: 'reports', label: 'Backups and reports', desc: HEALTH_BUILD ? 'Daily backups, PDFs for your doctor, error log' : 'PDFs for your doctor, error log', icon: FileText },
      { id: 'settings', label: 'Settings, backup & export', desc: 'Lead time, currency, backup and reset', icon: Settings },
    ],
  },
]

export default function MoreHub({ goTo }) {
  const [backfill, setBackfill] = useState(false)
  const lowStock = useLowStockDot()

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
                  <span className="t-label flex items-center gap-2" style={{ color: 'var(--text)' }}>
                    {l.label}
                    {l.lowDot && lowStock && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--warn)' }} aria-label="Something is running low" data-testid="stock-low-dot" />}
                  </span>
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
