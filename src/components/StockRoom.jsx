import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, Plus, Minus, ChevronRight, FileText, Trash2, Search,
  Paperclip, AlertTriangle, Boxes, CheckCircle2, Clock,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { groupStock, blankBatch, runwayFor, durationWords } from '../lib/stock'
import { prettyDate } from '../lib/schedule'
import { putBlob, getBlob, deleteBlob } from '../lib/blobStore'
import { isNasal } from '../lib/calc'
import { loadMatrix } from '../lib/mixMatrix'
import { wizardSuggestion, toPeptide } from '../lib/wizardDefaults'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'

const money = (n) => `$${Math.round((n || 0) * 100) / 100}`

/**
 * The stock room: every vial you physically own, grouped by peptide.
 *
 * Grouped rather than flat because "how much Retatrutide do I have" is the
 * question actually being asked, and a flat list of batches makes you add it up
 * yourself. The total leads; the breakdown sits under it, because a total that
 * hides two different vial sizes is worse than no total.
 */
export default function StockRoom() {
  const peptides = useStore((s) => s.peptides)
  const vials = useStore((s) => s.vials)
  const openVials = useStore((s) => s.openVials)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const leadDays = useStore((s) => s.settings.restockLeadDays)
  const t = todayStr()

  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState(null)

  const groups = useMemo(() => groupStock(vials, peptides), [vials, peptides])
  const totalVials = groups.reduce((n, g) => n + g.vialCount, 0)

  return (
    <div className="space-y-3" data-testid="stock-room">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
          Every sealed vial you hold, kept apart from what's running.
        </p>
        <span className="chip shrink-0 !py-1.5" style={{ color: 'var(--lime)' }}>
          <Boxes size={13} /> {totalVials} sealed
        </span>
      </div>

      <button onClick={() => setAdding(true)} data-testid="add-stock"
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black">
        <Plus size={16} /> Add stock
      </button>

      {groups.length === 0 && (
        <div className="card p-6 text-center text-sm font-medium" style={{ color: 'var(--muted)' }}>
          Nothing in the stock room yet.
        </div>
      )}

      <div className="space-y-2.5" data-testid="stock-groups">
        {groups.map((g) => {
          const peptide = peptides.find((p) => p.id === g.peptideId)
          const runway = peptide
            ? runwayFor(peptide, titration[peptide.id], openVials[peptide.id], vials, doseLogs, t, leadDays)
            : null
          return (
            <StockGroup
              key={g.peptideId}
              group={g}
              peptide={peptide}
              open={openId === g.peptideId}
              onToggle={() => setOpenId(openId === g.peptideId ? null : g.peptideId)}
              runway={runway}
            />
          )
        })}
      </div>

      <p className="px-1 pb-1 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
        Batches are kept apart on purpose — a 10 mg from one vendor and a 20 mg from another are
        different things to draw from. Activating one pulls a vial from that batch and carries the
        library's dosing across.
      </p>

      <AddBatchModal open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

/** The one-line, once-per-peptide answer to "when do I run out" — open vial and shelf combined. */
function RunwayLine({ runway }) {
  if (!runway) return null
  if (runway.out) {
    return (
      <p className="mt-1 flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--coral)' }}>
        <AlertTriangle size={11} /> Nothing left — reorder
      </p>
    )
  }
  if (!isFinite(runway.days)) return null
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium"
      style={{ color: runway.low ? 'var(--amber)' : 'var(--muted)' }}>
      <Clock size={11} className="shrink-0" />
      <span>
        {durationWords(runway.days)} left
        {runway.restockByDate ? ` · restock by ${prettyDate(runway.restockByDate)}` : ''}
      </span>
    </p>
  )
}

function StockGroup({ group: g, peptide, open, onToggle, runway }) {
  const adjustVialQty = useStore((s) => s.adjustVialQty)
  const removeVial = useStore((s) => s.removeVial)
  const activateBatch = useStore((s) => s.activateBatch)
  const low = !!(runway && (runway.out || runway.low))

  return (
    <motion.div layout className="card overflow-hidden" data-testid="stock-group">
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={g.vialCount === 0
            ? { background: 'color-mix(in srgb, var(--coral) 16%, transparent)', color: 'var(--coral)' }
            : { background: 'color-mix(in srgb, var(--lime) 16%, transparent)', color: 'var(--lime)' }}>
          <span className="text-[13px] font-black tabular-nums">{g.vialCount}</span>
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-sm font-bold">
            {g.name}
            {!g.inStack && (
              <span className="ml-1.5 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>· not in your stack</span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            {g.vialCount === 0
              ? 'none in stock'
              : `${g.batchCount} batch${g.batchCount === 1 ? '' : 'es'} · ${g.vialCount} sealed vial${g.vialCount === 1 ? '' : 's'}`}
          </p>
          <RunwayLine runway={runway} />
        </div>
        {low && <AlertTriangle size={14} className="mt-1 shrink-0" style={{ color: 'var(--amber)' }} />}
        <ChevronRight size={16} className="mt-1 shrink-0 transition-transform"
          style={{ color: 'var(--muted)', transform: open ? 'rotate(90deg)' : 'none' }} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-2 px-4 pb-4">
              {g.batches.length === 0 && (
                <p className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                  No batches recorded for this one.
                </p>
              )}
              {g.batches.map((b) => (
                <BatchRow key={b.id} batch={b} peptide={peptide}
                  onAdjust={(d) => adjustVialQty(b.id, d)}
                  onRemove={() => removeVial(b.id)}
                  onActivate={() => activateBatch(b.peptideId, b.id)} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** One batch, one row: size, quantity, vendor — never merged with a sibling batch. */
function BatchRow({ batch: b, peptide, onAdjust, onRemove, onActivate }) {
  const openVial = useStore((s) => s.openVials?.[b.peptideId])
  const isActive = openVial?.batchId === b.id
  const canActivate = peptide && !isNasal(peptide) && (b.qtyOnHand || 0) > 0

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }} data-testid="batch-row">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-black tabular-nums"
          style={{ background: 'var(--surface-solid)', color: 'var(--text)' }}>
          {b.qtyOnHand || 0}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-black">
            {b.vialMg} mg
            {isActive && (
              <span className="ml-1.5 text-[10px] font-bold" style={{ color: 'var(--lime)' }}>· in use</span>
            )}
          </p>
          <p className="truncate text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
            {b.vendor || 'No vendor recorded'}
          </p>
          <p className="mt-0.5 truncate text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
            {money(b.costAud)} each
            {b.lot ? ` · lot ${b.lot}` : ''}
            {b.sealedExpiry ? ` · exp ${b.sealedExpiry}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <CoaButton batch={b} />
          <div className="flex items-center gap-1">
            <button onClick={() => onAdjust(-1)} aria-label={`One fewer ${b.vialMg} mg`}
              className="flex h-6 w-6 items-center justify-center rounded-lg"
              style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>
              <Minus size={12} />
            </button>
            <button onClick={() => onAdjust(1)} aria-label={`One more ${b.vialMg} mg`}
              className="flex h-6 w-6 items-center justify-center rounded-lg"
              style={{ background: 'var(--surface-solid)', color: 'var(--lime)' }}>
              <Plus size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex gap-1.5">
        {canActivate && !isActive && (
          <button onClick={onActivate} data-testid="activate-batch"
            className="flex-1 rounded-lg py-1.5 text-[11px] font-black"
            style={{ backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200' }}>
            Activate this vial
          </button>
        )}
        <button onClick={onRemove} aria-label={`Delete the ${b.vialMg} mg batch`}
          className="rounded-lg px-2.5 py-1.5" style={{ background: 'var(--surface-solid)', color: 'var(--coral)' }}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- the COA

/**
 * The certificate of analysis for a batch. Stored in IndexedDB beside the
 * progress photos rather than in the app state — a PDF has no business in
 * localStorage — which also means the existing backup picks it up unchanged.
 */
export function CoaButton({ batch: b }) {
  const setBatchCoa = useStore((s) => s.setBatchCoa)
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const attach = async (file) => {
    if (!file) return
    setBusy(true)
    const key = `coa-${b.id}-${Date.now()}`
    const ok = await putBlob(key, file)
    if (ok) {
      if (b.coaKey) await deleteBlob(b.coaKey)
      setBatchCoa(b.id, key, { name: file.name, type: file.type, size: file.size })
    }
    setBusy(false)
  }

  const view = async () => {
    const blob = await getBlob(b.coaKey)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    // the tab holds its own reference; release ours once it has loaded
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
        aria-label={`COA for the ${b.vialMg} mg batch`}
        onChange={(e) => attach(e.target.files?.[0])} />
      <button
        data-testid={b.coaKey ? 'coa-view' : 'coa-attach'}
        onClick={() => (b.coaKey ? view() : fileRef.current?.click())}
        aria-label={b.coaKey ? `View the COA for the ${b.vialMg} mg batch` : `Attach a COA to the ${b.vialMg} mg batch`}
        className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[10px] font-black"
        style={b.coaKey
          ? { background: 'color-mix(in srgb, var(--indigo) 20%, transparent)', color: 'var(--indigo)' }
          : { background: 'var(--surface-solid)', color: 'var(--muted)' }}>
        {b.coaKey ? <FileText size={12} /> : <Paperclip size={12} />}
        {busy ? '…' : 'COA'}
      </button>
    </>
  )
}

// -------------------------------------------------------------- adding stock

function AddBatchModal({ open, onClose }) {
  const peptides = useStore((s) => s.peptides)
  const addVial = useStore((s) => s.addVial)
  const addPeptide = useStore((s) => s.addPeptide)
  const [picked, setPicked] = useState(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(null)
  const fileRef = useRef(null)
  const [coa, setCoa] = useState(null)
  const [matrix, setMatrix] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)

  // lazy-load the 86-compound matrix only when the picker actually opens
  useEffect(() => {
    if (!open || matrix) return
    let alive = true
    loadMatrix().then((m) => alive && setMatrix(m)).catch(() => alive && setLoadFailed(true))
    return () => { alive = false }
  }, [open, matrix])

  const existingById = useMemo(() => new Map(peptides.map((p) => [p.id, p])), [peptides])

  const results = useMemo(() => {
    if (!matrix) return []
    const q = query.trim().toLowerCase()
    if (!q) return matrix.compounds
    return matrix.compounds.filter(
      (c) => c.name.toLowerCase().includes(q) || c.class.toLowerCase().includes(q) || c.id.includes(q)
    )
  }, [matrix, query])

  const close = () => { setPicked(null); setDraft(null); setQuery(''); setCoa(null); onClose() }

  // Any of the 86 compounds can become a batch — it doesn't need to already be
  // in the active stack. If it's already in the library, its own vial size
  // seeds the form; otherwise the form starts blank and the user's own numbers
  // are what get recorded.
  const choose = (c) => {
    const existing = existingById.get(c.id) || null
    setPicked({ id: c.id, name: c.name, compound: c, existing })
    setDraft(blankBatch(existing))
  }

  const save = async () => {
    if (!draft || !picked) return

    let peptideId = picked.existing?.id || null
    if (!peptideId) {
      // Not in the library yet. Carry across whatever the evidence reference
      // actually states — the same parser the "build my schedule" wizard uses,
      // which only ever reads an explicit stated range and never invents one.
      // Activating this batch later is what pulls it into the running stack.
      const suggestion = wizardSuggestion(picked.compound)
      const entry = toPeptide(suggestion, todayStr())
      peptideId = addPeptide({
        ...entry,
        compoundClass: picked.compound.class,
        charge: picked.compound.charge,
        flags: picked.compound.flags || [],
      })
      if (!peptideId) peptideId = picked.compound.id
    }

    let coaKey = null
    let coaMeta = null
    if (coa) {
      coaKey = `coa-new-${Date.now()}`
      const ok = await putBlob(coaKey, coa)
      if (ok) coaMeta = { name: coa.name, type: coa.type, size: coa.size }
      else coaKey = null
    }
    addVial(peptideId, {
      name: picked.name,
      vialMg: draft.vialMg || 0,
      vendor: draft.vendor,
      qtyOnHand: Math.max(0, draft.qtyOnHand || 0),
      qtyPurchased: Math.max(0, draft.qtyOnHand || 0),
      costAud: draft.costAud || 0,
      lot: draft.lot,
      sealedExpiry: draft.sealedExpiry,
      coaKey, coaMeta,
    })
    close()
  }

  return (
    <Modal open={open} onClose={close} title={picked ? `Add ${picked.name}` : 'Add stock'}>
      {!picked ? (
        <div className="space-y-3" data-testid="stock-picker">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
            <input className="input !pl-9" placeholder={`Search ${matrix ? matrix.compounds.length : 86} compounds…`}
              aria-label="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {loadFailed ? (
            <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--amber)' }}>
              Couldn't load the compound list — try again in a moment.
            </p>
          ) : !matrix ? (
            <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>Loading compounds…</p>
          ) : (
            <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-0.5">
              {results.map((c) => {
                const existing = existingById.get(c.id)
                return (
                  <button key={c.id} onClick={() => choose(c)}
                    className="flex w-full items-center gap-2 rounded-xl p-2.5 text-left"
                    style={{ background: 'var(--surface2)' }}>
                    <Package size={14} className="shrink-0" style={{ color: 'var(--lime)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-bold">{c.name}</p>
                      <p className="truncate text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                        {existing
                          ? `${existing.recon?.vialMg || 0} mg per vial in your library`
                          : `${c.class} · not in your stack`}
                      </p>
                    </div>
                    <ChevronRight size={14} style={{ color: 'var(--muted)' }} />
                  </button>
                )
              })}
              {results.length === 0 && (
                <p className="py-4 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  No compound matches “{query}”.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="stock-batch-form">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vial size (mg)">
              <NumberField value={draft.vialMg} aria-label="Vial size in mg"
                onChange={(v) => setDraft({ ...draft, vialMg: v ?? 0 })} min={0} />
            </Field>
            <Field label="How many">
              <NumberField value={draft.qtyOnHand} aria-label="How many vials" integer
                onChange={(v) => setDraft({ ...draft, qtyOnHand: v ?? 0 })} min={0} />
            </Field>
          </div>
          <Field label="Vendor">
            <input className="input" value={draft.vendor} aria-label="Vendor"
              placeholder="Who you bought it from"
              onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost each (AUD)">
              <NumberField value={draft.costAud} aria-label="Cost per vial"
                onChange={(v) => setDraft({ ...draft, costAud: v ?? 0 })} min={0} />
            </Field>
            <Field label="Lot (optional)">
              <input className="input" value={draft.lot} aria-label="Lot number"
                onChange={(e) => setDraft({ ...draft, lot: e.target.value })} />
            </Field>
          </div>
          <Field label="Sealed expiry (optional)">
            <input type="date" className="input" value={draft.sealedExpiry} aria-label="Sealed expiry"
              onChange={(e) => setDraft({ ...draft, sealedExpiry: e.target.value })} />
          </Field>

          <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
            aria-label="COA file" onChange={(e) => setCoa(e.target.files?.[0] || null)} />
          <button onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-black"
            style={coa
              ? { background: 'color-mix(in srgb, var(--indigo) 18%, transparent)', color: 'var(--indigo)' }
              : { background: 'var(--surface2)', color: 'var(--muted)' }}>
            {coa ? <><CheckCircle2 size={14} /> {coa.name}</> : <><Paperclip size={14} /> Attach a COA (optional)</>}
          </button>

          <div className="flex gap-2">
            <button onClick={() => { setPicked(null); setDraft(null) }}
              className="flex-1 rounded-xl py-2.5 text-xs font-black"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
              Back
            </button>
            <button onClick={save} data-testid="save-batch"
              className="btn-primary flex-1 rounded-xl py-2.5 text-xs font-black">
              Add to stock
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}
