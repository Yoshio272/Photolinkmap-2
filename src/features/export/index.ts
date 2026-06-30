import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib'
import type { Pin, CalibState } from '../../types'

interface ExportOptions {
  pdfBytes: Uint8Array | null
  imageDataUrl?: string | null
  canvas: HTMLCanvasElement
  pins: Pin[]
  calib: CalibState
  canvasW: number
  canvasH: number
  noLinkAction: 'skip' | 'map'
  noteText: string
  fileName: string
  onProgress?: (pct: number, msg: string) => void
}

function hex2rgb(h: string) {
  return rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  )
}

export async function exportPdfWithLinks(opts: ExportOptions): Promise<void> {
  const { pdfBytes, canvas, pins, noLinkAction, noteText, fileName, onProgress } = opts
  const prog = (p: number, m: string) => onProgress?.(p, m)

  prog(10, 'PDF解析中...')
  let doc: PDFDocument
  if (pdfBytes) {
    doc = await PDFDocument.load(pdfBytes)
  } else {
    // 画像（JPEG/PNG）の場合はcanvasの現在描画内容をPDF化
    doc = await PDFDocument.create()
    const pg = doc.addPage([canvas.width, canvas.height])
    if (opts.imageDataUrl) {
      const isPng = opts.imageDataUrl.startsWith('data:image/png')
      const ib = await (await fetch(opts.imageDataUrl)).arrayBuffer()
      const img = isPng ? await doc.embedPng(ib) : await doc.embedJpg(ib)
      pg.drawImage(img, { x: 0, y: 0, width: canvas.width, height: canvas.height })
    } else {
      const ib = await (await fetch(canvas.toDataURL('image/jpeg', 0.92))).arrayBuffer()
      const img = await doc.embedJpg(ib)
      pg.drawImage(img, { x: 0, y: 0, width: canvas.width, height: canvas.height })
    }
  }

  prog(25, 'ページ取得中...')
  const page = doc.getPages()[0]
  const { width: pW, height: pH } = page.getSize()
  const sx = pW / canvas.width
  const sy = pH / canvas.height
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const white = rgb(1, 1, 1)

  // 注記（ASCII only）
  const safeNote = noteText.replace(/[^\x00-\x7E]/g, '').trim()
  if (safeNote) page.drawText(safeNote, { x: 10, y: 10, size: 8, font, color: rgb(0.3, 0.3, 0.3) })
  const now = new Date()
  const dateStr = `Output:${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
  page.drawText(dateStr, { x: pW - 80, y: 10, size: 6.5, font, color: rgb(0.5, 0.5, 0.5) })

  prog(35, `${pins.length}件のピンを描画中...`)

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i]
    prog(35 + Math.round((i + 1) / pins.length * 55), `ピン ${i + 1}/${pins.length} 描画中...`)

    const px = pin.px * sx
    const py = pH - pin.py * sy   // Y軸反転
    const r = (pin.r || 10) * sx
    const al = (pin.al || 30) * sx
    const deg = pin.deg || 180
    const rad = (deg * Math.PI) / 180
    const clr = hex2rgb(pin.color || '#1565C0')

    // 矢印
    if (al > 2) {
      const tx = px + Math.cos(rad) * r, ty = py - Math.sin(rad) * r
      const ex = px + Math.cos(rad) * (r + al), ey = py - Math.sin(rad) * (r + al)
      page.drawLine({ start: { x: tx, y: ty }, end: { x: ex, y: ey }, thickness: 1.5 * sx, color: clr })
      const ahead = 10 * sx, aw = 5 * sx
      const ax = -Math.sin(rad), ay = Math.cos(rad)
      page.drawLine({ start: { x: ex, y: ey }, end: { x: ex - Math.cos(rad) * ahead + ax * aw, y: ey + Math.sin(rad) * ahead + ay * aw }, thickness: 1.5 * sx, color: clr })
      page.drawLine({ start: { x: ex, y: ey }, end: { x: ex - Math.cos(rad) * ahead - ax * aw, y: ey + Math.sin(rad) * ahead - ay * aw }, thickness: 1.5 * sx, color: clr })
    }

    // 白リング + 青丸
    page.drawCircle({ x: px, y: py, size: r + 2, color: white, opacity: 0.88 })
    page.drawCircle({ x: px, y: py, size: r, color: clr })

    // ハイパーリンク
    let linkUrl = pin.link
    if (!linkUrl && noLinkAction === 'map') linkUrl = `https://www.google.com/maps?q=${pin.lat},${pin.lng}`
    if (linkUrl) {
      const aw2 = (r + 4) * 2, ah2 = (r + 4) * 2
      const ax2 = px - r - 4, ay2 = py - r - 4
      const annot = doc.context.obj({
        Type: 'Annot', Subtype: 'Link',
        Rect: [ax2, ay2, ax2 + aw2, ay2 + ah2],
        Border: [0, 0, 0],
        A: { S: 'URI', URI: PDFString.of(linkUrl) },
      })
      const ref = doc.context.register(annot)
      const existingAnnots = page.node.get(PDFName.of('Annots'))
      if (existingAnnots && 'push' in existingAnnots) {
        (existingAnnots as { push: (r: typeof ref) => void }).push(ref)
      } else {
        page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
      }
    }
  }

  prog(95, '保存中...')
  const bytes = await doc.save()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes instanceof Uint8Array ? bytes.buffer as ArrayBuffer : bytes], { type: 'application/pdf' }))
  a.download = fileName
  a.click()
  URL.revokeObjectURL(a.href)
  prog(100, `✓ 完了: ${pins.length}件 / リンク付き${pins.filter(p => p.link).length}件`)
}
