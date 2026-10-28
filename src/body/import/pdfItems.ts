// Positioned text items out of a PDF with pdf.js, one list for every page.
// The browser passes the bundled pdf.js (worker served locally, nothing leaves
// the device); the tests pass the Node build.

import type { PdfItem } from './pdfLines'

interface TextItem { str?: string; transform?: number[]; width?: number }
interface PdfJsLike {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: TextItem[] }> }>; destroy?: () => Promise<void> }> }
}

export async function itemsFromPdf(pdfjs: PdfJsLike, data: Uint8Array, maxPages = 8): Promise<PdfItem[]> {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise
  const out: PdfItem[] = []
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      for (const it of content.items) {
        if (typeof it.str !== 'string' || !it.transform) continue
        out.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p })
      }
    }
  } finally {
    await doc.destroy?.()
  }
  return out
}
