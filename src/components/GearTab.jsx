import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import GearForm from './gear/GearForm'
import {
  groupByCategory, describeItem, quantityWords, matchingSpares, lowStockIds,
  estimateBox, specKey, durationWords,
} from '../lib/gear'

const pretty = (d) => format(parseISO(d), 'd MMM yyyy')

/**
 * Supplies and equipment.
 *
 * The gear injected with, kept apart from peptide stock: nothing on this screen
 * reads or changes a vial, a dose or a run-out date. Two states — the box in use
 * and the spares behind it — with the one real action, Finished, swapping a
 * matching spare in and writing a dated record so how long a box lasts can be
 * read back from history.
 */
export default function GearTab() {
  const items = useStore((s) => s.gearItems)
  const swaps = useStore((s) => s.gearSwaps)
  const confirmItem = useStore((s) => s.confirmGearItem)

  const [form, setForm] = useState(null) // { itemId?, prefill? }
  const [finishing, setFinishing] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const inUse = useMemo(() => groupByCategory(items, 'in_use'), [items])
  const stock = useMemo(() => groupByCategory(items, 'stock'), [items])
  const low = useMemo(() => new Set(lowStockIds(items)), [items])
  const now = useMemo(() => new Date(), [])

  const inUseCount = items.filter((i) => i.status === 'in_use').length

  return (
    <div className="space-y-3" data-testid="gear-screen">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Supplies</h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          Needles, syringes, swabs and sharps. Kept separate from peptide stock.
        </p>
      </div>

      <button
        data-testid="gear-add"
        onClick={() => setForm({})}
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black"
      >
        <Plus size={16} /> Add an item
      </button>

      {low.size > 0 && (
        <p className="px-1 text-xs font-medium leading-snug" data-testid="gear-low-summary" style={{ color: 'var(--warn)' }}>
          {low.size} of {inUseCount} in use {low.size === 1 ? 'has' : 'have'} no spare behind {low.size === 1 ? 'it' : 'them'}.
        </p>
      )}

      <Section title="In use" count={inUseCount} testId="gear-in-use">
        {inUse.length === 0 && <Empty text="Nothing in use. Add an item and set its state to In use." />}
        {inUse.map((g) => (
          <Group key={g.category} category={g.category}>
            {g.items.map((item) => (
              <InUseRow
                key={item.id}
                item={item}
                low={low.has(item.id)}
                estimate={estimateBox(swaps, specKey(item), { current: item, now })}
                onEdit={() => setForm({ itemId: item.id })}
                onFinish={() => setFinishing(item.id)}
                onConfirm={() => confirmItem(item.id)}
              />
            ))}
          </Group>
        ))}
      </Section>

      <Section title="Spare stock" count={items.filter((i) => i.status === 'stock').length} testId="gear-stock">
        {stock.length === 0 && <Empty text="No spares. Add stock so a finished box can be swapped for a new one." />}
        {stock.map((g) => (
          <Group key={g.category} category={g.category}>
            {g.items.map((item) => (
              <StockRow key={item.id} item={item} onEdit={() => setForm({ itemId: item.id })} onConfirm={() => confirmItem(item.id)} />
            ))}
          </Group>
        ))}
      </Section>

      <History swaps={swaps} open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)} />

      <GearForm
        open={!!form}
        itemId={form?.itemId || null}
        prefill={form?.prefill || null}
        onClose={() => setForm(null)}
      />
      <FinishSheet
        // hidden while the form is up, so two sheets never stack: it comes
        // straight back, with its list recalculated, once the stock is added
        open={!!finishing && !form}
        itemId={finishing}
        onClose={() => setFinishing(null)}
        onAddStock={(item) => setForm({
          prefill: {
            category: item.category, status: 'stock', qty: 1, unit: item.unit,
            gauge: item.gauge, lengthMm: item.lengthMm, syringeType: item.syringeType,
            volumeMl: item.volumeMl, name: item.name, brand: item.brand, vendor: item.vendor,
          },
        })}
      />
    </div>
  )
}

function Section({ title, count, children, testId }) {
  return (
    <section className="space-y-3 pt-3" data-testid={testId}>
      <h2 className="t-caption px-1" style={{ color: 'var(--text-3)' }}>
        {title} <span className="tabular-nums">· {count}</span>
      </h2>
      {children}
    </section>
  )
}

function Group({ category, children }) {
  return (
    <div>
      <h3 className="t-caption mb-1.5 px-1 font-black" data-testid={`gear-cat-${category}`} style={{ color: 'var(--text-2)' }}>{category}</h3>
      <div className="card rows overflow-hidden">{children}</div>
    </div>
  )
}

const Empty = ({ text }) => (
  <div className="card p-4 text-center text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>{text}</div>
)

/** The one-line meta under a spec: brand, vendor, cost. */
function meta(item) {
  const bits = [item.brand, item.vendor].filter(Boolean)
  if (item.cost != null) bits.push(`$${Number(item.cost).toFixed(2)} each`)
  return bits.join(' · ')
}

/** "Confirm quantity", with the reason it is asking, until it is edited or dismissed. */
function VerifyPrompt({ item, onConfirm }) {
  if (!item.verify) return null
  return (
    <div
      className="mt-2 rounded-[var(--r-sm)] p-2.5"
      data-testid={`gear-verify-${item.id}`}
      style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)' }}
    >
      <p className="text-xs font-black" style={{ color: 'var(--warn)' }}>Confirm quantity</p>
      {item.note && <p className="text-xs font-medium leading-snug mt-0.5" style={{ color: 'var(--text-2)' }}>{item.note}</p>}
      <button className="chip mt-2" data-testid={`gear-confirm-${item.id}`} onClick={onConfirm}>Looks right</button>
    </div>
  )
}

function InUseRow({ item, low, estimate, onEdit, onFinish, onConfirm }) {
  return (
    <div className="p-4" data-testid={`gear-row-${item.id}`} data-status="in_use">
      <button className="flex w-full items-start gap-3 text-left" onClick={onEdit} data-testid={`gear-edit-${item.id}`}>
        <span className="min-w-0 flex-1">
          <span className="t-label block break-words">{describeItem(item)}</span>
          {meta(item) && <span className="text-xs font-medium leading-snug block" style={{ color: 'var(--text-3)' }}>{meta(item)}</span>}
          {item.note && !item.verify && <span className="text-xs font-medium leading-snug block" style={{ color: 'var(--text-3)' }}>{item.note}</span>}
        </span>
        <span className="t-label shrink-0 tabular-nums">{quantityWords(item)}</span>
      </button>

      {low && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-black" data-testid={`gear-low-${item.id}`} style={{ color: 'var(--warn)' }}>
          <AlertTriangle size={13} /> Low stock: no spare behind this
        </p>
      )}
      <VerifyPrompt item={item} onConfirm={onConfirm} />
      {estimate && <Estimate estimate={estimate} id={item.id} />}

      <button
        data-testid={`gear-finish-${item.id}`}
        onClick={onFinish}
        className="mt-3 w-full rounded-full py-2.5 text-sm font-black"
        style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}
      >
        Finished
      </button>
    </div>
  )
}

function StockRow({ item, onEdit, onConfirm }) {
  return (
    <div className="p-4" data-testid={`gear-row-${item.id}`} data-status="stock">
      <button className="flex w-full items-start gap-3 text-left" onClick={onEdit} data-testid={`gear-edit-${item.id}`}>
        <span className="min-w-0 flex-1">
          <span className="t-label block break-words">{describeItem(item)}</span>
          {meta(item) && <span className="text-xs font-medium leading-snug block" style={{ color: 'var(--text-3)' }}>{meta(item)}</span>}
          {item.note && !item.verify && <span className="text-xs font-medium leading-snug block" style={{ color: 'var(--text-3)' }}>{item.note}</span>}
        </span>
        <span className="t-label shrink-0 tabular-nums">{quantityWords(item)}</span>
      </button>
      <VerifyPrompt item={item} onConfirm={onConfirm} />
    </div>
  )
}

/** How long a box lasts, said only once there is enough history to say it. */
function Estimate({ estimate, id }) {
  const { avgDays, boxes, runsOutOn, daysLeft } = estimate
  return (
    <p className="mt-2 text-xs font-medium leading-snug" data-testid={`gear-estimate-${id}`} style={{ color: 'var(--text-2)' }}>
      A box lasts about {durationWords(avgDays)} (from {boxes} boxes).
      {runsOutOn && (daysLeft >= 0
        ? ` This one runs out around ${pretty(runsOutOn)}.`
        : ' This one is past that.')}
    </p>
  )
}

/**
 * Finishing a box.
 *
 * Matching spares are listed with the oldest pre-selected. With none, it says so
 * and offers to add stock or just clear the slot — never a silent empty swap.
 * The list is recalculated live, so adding stock from here and coming back shows
 * the new box already selected.
 */
function FinishSheet({ open, itemId, onClose, onAddStock }) {
  const items = useStore((s) => s.gearItems)
  const finish = useStore((s) => s.finishGearItem)
  const item = items.find((i) => i.id === itemId)
  const spares = useMemo(() => (item ? matchingSpares(items, item) : []), [items, item])
  const [pick, setPick] = useState(null)
  const [date, setDate] = useState(todayStr())

  useEffect(() => {
    if (open) setDate(todayStr())
  }, [open, itemId])
  useEffect(() => {
    // keep a valid selection: the first match unless the chosen one is still there
    setPick((prev) => (spares.some((s) => s.id === prev) ? prev : spares[0]?.id || null))
  }, [spares])

  if (!item) return null
  const run = (promoteId) => {
    finish(item.id, { promoteId, date })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Finished">
      <div className="space-y-4" data-testid="gear-finish-sheet">
        <div>
          <p className="t-label">{describeItem(item)}</p>
          <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{item.category}</p>
        </div>

        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>Date finished</span>
          <input type="date" className="input" value={date} max={todayStr()} data-testid="gear-finish-date"
            onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>

        {spares.length > 0 ? (
          <>
            <div>
              <p className="text-xs font-medium leading-snug mb-2" style={{ color: 'var(--text-2)' }}>
                {spares.length === 1 ? 'A matching spare is ready.' : `${spares.length} matching spares. The oldest is chosen.`}
              </p>
              <div className="space-y-2" role="radiogroup">
                {spares.map((s) => (
                  <button
                    key={s.id} type="button" role="radio" aria-checked={pick === s.id}
                    data-testid={`gear-spare-${s.id}`} data-on={pick === s.id ? 'true' : 'false'}
                    onClick={() => setPick(s.id)}
                    className="flex w-full items-center gap-3 rounded-[var(--r-sm)] p-3 text-left"
                    style={{
                      background: pick === s.id ? 'color-mix(in srgb, var(--accent) 14%, var(--surface-sunk))' : 'var(--surface-sunk)',
                      border: `1px solid ${pick === s.id ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="t-label block">{[s.brand, s.vendor].filter(Boolean).join(' · ') || 'Spare'}</span>
                      <span className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{quantityWords(s)} in stock</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <button className="btn-primary w-full rounded-full py-3 text-sm font-black" data-testid="gear-swap" disabled={!pick} onClick={() => run(pick)}>
              Swap in this box
            </button>
            <button className="t-caption underline" data-testid="gear-clear" style={{ color: 'var(--text-3)' }} onClick={() => run(null)}>
              Just clear the slot
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-bold" data-testid="gear-no-match" style={{ color: 'var(--warn)' }}>
              No spare in stock matches this.
            </p>
            <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
              You can add stock now and swap it in, or clear the slot and leave it empty.
            </p>
            <button className="btn-primary w-full rounded-full py-3 text-sm font-black" data-testid="gear-add-stock" onClick={() => onAddStock(item)}>
              Add stock
            </button>
            <button className="w-full rounded-full py-3 text-sm font-black" data-testid="gear-clear"
              style={{ background: 'var(--surface-sunk)' }} onClick={() => run(null)}>
              Just clear the slot
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}

/** Every swap, newest first — the dates how long a box lasts is worked out from. */
function History({ swaps, open, onToggle }) {
  const remove = useStore((s) => s.removeGearSwap)
  const sorted = useMemo(() => [...swaps].sort((a, b) => b.date.localeCompare(a.date)), [swaps])
  const shown = open ? sorted : sorted.slice(0, 3)
  if (!sorted.length) return null
  return (
    <section className="space-y-2 pt-3" data-testid="gear-history">
      <h2 className="t-caption px-1" style={{ color: 'var(--text-3)' }}>Swap history <span className="tabular-nums">· {sorted.length}</span></h2>
      <div className="card rows overflow-hidden">
        {shown.map((s) => (
          <div key={s.id} className="flex items-start gap-3 p-3" data-testid={`gear-swap-${s.id}`}>
            <span className="t-caption w-24 shrink-0 tabular-nums" style={{ color: 'var(--text-3)' }}>{pretty(s.date)}</span>
            <span className="min-w-0 flex-1">
              <span className="t-label block break-words">{s.label}</span>
              <span className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
                {s.outcome === 'promoted' ? `Swapped for a spare${s.promotedBrand ? ` (${s.promotedBrand})` : ''}. ${s.sparesLeft} left.` : 'Slot cleared.'}
              </span>
            </span>
            <button className="t-caption shrink-0 underline" style={{ color: 'var(--text-3)' }} onClick={() => remove(s.id)}>Remove</button>
          </div>
        ))}
      </div>
      {sorted.length > 3 && (
        <button className="t-caption flex items-center gap-1 px-1 underline" style={{ color: 'var(--text-3)' }} onClick={onToggle} data-testid="gear-history-more">
          <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
          {open ? 'Show fewer' : `Show all ${sorted.length}`}
        </button>
      )}
    </section>
  )
}
