// What gets written down about an injection at the moment it is logged: which
// compounds were in the syringe, how much, and through which needle.
//
// All of it is pulled from what the app already knows — the dose log, the
// ladder, and Supplies — so that logging stays one tap and the fields are only
// ever corrected, never typed. Everything captured here is editable afterwards.

/** Which Supplies category a route's needle comes out of. */
export function needleCategoryFor(peptide) {
  return peptide?.pen || peptide?.delivery === 'pen' ? 'Pen needles' : 'Syringe needles'
}

const gaugeText = (g) => {
  const s = String(g ?? '').trim()
  return /^\d+$/.test(s) ? `${s}G` : s
}

export function normaliseNeedle(n) {
  if (!n || (n.gauge == null && n.lengthMm == null)) return null
  const lengthMm = n.lengthMm == null || n.lengthMm === '' ? null : Number(n.lengthMm)
  const gauge = n.gauge == null || n.gauge === '' ? null : gaugeText(n.gauge)
  if (gauge == null || lengthMm == null || Number.isNaN(lengthMm)) return null
  return { gauge, lengthMm }
}

export const needleKey = (n) => {
  const x = normaliseNeedle(n)
  return x ? `${x.gauge}|${x.lengthMm}` : null
}

/** "32G × 6 mm" */
export const needleLabel = (n) => {
  const x = normaliseNeedle(n)
  return x ? `${x.gauge} × ${x.lengthMm} mm` : 'Not recorded'
}

/** Distinct needle specs currently In use for a category, thickest first. */
export function inUseNeedles(gearItems = [], category = 'Syringe needles') {
  const seen = new Map()
  for (const it of gearItems) {
    if (it.category !== category || it.status !== 'in_use') continue
    const n = normaliseNeedle(it)
    if (n && !seen.has(needleKey(n))) seen.set(needleKey(n), n)
  }
  return [...seen.values()].sort((a, b) => parseInt(a.gauge, 10) - parseInt(b.gauge, 10) || b.lengthMm - a.lengthMm)
}

/**
 * The needle to pre-fill, and the other in-use ones to offer beside it.
 *
 * One needle in use is the answer. With several, the one this route last used
 * wins (it is what the hand reaches for); with no history, SubQ takes the
 * shortest and IM the longest, which is what those routes are for. Either way
 * the rest are listed so changing it is one tap.
 */
export function suggestNeedle({ peptide, gearItems = [], records = [] }) {
  const category = needleCategoryFor(peptide)
  const choices = inUseNeedles(gearItems, category)
  if (!choices.length) return { needle: null, choices, category }
  if (choices.length === 1) return { needle: choices[0], choices, category }

  const route = peptide?.route
  const last = [...records]
    .filter((r) => r.needle && choices.some((c) => needleKey(c) === needleKey(r.needle)))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .find((r) => !route || !r.route || r.route === route)
  if (last) return { needle: choices.find((c) => needleKey(c) === needleKey(last.needle)), choices, category }

  const byLength = [...choices].sort((a, b) => a.lengthMm - b.lengthMm)
  return { needle: route === 'IM' ? byLength.at(-1) : byLength[0], choices, category }
}

/**
 * Who shared the syringe. A dose logged on its own has no co-draw id; several
 * doses written with the same one went in together.
 */
export function coDrawInfo(doseLogs = [], doseLogId) {
  const log = doseLogs.find((l) => l.id === doseLogId)
  if (!log?.coDrawId) return { coDraw: false, coDrawId: null, peptideIds: log ? [log.peptideId] : [] }
  const peptideIds = [...new Set(doseLogs.filter((l) => l.coDrawId === log.coDrawId).map((l) => l.peptideId))]
  return { coDraw: peptideIds.length > 1, coDrawId: log.coDrawId, peptideIds }
}

/** Everything pulled automatically for a new injection record. */
export function captureFor({ peptide, doseLogId, doseLogs = [], gearItems = [], records = [] }) {
  const co = coDrawInfo(doseLogs, doseLogId)
  const { needle } = suggestNeedle({ peptide, gearItems, records })
  return {
    coDraw: co.coDraw,
    coDrawId: co.coDrawId,
    coDrawPeptideIds: co.peptideIds,
    needle,
    route: peptide?.route || null,
  }
}
