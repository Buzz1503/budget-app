import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Syringe, Wind, Wand2, Package, AlertTriangle, Share2, ChevronRight, Plus, Pill,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import CompoundSheet from './CompoundSheet'
import { currentRung, cycleInfo, prettyDate } from '../lib/schedule'
import { formatDose, isNasal } from '../lib/calc'
import { scheduledWeekdaySet, WEEKDAYS, needsProtocolSetup } from '../lib/daily'
import { runwayFor, durationWords, sealedCount } from '../lib/stock'

const FREQ_LABELS = {
  daily: 'Daily', nightly: 'Nightly', weekly: 'Weekly',
  '2xweek': '2×/week', '3xweek': '3×/week', '5on2off': '5 on / 2 off',
}

function daysWords(peptide) {
  const days = scheduledWeekdaySet(peptide)
  if (days.size === 7) return 'every day'
  return [...days].map((d) => WEEKDAYS[d]).join(', ')
}

/**
 * What am I actually on.
 *
 * One screen, one row per compound, no editing. With the Library gone this is
 * the answer to the question the Library was really being used for — and
 * keeping it read-only is what stops it drifting from Build/rebuild, which is
 * the single place any of it changes.
 */
export default function ProtocolTab({ goTo }) {
  const peptides = useStore((s) => s.peptides)
  const supplements = useStore((s) => s.supplements)
  const vials = useStore((s) => s.vials)
  const openVials = useStore((s) => s.openVials)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const leadDays = useStore((s) => s.settings.restockLeadDays)
  const t = todayStr()
  const [sheetId, setSheetId] = useState(null)

  const rows = useMemo(() => peptides.map((p) => {
    const rung = currentRung(p, titration[p.id])
    const cyc = cycleInfo(p, t)
    const runway = runwayFor(p, titration[p.id], openVials[p.id], vials, doseLogs, t, leadDays)
    return {
      p,
      dose: rung.dose,
      rung,
      cyc,
      runway,
      unlinked: !!openVials[p.id]?.unlinked,
      sealed: sealedCount(vials, p.id),
      needsSetup: needsProtocolSetup(p),
    }
  }).sort((a, b) => a.p.name.localeCompare(b.p.name)),
  [peptides, titration, openVials, vials, doseLogs, t, leadDays])

  const exportIt = () => {
    const lines = [
      `My protocol — ${prettyDate(t)}`,
      '',
      ...rows.map((r) => {
        const bits = [
          r.needsSetup ? 'no dose set' : formatDose(r.dose, r.p.ladder?.unit),
          FREQ_LABELS[r.p.frequency] || r.p.frequency,
          daysWords(r.p),
          r.p.slot || 'AM',
          isNasal(r.p) ? 'Nasal' : (r.p.route || 'SubQ'),
          r.cyc.ongoing ? 'ongoing' : `cycle day ${r.cyc.cycleDay} (${r.cyc.isOn ? 'on' : 'off'})`,
          r.unlinked ? 'not in stock' : `${r.sealed} sealed`,
        ]
        return `${r.p.name} — ${bits.join(' · ')}`
      }),
      ...(supplements.length ? ['', 'Supplements', ...supplements.map((s) => `${s.name}${s.dose ? ` — ${s.dose}` : ''} · ${s.slot}`)] : []),
      '',
      'Personal tracking record, not medical advice.',
    ]
    const text = lines.join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-protocol-${t}.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-2.5" data-testid="protocol-overview">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight">My protocol</h1>
          <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            Everything I'm currently taking, at a glance.
          </p>
        </div>
        <span className="chip shrink-0 !py-1.5" style={{ color: 'var(--lime)' }}>
          {rows.length} compound{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex gap-2">
        <button onClick={() => goTo?.('wizard')} data-testid="protocol-build"
          className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black">
          <Wand2 size={14} /> Build / rebuild
        </button>
        <button onClick={exportIt} data-testid="protocol-export"
          className="flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-black"
          style={{ background: 'var(--surface2)', color: 'var(--indigo)' }}>
          <Share2 size={13} /> Export
        </button>
      </div>

      {rows.length === 0 && (
        <div className="card p-5 text-center" style={{ color: 'var(--muted)' }}>
          <p className="text-sm font-bold">Nothing in my protocol yet.</p>
          <button onClick={() => goTo?.('wizard')}
            className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black">
            <Plus size={14} /> Build it
          </button>
        </div>
      )}

      <div className="space-y-2" data-testid="protocol-rows">
        {rows.map((r, i) => (
          <motion.button key={r.p.id}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => setSheetId(r.p.id)}
            data-testid="protocol-row"
            className="card flex w-full items-start gap-3 p-3 text-left">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'color-mix(in srgb, var(--lime) 16%, transparent)', color: 'var(--lime)' }}>
              {isNasal(r.p) ? <Wind size={16} /> : <Syringe size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">{r.p.name}</p>
              <p className="truncate text-[11px] font-semibold leading-tight" style={{ color: 'var(--muted)' }}>
                {r.needsSetup
                  ? 'no dose set yet'
                  : `${formatDose(r.dose, r.p.ladder?.unit)} · ${FREQ_LABELS[r.p.frequency] || r.p.frequency} · ${r.p.slot || 'AM'}`}
              </p>
              <p className="truncate text-[10px] font-medium leading-tight" style={{ color: 'var(--muted)' }}>
                {daysWords(r.p)} · {isNasal(r.p) ? 'Nasal' : (r.p.route || 'SubQ')}
                {' · '}
                {r.cyc.ongoing ? 'ongoing' : `cycle day ${r.cyc.cycleDay} ${r.cyc.isOn ? 'on' : 'off'}`}
              </p>
              <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] font-bold leading-tight"
                style={{ color: r.unlinked ? 'var(--amber)' : r.runway?.low ? 'var(--amber)' : 'var(--muted)' }}>
                {r.unlinked
                  ? <><AlertTriangle size={10} /> not in stock — still scheduled</>
                  : <><Package size={10} /> {r.runway && isFinite(r.runway.days) ? `${durationWords(r.runway.days)} left` : `${r.sealed} sealed`}</>}
              </p>
            </div>
            <ChevronRight size={16} className="mt-1 shrink-0" style={{ color: 'var(--muted)' }} />
          </motion.button>
        ))}
      </div>

      {supplements.length > 0 && (
        <>
          <p className="px-1 pt-2 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--amber)' }}>
            Supplements
          </p>
          <button onClick={() => goTo?.('supplements')}
            className="card flex w-full items-center gap-3 p-3 text-left">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'color-mix(in srgb, var(--amber) 16%, transparent)', color: 'var(--amber)' }}>
              <Pill size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">{supplements.length} taken by mouth</p>
              <p className="truncate text-[11px] font-semibold leading-tight" style={{ color: 'var(--muted)' }}>
                {supplements.slice(0, 3).map((s) => s.name).join(', ')}{supplements.length > 3 ? '…' : ''}
              </p>
            </div>
            <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--muted)' }} />
          </button>
        </>
      )}

      <p className="px-1 pb-1 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
        This screen shows; it never edits. Tap any compound for its reference data, your own history and
        your notes — dose and schedule are changed in Build / rebuild, so there is only ever one version
        of the truth.
      </p>

      <CompoundSheet open={!!sheetId} compoundId={sheetId} onClose={() => setSheetId(null)} goTo={goTo} />
    </div>
  )
}
