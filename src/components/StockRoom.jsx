import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Minus, ChevronRight, FileText, Trash2, Search, Paperclip, CheckCircle2, Users, Package, Check,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { blankBatch, openVialRemainingMg, groupStock } from '../lib/stock'
import { drawdown, emptiesInWords, FREQUENCIES } from '../lib/drawdown'
import { putBlob, getBlob, deleteBlob } from '../lib/blobStore'
import { round } from '../lib/calc'
import { loadMatrix } from '../lib/mixMatrix'
import Modal from './ui/Modal'
import CompoundSheet from './CompoundSheet'
import NumberField from './ui/NumberField'
import { useMoney } from '../lib/useMoney'
import { sizesFor, referencePrice } from '../lib/cost'
import PickerField from './ui/PickerField'
import { useStockRows } from '../lib/useStock'
import {
  wasteInYear, vialHistory, dosesLeftWords, countRows, countDue, remainingMg, sealedBatches,
  fridgeLifeDays, orderLeadDays, ORDER_DOT_DAYS,
} from '../lib/vials'
import { useNativeFeed } from '../native/feed'

const shortDate = (d) => (d ? format(parseISO(d), 'd MMM') : '')
const GHOST = { background: 'var(--surface-sunk)', color: 'var(--text-2)' }

/**
 * Stock: one row per compound, in the order to order them. Each row says what
 * is open (as doses left), how many vials are sealed, when it runs out and
 * when to order by. Nothing here is typed in to keep it right: the open vial
 * counts down from the log, and the question after a log changes the vial.
 */
export default function StockRoom({ goTo }) {
  const rows = useStockRows()
  const finishedVials = useStore((s) => s.finishedVials)
  const peptides = useStore((s) => s.peptides)
  const vials = useStore((s) => s.vials)
  const notif = useStore((s) => s.notificationSettings)
  const lastCount = useStore((s) => s.nativeState?.countCheckOn)
  const openCountFlag = useNativeFeed((s) => s.openCount)
  const t = todayStr()

  const [adding, setAdding] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [counting, setCounting] = useState(false)

  // a notification asked for the count
  useEffect(() => {
    if (!openCountFlag) return
    setCounting(true)
    useNativeFeed.setState({ openCount: false })
  }, [openCountFlag])

  // batches for compounds that are not in my protocol: owned, so still listed
  const others = useMemo(() => groupStock(vials, peptides).filter((g) => !g.inStack), [vials, peptides])
  const waste = wasteInYear(finishedVials, t.slice(0, 4))
  const due = countDue({ now: new Date(), last: lastCount, time: notif?.countTime || '18:00', on: notif?.countCheck !== false })
  const anySealed = vials.some((v) => (v.qtyOnHand || 0) > 0)

  return (
    <div className="space-y-4" data-testid="stock-room">
      <div className="flex gap-2">
        <button onClick={() => setAdding(true)} data-testid="add-stock"
          className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
          <Plus size={16} /> Order arrived
        </button>
        {anySealed && (
          <button onClick={() => setCounting(true)} data-testid="open-count"
            className="rounded-full px-5 py-3 text-sm font-black"
            style={due ? { background: 'var(--surface-sunk)', color: 'var(--text)' } : GHOST}>
            {due ? 'Count due' : 'Count'}
          </button>
        )}
      </div>

      {rows.length === 0 && others.length === 0 && (
        <div className="card p-5 text-center text-sm" style={{ color: 'var(--text-2)' }}>Nothing in stock yet.</div>
      )}

      <div className="space-y-2" data-testid="stock-groups">
        {rows.map((r) => <StockRow key={r.peptideId} row={r} onOpen={() => setDetailId(r.peptideId)} />)}
        {others.map((g) => (
          <button key={g.peptideId} onClick={() => setDetailId(g.peptideId)} data-testid="stock-group" data-peptide={g.peptideId}
            className="card block w-full p-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-tight">{g.name}</p>
                <p className="mt-1 text-xs tabular-nums leading-tight" style={{ color: 'var(--text-2)' }}>
                  {g.vialCount} sealed, not in my protocol
                </p>
              </div>
              <ChevronRight size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--text-3)' }} />
            </div>
          </button>
        ))}
      </div>

      <p className="px-1 text-sm font-medium" style={{ color: 'var(--text-3)' }} data-testid="stock-waste">
        Wasted this year: {round(waste.mg, 1)} mg{waste.vials ? ` (${waste.vials} vial${waste.vials === 1 ? '' : 's'})` : ''}
      </p>

      <OrderArrivedSheet open={adding} onClose={() => setAdding(false)} />
      <CountCheck open={counting} onClose={() => setCounting(false)} />
      <VialSheet peptideId={detailId} onClose={() => setDetailId(null)} goTo={goTo} peptides={peptides} />
    </div>
  )
}

function StockRow({ row: r, onOpen }) {
  const orderSoon = r.orderByDays != null && r.orderByDays <= ORDER_DOT_DAYS
  const orderColor = r.out ? 'var(--danger)' : orderSoon ? 'var(--warn)' : 'var(--text)'
  // the key number large: doses left in the open vial
  const big = r.open && r.dosesLeft != null ? r.dosesLeft : null
  return (
    <button onClick={onOpen} data-testid="stock-group" data-peptide={r.peptideId}
      className="card block w-full p-4 text-left">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-[17px] font-semibold">{r.name}</p>
        <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />
      </div>
      <div className="mt-1 flex items-baseline gap-2" data-testid="stock-open-line" style={{ color: r.out ? 'var(--danger)' : 'var(--text)' }}>
        {big != null
          ? <><span className="text-[26px] font-extrabold tabular-nums leading-none">{big}</span><span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{big === 1 ? 'dose' : 'doses'} left</span></>
          : <span className="text-[15px] font-semibold">{dosesLeftWords(r)}</span>}
        {!r.untracked && <span className="ml-auto text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{r.sealed} sealed</span>}
      </div>
      {!r.untracked && r.setUp && (
        <p className="mt-2 text-sm font-medium tabular-nums" data-testid="stock-order-line">
          {r.out
            ? <span className="font-semibold" style={{ color: orderColor }}>Order now</span>
            : r.runOutDate
              ? <><span className="font-semibold" style={{ color: orderColor }}>Order by {shortDate(r.orderBy)}</span><span style={{ color: 'var(--text-2)' }}> · runs out {shortDate(r.runOutDate)}</span></>
              : <span style={{ color: 'var(--text-2)' }}>No run-out date yet</span>}
        </p>
      )}
      {!r.untracked && !r.setUp && (
        <p className="mt-2 text-sm font-medium" style={{ color: 'var(--text-3)' }}>No dose set, so no run-out date</p>
      )}
      {r.expiry?.showUseBy && (
        <p className="mt-1 text-sm font-medium tabular-nums"
          style={{ color: r.expiry.expired ? 'var(--danger)' : 'var(--warn)' }} data-testid="stock-use-by">
          {r.expiry.expired ? `Past its fridge life, ${r.expiry.useBy.toLowerCase()}` : r.expiry.useBy}
        </p>
      )}
      {r.needsMixing && (
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>Not mixed yet</p>
      )}
    </button>
  )
}

// -------------------------------------------------------------- one compound

/**
 * Everything about one compound's vials: the open one, the sealed batches, the
 * history, and the two settings that drive the forecast. Mark finished and
 * Adjust are here for the odd case; the normal way a vial changes is the
 * question after a log.
 */
function VialSheet({ peptideId, onClose, goTo }) {
  const rows = useStockRows()
  const inProtocol = useStore((s) => s.peptides.some((p) => p.id === peptideId))
  const protocolPeptide = useStore((s) => s.peptides.find((p) => p.id === peptideId))
  const vials = useStore((s) => s.vials)
  const doseLogs = useStore((s) => s.doseLogs)
  const sharedDraws = useStore((s) => s.sharedDraws)
  const finishedVials = useStore((s) => s.finishedVials)
  const finishVial = useStore((s) => s.finishVial)
  const startNewVial = useStore((s) => s.startNewVial)
  const adjustOpenVial = useStore((s) => s.adjustOpenVial)
  const markVialMixed = useStore((s) => s.markVialMixed)
  const adjustVialQty = useStore((s) => s.adjustVialQty)
  const removeVial = useStore((s) => s.removeVial)
  const updatePeptide = useStore((s) => s.updatePeptide)
  const [confirming, setConfirming] = useState(false)
  const [adjusting, setAdjusting] = useState(null)
  const [about, setAbout] = useState(false)

  const row = rows.find((r) => r.peptideId === peptideId)
  // stock for a compound that is not in my protocol: the batches only, nothing to count down or forecast
  const heldName = vials.find((v) => v.peptideId === peptideId)?.name || peptideId
  const peptide = protocolPeptide || (peptideId ? { id: peptideId, name: heldName, recon: {} } : null)
  if (!peptide || (inProtocol && !row)) return <Modal open={false} onClose={onClose} title="" />
  const open = row?.open
  const left = open ? remainingMg(open, doseLogs, sharedDraws) : 0
  const batches = vials.filter((v) => v.peptideId === peptideId)
  const history = vialHistory(finishedVials, peptideId)
  const batch = open ? vials.find((v) => v.id === open.batchId) : null

  const close = () => { setConfirming(false); setAdjusting(null); onClose() }

  return (
    <>
      <Modal open={!!peptideId} onClose={close} title={peptide.name}>
        <div className="space-y-5 pb-2" data-testid="vial-sheet">
          {/* the open vial */}
          {inProtocol && (<section className="space-y-2" data-testid="open-vial">
            <h3 className="t-caption" style={{ color: 'var(--text-3)' }}>Open vial</h3>
            {open ? (
              <>
                <p className="text-sm font-bold tabular-nums" data-testid="open-left">
                  {round(Math.max(0, left), 2)} of {open.vialMg} mg left
                  <span className="font-medium" style={{ color: 'var(--text-2)' }}> · {dosesLeftWords(row)}</span>
                </p>
                {left < -1e-6 && (
                  <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                    {round(-left, 2)} mg more than the label so far. This is kept when the vial is finished.
                  </p>
                )}
                <p className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {open.reconstitutedAt ? `Mixed ${shortDate(open.reconstitutedAt)}` : 'Not mixed yet'}
                  {open.volumeMl ? ` · ${open.volumeMl} mL` : ''}
                  {open.lot ? ` · batch ${open.lot}` : ''}
                </p>
                {row.expiry && (
                  <p className="text-xs tabular-nums" style={{ color: row.expiry.showUseBy ? 'var(--warn)' : 'var(--text-2)' }}>
                    {row.expiry.useBy}
                  </p>
                )}
                {!open.reconstitutedAt && (
                  <button onClick={() => markVialMixed(peptideId)} data-testid="mixed-today"
                    className="rounded-full px-4 py-2 text-xs font-black" style={GHOST}>Mixed today</button>
                )}

                {adjusting == null ? (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setAdjusting(String(round(Math.max(0, left), 2)))} data-testid="adjust-open"
                      className="flex-1 rounded-full py-2 text-xs font-black" style={GHOST}>Adjust</button>
                    {!confirming ? (
                      <button onClick={() => setConfirming(true)} data-testid="finish-open"
                        className="flex-1 rounded-full py-2 text-xs font-black" style={GHOST}>Mark vial finished</button>
                    ) : (
                      <button onClick={() => { finishVial(peptideId); setConfirming(false) }} data-testid="finish-open-yes"
                        className="flex-1 rounded-full py-2 text-xs font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--danger)' }}>
                        Finish it
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
                    <Field label="What is left (mg)">
                      <NumberField value={Number(adjusting) || 0} min={0} aria-label="mg left" data-testid="adjust-value"
                        onChange={(v) => setAdjusting(String(v ?? 0))} />
                    </Field>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      Use this for a dose that was never logged or a spill. It is kept as an adjustment on this vial.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setAdjusting(null)} className="flex-1 rounded-full py-2 text-xs font-black" style={GHOST}>Cancel</button>
                      <button onClick={() => { adjustOpenVial(peptideId, Number(adjusting), 'adjusted'); setAdjusting(null) }}
                        data-testid="adjust-save" className="btn-primary flex-1 rounded-full py-2 text-xs font-black">Save</button>
                    </div>
                  </div>
                )}
                {confirming && (
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                    This marks the vial finished and does not open another. Tap Finish it to confirm.
                  </p>
                )}
                {batch && (open.vialMg || 0) > 0 && (
                  <SharedVial batch={batch} peptide={peptide} openVial={open} />
                )}
              </>
            ) : (
              <>
                <p className="text-sm" style={{ color: row.out ? 'var(--danger)' : 'var(--text-2)' }}>
                  {row.out ? 'Out of stock. No sealed vial is left.' : row.untracked ? 'Not tracked.' : 'No vial is open.'}
                </p>
                {row.sealed > 0 && (
                  <button onClick={() => { startNewVial(peptideId, { reason: 'open' }); close() }} data-testid="open-a-vial"
                    className="btn-primary rounded-full px-5 py-2 text-xs font-black">Open a vial</button>
                )}
              </>
            )}
          </section>)}

          {/* forecast */}
          {inProtocol && !row.untracked && row.setUp && (
            <section className="space-y-1" data-testid="forecast">
              <h3 className="t-caption" style={{ color: 'var(--text-3)' }}>Forecast</h3>
              <p className="text-sm tabular-nums">
                {row.out ? 'Out now.' : row.runOutDate ? `Runs out ${shortDate(row.runOutDate)}.` : 'No run-out date yet.'}
                {row.orderBy && !row.out ? ` Order by ${shortDate(row.orderBy)}.` : ''}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                Walked through your real schedule: titration steps, cycles, pauses and how often you dose, across the open vial and {row.sealed} sealed.
              </p>
            </section>
          )}

          {/* sealed batches */}
          <section className="space-y-2">
            <h3 className="t-caption" style={{ color: 'var(--text-3)' }}>Sealed</h3>
            {batches.length === 0 && <p className="text-sm" style={{ color: 'var(--text-2)' }}>No batches on the shelf.</p>}
            {batches.map((b) => (
              <BatchRow key={b.id} batch={b} peptide={peptide} inUse={open?.batchId === b.id}
                oldest={sealedBatches(vials, peptideId)[0]?.id === b.id}
                onAdjust={(d) => adjustVialQty(b.id, d, 'adjusted')} onRemove={() => removeVial(b.id)} />
            ))}
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>The oldest batch is opened first.</p>
          </section>

          {/* settings */}
          {inProtocol && (<section className="space-y-3">
            <h3 className="t-caption" style={{ color: 'var(--text-3)' }}>Settings</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fridge life after mixing (days)">
                <NumberField value={fridgeLifeDays(peptide)} min={0} integer aria-label="Fridge life in days" data-testid="fridge-life"
                  onChange={(v) => updatePeptide(peptideId, { recon: { ...peptide.recon, expiryDays: Math.max(0, v ?? 0) } })} />
              </Field>
              <Field label="Delivery takes (days)">
                <NumberField value={orderLeadDays(peptide)} min={0} integer aria-label="Delivery lead time in days" data-testid="order-lead"
                  onChange={(v) => updatePeptide(peptideId, { orderLeadDays: Math.max(0, v ?? 0) })} />
              </Field>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Zero days for fridge life means no clock. The order date is the run-out date less the delivery time.
            </p>
          </section>)}

          {/* history */}
          {history.length > 0 && (
            <section className="space-y-2" data-testid="vial-history">
              <h3 className="t-caption" style={{ color: 'var(--text-3)' }}>Vial history</h3>
              {history.map((f) => <HistoryRow key={f.id} f={f} />)}
            </section>
          )}

          {inProtocol && (
            <button onClick={() => setAbout(true)} className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-black" style={GHOST}>
              <FileText size={12} /> About {peptide.name}
            </button>
          )}
        </div>
      </Modal>
      <CompoundSheet open={about} compoundId={peptideId} onClose={() => setAbout(false)} goTo={goTo} />
    </>
  )
}

function HistoryRow({ f }) {
  const days = f.activatedAt && f.finishedAt ? Math.max(0, Math.round((Date.parse(f.finishedAt) - Date.parse(f.activatedAt)) / 86400000)) : null
  const bits = [
    `${f.vialMg} mg`,
    f.activatedAt ? `${shortDate(f.activatedAt.slice(0, 10))} to ${shortDate(f.date)}` : shortDate(f.date),
    days != null ? `${days} day${days === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  const notes = []
  if (f.overfillMg > 0) notes.push(`overfill ${round(f.overfillMg, 2)} mg`)
  if (f.wasteMg > 0) notes.push(`thrown out with ${round(f.wasteMg, 2)} mg left`)
  if (f.leftoverMg > 0) notes.push(`${round(f.leftoverMg, 2)} mg left when finished`)
  return (
    <div className="text-xs tabular-nums leading-snug" data-testid="history-row" style={{ color: 'var(--text-2)' }}>
      {bits.join(' · ')}
      {notes.length > 0 && <span style={{ color: 'var(--text-3)' }}>{` · ${notes.join(', ')}`}</span>}
    </div>
  )
}

/**
 * What this batch costs, in money rather than in USD.
 *
 * Two figures because they answer different questions: per vial is what the
 * order costs, per dose is what tonight costs. Both are worked out here from
 * the vial's USD price and the rate in Settings — neither is stored, so both
 * move the moment the rate does.
 */
function VialCost({ batch: b, peptide }) {
  const m = useMoney()
  const updateVial = useStore((s) => s.updateVial)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(b.usdPerVial ?? 0)

  const perVial = m.vial(b.usdPerVial)
  const doseMg = m.doseMgFor(b.peptideId)
  const perDose = m.dose(b.usdPerVial, b.vialMg, doseMg)
  const sizes = sizesFor(peptide?.name || b.name)

  if (editing) {
    return (
      <div className="mt-1 flex items-center gap-1" data-testid="vial-price-edit">
        <span className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>USD</span>
        <NumberField className="!w-20 !px-2 !py-1 text-center" value={draft} min={0}
          aria-label="USD per vial" onChange={(n) => setDraft(n ?? 0)} />
        <button data-testid="vial-price-save"
          onClick={() => { updateVial(b.id, { usdPerVial: draft > 0 ? draft : null }); setEditing(false) }}
          className="rounded-full px-2 py-1 text-xs font-black"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Save</button>
        <button onClick={() => { setDraft(b.usdPerVial ?? 0); setEditing(false) }}
          className="rounded-full px-2 py-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>Cancel</button>
      </div>
    )
  }

  return (
    <button onClick={() => setEditing(true)} data-testid="vial-cost"
      className="mt-1 block text-left text-xs font-bold leading-tight">
      {perVial == null ? (
        <>
          <span style={{ color: 'var(--warn)' }}>No price set.</span>
          <span className="ml-1 font-medium" style={{ color: 'var(--text-2)' }}>
            Tap to enter USD per vial
            {sizes.length > 0 && ` (priced at ${sizes.map((s) => `${s.mg_per_vial} mg`).join(', ')})`}
          </span>
        </>
      ) : (
        <>
          <span style={{ color: 'var(--text)' }}>{m.fmt(perVial)}/vial</span>
          {perDose != null && (
            <span className="ml-2" style={{ color: 'var(--text-2)' }}>
              {m.fmt(perDose)}/dose
            </span>
          )}
          <span className="ml-1 font-medium" style={{ color: 'var(--text-3)' }}>
            · ${b.usdPerVial} USD
          </span>
        </>
      )}
    </button>
  )
}


function BatchRow({ batch: b, peptide, inUse, oldest, onAdjust, onRemove }) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (confirmDelete) {
    return (
      <div className="rounded-[14px] p-3" data-testid="confirm-delete-batch" style={{ background: 'var(--surface-sunk)' }}>
        <p className="text-xs font-black" style={{ color: 'var(--danger)' }}>Delete this {b.vialMg} mg batch?</p>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {b.qtyOnHand || 0} sealed vial{(b.qtyOnHand || 0) === 1 ? '' : 's'} and any COA come off the shelf. Your protocol and your logged doses are untouched.
        </p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-full py-2 text-xs font-black" style={GHOST}>Keep it</button>
          <button onClick={() => { setConfirmDelete(false); onRemove() }} data-testid="confirm-delete-batch-yes"
            className="flex-1 rounded-full py-2 text-xs font-black" style={{ background: 'var(--surface)', color: 'var(--danger)' }}>Delete</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="batch-row">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-black tabular-nums"
          style={{ background: 'var(--surface)', color: 'var(--text)' }}>{b.qtyOnHand || 0}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">
            {b.vialMg} mg
            {inUse && <span className="ml-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>in use</span>}
            {!inUse && oldest && (b.qtyOnHand || 0) > 0 && <span className="ml-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>next</span>}
          </p>
          <p className="text-xs leading-tight" style={{ color: 'var(--text-2)' }}>{b.vendor || 'No vendor recorded'}</p>
          <p className="text-xs leading-tight" style={{ color: 'var(--text-2)' }}>
            {b.lot ? `batch ${b.lot}` : 'No batch recorded'}{b.sealedExpiry ? ` · exp ${b.sealedExpiry}` : ''}
          </p>
          <VialCost batch={b} peptide={peptide} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <CoaButton batch={b} />
          <div className="flex items-center gap-1">
            <button onClick={() => onAdjust(-1)} aria-label={`One fewer ${b.vialMg} mg`}
              className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
              <Minus size={12} />
            </button>
            <button onClick={() => onAdjust(1)} aria-label={`One more ${b.vialMg} mg`}
              className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
              <Plus size={12} />
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <button onClick={() => setConfirmDelete(true)} aria-label={`Delete the ${b.vialMg} mg batch`}
          className="rounded-full px-3 py-1" style={{ background: 'var(--surface)', color: 'var(--text-3)' }}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// --------------------------------------------------------- the shared vial

/**
 * Who draws on this vial, and how long it lasts with all of them on it.
 *
 * Doses-left is reported per person rather than as one number, because with two
 * different dose sizes one number is wrong for at least one of them. The single
 * figure that is shared — and the one that decides when to reorder — is how many
 * days the vial has left with everybody drawing.
 */
function SharedVial({ batch: b, peptide, openVial }) {
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const addDrawProfile = useStore((s) => s.addDrawProfile)
  const updateDrawProfile = useStore((s) => s.updateDrawProfile)
  const removeDrawProfile = useStore((s) => s.removeDrawProfile)
  const logSharedDraw = useStore((s) => s.logSharedDraw)
  const [open, setOpen] = useState(false)

  const remainingMg = openVialRemainingMg(peptide, openVial, doseLogs)
  const d = drawdown(b, peptide, titration[b.peptideId], remainingMg)

  return (
    <div className="mt-3 rounded-[14px] p-3" style={{ background: 'var(--surface)' }} data-testid="drawdown">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <Users size={13} className="shrink-0" style={{ color: 'var(--text-2)' }} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-black leading-tight">
            {round(d.remainingMg, 2)} mg left · empties in {emptiesInWords(d)}
          </span>
          <span className="block text-xs font-semibold leading-tight" style={{ color: 'var(--text-2)' }}>
            {d.shared
              ? `${d.profiles.length} people drawing · ${round(d.combinedMgPerWeek, 2)} mg a week between them`
              : 'Just me · tap to share this vial'}
          </span>
        </span>
        <ChevronRight size={14} className="shrink-0 transition-transform"
          style={{ color: 'var(--text-2)', transform: open ? 'rotate(90deg)' : 'none' }} />
      </button>

      {/* Per-profile doses-left is always visible, shared or not: it is the
          number the person standing at the fridge is actually after. */}
      <div className="mt-2 space-y-1" data-testid="draw-profiles">
        {d.profiles.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-xs font-bold" data-testid="draw-profile">
            <span className="min-w-0 flex-1 truncate">
              {p.label}
              <span className="ml-1 font-semibold" style={{ color: 'var(--text-2)' }}>
                {round(p.doseMg, 3)} mg · {p.perWeek}×/wk
              </span>
            </span>
            <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-2)' }}>
              {p.dosesLeft} left
            </span>
            {!p.owner && (
              <button onClick={() => logSharedDraw(b.peptideId, p.id)} data-testid="log-shared-draw"
                aria-label={`Log a draw for ${p.label}`}
                className="shrink-0 rounded-full px-2 py-1 text-xs font-black"
                style={{ background: 'var(--surface-sunk)', color: 'var(--good)' }}>
                Log draw
              </button>
            )}
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          {(b.drawProfiles || []).map((p) => (
            <div key={p.id} className="flex items-center gap-2" data-testid="draw-profile-edit">
              <input className="input !px-2 !py-1 !text-xs" value={p.label}
                aria-label="Who draws" placeholder="Who"
                onChange={(e) => updateDrawProfile(b.id, p.id, { label: e.target.value })} />
              <NumberField className="!w-16 !px-2 !py-1 text-center !text-xs" value={p.doseMg} min={0}
                aria-label="Their dose in mg"
                onChange={(n) => updateDrawProfile(b.id, p.id, { doseMg: n ?? 0 })} />
              <select className="input !w-24 !px-2 !py-1 !text-xs" value={p.frequency}
                aria-label="How often they draw"
                onChange={(e) => updateDrawProfile(b.id, p.id, { frequency: e.target.value })}>
                {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <button onClick={() => removeDrawProfile(b.id, p.id)} aria-label={`Remove ${p.label}`}
                className="shrink-0 rounded-full p-1" style={{ color: 'var(--danger)' }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button onClick={() => addDrawProfile(b.id, { doseMg: d.profiles[0]?.doseMg || 0 })}
            data-testid="add-draw-profile"
            className="flex w-full items-center justify-center gap-2 rounded-full py-2 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            <Plus size={12} /> Someone else draws from this vial
          </button>
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Each person's "left" is how many more <em>they</em> could get out of it on their own. Those
            counts overlap, because there is only one vial. The days figure is the one that empties it.
          </p>
        </div>
      )}
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
        className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-black"
        style={b.coaKey
          ? { background: 'color-mix(in srgb, var(--info) 20%, transparent)', color: 'var(--info)' }
          : { background: 'var(--surface)', color: 'var(--text-2)' }}>
        {b.coaKey ? <FileText size={12} /> : <Paperclip size={12} />}
        {busy ? '…' : 'COA'}
      </button>
    </>
  )
}

// ------------------------------------------------------------- order arrived

export function OrderArrivedSheet({ open, onClose, presetId = null }) {
  const peptides = useStore((s) => s.peptides)
  const addVial = useStore((s) => s.addVial)
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

  // opened from a compound's own row: skip the picker
  useEffect(() => {
    if (!open || !presetId || picked || !matrix) return
    const c = matrix.compounds.find((x) => x.id === presetId)
    if (c) choose(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetId, matrix])

  const close = () => { setPicked(null); setDraft(null); setQuery(''); setCoa(null); onClose() }

  // Any of the 86 compounds can become a batch — it doesn't need to already be
  // in my protocol. If it already has a protocol entry, its own vial size
  // seeds the form; otherwise the form starts blank and the user's own numbers
  // are what get recorded.
  const choose = (c) => {
    const existing = existingById.get(c.id) || null
    setPicked({ id: c.id, name: c.name, compound: c, existing })
    const base = blankBatch(existing)
    // The reference price for this compound at this vial size, as the starting
    // suggestion. Whatever the user types over it is what the vial cost — a
    // real receipt beats a table every time.
    const ref = referencePrice(c.name, base.vialMg)
    setDraft({ ...base, name: c.name, usdPerVial: ref ? ref.usd_per_vial : base.usdPerVial })
  }

  // Changing the vial size changes which reference row applies, so the
  // suggestion follows it — unless the user has already priced it themselves.
  const setVialMg = (mg) => {
    const ref = referencePrice(picked?.name, mg)
    const untouched = draft.usdPerVial == null
      || draft.usdPerVial === referencePrice(picked?.name, draft.vialMg)?.usd_per_vial
    setDraft({
      ...draft,
      vialMg: mg,
      usdPerVial: untouched ? (ref ? ref.usd_per_vial : null) : draft.usdPerVial,
    })
  }

  const save = async () => {
    if (!draft || !picked) return

    // Owning is not taking. A batch records what is physically on the shelf and
    // nothing else — no schedule, no Home card, no adherence. The compound id
    // is enough to tie it to the catalogue and, later, to a protocol item if
    // one is ever built for it. Creating that protocol item here would put a
    // dose on the calendar that the user never asked for.
    const peptideId = picked.id

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
      usdPerVial: draft.usdPerVial ?? null,
      qtyOnHand: Math.max(0, draft.qtyOnHand || 0),
      qtyPurchased: Math.max(0, draft.qtyOnHand || 0),
      lot: draft.lot,
      sealedExpiry: draft.sealedExpiry,
      coaKey, coaMeta,
    })
    close()
  }

  return (
    <Modal open={open} onClose={close} title={picked ? `Order arrived: ${picked.name}` : 'Order arrived'}
      pinned={picked ? null : (
        // pinned rather than scrolled with the results: typing is what makes
        // the list change, so the field that drives it has to stay on screen
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-2)' }} />
          <input className="input !pl-10" placeholder={`Search ${matrix ? matrix.compounds.length : 86} compounds…`}
            aria-label="Search compounds" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}>
      {!picked ? (
        <div className="space-y-3" data-testid="stock-picker">
          {loadFailed ? (
            <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--warn)' }}>
              Could not load the compound list. Try again in a moment.
            </p>
          ) : !matrix ? (
            <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Loading compounds…</p>
          ) : (
            // no scroll box of its own: a list nested inside the sheet's own
            // scroller was what let results run on under the keyboard
            <div className="space-y-2" data-testid="stock-results">
              {results.map((c) => {
                const existing = existingById.get(c.id)
                return (
                  <button key={c.id} onClick={() => choose(c)}
                    className="flex w-full items-center gap-2 rounded-[14px] p-3 text-left"
                    style={{ background: 'var(--surface-sunk)' }}>
                    <Package size={14} className="shrink-0" style={{ color: 'var(--text-3)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold leading-tight">{c.name}</p>
                      <p className="truncate text-xs font-semibold leading-tight" style={{ color: 'var(--text-2)' }}>
                        {existing
                          ? `${existing.recon?.vialMg || 0} mg per vial in my protocol`
                          : `${c.class} · not in my protocol`}
                      </p>
                    </div>
                    <ChevronRight size={14} style={{ color: 'var(--text-2)' }} />
                  </button>
                )
              })}
              {results.length === 0 && (
                <p className="py-4 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
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
                onChange={(v) => setVialMg(v ?? 0)} min={0} />
            </Field>
            <Field label="How many arrived">
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
            <Field label="Cost each (USD)">
              <NumberField value={draft.usdPerVial ?? 0} aria-label="USD per vial"
                data-testid="batch-usd"
                onChange={(v) => setDraft({ ...draft, usdPerVial: v > 0 ? v : null })} min={0} />
            </Field>
            <Field label="Batch (optional)">
              <input className="input" value={draft.lot} aria-label="Batch"
                onChange={(e) => setDraft({ ...draft, lot: e.target.value })} />
            </Field>
          </div>
          <Field label="Sealed expiry (optional)">
            <PickerField kind="date" label="Sealed expiry" value={draft.sealedExpiry || null} emptyText="None"
              testid="sealed-expiry" onChange={(v) => setDraft({ ...draft, sealedExpiry: v || '' })} />
          </Field>

          <CostLine draft={draft} peptideId={picked.id} />

          <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
            aria-label="COA file" onChange={(e) => setCoa(e.target.files?.[0] || null)} />
          <button onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-black"
            style={coa
              ? { background: 'color-mix(in srgb, var(--info) 18%, transparent)', color: 'var(--info)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {coa ? <><CheckCircle2 size={14} /> {coa.name}</> : <><Paperclip size={14} /> Attach a COA (optional)</>}
          </button>

          <div className="flex gap-2">
            <button onClick={() => { setPicked(null); setDraft(null) }}
              className="flex-1 rounded-full py-3 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              Back
            </button>
            <button onClick={save} data-testid="save-batch"
              className="btn-primary flex-1 rounded-full py-3 text-xs font-black">
              Add to stock
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}


// ------------------------------------------------------------ the weekly count

/**
 * One screen: each batch with how many sealed vials are expected, a tick to
 * confirm it and plus and minus to correct it. "All correct" confirms the lot.
 * Only a difference is written, with the reason "count check".
 */
export function CountCheck({ open, onClose }) {
  const vials = useStore((s) => s.vials)
  const peptides = useStore((s) => s.peptides)
  const applyCountCheck = useStore((s) => s.applyCountCheck)
  const skipCountCheck = useStore((s) => s.skipCountCheck)
  const groups = useMemo(() => countRows(vials, peptides), [vials, peptides])
  const [counts, setCounts] = useState({})
  const [ticked, setTicked] = useState({})

  const value = (b) => (b.id in counts ? counts[b.id] : b.expected)
  const changed = groups.some((g) => g.batches.some((b) => value(b) !== b.expected))
  const close = () => { setCounts({}); setTicked({}); onClose() }
  const save = () => { applyCountCheck(counts); close() }
  const skip = () => { skipCountCheck(); close() }

  return (
    <Modal open={open} onClose={close} title="Weekly count">
      <div className="space-y-4 pb-2" data-testid="count-check">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Check the sealed vials against the shelf. Tick what is right, or change the number.
        </p>
        {groups.length === 0 && <p className="text-sm" style={{ color: 'var(--text-2)' }}>Nothing sealed to count.</p>}
        {groups.map((g) => (
          <section key={g.peptideId} className="space-y-2">
            <h3 className="text-sm font-bold">{g.name}</h3>
            {g.batches.map((b) => {
              const n = value(b)
              const ok = !!ticked[b.id] || n !== b.expected
              return (
                <div key={b.id} className="flex items-center gap-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="count-row">
                  <button onClick={() => setTicked({ ...ticked, [b.id]: !ticked[b.id] })} aria-label={`Confirm ${g.name} ${b.vialMg} mg`}
                    aria-pressed={ok} data-testid="count-tick"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={ok ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface)', color: 'var(--text-3)' }}>
                    <Check size={14} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-tight tabular-nums">{b.vialMg} mg</p>
                    <p className="text-xs leading-tight" style={{ color: 'var(--text-2)' }}>
                      {b.lot ? `batch ${b.lot}` : b.vendor || 'Expected ' + b.expected}
                    </p>
                  </div>
                  <button onClick={() => setCounts({ ...counts, [b.id]: Math.max(0, n - 1) })} aria-label="One fewer"
                    className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                    <Minus size={12} />
                  </button>
                  <span className="w-6 text-center text-sm font-black tabular-nums" data-testid="count-value">{n}</span>
                  <button onClick={() => setCounts({ ...counts, [b.id]: n + 1 })} aria-label="One more"
                    className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                    <Plus size={12} />
                  </button>
                </div>
              )
            })}
          </section>
        ))}
        <div className="flex gap-2">
          <button onClick={skip} data-testid="count-skip" className="rounded-full px-5 py-3 text-sm font-black" style={GHOST}>Skip</button>
          <button onClick={save} data-testid="count-all-correct" className="btn-primary flex-1 rounded-full py-3 text-sm font-black">
            {changed ? 'Save counts' : 'All correct'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** What the order costs per mg and per dose, from the price just typed. */
function CostLine({ draft, peptideId }) {
  const m = useMoney()
  const doseMg = m.doseMgFor(peptideId)
  const perVial = draft.usdPerVial
  if (!(perVial > 0) || !(draft.vialMg > 0)) return null
  const perMg = m.vial(perVial / draft.vialMg)
  const perDose = doseMg > 0 ? m.dose(perVial, draft.vialMg, doseMg) : null
  return (
    <p className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="order-cost">
      {m.fmt(perMg)} per mg{perDose != null ? ` · ${m.fmt(perDose)} per dose` : ''}
    </p>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}
