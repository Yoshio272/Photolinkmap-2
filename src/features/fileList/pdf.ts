/**
 * ファイルモード — 一覧PDF出力（Step3）
 *
 * 方式: HTMLで表を組む → html2canvasで画像化 → pdf-libでA4縦ページに貼付
 *       → 各行の位置にリンク注釈（Annot/URI）を重ねる。
 * 地図モード（MapPage C-1/C-2）と同じパターン。pdf-libの標準フォントは
 * 日本語を描画できないため、日本語はHTML経由の画像として埋め込む。
 * 依存追加なし（html2canvasはCDNから動的ロード。地図モードと同一手法）。
 */
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import type { FileEntry } from './index'

// A4縦: PDFポイントとHTMLピクセル（96dpi相当）。アスペクト比は同一（1:√2）
const PDF_W = 595.28
const PDF_H = 841.89
const PAGE_W_PX = 794
const PAGE_H_PX = 1123
const ROWS_PER_PAGE = 12

interface RowRect {
  xRatio: number; yRatio: number; wRatio: number; hRatio: number
  cloudUrl: string
}

export interface FileListPdfResult {
  pages: number
  linked: number
}

/** 写真名一覧のリンク付きPDFを生成してダウンロードする */
export async function exportFileListPdf(
  entries: FileEntry[],
  siteName: string,
): Promise<FileListPdfResult> {
  if (entries.length === 0) throw new Error('写真がありません。先に取り込んでください')

  await loadScript('https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js')
  const html2canvas = (window as unknown as { html2canvas?: Html2Canvas }).html2canvas
  if (!html2canvas) throw new Error('html2canvas 読込失敗')

  // ページ分割
  const chunks: FileEntry[][] = []
  for (let i = 0; i < entries.length; i += ROWS_PER_PAGE) {
    chunks.push(entries.slice(i, i + ROWS_PER_PAGE))
  }

  const pdf = await PDFDocument.create()
  const dateStr = formatToday()
  let linked = 0

  for (let pi = 0; pi < chunks.length; pi++) {
    // 1ページ分のHTMLを組んで撮影（撮影後すぐDOMから除去）
    const { pageDiv, rowEls } = buildPageDiv(chunks[pi], siteName, dateStr, entries.length, pi + 1, chunks.length)
    document.body.appendChild(pageDiv)
    let canvas: HTMLCanvasElement
    let rects: RowRect[]
    try {
      // 行位置を比率で記録（PDF座標変換用）
      const pageRect = pageDiv.getBoundingClientRect()
      rects = rowEls
        .filter(r => r.cloudUrl)
        .map(r => {
          const b = r.el.getBoundingClientRect()
          return {
            xRatio: (b.left - pageRect.left) / pageRect.width,
            yRatio: (b.top - pageRect.top) / pageRect.height,
            wRatio: b.width / pageRect.width,
            hRatio: b.height / pageRect.height,
            cloudUrl: r.cloudUrl,
          }
        })
      canvas = await html2canvas(pageDiv, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
      })
    } finally {
      document.body.removeChild(pageDiv)
    }

    const pngBytes = await fetch(canvas.toDataURL('image/png')).then(r => r.arrayBuffer())
    const png = await pdf.embedPng(pngBytes)
    const page = pdf.addPage([PDF_W, PDF_H])
    page.drawImage(png, { x: 0, y: 0, width: PDF_W, height: PDF_H })

    // リンク注釈（比率 → PDF座標。Y軸はPDFが下原点なので反転）
    for (const r of rects) {
      const x1 = r.xRatio * PDF_W
      const x2 = (r.xRatio + r.wRatio) * PDF_W
      const yTop = r.yRatio * PDF_H
      const y2 = PDF_H - yTop                    // 行上端（PDF座標）
      const y1 = PDF_H - (yTop + r.hRatio * PDF_H)  // 行下端（PDF座標）
      const annot = pdf.context.obj({
        Type: 'Annot', Subtype: 'Link',
        Rect: [x1, y1, x2, y2],
        Border: [0, 0, 0],
        A: { S: 'URI', URI: PDFString.of(r.cloudUrl) },
      })
      const ref = pdf.context.register(annot)
      const existing = page.node.get(PDFName.of('Annots'))
      if (existing && 'push' in existing) {
        (existing as { push: (r: typeof ref) => void }).push(ref)
      } else {
        page.node.set(PDFName.of('Annots'), pdf.context.obj([ref]))
      }
      linked++
    }
  }

  const bytes = await pdf.save()
  const blob = new Blob([bytes instanceof Uint8Array ? bytes.buffer as ArrayBuffer : bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${siteName || '写真一覧'}_写真一覧.pdf`
  a.click()
  URL.revokeObjectURL(url)

  return { pages: chunks.length, linked }
}

// ===== 1ページ分のHTML構築（DOM APIで組み立て。ファイル名等のエスケープ不要） =====
function buildPageDiv(
  rows: FileEntry[],
  siteName: string,
  dateStr: string,
  total: number,
  pageNo: number,
  pageCount: number,
): { pageDiv: HTMLDivElement; rowEls: { el: HTMLElement; cloudUrl: string }[] } {
  const pageDiv = document.createElement('div')
  Object.assign(pageDiv.style, {
    position: 'fixed', left: '-10000px', top: '0',
    width: `${PAGE_W_PX}px`, height: `${PAGE_H_PX}px`,
    background: '#ffffff', boxSizing: 'border-box',
    padding: '40px 44px', fontFamily: 'sans-serif', color: '#111827',
  } as CSSStyleDeclaration)

  // ヘッダー: 現場名・出力日・件数・ページ番号
  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
    borderBottom: '2px solid #1565C0', paddingBottom: '8px', marginBottom: '12px',
  } as CSSStyleDeclaration)
  const titleBox = document.createElement('div')
  const title = document.createElement('div')
  title.textContent = siteName || '写真一覧'
  Object.assign(title.style, { fontSize: '20px', fontWeight: '700' } as CSSStyleDeclaration)
  const subtitle = document.createElement('div')
  subtitle.textContent = '写真一覧表'
  Object.assign(subtitle.style, { fontSize: '12px', color: '#6b7280', marginTop: '2px' } as CSSStyleDeclaration)
  titleBox.appendChild(title)
  titleBox.appendChild(subtitle)
  const metaBox = document.createElement('div')
  Object.assign(metaBox.style, { textAlign: 'right', fontSize: '11px', color: '#374151' } as CSSStyleDeclaration)
  metaBox.appendChild(textLine(`出力日: ${dateStr}`))
  metaBox.appendChild(textLine(`写真: ${total}件`))
  metaBox.appendChild(textLine(`${pageNo} / ${pageCount} ページ`))
  header.appendChild(titleBox)
  header.appendChild(metaBox)
  pageDiv.appendChild(header)

  // 表ヘッダー行
  const headRow = document.createElement('div')
  Object.assign(headRow.style, {
    display: 'flex', alignItems: 'center',
    background: '#1565C0', color: '#ffffff',
    fontSize: '11px', fontWeight: '700',
    padding: '6px 8px', borderRadius: '3px 3px 0 0',
  } as CSSStyleDeclaration)
  headRow.appendChild(cell('No', '36px'))
  headRow.appendChild(cell('写真', '70px'))
  headRow.appendChild(cell('ファイル名', 'auto'))
  headRow.appendChild(cell('撮影時刻', '130px'))
  pageDiv.appendChild(headRow)

  // データ行
  const rowEls: { el: HTMLElement; cloudUrl: string }[] = []
  for (const e of rows) {
    const row = document.createElement('div')
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center',
      borderBottom: '1px solid #e5e7eb',
      borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb',
      padding: '6px 8px', height: '70px', boxSizing: 'border-box',
      fontSize: '12px',
    } as CSSStyleDeclaration)

    const noEl = cell(String(e.no), '36px')
    Object.assign(noEl.style, { fontWeight: '700', color: '#1565C0' } as CSSStyleDeclaration)
    row.appendChild(noEl)

    const thumbWrap = document.createElement('div')
    Object.assign(thumbWrap.style, { width: '70px', flexShrink: '0' } as CSSStyleDeclaration)
    const img = document.createElement('img')
    img.src = e.thumbDataUrl
    Object.assign(img.style, {
      width: '56px', height: '56px', objectFit: 'cover',
      borderRadius: '3px', display: 'block',
    } as CSSStyleDeclaration)
    thumbWrap.appendChild(img)
    row.appendChild(thumbWrap)

    const nameWrap = document.createElement('div')
    Object.assign(nameWrap.style, { flex: '1', minWidth: '0' } as CSSStyleDeclaration)
    const name = document.createElement('div')
    name.textContent = `${e.is360 ? '🌐 ' : ''}${middleTruncate(e.fileName)}`
    // overflow:hidden＋1行省略はhtml2canvasの文字下ズレ描画でクリップされ
    // 文字の下側が切れるため使わない。折り返しで全文を表示する（行高70px内に2行まで収まる）
    Object.assign(name.style, {
      fontWeight: '600',
      fontSize: '11px',
      lineHeight: '1.5',
      wordBreak: 'break-all',
      paddingRight: '8px',
      color: e.cloudUrl ? '#1565C0' : '#111827',
      textDecoration: e.cloudUrl ? 'underline' : 'none',
    } as CSSStyleDeclaration)
    nameWrap.appendChild(name)
    if (!e.cloudUrl) {
      const noLink = document.createElement('div')
      noLink.textContent = '（リンクなし）'
      Object.assign(noLink.style, { fontSize: '10px', color: '#9ca3af', marginTop: '2px' } as CSSStyleDeclaration)
      nameWrap.appendChild(noLink)
    }
    row.appendChild(nameWrap)

    row.appendChild(cell(e.takenAt ?? '—', '130px'))

    pageDiv.appendChild(row)
    if (e.cloudUrl) rowEls.push({ el: row, cloudUrl: e.cloudUrl })
  }

  return { pageDiv, rowEls }
}

function cell(text: string, width: string): HTMLDivElement {
  const d = document.createElement('div')
  d.textContent = text
  d.style.lineHeight = '1.5'
  if (width === 'auto') {
    Object.assign(d.style, { flex: '1', minWidth: '0' } as CSSStyleDeclaration)
  } else {
    Object.assign(d.style, { width, flexShrink: '0' } as CSSStyleDeclaration)
  }
  return d
}

// 極端に長いファイル名のみ中間省略（2行分に収まる長さは全文表示）
function middleTruncate(name: string, max = 110): string {
  if (name.length <= max) return name
  const keep = Math.floor((max - 1) / 2)
  return name.slice(0, keep) + '…' + name.slice(-keep)
}

function textLine(text: string): HTMLDivElement {
  const d = document.createElement('div')
  d.textContent = text
  return d
}

function formatToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

// ===== html2canvas 動的ロード（地図モードloadScriptと同方針。依存追加なし） =====
type Html2Canvas = (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error(`load failed: ${src}`)))
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.onload = () => { s.dataset.loaded = 'true'; resolve() }
    s.onerror = () => reject(new Error(`load failed: ${src}`))
    document.head.appendChild(s)
  })
}
