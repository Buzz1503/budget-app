import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'

/** How long the change can be taken back. */
export const UNDO_SECONDS = 10

export const CHANGE_TEXT = 'This vial should be about empty. Start a new one?'
export const NO_OPEN_TEXT = 'No vial is open. Start a new one?'
export const EXPIRED_TEXT = 'Has this vial been thrown out? Start a new one?'

const GHOST = { background: 'var(--surface-sunk)', color: 'var(--text-2)' }

/**
 * The one question after a log (or on the day a mixed vial goes off), and what
 * follows a Yes: the mixing recipe with a Mixed button, or the out of stock
 * state. Mounted once, over every screen. What is asked is re-derived from the
 * store, so a question that no longer applies (the dose was undone) is gone.
 */
export default function VialPromptHost({ goTo }) {
  const prompts = useStore((s) => s.vialPrompts)
  const change = useStore((s) => s.lastVialChange)
  const answer = useStore((s) => s.answerVialPrompt)
  const markMixed = useStore((s) => s.markVialMixed)
  const undo = useStore((s) => s.undoVialChange)
  const dismiss = useStore((s) => s.dismissVialChange)

  // seconds of Undo left, counted from the moment the vial was changed
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!change) { setLeft(0); return undefined }
    const tick = () => setLeft(Math.max(0, UNDO_SECONDS - Math.floor((Date.now() - change.at) / 1000)))
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [change])

  // a change with nothing left to do (nothing to mix) closes itself once Undo has run out
  useEffect(() => {
    if (change && left === 0 && change.opened && !change.needsMixing && !change.outOfStock) dismiss()
  }, [change, left, dismiss])

  if (change) {
    const heading = change.outOfStock ? 'Out of stock' : change.opened ? 'New vial open' : 'Vial finished'
    return (
      <Modal open onClose={dismiss} title={heading}>
        <div className="space-y-4 pb-2" data-testid="vial-change">
          <p className="text-sm font-bold">{change.name}</p>

          {change.outOfStock && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }} data-testid="vial-out">
              No sealed vial is left. The last one is marked finished.
            </p>
          )}
          {change.opened && change.needsMixing && change.recipe && (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed" data-testid="vial-recipe">{change.recipe.text}</p>
              <button onClick={() => markMixed(change.peptideId)} data-testid="vial-mixed"
                className="btn-primary w-full rounded-full py-3 text-sm font-black">
                Mixed
              </button>
            </div>
          )}
          {change.opened && change.mixed && (
            <p className="text-sm" style={{ color: 'var(--text-2)' }} data-testid="vial-mixed-done">Mixed today.</p>
          )}
          {change.opened && !change.needsMixing && !change.mixed && (
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>Nothing to mix. It is ready to use.</p>
          )}
          {change.overfillMg > 0 && (
            <p className="text-xs" style={{ color: 'var(--text-2)' }} data-testid="vial-overfill">
              The last vial gave {Math.round(change.overfillMg * 100) / 100} mg more than its label.
            </p>
          )}
          {change.wasteMg > 0 && (
            <p className="text-xs" style={{ color: 'var(--text-2)' }} data-testid="vial-waste">
              {Math.round(change.wasteMg * 100) / 100} mg thrown out, counted under Wasted this year.
            </p>
          )}

          <div className="flex gap-2">
            {change.outOfStock && (
              <button onClick={() => { dismiss(); goTo?.('supplies') }} data-testid="vial-open-stock"
                className="btn-primary flex-1 rounded-full py-3 text-sm font-black">
                Open Stock
              </button>
            )}
            {left > 0 && (
              <button onClick={() => undo()} data-testid="vial-undo"
                className="flex-1 rounded-full py-3 text-sm font-black" style={GHOST}>
                Undo ({left})
              </button>
            )}
            {!(change.opened && change.needsMixing) && (
              <button onClick={dismiss} className="flex-1 rounded-full py-3 text-sm font-black" style={GHOST}>
                Done
              </button>
            )}
            {change.opened && change.needsMixing && (
              <button onClick={dismiss} className="rounded-full px-4 py-3 text-sm font-black" style={GHOST}>
                Later
              </button>
            )}
          </div>
        </div>
      </Modal>
    )
  }

  const pr = prompts[0]
  if (!pr) return null
  const expired = pr.kind === 'expired'
  const text = expired ? EXPIRED_TEXT : pr.noOpen ? NO_OPEN_TEXT : CHANGE_TEXT
  const no = expired ? ['notyet', 'Not yet'] : pr.noOpen ? ['still', 'Not now'] : ['still', 'Still some left']
  return (
    <Modal open onClose={() => answer(pr.id, no[0])} title={pr.name || 'Vial'}>
      <div className="space-y-4 pb-2" data-testid="vial-prompt" data-kind={pr.kind}>
        <p className="text-sm leading-relaxed">{text}</p>
        {prompts.length > 1 && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{prompts.length - 1} more to answer after this one.</p>
        )}
        <div className="flex gap-2">
          <button onClick={() => answer(pr.id, 'yes')} data-testid="vial-yes"
            className="btn-primary flex-1 rounded-full py-3 text-sm font-black">
            Yes
          </button>
          <button onClick={() => answer(pr.id, no[0])} data-testid="vial-still"
            className="flex-1 rounded-full py-3 text-sm font-black" style={GHOST}>
            {no[1]}
          </button>
        </div>
      </div>
    </Modal>
  )
}
