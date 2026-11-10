import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Rect } from '../model/types'

// pdf.js, loaded only when a drawing is opened. Vectorworks sheets often have their text outlined, so
// nothing here relies on reading text: the importer shows the page and the crew points at things.

let lib: Promise<typeof import('pdfjs-dist')> | null = null
function pdfjs() {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
    m.GlobalWorkerOptions.workerSrc = worker.default
    return m
  })
  return lib
}

export type Rotation = 0 | 90 | 180 | 270

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const m = await pdfjs()
  // pdf.js takes ownership of the buffer it is given; hand it a copy so the original can still be stored.
  return m.getDocument({ data: new Uint8Array(data.slice(0)) }).promise
}

export interface PageImage {
  canvas: HTMLCanvasElement
  /** Pixels per drawing point. */
  scale: number
  /** Page size in points, rotated. */
  widthPt: number
  heightPt: number
}

/** Draw a whole page, longest side maxPx, for picking points on. */
export async function renderPage(doc: PDFDocumentProxy, pageNo: number, rotation: Rotation, maxPx = 4096): Promise<PageImage> {
  const page = await doc.getPage(pageNo)
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 })
  const scale = Math.min(4, maxPx / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport, background: '#ffffff' }).promise
  return { canvas, scale, widthPt: base.width, heightPt: base.height }
}

/**
 * Draw part of a page (rect in rotated page points) for the 3D deck: longest side maxPx, lightness
 * inverted so black-on-white linework reads light on the dark deck with its colors kept.
 */
export async function renderUnderlay(doc: PDFDocumentProxy, pageNo: number, rotation: Rotation, rect: Rect, maxPx = 2048): Promise<Blob> {
  const page = await doc.getPage(pageNo)
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0
  const scale = Math.min(6, maxPx / Math.max(w, h))
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360, offsetX: -rect.x0 * scale, offsetY: -rect.y0 * scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  await page.render({ canvas, viewport, background: '#ffffff' }).promise
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const p = img.data
  for (let k = 0; k < p.length; k += 4) {
    // HSL lightness flip with hue and saturation kept: white paper goes black, a blue tower stays blue.
    const max = Math.max(p[k], p[k + 1], p[k + 2]), min = Math.min(p[k], p[k + 1], p[k + 2])
    const shift = 255 - max - min
    p[k] += shift; p[k + 1] += shift; p[k + 2] += shift
  }
  ctx.putImageData(img, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the plan'))), 'image/png'))
}

/** The likeliest plan sheet: the first page whose text says plan view or roof structure (when it has text at all). */
export async function guessPlanPage(doc: PDFDocumentProxy): Promise<number> {
  for (let n = 1; n <= Math.min(doc.numPages, 20); n++) {
    const text = (await (await doc.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
    if (/plan view|roof structure|top plan|roof plan/i.test(text)) return n
  }
  return 1
}
