// Shuffle-bag rotation over the motivation list.
//
// A plain random pick repeats within a handful of draws, which reads as the app
// having nothing to say. A bag draws without replacement: every message appears
// once before any appears twice. The bag is the *used* set rather than a
// pre-shuffled queue, so it survives a reload as a small array of indices and
// stays correct even if the message list grows between releases.
import DATA from '../data/motivation_messages.json'

export const MESSAGES = DATA.messages
export const MOTIVATION_TONE = DATA.tone

/**
 * Draw the next message.
 *
 * @param used indices already drawn this cycle
 * @param rand injectable RNG so the rotation is testable
 * @returns {{ index, message, used, reshuffled }} — `used` is the new set to
 *   persist, `reshuffled` is true on the draw that emptied and reset the bag.
 */
export function drawMessage(used = [], rand = Math.random) {
  const total = MESSAGES.length
  if (total === 0) return { index: -1, message: null, used: [], reshuffled: false }

  // Indices from an older, shorter list stay valid; anything out of range is
  // dropped rather than left to poison the "is the bag empty" check.
  let seen = new Set(used.filter((i) => Number.isInteger(i) && i >= 0 && i < total))
  let reshuffled = false

  let remaining = []
  for (let i = 0; i < total; i++) if (!seen.has(i)) remaining.push(i)

  if (remaining.length === 0) {
    seen = new Set()
    reshuffled = true
    remaining = Array.from({ length: total }, (_, i) => i)
  }

  const index = remaining[Math.floor(rand() * remaining.length) % remaining.length]
  seen.add(index)
  return {
    index,
    message: MESSAGES[index],
    used: [...seen].sort((a, b) => a - b),
    reshuffled,
  }
}

/** How far through the current bag we are — for a quiet progress hint. */
export function bagProgress(used = []) {
  const total = MESSAGES.length
  const drawn = new Set(used.filter((i) => i >= 0 && i < total)).size
  return { drawn, total, remaining: Math.max(0, total - drawn) }
}
