/**
 * Bringing a pathology report in from a file, and sending the record back out.
 *
 * The file is prepared elsewhere — a PDF is handed to Claude, which writes it
 * out in this app's schema — so there is no PDF reading or OCR here. This file's
 * whole job is to be the careful end of that pipe: read it, say exactly what is
 * wrong with it if anything is, show everything it is about to do, and only then
 * do it.
 *
 * Three rules shape it.
 *
 *   Nothing is written until it has been previewed. buildPreview() derives what
 *   would happen from the file, the current record and the person's edits, and
 *   changes nothing; applyImport() is the only thing that writes, and it takes
 *   the plan the preview produced.
 *
 *   Nothing is dropped silently. A name the app does not know is a row that needs
 *   a decision, not a row that disappears. A value that is not a number is shown
 *   and has to be fixed or excluded. A file that cannot be read at all is refused
 *   with the reason, rather than imported in part.
 *
 *   Nothing is overwritten silently. An existing date is a conflict with three
 *   answers, and merging fills only what is empty.
 *
 * Pure functions throughout, so every one of those rules is testable directly.
 */
import {
  PANEL_ORDER, allMarkers, rangeOf, statusOf, validateValue, fmtRange,
} from './bloods'

export const IMPORT_SCHEMA = 'pepito-bloods-import/v1'

/** Keys in a result that describe the test rather than measure anything. */
const META = new Set(['date', 'lab', 'ref', 'notes'])
/** Keys the app itself uses on a stored test; never markers, never imported. */
const RESERVED = new Set(['id', 'attachment', 'seeded'])
/** Keys an entry may carry. Anything else is ignored, with a note. */
const ENTRY_KEYS = new Set(['schema', 'result', 'new_markers'])

export const MODES = ['add', 'merge', 'replace', 'skip']

// ----------------------------------------------------------------- helpers

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Compare names the way a person reads them: case, spacing and odd spaces ignored. */
export function normName(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Compare units the way a person reads them.
 *
 * Case and spacing are ignored, the two micro signs become a plain u (the app
 * writes umol/L; a report prints µmol/L), and a leading x goes (x10^9/L and
 * 10^9/L are the same unit). Nothing is *converted* — mmol/L against g/L is a
 * difference, and stays one.
 */
export function normUnit(u) {
  return String(u ?? '').normalize('NFKC').replace(/[µμ]/g, 'u').replace(/\s+/g, '').toLowerCase().replace(/^x/, '')
}

/** True only when both sides state a unit and the two really differ. */
export function unitsDiffer(incoming, stored) {
  const a = normUnit(incoming)
  const b = normUnit(stored)
  if (!a || !b) return false
  return a !== b
}

/** YYYY-MM-DD, and a day that exists: 2026-02-30 is not a date. */
export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** A number typed into a row, or the reason it is not one. */
export function parseValueText(text) {
  const t = String(text ?? '').trim()
  if (!t) return { value: null, error: 'Enter a number, or exclude this row.' }
  const n = Number(t)
  if (Number.isFinite(n)) {
    if (n < 0) return { value: null, error: 'A result cannot be negative.' }
    return { value: n, error: null }
  }
  if (/^[<>≤≥]/.test(t)) {
    return { value: null, error: `"${t}" is a limit, not a measurement. The app stores plain numbers: enter one, or exclude this row.` }
  }
  return { value: null, error: `"${t}" is not a number.` }
}

const fail = (error) => ({ ok: false, error })

// ------------------------------------------------------------------ parsing

/**
 * One cell of a result: a number, a numeric string, a string with a unit
 * ("18 nmol/L"), or { value, unit }. Anything else is kept as it was so the
 * preview can show it and say what is wrong, rather than losing it here.
 */
function parseCell(name, cell) {
  if (typeof cell === 'number') return { name, raw: cell, value: Number.isFinite(cell) ? cell : null, unit: '', invalid: !Number.isFinite(cell) }
  if (typeof cell === 'string') {
    const t = cell.trim()
    if (t !== '' && Number.isFinite(Number(t))) return { name, raw: cell, value: Number(t), unit: '', invalid: false }
    const m = t.match(/^(-?\d+(?:\.\d+)?)\s*([^\d\s<>=].*)$/)
    if (m) return { name, raw: cell, value: Number(m[1]), unit: m[2].trim(), invalid: false }
    return { name, raw: cell, value: null, unit: '', invalid: true }
  }
  if (isObj(cell) && 'value' in cell) {
    const inner = parseCell(name, cell.value)
    const unit = typeof cell.unit === 'string' ? cell.unit.trim() : ''
    return { ...inner, unit: unit || inner.unit }
  }
  return { name, raw: JSON.stringify(cell), value: null, unit: '', invalid: true }
}

/**
 * Read the text of an import file.
 *
 * Structural problems refuse the whole file with a sentence that says which
 * result and what: a file that is half readable is not imported in part, because
 * the part that was skipped would never be noticed. Problems with an individual
 * *value* are not structural — they travel into the preview, where they are
 * visible and fixable.
 */
export function parseImport(text) {
  if (typeof text !== 'string' || !text.trim()) return fail('The file is empty.')

  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return fail(`This is not valid JSON (${e.message}).`)
  }

  const list = Array.isArray(data) ? data : [data]
  if (list.length === 0) return fail('The file holds an empty list, so there is nothing to import.')
  const many = list.length > 1

  const entries = []
  const warnings = []

  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const where = many ? `Result ${i + 1}` : 'The result'

    if (!isObj(item)) {
      return fail(`${where} is not an object. Each one needs to look like {"schema": "${IMPORT_SCHEMA}", "result": {...}}.`)
    }
    if (item.schema !== undefined && item.schema !== IMPORT_SCHEMA) {
      return fail(`${where} has the schema "${item.schema}", but this app reads "${IMPORT_SCHEMA}".`)
    }
    if (!isObj(item.result)) {
      const hint = typeof item.date === 'string'
        ? ' It looks like a bare result: wrap it as {"schema": "' + IMPORT_SCHEMA + '", "result": {...}}.'
        : ''
      return fail(`${where} has no "result" object.${hint}`)
    }
    for (const k of Object.keys(item)) {
      if (!ENTRY_KEYS.has(k)) warnings.push(`${where}: ignored the unknown key "${k}".`)
    }

    const r = item.result
    if (r.date === undefined || r.date === null || r.date === '') {
      return fail(`${where} has no "date". Every result needs the day it was collected, as YYYY-MM-DD.`)
    }
    if (!isRealDate(r.date)) {
      return fail(`${where} has the date ${JSON.stringify(r.date)}, which is not a real date in YYYY-MM-DD form.`)
    }

    const meta = {}
    for (const k of ['lab', 'ref', 'notes']) {
      const v = r[k]
      if (v === undefined || v === null) { meta[k] = ''; continue }
      if (typeof v === 'string' || typeof v === 'number') { meta[k] = String(v).trim(); continue }
      return fail(`${where}: "${k}" must be text, not ${Array.isArray(v) ? 'a list' : typeof v}.`)
    }

    // markers the file declares as new
    const newMarkers = []
    if (item.new_markers !== undefined) {
      if (!Array.isArray(item.new_markers)) return fail(`${where}: "new_markers" must be a list.`)
      for (let j = 0; j < item.new_markers.length; j++) {
        const m = item.new_markers[j]
        const label = `${where}: new marker ${j + 1}`
        if (!isObj(m)) return fail(`${label} is not an object.`)
        if (typeof m.name !== 'string' || !m.name.trim()) return fail(`${label} has no "name".`)
        const name = m.name.trim()
        if (!PANEL_ORDER.includes(m.panel)) {
          return fail(`${where}: new marker "${name}" has the panel ${JSON.stringify(m.panel)}, which is not one of ${PANEL_ORDER.join(', ')}.`)
        }
        if (m.unit !== undefined && m.unit !== null && typeof m.unit !== 'string') {
          return fail(`${where}: new marker "${name}" has a unit that is not text.`)
        }
        for (const k of ['ref_low', 'ref_high']) {
          if (m[k] !== undefined && m[k] !== null && !Number.isFinite(m[k])) {
            return fail(`${where}: new marker "${name}" has a ${k} that is not a number.`)
          }
        }
        const lo = m.ref_low ?? null
        const hi = m.ref_high ?? null
        if (lo != null && hi != null && lo > hi) {
          return fail(`${where}: new marker "${name}" has ref_low (${lo}) above ref_high (${hi}).`)
        }
        newMarkers.push({ name, panel: m.panel, unit: (m.unit || '').trim(), refLow: lo, refHigh: hi })
      }
    }

    // the measurements: every key that is not the test's own description
    const values = []
    for (const [k, cell] of Object.entries(r)) {
      if (META.has(k)) continue
      if (RESERVED.has(k)) { warnings.push(`${where}: ignored "${k}", which the app keeps for itself.`); continue }
      if (cell === null || cell === undefined) continue // not measured
      values.push(parseCell(k.trim(), cell))
    }
    if (values.length === 0) return fail(`${where} (${r.date}) has no marker values, so there is nothing to import.`)

    entries.push({ index: i, date: r.date, ...meta, values, newMarkers })
  }

  // two results on one day cannot both be imported as that day's test
  const seen = new Map()
  for (const e of entries) {
    if (seen.has(e.date)) {
      return fail(`Results ${seen.get(e.date) + 1} and ${e.index + 1} are both dated ${e.date}. Combine them into one result.`)
    }
    seen.set(e.date, e.index)
  }

  return { ok: true, entries, warnings }
}

// ----------------------------------------------------------------- preview

const markerFromDef = (d) => ({
  name: d.name, panel: d.panel, unit: d.unit || '', refLow: d.refLow ?? null, refHigh: d.refHigh ?? null,
  note: '', watchFor: [], custom: true,
})

/** Far-future and long-ago dates are likelier typos than tests. */
function dateWarning(date, today) {
  if (!isRealDate(date)) return null
  const t = today || new Date().toISOString().slice(0, 10)
  if (date > t) return 'This date is in the future.'
  if (date < '1990-01-01') return 'This date is before 1990.'
  return null
}

/**
 * What importing this file would do, given the record as it stands and whatever
 * the person has changed in the preview. Changes nothing.
 *
 * `edits` holds only what the person did:
 *   entries[i]   { date, lab, ref, notes, mode }
 *   rows[i:j]    { value, excluded, confirmedFor }
 *   resolutions  { [name]: { action: 'add' | 'map' | 'skip', panel, unit, refLow, refHigh, mapTo } }
 *   markers      { [name]: { panel, unit, refLow, refHigh } }   (a new marker the file declared)
 *
 * Returns the rows with their classification and flags, the counts, and
 * `blockers`: everything that must be decided before it can be saved.
 */
export function buildPreview(entries, ctx = {}, edits = {}) {
  const { tests = [], customMarkers = [], overrides = {}, today } = ctx
  const known = allMarkers(customMarkers)
  const byNorm = new Map(known.map((m) => [normName(m.name), m]))
  const byName = new Map(known.map((m) => [m.name, m]))

  // markers the file declares that the app does not already have
  const declared = new Map()
  for (const e of entries) {
    for (const d of e.newMarkers) {
      const key = normName(d.name)
      if (byNorm.has(key) || declared.has(key)) continue
      declared.set(key, { ...d, ...(edits.markers?.[key] || {}) })
    }
  }

  const resolutions = edits.resolutions || {}
  const blockers = []
  const outEntries = []

  entries.forEach((entry, i) => {
    const ed = edits.entries?.[i] || {}
    const date = ed.date ?? entry.date
    const lab = ed.lab ?? entry.lab
    const ref = ed.ref ?? entry.ref
    const notes = ed.notes ?? entry.notes
    const validDate = isRealDate(date)
    const existing = validDate ? tests.find((t) => t.date === date) || null : null
    const conflict = existing
      ? {
        testId: existing.id,
        markerCount: Object.keys(existing.values || {}).length,
        hasAttachment: !!existing.attachment,
        lab: existing.lab || '',
        values: existing.values || {},
      }
      : null

    // a conflict has no default: choosing for the person is how a record gets overwritten
    let mode = ed.mode ?? (conflict ? null : 'add')
    if (!conflict && (mode === 'merge' || mode === 'replace')) mode = 'add'
    if (conflict && mode === 'add') mode = null
    const skipped = mode === 'skip'

    const rows = entry.values.map((v, j) => {
      const key = `${i}:${j}`
      const re = edits.rows?.[key] || {}
      const valueText = re.value ?? (v.invalid ? String(v.raw) : String(v.value))
      const parsed = parseValueText(valueText)
      const norm = normName(v.name)

      let kind = 'unrecognised'
      let marker = null
      let resolved = false
      let resolution = null
      let mappedTo = null

      if (byNorm.has(norm)) {
        kind = 'recognised'; marker = byNorm.get(norm); resolved = true
      } else if (declared.has(norm)) {
        kind = 'new'; marker = markerFromDef(declared.get(norm)); resolved = true
      } else {
        const res = resolutions[norm]
        resolution = res || null
        if (res?.action === 'map' && res.mapTo && (byName.get(res.mapTo) || declared.has(normName(res.mapTo)))) {
          marker = byName.get(res.mapTo) || markerFromDef(declared.get(normName(res.mapTo)))
          mappedTo = marker.name; resolved = true
        } else if (res?.action === 'add') {
          marker = markerFromDef({
            name: v.name, panel: res.panel || 'Chemistry', unit: res.unit ?? v.unit ?? '',
            refLow: res.refLow ?? null, refHigh: res.refHigh ?? null,
          })
          resolved = true
        } else if (res?.action === 'skip') {
          resolved = true
        }
      }

      const canonical = marker?.name || null
      const skippedByChoice = resolution?.action === 'skip'
      const excluded = !!re.excluded || skippedByChoice

      const range = marker ? rangeOf(marker, overrides) : { low: null, high: null }

      // A number in another unit cannot be placed against this interval. Saying
      // "in range" or "high" about it would be a verdict reached by comparing
      // unlike things, and the "stray digit" test would fire on any figure in a
      // bigger unit. So it is not compared at all: the unit flag says why.
      const unitMismatch = !!(marker && parsed.value != null && v.unit && unitsDiffer(v.unit, marker.unit))
      const status = marker && parsed.value != null && !unitMismatch ? statusOf(parsed.value, range) : 'unknown'

      const problems = []
      if (parsed.error) problems.push({ kind: 'invalid', text: parsed.error, blocking: true })
      if (marker && parsed.value != null) {
        if (unitMismatch) {
          problems.push({
            kind: 'unit',
            text: `The file gives this in ${v.unit}; the app stores ${marker.name} in ${marker.unit}. It is not converted.`,
            needsConfirm: true,
          })
        } else if (validateValue(marker, valueText, overrides).warn) {
          problems.push({
            kind: 'implausible',
            text: `${parsed.value} is a long way outside ${fmtRange(range, marker.unit)}. Check the report for a stray digit or a misread decimal point.`,
            needsConfirm: true,
          })
        }
      }
      const confirmed = re.confirmedFor === valueText

      const existingValue = conflict && canonical ? conflict.values[canonical] : undefined
      let effect = 'new'
      if (conflict) {
        if (mode === 'merge') effect = existingValue != null ? 'kept' : 'fills'
        else if (mode === 'replace') effect = existingValue != null ? 'overwrites' : 'new'
      }

      return {
        key, index: j, name: v.name, kind, resolved, resolution, mappedTo, canonical, marker,
        valueText, value: parsed.value, unit: v.unit, markerUnit: marker?.unit || '',
        range, status, compared: !unitMismatch, rangeText: marker ? fmtRange(range, marker.unit) : '',
        problems, confirmed, excluded, existingValue, effect,
        // the one question the rest turns on: does this row put a number in the record
        writes: false,
      }
    })

    // two rows that land on one marker cannot both be written
    const active = rows.filter((r) => !r.excluded && r.resolved && r.canonical && r.value != null)
    const byCanon = new Map()
    for (const r of active) byCanon.set(r.canonical, [...(byCanon.get(r.canonical) || []), r])
    for (const group of byCanon.values()) {
      if (group.length > 1) {
        for (const r of group) {
          r.problems.push({
            kind: 'collision', blocking: true,
            text: `More than one row would set ${r.canonical}. Exclude all but one.`,
          })
        }
      }
    }

    for (const r of rows) {
      const settled = !r.excluded
      const hasBlockingProblem = r.problems.some((p) => p.blocking)
      const needsConfirm = r.problems.some((p) => p.needsConfirm) && !r.confirmed
      r.writes = settled && !skipped && r.resolved && !!r.canonical && r.value != null
        && !hasBlockingProblem && !needsConfirm && r.effect !== 'kept'

      if (skipped || r.excluded) continue
      if (!r.resolved) blockers.push({ kind: 'unrecognised', entry: i, name: r.name, text: `Decide what to do with "${r.name}".` })
      else if (hasBlockingProblem) blockers.push({ kind: 'invalid', entry: i, name: r.name, text: `Fix or exclude ${r.name}.` })
      else if (needsConfirm) blockers.push({ kind: 'confirm', entry: i, name: r.name, text: `Confirm or fix ${r.name}.` })
    }

    outEntries.push({
      index: i, date, lab, ref, notes, validDate,
      dateWarning: dateWarning(date, today), conflict, mode, skipped, rows,
    })
  })

  // the date is the key a test is filed under, so it cannot be doubtful
  const active = outEntries.filter((e) => !e.skipped)
  for (const e of active) {
    if (!e.validDate) blockers.push({ kind: 'date', entry: e.index, text: 'Enter a real date for this result.' })
    if (e.conflict && !e.mode) blockers.push({ kind: 'conflict', entry: e.index, text: `Choose merge, replace or cancel for ${e.date}.` })
  }
  const dateCount = new Map()
  for (const e of active) if (e.validDate) dateCount.set(e.date, (dateCount.get(e.date) || 0) + 1)
  for (const [date, n] of dateCount) {
    if (n > 1) blockers.push({ kind: 'date', entry: null, text: `More than one result is now dated ${date}.` })
  }
  for (const e of active) {
    if (e.validDate && !e.rows.some((r) => r.writes) && !(e.conflict && e.mode === 'merge')) {
      blockers.push({ kind: 'empty', entry: e.index, text: `Nothing from ${e.date} would be saved.` })
    }
  }

  // the markers that would be created: declared or added by the person, and only
  // if something that writes actually uses them
  const toAdd = new Map()
  for (const e of active) {
    for (const r of e.rows) {
      if (!r.writes || !r.marker?.custom) continue
      if (byNorm.has(normName(r.marker.name))) continue
      toAdd.set(r.marker.name, {
        name: r.marker.name, panel: r.marker.panel, unit: r.marker.unit,
        refLow: r.marker.refLow, refHigh: r.marker.refHigh,
      })
    }
  }

  const allRows = outEntries.flatMap((e) => e.rows)
  const newNames = new Set(allRows.filter((r) => r.kind === 'new').map((r) => normName(r.name)))
  const unrecNames = new Set(allRows.filter((r) => r.kind === 'unrecognised').map((r) => normName(r.name)))
  const writing = allRows.filter((r) => r.writes)
  const counts = {
    values: allRows.length,
    newMarkers: newNames.size,
    unrecognised: unrecNames.size,
    excluded: allRows.filter((r) => r.excluded).length,
    toSave: writing.length,
    outOfRange: allRows.filter((r) => !r.excluded && (r.status === 'low' || r.status === 'high')).length,
    flagged: allRows.filter((r) => !r.excluded && r.problems.length > 0).length,
  }

  return {
    entries: outEntries,
    newMarkers: [...toAdd.values()],
    counts,
    blockers,
    // a merge that finds everything already recorded is not an error, but an
    // import that saves nothing at all is not worth a button
    canImport: blockers.length === 0 && active.length > 0 && counts.toSave > 0,
  }
}

/** "24 values, 2 new markers, 1 unrecognised" — the headline, only the parts that are non-zero. */
export function countsLine(counts) {
  const parts = [`${counts.values} value${counts.values === 1 ? '' : 's'}`]
  if (counts.newMarkers) parts.push(`${counts.newMarkers} new marker${counts.newMarkers === 1 ? '' : 's'}`)
  if (counts.unrecognised) parts.push(`${counts.unrecognised} unrecognised`)
  return parts.join(', ')
}

// -------------------------------------------------------------- committing

/**
 * The preview, reduced to what is to be written: for each test that is not
 * skipped, its mode, its description and the numbers to put in it.
 */
export function commitPlan(preview) {
  const entries = preview.entries
    .filter((e) => !e.skipped && e.validDate && e.mode)
    .map((e) => {
      const values = {}
      for (const r of e.rows) if (r.writes) values[r.canonical] = r.value
      return {
        index: e.index, mode: e.mode, date: e.date, lab: e.lab, ref: e.ref, notes: e.notes,
        existingId: e.conflict?.testId || null, values,
      }
    })
  return { entries, newMarkers: preview.newMarkers }
}

const defaultId = () => `bt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`

/**
 * Write a plan into the blood record. Pure: returns the new record, a summary
 * and which test each entry became, and touches nothing else.
 *
 *   add      a new test.
 *   merge    fills markers the test does not have, and a description field only
 *            where it is blank. Nothing already recorded is changed.
 *   replace  the test takes the file's values and description, keeping its id and
 *            its attached report. A description the file leaves blank is not read
 *            as a statement that the lab was blank.
 *
 * It is defensive about a plan that has gone stale: an "add" onto a date that now
 * exists is merged rather than duplicated or overwritten.
 */
export function applyImport(bloods, plan, { makeId = defaultId } = {}) {
  let tests = [...(bloods.tests || [])]
  const customMarkers = [...(bloods.customMarkers || [])]
  const have = new Set(allMarkers(customMarkers).map((m) => normName(m.name)))

  const summary = { added: 0, merged: 0, replaced: 0, valuesWritten: 0, newMarkers: 0 }
  for (const m of plan.newMarkers || []) {
    if (have.has(normName(m.name))) continue
    customMarkers.push({
      name: m.name, panel: m.panel || 'Chemistry', unit: m.unit || '',
      refLow: m.refLow ?? null, refHigh: m.refHigh ?? null, custom: true,
    })
    have.add(normName(m.name))
    summary.newMarkers++
  }

  const created = []
  for (const e of plan.entries) {
    const existing = tests.find((t) => t.date === e.date)
    let mode = e.mode
    if (mode === 'add' && existing) mode = 'merge'
    if ((mode === 'merge' || mode === 'replace') && !existing) mode = 'add'

    if (mode === 'add') {
      const id = makeId()
      tests.push({
        id, date: e.date, lab: e.lab || '', ref: e.ref || '', notes: e.notes || '',
        values: { ...e.values }, attachment: null,
      })
      summary.added++
      summary.valuesWritten += Object.keys(e.values).length
      created.push({ index: e.index, testId: id })
    } else if (mode === 'merge') {
      const values = { ...existing.values }
      let filled = 0
      for (const [k, v] of Object.entries(e.values)) {
        if (values[k] == null) { values[k] = v; filled++ }
      }
      tests = tests.map((t) => (t.id === existing.id
        ? {
          ...t,
          lab: t.lab || e.lab || '', ref: t.ref || e.ref || '', notes: t.notes || e.notes || '',
          values,
        }
        : t))
      // a merge that had nothing to fill changed nothing, and says so by not
      // counting itself
      if (filled > 0) summary.merged++
      summary.valuesWritten += filled
      created.push({ index: e.index, testId: existing.id })
    } else if (mode === 'replace') {
      tests = tests.map((t) => (t.id === existing.id
        ? {
          ...t,
          lab: e.lab || t.lab || '', ref: e.ref || t.ref || '', notes: e.notes || t.notes || '',
          values: { ...e.values },
        }
        : t))
      summary.replaced++
      summary.valuesWritten += Object.keys(e.values).length
      created.push({ index: e.index, testId: existing.id })
    }
  }

  tests.sort((a, b) => a.date.localeCompare(b.date))
  return { bloods: { ...bloods, tests, customMarkers }, summary, created }
}

/** "Added 1 test and 24 values" — what happened, in a sentence. */
export function summaryWords(s) {
  const bits = []
  if (s.added) bits.push(`${s.added} new test${s.added === 1 ? '' : 's'}`)
  if (s.merged) bits.push(`${s.merged} merged`)
  if (s.replaced) bits.push(`${s.replaced} replaced`)
  const head = bits.join(', ') || 'No tests'
  const tail = `${s.valuesWritten} value${s.valuesWritten === 1 ? '' : 's'}`
  const markers = s.newMarkers ? `, ${s.newMarkers} new marker${s.newMarkers === 1 ? '' : 's'}` : ''
  return `${head}: ${tail}${markers}`
}

// ------------------------------------------------------------------ export

/**
 * The whole record, in the same shape the importer reads.
 *
 * One entry per test, oldest first, each carrying the custom markers it uses so
 * every entry stands on its own. Markers keep the catalogue's order so the file
 * reads like a report. Attached reports are not in it — they live in a backup.
 */
export function exportResults(bloods) {
  const custom = bloods?.customMarkers || []
  const markers = allMarkers(custom)
  const order = new Map(markers.map((m, i) => [m.name, i]))
  const customByName = new Map(custom.map((m) => [m.name, m]))

  return [...(bloods?.tests || [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const result = { date: t.date }
      if (t.lab) result.lab = t.lab
      if (t.ref) result.ref = t.ref
      if (t.notes) result.notes = t.notes
      const names = Object.keys(t.values || {}).sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b))
      for (const n of names) result[n] = t.values[n]

      const entry = { schema: IMPORT_SCHEMA, result }
      const used = names.filter((n) => customByName.has(n)).map((n) => customByName.get(n))
      if (used.length) {
        entry.new_markers = used.map((m) => ({
          name: m.name, panel: m.panel, unit: m.unit || '', ref_low: m.refLow ?? null, ref_high: m.refHigh ?? null,
        }))
      }
      return entry
    })
}

export const exportText = (bloods) => JSON.stringify(exportResults(bloods), null, 2)

export const exportFilename = (date = new Date()) => `pepito-blood-results-${date.toISOString().slice(0, 10)}.json`
