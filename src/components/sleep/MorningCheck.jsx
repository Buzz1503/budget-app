import { useState } from 'react'
import { ChevronRight, ChevronDown, Sun } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { DREAMS, PARTNER, morningAnswered } from '../../sleep/logging'

const chip = (on) => (on ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' })

function Row({ label, children, testid }) {
  return (
    <div data-testid={testid}>
      <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Pick({ on, onClick, children, testid }) {
  return <button type="button" onClick={onClick} aria-pressed={on} data-testid={testid} className="min-h-[36px] min-w-[44px] rounded-full px-3 text-sm font-semibold tabular-nums" style={chip(on)}>{children}</button>
}

/**
 * The morning check, about ten seconds and all optional: how rested, dreams,
 * headache, dry mouth, times up to pee and what a partner noticed. On top of
 * the Sleep tab until it is done for today.
 */
export default function MorningCheck({ wakeDate = null, compact = false, notice = null, soundsSummary = null, onOpenSounds = null }) {
  const date = wakeDate || todayStr()
  const c = useStore((s) => s.morningChecks[date]) || {}
  const answer = useStore((s) => s.answerMorningCheck)
  const set = (patch) => answer(date, patch)
  const toggle = (key, value) => set({ [key]: c[key] === value ? null : value })
  const anyMore = c.headache != null || c.dryMouth != null || c.pee != null || c.partner != null
  const [more, setMore] = useState(false)
  const showMore = compact || more || anyMore
  if (c.done && !compact) return null
  return (
    <section className="card space-y-3 p-4" data-testid="morning-check" data-answered={morningAnswered(c) ? 'true' : 'false'}>
      <div className="flex items-center gap-2">
        <Sun size={18} style={{ color: 'var(--text-2)' }} aria-hidden="true" />
        <h2 className="flex-1 text-[17px] font-semibold">Morning check</h2>
        <span className="text-sm font-medium" style={{ color: 'var(--text-3)' }}>Optional</span>
      </div>
      {notice && <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="morning-notice">{notice}</p>}
      {soundsSummary && onOpenSounds && (
        <button type="button" onClick={onOpenSounds} className="flex w-full items-center gap-1 text-left text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="morning-sounds">
          <span className="min-w-0 flex-1">{soundsSummary}</span>
          <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />
        </button>
      )}
      <Row label="How rested (1 to 5)" testid="morning-rested">
        {[1, 2, 3, 4, 5].map((n) => <Pick key={n} on={c.rested === n} onClick={() => toggle('rested', n)} testid={`morning-rested-${n}`}>{n}</Pick>)}
      </Row>
      <Row label="Dreams" testid="morning-dreams">
        {DREAMS.map((d) => <Pick key={d.id} on={c.dreams === d.id} onClick={() => toggle('dreams', d.id)} testid={`morning-dreams-${d.id}`}>{d.label}</Pick>)}
      </Row>
      {!showMore && (
        <button type="button" onClick={() => setMore(true)} className="flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--text-2)' }} data-testid="morning-more">
          4 more questions <ChevronDown size={14} />
        </button>
      )}
      {showMore && <>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Woke with headache">
          {[[true, 'Yes'], [false, 'No']].map(([v, l]) => <Pick key={l} on={c.headache === v} onClick={() => toggle('headache', v)} testid={`morning-headache-${l.toLowerCase()}`}>{l}</Pick>)}
        </Row>
        <Row label="Dry mouth">
          {[[true, 'Yes'], [false, 'No']].map(([v, l]) => <Pick key={l} on={c.dryMouth === v} onClick={() => toggle('dryMouth', v)} testid={`morning-drymouth-${l.toLowerCase()}`}>{l}</Pick>)}
        </Row>
      </div>
      <Row label="Times up to pee" testid="morning-pee">
        {[0, 1, 2, 3].map((n) => <Pick key={n} on={c.pee === n} onClick={() => toggle('pee', n)} testid={`morning-pee-${n}`}>{n === 3 ? '3+' : n}</Pick>)}
      </Row>
      <Row label="Partner noticed" testid="morning-partner">
        {PARTNER.map((p) => <Pick key={p.id} on={c.partner === p.id} onClick={() => toggle('partner', p.id)} testid={`morning-partner-${p.id}`}>{p.label}</Pick>)}
      </Row>
      </>}
      {!compact && (
        <button type="button" onClick={() => set({ done: true })} className="w-full rounded-full py-2.5 text-sm font-black" style={morningAnswered(c) ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="morning-done">
          {morningAnswered(c) ? 'Done' : 'Not today'}
        </button>
      )}
    </section>
  )
}
