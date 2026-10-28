// Reading dropped files into import rows: PDFs through pdf.js (bundled, worker
// served locally, nothing uploaded), zips with the browser's own
// DecompressionStream, CSV and JSON as text. What each file is and what it
// would add is decided in src/body/import/plan.ts.

import { extractPdfItems } from './scanParse'
import { logError } from './errorLog'
import { rebuildLines } from '../body/import/pdfLines'
import { pdfItem, withingsItems, jsonItems, unknownItem, settleBatch } from '../body/import/plan'
import { readZip, isBodyCsvName } from '../body/import/withings'

const MAX_BYTES = 40 * 1024 * 1024

export const ACCEPT = '.pdf,.csv,.zip,.json,application/pdf,text/csv,application/zip,application/json'

async function readOne(file, existing) {
  const name = file.name || 'file'
  const lower = name.toLowerCase()
  if (file.size > MAX_BYTES) return [{ ...unknownItem(name), note: 'Far larger than a report or an export' }]
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    return [pdfItem(name, rebuildLines(await extractPdfItems(file)), existing)]
  }
  if (lower.endsWith('.zip') || file.type === 'application/zip') {
    const csvs = await readZip(await file.arrayBuffer(), isBodyCsvName)
    if (!csvs.length) return [{ ...unknownItem(name), note: 'No weight file in this zip' }]
    const dec = new TextDecoder()
    return csvs.flatMap((c) => withingsItems(`${name}, ${c.name.split('/').pop()}`, dec.decode(c.data), existing))
  }
  if (lower.endsWith('.csv') || file.type === 'text/csv') return withingsItems(name, await file.text(), existing)
  if (lower.endsWith('.json') || file.type === 'application/json') {
    let json
    try { json = JSON.parse(await file.text()) } catch { return [{ ...unknownItem(name), note: 'Not valid JSON' }] }
    return jsonItems(name, json, existing)
  }
  return [unknownItem(name)]
}

/** Every file, in the order given, as rows; repeats inside the batch settled. */
export async function readImportFiles(files, existing) {
  const items = []
  for (const f of files) {
    try {
      items.push(...await readOne(f, existing))
    } catch (err) {
      // the error, never the file's contents
      logError(err, { where: 'import', kind: (f.name || '').split('.').pop() })
      items.push({ ...unknownItem(f.name || 'file'), note: 'Could not be read' })
    }
  }
  return settleBatch(items)
}
